import type { EventDistance, Prisma } from '@prisma/client';

/**
 * Дистанции старта и места на них.
 *
 * У старта может быть несколько дистанций (5 км, 3 км…) — у каждой свой лимит,
 * счётчик занятых мест и цена. Места занимаются и освобождаются ТОЛЬКО через
 * функции этого модуля: они меняют счётчик дистанции одним условным UPDATE (двое
 * не займут последнее место) и тут же пересчитывают сводку в самом старте
 * (events.distance / slots_total / slots_taken / price). Сводку читают старые
 * места кода — тексты бота, напоминания, список стартов, — и откат на прошлую
 * версию приложения тоже продолжает работать.
 */

type Tx = Prisma.TransactionClient;

/** Порядок дистанций везде одинаковый: как задан в админке. */
export const DISTANCE_ORDER: Prisma.EventDistanceOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { id: 'asc' },
];

export function serializeDistance(d: EventDistance) {
  return {
    id: d.id,
    label: d.label,
    // Дистанция из справочника — по ней фильтруются результаты.
    catalogId: d.catalogId,
    // Диапазон стартовых номеров (lib/bibs); null — номера не выдаются.
    bibFrom: d.bibFrom,
    bibTo: d.bibTo,
    slotsTotal: d.slotsTotal,
    slotsTaken: d.slotsTaken,
    slotsLeft: Math.max(0, d.slotsTotal - d.slotsTaken),
    price: Number(d.price),
    seasonPass: d.seasonPass,
  };
}

/** «5 км» → 5000, «21,1 км» → 21100, «500 м» → 500; не понять — null. */
export function metersFromLabel(label: string): number | null {
  const km = label.match(/^\s*(\d+(?:[.,]\d+)?)\s*км/i);
  if (km) return Math.round(Number(km[1].replace(',', '.')) * 1000);
  const m = label.match(/^\s*(\d+)\s*м/i);
  return m ? Number(m[1]) : null;
}

/**
 * Дистанция справочника по названию: «5 км» у разных стартов — одна запись
 * (без учёта регистра и лишних пробелов). Нет такой — заводим новую.
 */
export async function catalogIdFor(tx: Tx, label: string): Promise<number> {
  const clean = label.trim().replace(/\s+/g, ' ');
  const found = await tx.distance.findFirst({ where: { label: { equals: clean, mode: 'insensitive' } } });
  if (found) return found.id;
  const meters = metersFromLabel(clean);
  const created = await tx.distance.create({ data: { label: clean, meters, sortOrder: meters ?? 1_000_000 } });
  return created.id;
}

/**
 * Сводка старта по его дистанциям: лимит и занято — сумма, цена — минимальная
 * («от»), название — через « / ». Вызывается после любого изменения мест или
 * состава дистанций в той же транзакции.
 */
export async function syncEventTotals(tx: Tx, eventId: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "events" e SET
      "slots_total" = s.total,
      "slots_taken" = s.taken,
      "price" = s.min_price,
      "distance" = s.labels
    FROM (
      SELECT
        COALESCE(SUM("slots_total"), 0)::int AS total,
        COALESCE(SUM("slots_taken"), 0)::int AS taken,
        COALESCE(MIN("price"), 0) AS min_price,
        COALESCE(string_agg("label", ' / ' ORDER BY "sort_order", "id"), '') AS labels
      FROM "event_distances" WHERE "event_id" = ${eventId}
    ) s
    WHERE e."id" = ${eventId} AND EXISTS (SELECT 1 FROM "event_distances" WHERE "event_id" = ${eventId})`;
}

/** Занять место на дистанции. false — мест нет. */
export async function claimDistanceSlot(tx: Tx, distanceId: number): Promise<boolean> {
  const changed = await tx.$executeRaw`
    UPDATE "event_distances" SET "slots_taken" = "slots_taken" + 1
    WHERE "id" = ${distanceId} AND "slots_taken" < "slots_total"`;
  if (changed !== 1) return false;
  await syncEventTotals(tx, await eventIdOf(tx, distanceId));
  return true;
}

/** Вернуть место на дистанцию (не ниже нуля). */
export async function releaseDistanceSlot(tx: Tx, distanceId: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "event_distances" SET "slots_taken" = "slots_taken" - 1
    WHERE "id" = ${distanceId} AND "slots_taken" > 0`;
  await syncEventTotals(tx, await eventIdOf(tx, distanceId));
}

async function eventIdOf(tx: Tx, distanceId: number): Promise<number> {
  const d = await tx.eventDistance.findUniqueOrThrow({
    where: { id: distanceId },
    select: { eventId: true },
  });
  return d.eventId;
}

/**
 * Дистанция для записи: выбранная участником (должна принадлежать старту) или,
 * если не выбрана (старое приложение), — первая по порядку. null — у старта нет
 * такой дистанции.
 */
export async function pickDistance(
  tx: Tx,
  eventId: number,
  distanceId?: number | null,
): Promise<EventDistance | null> {
  if (distanceId) {
    return tx.eventDistance.findFirst({ where: { id: distanceId, eventId } });
  }
  return tx.eventDistance.findFirst({ where: { eventId }, orderBy: DISTANCE_ORDER });
}

/** На какую дистанцию старта записывает абонемент. null — ни на какую. */
export function seasonDistanceOf(tx: Tx, eventId: number): Promise<EventDistance | null> {
  return tx.eventDistance.findFirst({ where: { eventId, seasonPass: true }, orderBy: DISTANCE_ORDER });
}

/**
 * Дистанция регистрации — для освобождения или возврата её места. Если у
 * старой записи дистанции нет (удалили из старта), берём первую дистанцию
 * старта, чтобы счётчики не разъехались.
 */
export async function distanceIdOf(
  tx: Tx,
  reg: { eventId: number; distanceId: number | null },
): Promise<number | null> {
  if (reg.distanceId) return reg.distanceId;
  const first = await pickDistance(tx, reg.eventId);
  return first?.id ?? null;
}
