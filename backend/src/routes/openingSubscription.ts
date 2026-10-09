import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma';
import { subscribe } from '../lib/openingSubscribers';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';

/**
 * Подписка «Сообщить об открытии» из Mini App (кнопка на экране «Регистрация
 * скоро откроется»). Тот же список, что у бота (lib/openingSubscribers).
 */
export async function openingSubscriptionRoutes(app: FastifyInstance) {
  /** GET /opening-subscription — подписан ли текущий пользователь. */
  app.get('/opening-subscription', { preHandler: requireTelegramAuth }, async (req) => {
    const tg = tgUserOf(req);
    const sub = await prisma.openingSubscriber.findFirst({
      where: { telegramId: BigInt(tg.id), unsubscribedAt: null },
      select: { id: true },
    });
    return { subscribed: Boolean(sub) };
  });

  /** POST /opening-subscription — подписаться. Повторно — без ошибки. */
  app.post('/opening-subscription', { preHandler: requireTelegramAuth }, async (req) => {
    const tg = tgUserOf(req);
    await subscribe(tg, 'app');
    req.log.info({ telegramId: tg.id }, 'Подписка на открытие регистрации (Mini App)');
    return { subscribed: true };
  });
}
