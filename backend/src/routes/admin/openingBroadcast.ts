import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../plugins/adminAuth';
import {
  broadcastState,
  DEFAULT_OPENING_TEXT,
  startBroadcast,
  subscriberStats,
} from '../../lib/openingSubscribers';
import { registrationOpen } from '../../lib/registrationWindow';

const broadcastSchema = z.object({
  text: z.string().trim().min(1, 'Текст пустой').max(3000),
});

/** Админка: подписчики «Узнать об открытии» и рассылка (lib/openingSubscribers). */
export async function adminOpeningBroadcastRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** GET /admin/opening-subscribers — сколько подписано, идёт ли рассылка. */
  app.get('/admin/opening-subscribers', async () => ({
    stats: await subscriberStats(),
    broadcast: broadcastState(),
    defaultText: DEFAULT_OPENING_TEXT,
    registrationOpen: registrationOpen(),
  }));

  /**
   * POST /admin/opening-subscribers/broadcast — разослать «регистрация открыта»
   * всем подписанным, кто ещё не получил. Пока регистрация закрыта — отказ:
   * написать «открыта» раньше времени хуже, чем не написать.
   */
  app.post('/admin/opening-subscribers/broadcast', async (req, reply) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте текст' });
    }
    if (!registrationOpen()) {
      return reply.code(409).send({
        error: 'Регистрация ещё закрыта — сначала откройте её, потом рассылайте',
        reason: 'registration_closed',
      });
    }
    if (!startBroadcast(parsed.data.text, req.log)) {
      return reply.code(409).send({ error: 'Рассылка уже идёт', reason: 'already_running' });
    }
    return reply.code(202).send({ broadcast: broadcastState() });
  });
}
