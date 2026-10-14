import type { FastifyInstance } from 'fastify';
import { prisma } from '../../prisma';
import { requireAdmin } from '../../plugins/adminAuth';
import { EVENT_DETAILS } from '../../lib/eventDetails';
import {
  announcementButton,
  announcementRun,
  announcementStats,
  announcementText,
  startAnnouncement,
} from '../../lib/raceAnnouncements';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Админка: «Сообщить о новом старте» (lib/raceAnnouncements). */
export async function adminRaceAnnouncementsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /**
   * GET /admin/events/:id/announcement — предпросмотр: текст (HTML Telegram),
   * кнопка, сколько получат и как прошли прошлые запуски.
   */
  app.get<{ Params: { id: string } }>('/admin/events/:id/announcement', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAILS });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    return {
      text: announcementText(event),
      button: announcementButton(event),
      stats: await announcementStats(id),
      run: announcementRun(id),
      started: event.date.getTime() <= Date.now(),
    };
  });

  /** POST /admin/events/:id/announcement — разослать (тем, кто ещё не получил). */
  app.post<{ Params: { id: string } }>('/admin/events/:id/announcement', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id }, include: EVENT_DETAILS });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    if (event.date.getTime() <= Date.now()) {
      return reply.code(409).send({ error: 'Старт уже прошёл', reason: 'started' });
    }
    const stats = await announcementStats(id);
    if (stats.pending === 0) {
      return reply.code(409).send({ error: 'Всем, кому можно, уже отправлено', reason: 'nobody_left' });
    }
    if (!startAnnouncement(event, req.log)) {
      return reply.code(409).send({ error: 'Рассылка по этому старту уже идёт', reason: 'already_running' });
    }
    req.log.info({ eventId: id, pending: stats.pending }, 'Рассылка «новый старт» запущена из админки');
    return reply.code(202).send({ run: announcementRun(id) });
  });
}
