import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma';
import { requireAdmin } from '../plugins/adminAuth';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';
import {
  SummaryError,
  personalSummary,
  publicSummaryByYear,
  publishSummary,
  summaryByShareToken,
  summaryMessageStats,
  summaryReadiness,
  summarySeasons,
} from '../lib/seasonSummary';

/** Итоги сезона (2026-11-12): /itogi/<год> на сайте, личные итоги в Mini App, кнопка в админке. */
const yearOf = (raw: string) => {
  const y = Number(raw);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
};

export async function seasonSummaryRoutes(app: FastifyInstance) {
  /** GET /seasons/summaries — сезоны (год, подведены ли итоги): sitemap и меню. */
  app.get('/seasons/summaries', async () => summarySeasons());

  /** GET /seasons/summary/:year — публичные итоги или текущий рейтинг, если сезон идёт. */
  app.get<{ Params: { year: string } }>('/seasons/summary/:year', async (req, reply) => {
    const year = yearOf(req.params.year);
    if (year === null) return reply.code(404).send({ error: 'Сезон не найден' });
    const data = await publicSummaryByYear(year);
    if (!data) return reply.code(404).send({ error: 'Сезон не найден' });
    return data;
  });

  /**
   * GET /seasons/summary/:year/card/:token — цифры для картинки «Поделиться».
   * Только имя (без фамилии) и цифры итогов: картинку участник публикует сам.
   */
  app.get<{ Params: { year: string; token: string } }>('/seasons/summary/:year/card/:token', async (req, reply) => {
    const year = yearOf(req.params.year);
    const s = year === null ? null : await summaryByShareToken(year, req.params.token);
    if (!s) return reply.code(404).send({ error: 'Итоги не найдены' });
    const { shareToken: _t, gender: _g, history, stages, ...card } = s;
    return { ...card, stagesDone: stages.map((x) => x.done), placeMoves: history.filter((h) => h.place !== null).map((h) => h.place) };
  });

  /** GET /me/season-summary?year= — личные итоги (Mini App). */
  app.get<{ Querystring: { year?: string } }>('/me/season-summary', { preHandler: requireTelegramAuth }, async (req, reply) => {
    const tg = tgUserOf(req);
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tg.id) } });
    if (!user) return reply.code(404).send({ error: 'Профиль не найден' });
    const year = req.query.year ? yearOf(req.query.year) : null;
    const season = await prisma.season.findFirst({
      where: { summaryPublishedAt: { not: null }, ...(year ? { year } : {}) },
      orderBy: { year: 'desc' },
    });
    if (!season) return reply.code(404).send({ error: 'Итоги сезона ещё не подведены', reason: 'not_published' });
    const s = await personalSummary(season, user.id);
    if (!s) return reply.code(404).send({ error: 'В этом сезоне у вас нет финишей', reason: 'no_results' });
    return s;
  });

  /** GET /admin/seasons/:id/summary — готовность, подведены ли итоги, рассылка. */
  app.get<{ Params: { id: string } }>('/admin/seasons/:id/summary', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    const season = Number.isInteger(id) ? await prisma.season.findUnique({ where: { id } }) : null;
    if (!season) return reply.code(404).send({ error: 'Сезон не найден' });
    return {
      seasonId: season.id,
      year: season.year,
      title: season.title,
      publishedAt: season.summaryPublishedAt,
      readiness: await summaryReadiness(season.id),
      messages: season.summaryPublishedAt ? await summaryMessageStats(season.id) : null,
    };
  });

  /** POST /admin/seasons/:id/summary — «Подвести итоги сезона» (повторно — пересчитать). */
  app.post<{ Params: { id: string } }>('/admin/seasons/:id/summary', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      const res = await publishSummary(id);
      req.log.info({ seasonId: id, ...res }, 'Итоги сезона подведены');
      return res;
    } catch (err) {
      if (err instanceof SummaryError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
