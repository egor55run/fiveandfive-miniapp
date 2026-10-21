import type { Event, Prisma, Registration } from '@prisma/client';
import { shiftDays, startOfDayInTz } from './notify';

/**
 * Стартовые номера (решения пользователя 2026-10-21).
 *
 *  - Номер выдаётся при оплате: наименьший свободный в диапазоне дистанции
 *    (event_distances.bib_from..bib_to), минуя резерв старта (bib_reserves)
 *    и уже занятые номера этого старта.
 *  - Абонемент — один номер на весь сезон из seasons.pass_bib_from..to; этот
 *    номер стоит на всех регистрациях абонемента.
 *  - Отмена и возврат возвращают номер в пул — но после начала выдачи пакетов
 *    (первый pickup_slot старта; нет слотов — за 2 дня до старта) номер
 *    остаётся за записью: пакет с ним мог быть уже выдан.
 *  - Номер уникален в пределах старта (индекс в базе); выбор — под
 *    advisory-блокировкой старта/сезона, чтобы двое не получили один номер.
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
 * Номер для оплаченной регистрации. Уже есть — оставляем. Абонемент — номер
 * абонемента (выдаётся при необходимости). Возвращает номер или null (у
 * дистанции не задан диапазон или он закончился — админка это покажет).
 */
export async function assignRegistrationBib(tx: Tx, registrationId: number): Promise<number | null> {
  const reg = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { distance: true } });
  if (reg.bibNumber !== null) return reg.bibNumber;
  if (reg.seasonPassId) {
    const passBib = await assignPassBib(tx, reg.seasonPassId);
    if (passBib === null) return null;
    // Номер абонемента на этом старте мог занять кто-то вручную — тогда не ставим.
    const taken = await tx.registration.findFirst({ where: { eventId: reg.eventId, bibNumber: passBib, id: { not: reg.id } } });
    if (taken) return null;
    await tx.registration.update({ where: { id: reg.id }, data: { bibNumber: passBib } });
    return passBib;
  }
  const d = reg.distance;
  if (!d || d.bibFrom === null || d.bibTo === null) return null;
  await lock(tx, 'event', reg.eventId);
  const n = await freeEventBib(tx, reg.eventId, d.bibFrom, d.bibTo);
  if (n === null) return null;
  await tx.registration.update({ where: { id: reg.id }, data: { bibNumber: n } });
  return n;
}

/**
 * Номер абонемента — один на сезон. Свободен, если его нет ни у другого
 * абонемента сезона, ни у какой регистрации на старты сезона.
 */
export async function assignPassBib(tx: Tx, seasonPassId: number): Promise<number | null> {
  const pass = await tx.seasonPass.findUniqueOrThrow({ where: { id: seasonPassId }, include: { season: true } });
  if (pass.bibNumber !== null) return pass.bibNumber;
  const { passBibFrom: from, passBibTo: to } = pass.season;
  if (from === null || to === null) return null;
  await lock(tx, 'season', pass.seasonId);
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT n::int AS n FROM generate_series(${from}::int, ${to}::int) AS n
    WHERE NOT EXISTS (SELECT 1 FROM "season_passes" p WHERE p."season_id" = ${pass.seasonId} AND p."bib_number" = n)
      AND NOT EXISTS (
        SELECT 1 FROM "registrations" r JOIN "events" e ON e."id" = r."event_id"
        WHERE e."season_id" = ${pass.seasonId} AND r."bib_number" = n)
    ORDER BY n LIMIT 1`;
  const n = rows[0]?.n ?? null;
  if (n === null) return null;
  await tx.seasonPass.update({ where: { id: pass.id }, data: { bibNumber: n } });
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

/**
 * Абонемент возвращён целиком: его номер освобождается, если ни одна из его
 * регистраций номер не удержала (выдача пакетов на том старте уже шла).
 */
export async function releasePassBib(tx: Tx, seasonPassId: number): Promise<void> {
  const pass = await tx.seasonPass.findUniqueOrThrow({ where: { id: seasonPassId } });
  if (pass.bibNumber === null) return;
  const holding = await tx.registration.count({ where: { seasonPassId, bibNumber: pass.bibNumber } });
  if (holding === 0) await tx.seasonPass.update({ where: { id: seasonPassId }, data: { bibNumber: null } });
}

export class BibError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Ручная смена номера из админки. У абонемента номер общий на сезон — меняется
 * у абонемента и у всех его регистраций (на каждом старте должен быть свободен).
 * null — снять номер.
 */
export async function setBibManually(tx: Tx, registrationId: number, bib: number | null): Promise<{ changed: number[] }> {
  const reg = await tx.registration.findUniqueOrThrow({ where: { id: registrationId } });
  const targets = reg.seasonPassId
    ? await tx.registration.findMany({ where: { seasonPassId: reg.seasonPassId, paymentStatus: { not: 'CANCELLED' } } })
    : [reg];
  if (!targets.some((t) => t.id === reg.id)) targets.push(reg);
  if (bib !== null) {
    for (const t of targets) {
      await lock(tx, 'event', t.eventId);
      const taken = await tx.registration.findFirst({
        where: { eventId: t.eventId, bibNumber: bib, id: { notIn: targets.map((x) => x.id) } },
        include: { user: true, event: true },
      });
      if (taken) {
        throw new BibError(
          `Номер ${bib} на старте «${taken.event.title}» уже у ${[taken.user.lastName, taken.user.firstName].filter(Boolean).join(' ')}`,
        );
      }
    }
    if (reg.seasonPassId) {
      const other = await tx.seasonPass.findFirst({
        where: { seasonId: (await tx.seasonPass.findUniqueOrThrow({ where: { id: reg.seasonPassId } })).seasonId, bibNumber: bib, id: { not: reg.seasonPassId } },
      });
      if (other) throw new BibError(`Номер ${bib} уже у другого абонемента этого сезона`);
    }
  }
  if (reg.seasonPassId) await tx.seasonPass.update({ where: { id: reg.seasonPassId }, data: { bibNumber: bib } });
  for (const t of targets) await tx.registration.update({ where: { id: t.id }, data: { bibNumber: bib } });
  return { changed: targets.map((t) => t.id) };
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
