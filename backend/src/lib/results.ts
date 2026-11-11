import type { Gender, Prisma, ResultStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { protestUntil } from './rating';

/**
 * Результаты по дистанциям (2026-11-11). Каждая дистанция старта публикуется
 * отдельно, со своим окном протестов; event.resultsPublishedAt — момент первой
 * публикации на старте (по нему старт считается «с результатами»). У этапа
 * серии одна дистанция — для него всё как раньше.
 */

type Tx = Prisma.TransactionClient;

/** Результат виден участникам: опубликована его дистанция (старые записи без дистанции — по старту). */
export const PUBLISHED_RESULT: Prisma.ResultWhereInput = {
  OR: [
    { eventDistance: { resultsPublishedAt: { not: null } } },
    { eventDistanceId: null, event: { resultsPublishedAt: { not: null } } },
  ],
};

/** event.resultsPublishedAt = самая ранняя публикация среди дистанций; ни одной — null. */
export async function syncEventPublished(tx: Tx, eventId: number): Promise<void> {
  const ds = await tx.eventDistance.findMany({ where: { eventId, resultsPublishedAt: { not: null } }, select: { resultsPublishedAt: true } });
  const first = ds.map((d) => d.resultsPublishedAt!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: first } });
}

/** «Фамилия Имя». */
const fullName = (u: { lastName: string | null; firstName: string }) => [u.lastName, u.firstName].filter(Boolean).join(' ');

export type ProtocolRow = { place: number | null; name: string; bib: number | null; time: number | null; status: ResultStatus; me: boolean };
export type DistanceProtocol = {
  distanceId: number;
  label: string;
  published: boolean;
  protestUntil: Date | null;
  men: ProtocolRow[];
  women: ProtocolRow[];
};

/**
 * Протокол старта по дистанциям: мужчины и женщины отдельно, место на своей
 * дистанции. Без баллов — для любого старта (у этапов баллы — на /reiting).
 * publicOnly — только опубликованные дистанции.
 */
export async function eventProtocol(eventId: number, opts: { publicOnly: boolean; meUserId?: number | null }): Promise<DistanceProtocol[]> {
  const distances = await prisma.eventDistance.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  const shown = distances.filter((d) => !opts.publicOnly || d.resultsPublishedAt !== null);
  if (shown.length === 0) return [];
  const results = await prisma.result.findMany({
    where: { eventId, eventDistanceId: { in: shown.map((d) => d.id) } },
    include: { user: true },
  });
  const regs = await prisma.registration.findMany({
    where: { eventId, userId: { in: results.map((r) => r.userId) } },
    select: { userId: true, bibNumber: true },
  });
  const bibOf = new Map(regs.map((r) => [r.userId, r.bibNumber]));
  const rows = (distanceId: number, g: Gender): ProtocolRow[] =>
    results
      .filter((r) => r.eventDistanceId === distanceId && r.user.gender === g)
      .map((r) => ({
        place: r.genderPlace,
        name: fullName(r.user),
        bib: bibOf.get(r.userId) ?? null,
        time: r.finishTime,
        status: r.status,
        me: opts.meUserId === r.userId,
      }))
      .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
  return shown.map((d) => ({
    distanceId: d.id,
    label: d.label,
    published: d.resultsPublishedAt !== null,
    protestUntil: protestUntil(d.resultsPublishedAt),
    men: rows(d.id, 'MALE'),
    women: rows(d.id, 'FEMALE'),
  }));
}
