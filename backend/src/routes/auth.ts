import type { FastifyInstance } from 'fastify';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';
import { serializeEvent } from './events';

/**
 * Явная сериализация вместо отдачи модели Prisma напрямую: telegram_id — BigInt
 * (в JSON не сериализуется без приведения), а список полей задан здесь, поэтому
 * новое поле в схеме не утечёт в API само собой.
 */
export function serializeUser(u: User) {
  return {
    id: u.id,
    telegramId: u.telegramId?.toString() ?? null,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    age: u.age,
    phone: u.phone,
    createdAt: u.createdAt,
  };
}

const patchSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    age: z.number().int().min(1).max(120).optional(),
    phone: z.string().trim().min(3).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Нужно передать хотя бы одно поле',
  });

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /auth/telegram — вход в Mini App.
   *
   * Формы входа у пользователя нет: фронт просто отдаёт подписанный Telegram
   * initData, а мы по нему находим или создаём User. Ключ — telegram_id.
   */
  app.post(
    '/auth/telegram',
    { preHandler: requireTelegramAuth },
    async (req) => {
      const tg = tgUserOf(req);
      const telegramId = BigInt(tg.id);

      // Поля, которыми владеет Telegram: перезаписываем на каждом входе,
      // потому что пользователь мог сменить имя или username.
      const fromTelegram = {
        firstName: tg.first_name,
        lastName: tg.last_name ?? null,
        username: tg.username ?? null,
      };

      const existing = await prisma.user.findUnique({ where: { telegramId } });
      const user = await prisma.user.upsert({
        where: { telegramId },
        create: { telegramId, ...fromTelegram },
        // email/phone/age не трогаем — их ввёл сам пользователь при регистрации.
        update: fromTelegram,
      });

      return { user: serializeUser(user), isNew: existing === null };
    },
  );

  /** GET /me — профиль, всё, на что пользователь записан, и его результаты. */
  app.get('/me', { preHandler: requireTelegramAuth }, async (req, reply) => {
    const tg = tgUserOf(req);
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tg.id) },
      include: {
        registrations: {
          include: { event: true },
          orderBy: { registeredAt: 'desc' },
        },
        // От старых к новым: на этом порядке держатся динамика времени и
        // «минус X с первого старта» в аналитике.
        results: {
          include: { event: true },
          orderBy: { event: { date: 'asc' } },
        },
        seasonPasses: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!user) {
      // Фронт вызывает POST /auth/telegram при старте, так что сюда попасть
      // можно только запросом в обход приложения.
      return reply.code(404).send({ error: 'Пользователь не найден', reason: 'no_user_row' });
    }

    // Сколько всего человек финишировало на каждом из «своих» стартов — знаменатель
    // для «N-е место из M». Одним запросом, а не по одному на забег; у кого
    // результатов ещё нет (а это каждый новый пользователь) — вообще без запроса.
    const finishersByEvent = new Map<number, number>();
    if (user.results.length > 0) {
      const finishers = await prisma.result.groupBy({
        by: ['eventId'],
        where: { eventId: { in: user.results.map((r) => r.eventId) } },
        _count: { _all: true },
      });
      for (const row of finishers) {
        finishersByEvent.set(row.eventId, row._count._all);
      }
    }

    return {
      user: serializeUser(user),
      registrations: user.registrations.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        seasonPassId: r.seasonPassId,
        paymentStatus: r.paymentStatus,
        qrCode: r.qrCode,
        registeredAt: r.registeredAt,
        event: serializeEvent(r.event),
      })),
      results: user.results.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        finishTime: r.finishTime,
        place: r.place,
        // Считается на лету, в модели Result этого поля нет.
        finishersTotal: finishersByEvent.get(r.eventId) ?? 1,
        recordedAt: r.recordedAt,
        event: serializeEvent(r.event),
      })),
      seasonPasses: user.seasonPasses.map((p) => ({
        id: p.id,
        seasonId: p.seasonId,
        price: Number(p.price),
        paymentStatus: p.paymentStatus,
        createdAt: p.createdAt,
      })),
    };
  });

  /** PATCH /me — правка профиля вне флоу регистрации на старт. */
  app.patch('/me', { preHandler: requireTelegramAuth }, async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const tg = tgUserOf(req);
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tg.id) },
    });
    if (!user) {
      return reply.code(404).send({ error: 'Пользователь не найден', reason: 'no_user_row' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: parsed.data,
    });
    return { user: serializeUser(updated) };
  });
}
