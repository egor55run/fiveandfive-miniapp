import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { deliver, formatFinishTime, resultText } from '../../lib/notify';
import { requireAdmin } from '../../plugins/adminAuth';

const upsertSchema = z.object({
  userId: z.number().int().positive(),
  // Финишное время в секундах. Разбор «MM:SS» — на стороне формы.
  finishTime: z.number().int().min(1).max(24 * 60 * 60),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Пересчитывает места по всему старту.
 *
 * Ранжирование спортивное: равные времена делят место, следующее сдвигается
 * (1, 2, 2, 4). Вызывается после любой правки времени и после снятия
 * результата — поэтому дыр и двух первых мест из-за опечаток не бывает.
 */
async function recomputePlaces(
  tx: Prisma.TransactionClient,
  eventId: number,
): Promise<void> {
  const rows = await tx.result.findMany({
    where: { eventId },
    orderBy: [{ finishTime: 'asc' }, { id: 'asc' }],
  });

  let place = 0;
  let prevTime: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (prevTime === null || row.finishTime !== prevTime) {
      place = i + 1;
      prevTime = row.finishTime;
    }
    if (row.place !== place) {
      await tx.result.update({ where: { id: row.id }, data: { place } });
    }
  }
}

async function protocolOf(eventId: number) {
  const results = await prisma.result.findMany({
    where: { eventId },
    orderBy: [{ place: 'asc' }, { finishTime: 'asc' }],
    include: { user: true },
  });
  return results.map((r) => ({
    id: r.id,
    userId: r.userId,
    lastName: r.user.lastName,
    firstName: r.user.firstName,
    username: r.user.username,
    finishTime: r.finishTime,
    place: r.place,
    recordedAt: r.recordedAt,
  }));
}

export async function adminResultsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** GET /admin/events/:id/results — финишный протокол старта. */
  app.get<{ Params: { id: string } }>(
    '/admin/events/:id/results',
    async (req, reply) => {
      const eventId = parseId(req.params.id);
      if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: 'Старт не найден' });

      return {
        event: { id: event.id, title: event.title, date: event.date, distance: event.distance },
        results: await protocolOf(eventId),
      };
    },
  );

  /**
   * PUT /admin/events/:id/results — внести или изменить время участнику.
   * Место не принимается: его считает сервер.
   */
  app.put<{ Params: { id: string } }>(
    '/admin/events/:id/results',
    async (req, reply) => {
      const eventId = parseId(req.params.id);
      if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });

      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Проверьте поля', details: parsed.error.flatten() });
      }
      const { userId, finishTime } = parsed.data;

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: 'Старт не найден' });

      // Результат только зарегистрированному, иначе протокол разойдётся со
      // списком участников. Отменённые регистрации тоже не в счёт.
      const registration = await prisma.registration.findUnique({
        where: { userId_eventId: { userId, eventId } },
      });
      if (!registration) {
        return reply.code(409).send({
          error: 'Участник не зарегистрирован на этот старт',
          reason: 'not_registered',
        });
      }
      if (registration.paymentStatus === 'CANCELLED') {
        return reply.code(409).send({
          error: 'Регистрация отменена — результат внести нельзя',
          reason: 'registration_cancelled',
        });
      }

      // До правки: по нему решаем, уведомлять ли участника. Если админ сохранил
      // ту же цифру (поправил что-то другое или нажал дважды) — второе
      // сообщение с тем же результатом было бы спамом.
      const before = await prisma.result.findUnique({
        where: { userId_eventId: { userId, eventId } },
      });

      await prisma.$transaction(async (tx) => {
        await tx.result.upsert({
          where: { userId_eventId: { userId, eventId } },
          // place проставит recomputePlaces следующей строкой; 0 — временное значение.
          create: { userId, eventId, finishTime, place: 0 },
          update: { finishTime },
        });
        await recomputePlaces(tx, eventId);
      });

      req.log.info({ eventId, userId, finishTime }, 'Результат внесён из админки');

      const results = await protocolOf(eventId);

      if (before === null || before.finishTime !== finishTime) {
        // Место и число финишёров берём уже после пересчёта — участнику важно
        // финальное значение, а не то, что было до перестановки.
        const mine = results.find((r) => r.userId === userId);
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (mine && user) {
          await deliver({
            userId,
            telegramId: user.telegramId,
            eventId,
            kind: 'RESULT',
            text: resultText(event, {
              finishTime: formatFinishTime(mine.finishTime),
              place: mine.place,
              finishersTotal: results.length,
            }),
            log: req.log,
          });
        }
      }

      return { results };
    },
  );

  /** DELETE /admin/results/:id — снять результат и пересчитать места. */
  app.delete<{ Params: { id: string } }>(
    '/admin/results/:id',
    async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Некорректный id' });

      const result = await prisma.result.findUnique({ where: { id } });
      if (!result) return reply.code(404).send({ error: 'Результат не найден' });

      await prisma.$transaction(async (tx) => {
        await tx.result.delete({ where: { id } });
        await recomputePlaces(tx, result.eventId);
      });

      req.log.info({ resultId: id, eventId: result.eventId }, 'Результат снят');
      return { results: await protocolOf(result.eventId) };
    },
  );
}
