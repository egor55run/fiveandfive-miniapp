import type { Gender, Prisma, ResultStatus } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Рейтинг серии (решения пользователя 2026-10-23).
 *
 *  - Баллы за этап: 1000 + 4340 × ((T0 / T)^0.164 − 1), T — время от
 *    выстрела (gun time) на 5 км. T0 = 15:00 у мужчин, 17:15 у женщин.
 *    Округление до целого. Финиш позже 60:00 — 10 баллов (и вообще не меньше
 *    10 за финиш). Сошёл / не стартовал / дисквалифицирован — 0.
 *  - В рейтинг идёт только дистанция 5 км (справочник distances, 5000 м).
 *  - Сезон — сумма баллов за все этапы, без коэффициентов. Зачёт только
 *    абсолютный, отдельно М и Ж. Ничья — выше тот, у кого лучшее время на
 *    одном этапе; если и оно равно — место делят.
 *  - Участник без пола в зачёт не попадает (пол обязателен с 23.10).
 *  - «Не показывать меня в публичном рейтинге» — имя скрыто, место и баллы
 *    остаются; сам человек себя видит.
 *  - Результаты этапа видны публично только после публикации
 *    (events.results_published_at); 48 часов после неё — окно протестов,
 *    результаты «предварительные».
 *
 * Баллы не хранятся — считаются из времени, так любая правка времени сразу
 * пересчитывает рейтинг.
 */

export const T0: Record<Gender, number> = { MALE: 15 * 60, FEMALE: 17 * 60 + 15 };
export const RATING_METERS = 5000;
export const CUTOFF_SECONDS = 60 * 60;
export const MIN_POINTS = 10;
export const PROTEST_HOURS = 48;

/** Баллы за время T (секунды) у пола gender. */
export function pointsFor(seconds: number, gender: Gender): number {
  if (seconds > CUTOFF_SECONDS) return MIN_POINTS;
  const raw = 1000 + 4340 * ((T0[gender] / seconds) ** 0.164 - 1);
  return Math.max(MIN_POINTS, Math.round(raw));
}

export function resultPoints(r: { status: ResultStatus; finishTime: number | null }, gender: Gender | null): number {
  if (r.status !== 'FINISHED' || r.finishTime === null || !gender) return 0;
  return pointsFor(r.finishTime, gender);
}

/** До какого момента идёт окно протестов; null — результаты не опубликованы. */
export function protestUntil(publishedAt: Date | null): Date | null {
  return publishedAt ? new Date(publishedAt.getTime() + PROTEST_HOURS * 3_600_000) : null;
}

type Tx = Prisma.TransactionClient;

/**
 * Места на старте: среди всех финишировавших (place) и среди своего пола
 * (genderPlace). Равные времена делят место (1, 2, 2, 4). Не финишировавшим —
 * null. Вызывается после любой правки результатов.
 */
export async function recomputePlaces(tx: Tx, eventId: number): Promise<void> {
  const rows = await tx.result.findMany({
    where: { eventId },
    include: { user: { select: { gender: true } } },
    orderBy: [{ finishTime: 'asc' }, { id: 'asc' }],
  });
  const finished = rows.filter((r) => r.status === 'FINISHED' && r.finishTime !== null);
  const rank = (list: typeof finished) => {
    const out = new Map<number, number>();
    list.forEach((r, i) => {
      const prev = i > 0 ? list[i - 1] : null;
      out.set(r.id, prev && prev.finishTime === r.finishTime ? out.get(prev.id)! : i + 1);
    });
    return out;
  };
  const overall = rank(finished);
  const byGender = new Map<number, number>();
  for (const g of ['MALE', 'FEMALE'] as const) {
    for (const [id, p] of rank(finished.filter((r) => r.user.gender === g))) byGender.set(id, p);
  }
  for (const r of rows) {
    const place = overall.get(r.id) ?? null;
    const genderPlace = byGender.get(r.id) ?? null;
    if (r.place !== place || r.genderPlace !== genderPlace) {
      await tx.result.update({ where: { id: r.id }, data: { place, genderPlace } });
    }
  }
}

/** Имя для публичного списка: скрывшие себя — без имени. */
function publicName(u: { lastName: string | null; firstName: string; hideFromRating: boolean }, reveal: boolean): string {
  if (u.hideFromRating && !reveal) return 'Участник скрыл имя';
  return [u.lastName, u.firstName].filter(Boolean).join(' ');
}

export type StageRow = {
  place: number | null;
  name: string;
  userId: number;
  bib: number | null;
  gender: Gender;
  time: number | null;
  status: ResultStatus;
  points: number;
  hidden: boolean;
  me: boolean;
};

/** Старт входит в рейтинг: у него есть дистанция 5 км из справочника. */
async function ratingDistanceIds(eventIds: number[]): Promise<Map<number, number[]>> {
  const ds = await prisma.eventDistance.findMany({
    where: { eventId: { in: eventIds }, catalog: { meters: RATING_METERS } },
    select: { id: true, eventId: true },
  });
  const out = new Map<number, number[]>();
  for (const d of ds) out.set(d.eventId, [...(out.get(d.eventId) ?? []), d.id]);
  return out;
}

/**
 * Протокол этапа по полам: места, время, баллы. publicOnly — только
 * опубликованные результаты (сайт, приложение); админка видит всё.
 */
export async function stageProtocol(
  eventId: number,
  opts: { publicOnly: boolean; meUserId?: number | null },
): Promise<{ published: boolean; publishedAt: Date | null; protestUntil: Date | null; men: StageRow[]; women: StageRow[] } | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;
  const published = event.resultsPublishedAt !== null;
  const base = { published, publishedAt: event.resultsPublishedAt, protestUntil: protestUntil(event.resultsPublishedAt) };
  if (opts.publicOnly && !published) return { ...base, men: [], women: [] };
  const dist = (await ratingDistanceIds([eventId])).get(eventId) ?? [];
  const results = await prisma.result.findMany({
    where: { eventId, eventDistanceId: { in: dist } },
    include: { user: true },
  });
  const regs = await prisma.registration.findMany({
    where: { eventId, userId: { in: results.map((r) => r.userId) } },
    select: { userId: true, bibNumber: true },
  });
  const bibOf = new Map(regs.map((r) => [r.userId, r.bibNumber]));
  const rows = (g: Gender): StageRow[] =>
    results
      .filter((r) => r.user.gender === g)
      .map((r) => {
        const me = opts.meUserId === r.userId;
        return {
          place: r.genderPlace,
          name: publicName(r.user, me || !opts.publicOnly),
          userId: r.userId,
          bib: bibOf.get(r.userId) ?? null,
          gender: g,
          time: r.finishTime,
          status: r.status,
          points: resultPoints(r, g),
          hidden: r.user.hideFromRating,
          me,
        };
      })
      .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
  return { ...base, men: rows('MALE'), women: rows('FEMALE') };
}

export type SeasonRow = {
  place: number;
  name: string;
  userId: number;
  gender: Gender;
  total: number;
  /** Баллы по этапам в порядке календаря; null — не участвовал. */
  stages: (number | null)[];
  bestTime: number | null;
  hidden: boolean;
  me: boolean;
};

/**
 * Таблица сезона: сумма баллов за опубликованные этапы, отдельно М и Ж.
 * Ничья — выше лучшее время на одном этапе; равны и они — место общее.
 */
export async function seasonStandings(
  seasonId: number,
  opts: { publicOnly: boolean; meUserId?: number | null },
): Promise<{ events: { id: number; title: string; slug: string | null; date: Date; published: boolean }[]; men: SeasonRow[]; women: SeasonRow[] }> {
  const events = await prisma.event.findMany({ where: { seasonId }, orderBy: { date: 'asc' } });
  const counted = events.filter((e) => !opts.publicOnly || e.resultsPublishedAt !== null);
  const dist = await ratingDistanceIds(counted.map((e) => e.id));
  const results = await prisma.result.findMany({
    where: {
      eventId: { in: counted.map((e) => e.id) },
      eventDistanceId: { in: [...dist.values()].flat() },
    },
    include: { user: true },
  });
  const index = new Map(events.map((e, i) => [e.id, i]));
  const byUser = new Map<number, SeasonRow>();
  for (const r of results) {
    const g = r.user.gender;
    if (!g) continue; // без пола — вне зачёта
    const me = opts.meUserId === r.userId;
    const row =
      byUser.get(r.userId) ??
      ({
        place: 0,
        name: publicName(r.user, me || !opts.publicOnly),
        userId: r.userId,
        gender: g,
        total: 0,
        stages: events.map(() => null),
        bestTime: null,
        hidden: r.user.hideFromRating,
        me,
      } satisfies SeasonRow);
    const pts = resultPoints(r, g);
    row.stages[index.get(r.eventId)!] = pts;
    row.total += pts;
    if (r.status === 'FINISHED' && r.finishTime !== null && (row.bestTime === null || r.finishTime < row.bestTime)) {
      row.bestTime = r.finishTime;
    }
    byUser.set(r.userId, row);
  }
  const table = (g: Gender) => {
    const list = [...byUser.values()]
      .filter((r) => r.gender === g)
      .sort((a, b) => b.total - a.total || (a.bestTime ?? Infinity) - (b.bestTime ?? Infinity) || a.name.localeCompare(b.name));
    list.forEach((r, i) => {
      const prev = i > 0 ? list[i - 1] : null;
      r.place = prev && prev.total === r.total && prev.bestTime === r.bestTime ? prev.place : i + 1;
    });
    return list;
  };
  return {
    events: events.map((e) => ({ id: e.id, title: e.title, slug: e.slug, date: e.date, published: e.resultsPublishedAt !== null })),
    men: table('MALE'),
    women: table('FEMALE'),
  };
}
