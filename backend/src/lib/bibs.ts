import type { Event, Prisma, Registration } from '@prisma/client';
import { shiftDays, startOfDayInTz } from './notify';

/**
 * Стартовые номера (решения пользователя 2026-10-21).
 *
 *  - Номер выдаётся при оплате: наименьший свободный в диапазоне дистанции
 *    (event_distances.bib_from..bib_to), минуя резерв старта (bib_reserves)
 *    и уже занятые номера этого старта.
 *  - Абонемент — так же, как все: на каждом старте свой номер из диапазона
 *    дистанции, по порядку регистрации (отдельный диапазон абонементов убран
 *    решением пользователя 2026-10-28).
 *  - Отмена и возврат возвращают номер в пул — но после начала выдачи пакетов
 *    (первый pickup_slot старта; нет слотов — за 2 дня до старта) номер
 *    остаётся за записью: пакет с ним мог быть уже выдан.
 *  - Номер уникален в пределах старта (индекс в базе); выбор — под
 *    advisory-блокировкой старта, чтобы двое не получили один номер.
 *
 * Все функции работают внутри транзакции вызывающей стороны.
 */

type Tx = Prisma.TransactionClient;

export type Range = readonly [number, number];

export function rangesOverlap(a: Range, b: Range): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Начало выдачи пакетов: первый слот выдачи или (запасной вариант) за 2 дня до старта. */
export async function pickupStartsAt(tx: Tx, event: Pick<Event, 'id' | 'date'>): Promise<Date> {
  const first = await tx.pickupSlot.findFirst({ where: { eventId: event.id }, orderBy: { startsAt: 'asc' } });
  return first?.startsAt ?? startOfDayInTz(shiftDays(event.date, -2));
}

/** Выдача пакетов уже началась — номер не освобождаем, возврат по оферте не положен. */
export async function pickupStarted(tx: Tx, event: Pick<Event, 'id' | 'date'>, now: Date = new Date()): Promise<boolean> {
  return now.getTime() >= (await pickupStartsAt(tx, event)).getTime();
}

/** Блокировка на время выбора номера: ключи разведены по типу, чтобы старт 1 и сезон 1 не мешали друг другу. */
async function lock(tx: Tx, kind: 'event' | 'season', id: number): Promise<void> {
  // Два int4 — так Postgres выбирает вариант функции с парой ключей (Prisma шлёт числа как bigint).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${kind === 'event' ? 51_001 : 51_002}::int4, ${id}::int4)`;
}

/** Наименьший свободный номер дистанции на старте; null — диапазона нет или он исчерпан. */
async function freeEventBib(tx: Tx, eventId: number, from: number, to: number): Promise<number | null> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT n::int AS n FROM generate_series(${from}::int, ${to}::int) AS n
    WHERE NOT EXISTS (SELECT 1 FROM "registrations" r WHERE r."event_id" = ${eventId} AND r."bib_number" = n)
      AND NOT EXISTS (SELECT 1 FROM "bib_reserves" b WHERE b."event_id" = ${eventId} AND n BETWEEN b."bib_from" AND b."bib_to")
    ORDER BY n LIMIT 1`;
  return rows[0]?.n ?? null;
}

/**
 * Номер для оплаченной регистрации (и разовой, и из абонемента). Уже есть —
 * оставляем. Возвращает номер или null (у дистанции не задан диапазон или он
 * закончился — админка это покажет).
 */
export async function assignRegistrationBib(tx: Tx, registrationId: number): Promise<number | null> {
  const reg = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { distance: true } });
  if (reg.bibNumber !== null) return reg.bibNumber;
  const d = reg.distance;
  if (!d || d.bibFrom === null || d.bibTo === null) return null;
  await lock(tx, 'event', reg.eventId);
  const n = await freeEventBib(tx, reg.eventId, d.bibFrom, d.bibTo);
  if (n === null) return null;
  await tx.registration.update({ where: { id: reg.id }, data: { bibNumber: n } });
  return n;
}

/**
 * Запись отменена или оформлен возврат: номер — обратно в пул, если выдача
 * пакетов ещё не началась. Возвращает 'released' | 'kept' | 'none'.
 */
export async function releaseRegistrationBib(
  tx: Tx,
  reg: Pick<Registration, 'id' | 'eventId' | 'bibNumber'>,
  now: Date = new Date(),
): Promise<'released' | 'kept' | 'none'> {
  if (reg.bibNumber === null) return 'none';
  const event = await tx.event.findUniqueOrThrow({ where: { id: reg.eventId }, select: { id: true, date: true } });
  if (await pickupStarted(tx, event, now)) return 'kept';
  await tx.registration.update({ where: { id: reg.id }, data: { bibNumber: null } });
  return 'released';
}

export class BibError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Ручная смена номера из админки — только на этом старте (у абонемента номера
 * на каждом старте свои). null — снять номер.
 */
export async function setBibManually(tx: Tx, registrationId: number, bib: number | null): Promise<{ changed: number[] }> {
  const reg = await tx.registration.findUniqueOrThrow({ where: { id: registrationId } });
  if (bib !== null) {
    await lock(tx, 'event', reg.eventId);
    const taken = await tx.registration.findFirst({
      where: { eventId: reg.eventId, bibNumber: bib, id: { not: reg.id } },
      include: { user: true, event: true },
    });
    if (taken) {
      throw new BibError(
        `Номер ${bib} на старте «${taken.event.title}» уже у ${[taken.user.lastName, taken.user.firstName].filter(Boolean).join(' ')}`,
      );
    }
  }
  await tx.registration.update({ where: { id: reg.id }, data: { bibNumber: bib } });
  return { changed: [reg.id] };
}

/**
 * Выдать номера оплаченным без номера (после того как задали диапазоны).
 * Возвращает, скольким выдали и скольким не хватило номеров.
 */
export async function assignMissingBibs(tx: Tx, eventId: number): Promise<{ assigned: number; missing: number }> {
  const regs = await tx.registration.findMany({
    where: { eventId, paymentStatus: 'PAID', bibNumber: null },
    orderBy: { registeredAt: 'asc' },
  });
  let assigned = 0;
  for (const r of regs) if ((await assignRegistrationBib(tx, r.id)) !== null) assigned++;
  return { assigned, missing: regs.length - assigned };
}
