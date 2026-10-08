import type { FastifyInstance } from 'fastify';
import type { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ageFromBirthDate, formatBirthDate, parseBirthDate } from '../lib/birthDate';
import {
  birthDateField,
  emailField,
  personNameField,
  phoneField,
  sendValidationError,
} from '../lib/validation';
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
    // Отдаём днём («1999-12-14»), а не ISO-меткой времени: у колонки тип DATE,
    // и в этом же формате её ждёт input[type=date] на фронте.
    birthDate: formatBirthDate(u.birthDate),
    phone: u.phone,
    createdAt: u.createdAt,
  };
}

const patchSchema = z
  .object({
    firstName: personNameField('firstName').optional(),
    lastName: personNameField('lastName').optional(),
    email: emailField.optional(),
    birthDate: birthDateField.optional(),
    phone: phoneField.optional(),
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

      // Имя из Telegram — только при первом входе, как черновик до регистрации.
      // Дальше им владеет форма регистрации (кириллица, без отчества): раньше
      // каждый вход перезаписывал «Кадыров Егор» обратно на «Egor» из Telegram,
      // и в админке и протоколах оказывалось не то имя. Username — за Telegram,
      // его обновляем всегда.
      const existing = await prisma.user.findUnique({ where: { telegramId } });
      const user = await prisma.user.upsert({
        where: { telegramId },
        create: {
          telegramId,
          firstName: tg.first_name,
          lastName: tg.last_name ?? null,
          username: tg.username ?? null,
        },
        // Имя, email, телефон и дату рождения не трогаем — их ввёл сам участник.
        update: { username: tg.username ?? null },
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

  /**
   * PATCH /me — правка профиля вне флоу регистрации на старт (карандаши в
   * профиле). Принимает любое подмножество полей, но минимум одно.
   *
   * `age` отдельным полем не принимается намеренно: он производный от даты
   * рождения, и разрешить править его отдельно значит позволить двум полям
   * разойтись. Пришла дата — возраст пересчитывает сервер.
   */
  app.patch('/me', { preHandler: requireTelegramAuth }, async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const tg = tgUserOf(req);
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tg.id) },
    });
    if (!user) {
      return reply.code(404).send({ error: 'Пользователь не найден', reason: 'no_user_row' });
    }

    const { birthDate, ...rest } = parsed.data;
    const data: Prisma.UserUpdateInput = { ...rest };

    if (birthDate !== undefined) {
      // Схема уже проверила разбор, поэтому null тут недостижим.
      const parsedDate = parseBirthDate(birthDate);
      if (parsedDate !== null) {
        data.birthDate = parsedDate;
        data.age = ageFromBirthDate(parsedDate);
      }
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data });
    req.log.info({ userId: user.id, fields: Object.keys(data) }, 'Профиль обновлён');
    return { user: serializeUser(updated) };
  });
}
