import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../prisma';
import { verifyInitData } from '../lib/telegramAuth';
import { CUTOFF_SECONDS, MIN_POINTS, PROTEST_HOURS, RATING_METERS, T0, protestUntil, seasonStandings, stageProtocol } from '../lib/rating';

/**
 * Рейтинг серии — публично: сайт (/reiting) и Mini App (вкладка «Рейтинг»).
 * Только опубликованные этапы. Скрывшие себя — «Участник скрыл имя»; если
 * запрос из Mini App (заголовок tma …), свою строку человек видит с именем
 * (me: true).
 */

/** Кто спрашивает — по подписи Mini App; без подписи (сайт) — никто. */
async function meOf(req: FastifyRequest): Promise<number | null> {
  const header = req.headers.authorization;
  const token = process.env.BOT_TOKEN;
  if (!header?.startsWith('tma ') || !token) return null;
  const res = verifyInitData(header.slice(4), token);
  if (!res.ok) return null;
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(res.user.id) }, select: { id: true } });
  return user?.id ?? null;
}

const FORMULA = {
  text: 'Баллы = 1000 + 4340 × ((T0 / T)^0,164 − 1), T — время от выстрела на 5 км',
  t0: { MALE: T0.MALE, FEMALE: T0.FEMALE },
  cutoffSeconds: CUTOFF_SECONDS,
  minPoints: MIN_POINTS,
  meters: RATING_METERS,
  protestHours: PROTEST_HOURS,
};

export async function ratingRoutes(app: FastifyInstance) {
  /** GET /rating/season?seasonId= — таблица сезона (по умолчанию — активный). */
  app.get<{ Querystring: { seasonId?: string } }>('/rating/season', async (req, reply) => {
    const id = Number(req.query.seasonId);
    const season = Number.isInteger(id) && id > 0
      ? await prisma.season.findUnique({ where: { id } })
      : await prisma.season.findFirst({ where: { isActive: true } });
    if (!season) return reply.code(404).send({ error: 'Сезон не найден' });
    const table = await seasonStandings(season.id, { publicOnly: true, meUserId: await meOf(req) });
    return { season: { id: season.id, title: season.title, year: season.year }, formula: FORMULA, ...table };
  });

  /** GET /rating/stage/:slug — протокол этапа (М и Ж) с баллами. */
  app.get<{ Params: { slug: string } }>('/rating/stage/:slug', async (req, reply) => {
    const event = await prisma.event.findUnique({ where: { slug: req.params.slug } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    const protocol = await stageProtocol(event.id, { publicOnly: true, meUserId: await meOf(req) });
    return {
      event: { id: event.id, title: event.title, slug: event.slug, date: event.date, location: event.location },
      formula: FORMULA,
      ...protocol,
      protestUntil: protestUntil(event.resultsPublishedAt),
    };
  });
}
