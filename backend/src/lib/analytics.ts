import type { Gender, Prisma } from '@prisma/client';
import { PUBLISHED_RESULT } from './results';
import { prisma } from '../prisma';

/**
 * Аналитика участника в Mini App (2026-11-11): сравнение с другими по каждой
 * дистанции. Только финиши опубликованных стартов (сошедшие, не стартовавшие и
 * дисквалифицированные не считаются). Наружу — только числа: сколько человек в
 * сравнении и сколько из них медленнее; имён нет.
 */

/**
 * Сколько человек в сравнении (без самого участника), сколько из них медленнее и
 * среднее время финишёров этой группы на этом забеге (с участником, если он в
 * группе); avg — только у сравнения по забегу.
 */
export type Compare = { others: number; slower: number; avg?: number };
export type CompareByGroup = { all: Compare; MALE: Compare; FEMALE: Compare };

export type MyResult = {
  id: number;
  userId: number;
  eventId: number;
  eventDistanceId: number | null;
  finishTime: number | null;
  eventDistance: { label: string; catalogId: number; catalog: { label: string; meters: number | null } } | null;
};

/** Ключ дистанции: дистанция из справочника (5 км на всех стартах — одна). */
export const distanceKey = (r: Pick<MyResult, 'eventDistance' | 'eventId'>) =>
  r.eventDistance ? `d${r.eventDistance.catalogId}` : `e${r.eventId}`;

const FINISHED: Prisma.ResultWhereInput = { status: 'FINISHED', finishTime: { not: null }, ...PUBLISHED_RESULT };

function compare(mine: number, rows: { time: number; gender: Gender | null }[]): CompareByGroup {
  const of = (list: typeof rows): Compare => ({ others: list.length, slower: list.filter((r) => r.time > mine).length });
  return {
    all: of(rows),
    MALE: of(rows.filter((r) => r.gender === 'MALE')),
    FEMALE: of(rows.filter((r) => r.gender === 'FEMALE')),
  };
}

/**
 * По каждому забегу — сравнение с теми, кто бежал ту же дистанцию на том же
 * старте, и место среди своего пола на этой дистанции; по каждой дистанции —
 * сравнение личного рекорда с лучшими временами всех, кто бежал её на стартах 5&5.
 */
export async function myAnalytics(userId: number, gender: Gender | null, results: MyResult[]) {
  const finished = results.filter((r) => r.finishTime !== null);
  if (finished.length === 0) return { perResult: new Map<number, { compare: CompareByGroup; place: number; of: number }>(), distances: [] };

  // Все финиши на «своих» стартах — одним запросом.
  const sameRace = await prisma.result.findMany({
    where: { ...FINISHED, eventId: { in: [...new Set(finished.map((r) => r.eventId))] } },
    select: { userId: true, eventId: true, eventDistanceId: true, finishTime: true, user: { select: { gender: true } } },
  });
  const perResult = new Map<number, { compare: CompareByGroup; place: number; of: number }>();
  for (const r of finished) {
    const peers = sameRace.filter((x) => x.eventId === r.eventId && x.eventDistanceId === r.eventDistanceId && x.userId !== userId);
    const rows = peers.map((x) => ({ time: x.finishTime!, gender: x.user.gender }));
    const own = gender ? rows.filter((x) => x.gender === gender) : rows;
    // Среднее время на этой дистанции этого старта — по группе (все / мужчины / женщины).
    const avgOf = (list: typeof rows, includeMe: boolean) => {
      const times = [...list.map((x) => x.time), ...(includeMe ? [r.finishTime!] : [])];
      return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : undefined;
    };
    const cmp = compare(r.finishTime!, rows);
    cmp.all.avg = avgOf(rows, true);
    cmp.MALE.avg = avgOf(rows.filter((x) => x.gender === 'MALE'), gender === 'MALE');
    cmp.FEMALE.avg = avgOf(rows.filter((x) => x.gender === 'FEMALE'), gender === 'FEMALE');
    perResult.set(r.id, {
      compare: cmp,
      // Место на своей дистанции среди своего пола (пол не указан — среди всех).
      place: 1 + own.filter((x) => x.time < r.finishTime!).length,
      of: own.length + 1,
    });
  }

  // За всё время: лучшее время каждого человека на этой дистанции (справочник).
  const catalogIds = [...new Set(finished.filter((r) => r.eventDistance).map((r) => r.eventDistance!.catalogId))];
  const allTime = catalogIds.length
    ? await prisma.result.findMany({
        where: { ...FINISHED, eventDistance: { catalogId: { in: catalogIds } } },
        select: { userId: true, finishTime: true, eventDistance: { select: { catalogId: true } }, user: { select: { gender: true } } },
      })
    : [];
  const distances = catalogIds.map((catalogId) => {
    const mine = finished.filter((r) => r.eventDistance?.catalogId === catalogId);
    const best = Math.min(...mine.map((r) => r.finishTime!));
    const bestOf = new Map<number, { time: number; gender: Gender | null }>();
    for (const x of allTime) {
      if (x.eventDistance?.catalogId !== catalogId || x.userId === userId) continue;
      const prev = bestOf.get(x.userId);
      if (!prev || x.finishTime! < prev.time) bestOf.set(x.userId, { time: x.finishTime!, gender: x.user.gender });
    }
    return {
      key: `d${catalogId}`,
      label: mine[0].eventDistance!.catalog.label,
      meters: mine[0].eventDistance!.catalog.meters,
      best,
      runs: mine.length,
      compare: compare(best, [...bestOf.values()]),
    };
  });
  return { perResult, distances };
}
