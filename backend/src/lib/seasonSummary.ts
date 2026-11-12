import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Gender, Prisma, Season } from '@prisma/client';
import { prisma } from '../prisma';
import { deliver } from './notify';
import { RATING_METERS, placesAfterStage, protestUntil, publishedStages, seasonStandings, stageProtocol } from './rating';

/**
 * Итоги сезона (2026-11-12).
 *
 * Кнопка «Подвести итоги сезона» в админке (можно, когда опубликованы все
 * этапы и кончилось окно протестов последнего) фиксирует итоговый рейтинг —
 * снимок в seasons.summary — и включает личные итоги в Mini App и рассылку
 * «Ваши итоги сезона готовы» (фоновая очередь, по 30 сообщений за проход).
 *
 * Публично (/itogi/<год>): топ-10 М и Ж, победители этапов (топ-3), рекорды
 * сезона, сезон в цифрах. До итогов — текущий рейтинг с пометкой «Сезон идёт».
 * Личные итоги считаются по результатам (они после итогов уже не меняются),
 * итоговое место — из снимка.
 */

const KM = RATING_METERS / 1000;
const fullName = (u: { lastName: string | null; firstName: string }) => [u.lastName, u.firstName].filter(Boolean).join(' ');
const APP_URL = (process.env.APP_URL ?? 'https://fiveandfive.kz').replace(/\/+$/, '');

type TopRow = { place: number; name: string; total: number; stages: number };
type Podium = { place: number; name: string; time: number | null };
export type PublicSummary = {
  year: number;
  title: string;
  publishedAt: string;
  stagesTotal: number;
  top: { men: TopRow[]; women: TopRow[] };
  stageWinners: { stage: number; title: string; slug: string | null; date: string; men: Podium[]; women: Podium[] }[];
  records: { men: { name: string; time: number; stage: number; title: string } | null; women: { name: string; time: number; stage: number; title: string } | null };
  stats: { participants: number; finishes: number; km: number; stars: number };
};
/** Что хранится в seasons.summary: публичная часть + итоговые места по userId (наружу не отдаём). */
type StoredSummary = PublicSummary & { places: Record<string, { place: number; of: number; gender: Gender; total: number }> };

/** Данные сезона: этапы, финиши на 5 км (только опубликованные этапы). */
async function seasonFinishes(seasonId: number) {
  const events = await prisma.event.findMany({ where: { seasonId }, orderBy: { date: 'asc' } });
  const stageNo = new Map(events.map((e, i) => [e.id, e.stageNumber ?? i + 1]));
  const results = await prisma.result.findMany({
    where: {
      eventId: { in: events.filter((e) => e.resultsPublishedAt !== null).map((e) => e.id) },
      eventDistance: { catalog: { meters: RATING_METERS } },
      status: 'FINISHED',
      finishTime: { not: null },
    },
    include: { user: true },
  });
  return { events, stageNo, results };
}

/** Можно ли подводить итоги: все этапы опубликованы, протесты по последнему закрыты. */
export async function summaryReadiness(seasonId: number): Promise<{ ready: boolean; reason: string | null; stagesPublished: number; stagesTotal: number; protestUntil: Date | null }> {
  const events = await prisma.event.findMany({ where: { seasonId }, orderBy: { date: 'asc' } });
  const published = events.filter((e) => e.resultsPublishedAt !== null);
  const last = events.at(-1);
  const until = last ? protestUntil(last.resultsPublishedAt) : null;
  let reason: string | null = null;
  if (events.length === 0) reason = 'В сезоне нет этапов';
  else if (published.length < events.length) reason = `Опубликованы результаты ${published.length} из ${events.length} этапов`;
  else if (until && until.getTime() > Date.now()) reason = 'Идёт окно протестов по последнему этапу';
  return { ready: reason === null, reason, stagesPublished: published.length, stagesTotal: events.length, protestUntil: until };
}

/** Посчитать итоги сезона (без сохранения). */
export async function computeSummary(season: Season): Promise<StoredSummary> {
  const { events, stageNo, results } = await seasonFinishes(season.id);
  const table = await seasonStandings(season.id, { publicOnly: true });
  const stagesOf = (row: { stages: (number | null)[] }) => row.stages.filter((p) => p !== null).length;
  const finishedStages = new Map<number, Set<number>>();
  for (const r of results) finishedStages.set(r.userId, (finishedStages.get(r.userId) ?? new Set()).add(r.eventId));
  const top = (rows: typeof table.men): TopRow[] =>
    rows.filter((r) => r.place <= 10).map((r) => ({ place: r.place, name: r.name, total: r.total, stages: finishedStages.get(r.userId)?.size ?? stagesOf(r) }));

  const stageWinners: PublicSummary['stageWinners'] = [];
  for (const e of events) {
    const p = await stageProtocol(e.id, { publicOnly: true });
    const podium = (rows: NonNullable<typeof p>['men']) =>
      rows.filter((r) => r.place !== null && r.place <= 3 && r.status === 'FINISHED').map((r) => ({ place: r.place!, name: r.name, time: r.time }));
    stageWinners.push({ stage: stageNo.get(e.id)!, title: e.title, slug: e.slug, date: e.date.toISOString(), men: p ? podium(p.men) : [], women: p ? podium(p.women) : [] });
  }

  const record = (g: Gender) => {
    const best = results.filter((r) => r.user.gender === g).sort((a, b) => a.finishTime! - b.finishTime!)[0];
    if (!best) return null;
    const e = events.find((x) => x.id === best.eventId)!;
    return { name: fullName(best.user), time: best.finishTime!, stage: stageNo.get(e.id)!, title: e.title };
  };

  const places: StoredSummary['places'] = {};
  for (const list of [table.men, table.women]) for (const r of list) places[String(r.userId)] = { place: r.place, of: list.length, gender: r.gender, total: r.total };

  const all = [...finishedStages.values()];
  return {
    year: season.year,
    title: season.title,
    publishedAt: new Date().toISOString(),
    stagesTotal: events.length,
    top: { men: top(table.men), women: top(table.women) },
    stageWinners,
    records: { men: record('MALE'), women: record('FEMALE') },
    stats: {
      participants: finishedStages.size,
      finishes: results.length,
      km: results.length * KM,
      stars: events.length > 0 ? all.filter((s) => s.size >= events.length).length : 0,
    },
    places,
  };
}

const publicPart = (s: StoredSummary): PublicSummary => {
  const { places: _places, ...rest } = s;
  return rest;
};

/** «Подвести итоги»: снимок + время. Повторно — пересчитать (сообщения не дублируются). */
export async function publishSummary(seasonId: number): Promise<{ recipients: number; republished: boolean }> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) throw new SummaryError('Сезон не найден', 404);
  const ready = await summaryReadiness(seasonId);
  if (!ready.ready) throw new SummaryError(`Пока нельзя: ${ready.reason}`);
  const summary = await computeSummary(season);
  await prisma.season.update({
    where: { id: seasonId },
    data: { summary: summary as unknown as Prisma.InputJsonValue, summaryPublishedAt: season.summaryPublishedAt ?? new Date() },
  });
  return { recipients: Object.keys(summary.places).length, republished: season.summaryPublishedAt !== null };
}

export class SummaryError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

// ---------- Публичная страница ----------

export async function publicSummaryByYear(year: number) {
  const season = await prisma.season.findFirst({ where: { year }, orderBy: { id: 'desc' } });
  if (!season) return null;
  const events = await prisma.event.findMany({ where: { seasonId: season.id }, orderBy: { date: 'asc' }, select: { id: true, title: true, slug: true, date: true, resultsPublishedAt: true } });
  const finalDate = events.at(-1)?.date ?? null;
  if (season.summaryPublishedAt && season.summary) {
    return { season: { year: season.year, title: season.title }, published: true as const, finalDate, summary: publicPart(season.summary as unknown as StoredSummary) };
  }
  // Сезон идёт: текущий рейтинг (топ-10), этапы и сколько уже прошло.
  const table = await seasonStandings(season.id, { publicOnly: true });
  const strip = (rows: typeof table.men) => rows.filter((r) => r.place <= 10).map((r) => ({ place: r.place, name: r.name, total: r.total, stages: r.stages.filter((p) => p !== null).length }));
  return {
    season: { year: season.year, title: season.title },
    published: false as const,
    finalDate,
    current: {
      stagesPublished: events.filter((e) => e.resultsPublishedAt !== null).length,
      stagesTotal: events.length,
      events: events.map((e) => ({ title: e.title, slug: e.slug, date: e.date, published: e.resultsPublishedAt !== null })),
      men: strip(table.men),
      women: strip(table.women),
    },
  };
}

/** Сезоны для sitemap и меню: год и подведены ли итоги. */
export async function summarySeasons() {
  const seasons = await prisma.season.findMany({ where: { events: { some: {} } }, orderBy: { year: 'asc' }, select: { year: true, summaryPublishedAt: true } });
  return seasons.map((s) => ({ year: s.year, published: s.summaryPublishedAt !== null }));
}

// ---------- Личные итоги ----------

export type PersonalSummary = {
  year: number;
  title: string;
  firstName: string;
  gender: Gender | null;
  stagesRun: number;
  stagesTotal: number;
  km: number;
  /** Лучший забег — лучшее место среди своего пола. */
  bestRace: { stage: number; title: string; place: number | null; of: number; time: number } | null;
  /** Личный рекорд — самое быстрое время. */
  record: { stage: number; title: string; time: number } | null;
  /** На сколько секунд лучшее время быстрее первого финиша сезона (null — не улучшали или один финиш). */
  improvement: number | null;
  final: { place: number; of: number; total: number } | null;
  history: { stage: number; title: string; place: number | null; of: number }[];
  /** Быстрее X% участников сезона своего пола (по лучшему времени). */
  fasterThan: number | null;
  rays: number;
  shareToken: string;
};

/** Токен картинки «Поделиться»: без внутреннего id, подделать нельзя. */
function shareSecret(): string {
  return process.env.SUMMARY_SHARE_SECRET?.trim() || `summary:${process.env.BOT_TOKEN ?? 'dev'}`;
}
export function shareToken(seasonId: number, userId: number): string {
  return createHmac('sha256', shareSecret()).update(`season-summary:${seasonId}:${userId}`).digest('base64url').slice(0, 24);
}

export async function personalSummary(season: Season, userId: number): Promise<PersonalSummary | null> {
  if (!season.summaryPublishedAt || !season.summary) return null;
  const stored = season.summary as unknown as StoredSummary;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const { events, stageNo, results } = await seasonFinishes(season.id);
  const mine = results.filter((r) => r.userId === userId).sort((a, b) => events.findIndex((e) => e.id === a.eventId) - events.findIndex((e) => e.id === b.eventId));
  if (mine.length === 0) return null;
  const titleOf = (eventId: number) => events.find((e) => e.id === eventId)?.title ?? '';

  const fastest = [...mine].sort((a, b) => a.finishTime! - b.finishTime!)[0];
  // Лучшее место среди своего пола на этапе: сколько финишёров того же пола.
  const ofOnStage = (eventId: number) => results.filter((r) => r.eventId === eventId && r.user.gender === user.gender).length;
  const byPlace = [...mine].filter((r) => r.genderPlace !== null).sort((a, b) => a.genderPlace! - b.genderPlace! || a.finishTime! - b.finishTime!)[0] ?? fastest;
  const first = mine[0];
  const improvement = mine.length > 1 && fastest.id !== first.id ? first.finishTime! - fastest.finishTime! : null;

  const history: PersonalSummary['history'] = [];
  for (const s of await publishedStages(season.id)) {
    const p = (await placesAfterStage(season.id, s.id)).get(userId);
    history.push({ stage: s.stage, title: s.title, place: p?.place ?? null, of: p?.of ?? 0 });
  }

  // Быстрее X%: лучшее время каждого участника своего пола.
  let fasterThan: number | null = null;
  if (user.gender) {
    const best = new Map<number, number>();
    for (const r of results) if (r.user.gender === user.gender) best.set(r.userId, Math.min(best.get(r.userId) ?? Infinity, r.finishTime!));
    const others = [...best.entries()].filter(([id]) => id !== userId).map(([, t]) => t);
    if (others.length > 0) fasterThan = Math.round((others.filter((t) => t > fastest.finishTime!).length / others.length) * 100);
  }

  const final = stored.places[String(userId)] ?? null;
  return {
    year: season.year,
    title: season.title,
    firstName: user.firstName,
    gender: user.gender,
    stagesRun: new Set(mine.map((r) => r.eventId)).size,
    stagesTotal: events.length,
    km: mine.length * KM,
    bestRace: { stage: stageNo.get(byPlace.eventId)!, title: titleOf(byPlace.eventId), place: byPlace.genderPlace, of: ofOnStage(byPlace.eventId), time: byPlace.finishTime! },
    record: { stage: stageNo.get(fastest.eventId)!, title: titleOf(fastest.eventId), time: fastest.finishTime! },
    improvement: improvement !== null && improvement > 0 ? improvement : null,
    final: final ? { place: final.place, of: final.of, total: final.total } : null,
    history,
    fasterThan,
    rays: Math.min(new Set(mine.map((r) => r.eventId)).size, 5),
    shareToken: shareToken(season.id, userId),
  };
}

/** Картинка «Поделиться»: найти участника по токену среди финишёров сезона. */
export async function summaryByShareToken(year: number, token: string): Promise<PersonalSummary | null> {
  const season = await prisma.season.findFirst({ where: { year, summaryPublishedAt: { not: null } }, orderBy: { id: 'desc' } });
  if (!season || !/^[A-Za-z0-9_-]{24}$/.test(token)) return null;
  const stored = season.summary as unknown as StoredSummary | null;
  if (!stored) return null;
  const want = Buffer.from(token);
  const { results } = await seasonFinishes(season.id);
  for (const id of new Set(results.map((r) => r.userId))) {
    const t = Buffer.from(shareToken(season.id, id));
    if (t.length === want.length && timingSafeEqual(t, want)) return personalSummary(season, id);
  }
  return null;
}

/** Сезон с подведёнными итогами, где у участника есть финиш, — для /me. */
export async function mySummaryAvailable(userId: number): Promise<{ year: number; title: string } | null> {
  const seasons = await prisma.season.findMany({ where: { summaryPublishedAt: { not: null } }, orderBy: { year: 'desc' }, take: 3 });
  for (const s of seasons) {
    const has = await prisma.result.count({
      where: { userId, status: 'FINISHED', event: { seasonId: s.id, resultsPublishedAt: { not: null } }, eventDistance: { catalog: { meters: RATING_METERS } } },
    });
    if (has > 0) return { year: s.year, title: s.title };
  }
  return null;
}

// ---------- Рассылка «Ваши итоги сезона готовы» ----------

/**
 * Фоновая очередь (раз в 30 секунд вместе с рассылками): участникам с финишем
 * в сезоне, у кого ещё нет уведомления SEASON_SUMMARY по последнему этапу.
 * Только первые 14 дней после итогов — потом не досылаем.
 */
export async function processSummaryMessages(log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }): Promise<number> {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const seasons = await prisma.season.findMany({ where: { summaryPublishedAt: { gte: since } } });
  let sent = 0;
  for (const season of seasons) {
    const last = await prisma.event.findFirst({ where: { seasonId: season.id }, orderBy: { date: 'desc' } });
    if (!last) continue;
    const { results } = await seasonFinishes(season.id);
    const ids = [...new Set(results.map((r) => r.userId))];
    const done = new Set(
      (await prisma.notification.findMany({ where: { kind: 'SEASON_SUMMARY', eventId: last.id, userId: { in: ids } }, select: { userId: true } })).map((n) => n.userId),
    );
    const todo = ids.filter((id) => !done.has(id)).slice(0, 30);
    for (const id of todo) {
      const user = results.find((r) => r.userId === id)!.user;
      await deliver({
        userId: id,
        telegramId: user.telegramId,
        eventId: last.id,
        kind: 'SEASON_SUMMARY',
        text: [
          `🏁 <b>Ваши итоги сезона ${season.year} готовы</b>`,
          '',
          'Сколько этапов и километров, лучший забег, личный рекорд и итоговое место в рейтинге — всё в одном месте. Итогами можно поделиться в сторис.',
        ].join('\n'),
        button: { text: 'Открыть итоги', url: `${APP_URL}/app?itogi=${season.year}` },
        log,
      });
      sent += 1;
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  if (sent) log.info({ sent }, 'Итоги сезона: сообщения отправлены');
  return sent;
}

/** Для админки: сколько получателей и сколько уже отправлено. */
export async function summaryMessageStats(seasonId: number): Promise<{ recipients: number; sent: number; failed: number }> {
  const last = await prisma.event.findFirst({ where: { seasonId }, orderBy: { date: 'desc' } });
  const { results } = await seasonFinishes(seasonId);
  const ids = [...new Set(results.map((r) => r.userId))];
  if (!last) return { recipients: ids.length, sent: 0, failed: 0 };
  const rows = await prisma.notification.findMany({ where: { kind: 'SEASON_SUMMARY', eventId: last.id, userId: { in: ids } }, select: { status: true } });
  return { recipients: ids.length, sent: rows.filter((r) => r.status === 'SENT').length, failed: rows.filter((r) => r.status !== 'SENT').length };
}
