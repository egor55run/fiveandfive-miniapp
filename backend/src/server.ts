import Fastify from 'fastify';
import cors from '@fastify/cors';
import { prisma } from './prisma';
import { eventsRoutes } from './routes/events';
import { registrationsRoutes } from './routes/registrations';
import { seasonsRoutes } from './routes/seasons';

// BigInt (telegram_id) is not JSON-serializable by default — render as string.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = Fastify({ logger: true });

async function main() {
  await app.register(cors, { origin: true });

  // Health check — also verifies DB connectivity.
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up', time: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });

  await app.register(eventsRoutes);
  await app.register(registrationsRoutes);
  await app.register(seasonsRoutes);

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
