import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { prisma } from './prisma';
import { setupAdminAuth } from './plugins/adminAuth';
import { setupTelegramAuth } from './plugins/telegramAuth';
import { adminEventsRoutes } from './routes/admin/events';
import { adminParticipantsRoutes } from './routes/admin/participants';
import { adminResultsRoutes } from './routes/admin/results';
import { adminSessionRoutes } from './routes/admin/session';
import { authRoutes } from './routes/auth';
import { eventsRoutes } from './routes/events';
import { registrationsRoutes } from './routes/registrations';
import { seasonsRoutes } from './routes/seasons';

// BigInt (telegram_id) is not JSON-serializable by default — render as string.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = Fastify({
  logger: true,
  // Доверяем только петле: наружу порт не смотрит (HOST=127.0.0.1), запросы
  // приходят от nginx, который ставит X-Forwarded-For. Без этого req.ip был бы
  // всегда 127.0.0.1 — и ограничитель попыток входа стал бы общим на всех.
  trustProxy: '127.0.0.1',
});

// Декораторы request.tgUser и request.admin объявляем на корневом инстансе, а не
// через app.register(): декораторы из зарегистрированного плагина не видны
// роутам, зарегистрированным рядом. Здесь же падаем, если BOT_TOKEN не задан.
setupTelegramAuth(app);
setupAdminAuth(app);

/**
 * Разрешённые источники. В проде — только собственный домен: появилась
 * cookie-сессия админки, и отражать любой Origin (как было с origin: true)
 * больше не стоит. Mini App участников работает с того же домена.
 */
function corsOrigins(): string[] | boolean {
  if (process.env.NODE_ENV !== 'production') return true; // локально Vite на другом порту
  return ['https://fiveandfive.kz', 'https://www.fiveandfive.kz'];
}

async function main() {
  await app.register(cors, { origin: corsOrigins() });
  await app.register(cookie);

  // Health check — also verifies DB connectivity.
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', time: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });

  // Участники: авторизация по Telegram initData.
  await app.register(authRoutes);
  await app.register(eventsRoutes);
  await app.register(registrationsRoutes);
  await app.register(seasonsRoutes);

  // Админка: своя cookie-сессия, к initData участников отношения не имеет.
  // Каждая группа — отдельный плагин, поэтому preHandler requireAdmin внутри
  // них не протекает на роуты участников.
  await app.register(adminSessionRoutes);
  await app.register(adminEventsRoutes);
  await app.register(adminParticipantsRoutes);
  await app.register(adminResultsRoutes);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  const port = Number(process.env.PORT ?? 3000);
  // Локально слушаем все интерфейсы (удобно открывать с телефона в той же сети),
  // в проде HOST=127.0.0.1 — наружу API отдаёт nginx по /api/.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
