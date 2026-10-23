import type { FastifyInstance } from 'fastify';
import { EVENT_DETAILS } from '../lib/eventDetails';

import type { Gender, Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { registrationOpenFor } from '../lib/registrationWindow';
import { ageFromBirthDate, formatBirthDate, parseBirthDate } from '../lib/birthDate';
import {
  birthDateField,
  emailField,
  genderField,
  personNameField,
  phoneField,
  sendValidationError,
} from '../lib/validation';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';
import { serializeEvent } from './events';
import { resultPoints, seasonStandings } from '../lib/rating';

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
    gender: u.gender,
    // «Не показывать меня в публичном рейтинге».
    hideFromRating: u.hideFromRating,
    createdAt: u.createdAt,
  };
}

const patchSchema = z
  .object({
    firstName: personNameField('firstName').optional(),
    lastName: personNameField('lastName').optional(),
    email: emailField.optional(),
    birthDate: birthDateField.optional(),
    gender: genderField.optional(),
    phone: phoneField.optional(),
    hideFromRating: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Нужно передать хотя бы одно поле',
  });

/** Баллы и место в рейтинге активного сезона; null — сезона или пола нет. */
async function myRating(userId: number, gender: Gender | null) {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season || !gender) return null;
  const table = await seasonStandings(season.id, { publicOnly: true, meUserId: userId });
  const list = gender === 'MALE' ? table.men : table.women;
  const mine = list.find((r) => r.userId === userId);
  return {
    seasonId: season.id,
    gender,
    points: mine?.total ?? 0,
    place: mine?.place ?? null,
    of: list.length,
    stages: mine?.stages ?? table.events.map(() => null),
  };
}

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

      return {
        user: serializeUser(user),
        isNew: existing === null,
        // Открыта ли регистрация именно для этого человека: при закрытой
        // регистрации администраторы всё равно могут записаться (тестовый
        // платёж до открытия) — приложение покажет им форму.
        registrationOpen: registrationOpenFor(tg.id),
      };
    },
  );

  /** GET /me — профиль, всё, на что пользователь записан, и его результаты. */
  app.get('/me', { preHandler: requireTelegramAuth }, async (req, reply) => {
    const tg = tgUserOf(req);
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(tg.id) },
      include: {
        registrations: {
          include: { event: { include: EVENT_DETAILS }, distance: true },
          orderBy: { registeredAt: 'desc' },
        },
        // От старых к новым: на этом порядке держатся динамика времени и
        // «минус X с первого старта» в аналитике.
        // Только опубликованные финиши: до публикации результатов участник их
        // не видит, сошедшие и не стартовавшие в аналитику не идут.
        results: {
          where: { status: 'FINISHED', finishTime: { not: null }, event: { resultsPublishedAt: { not: null } } },
          include: { event: true },
          orderBy: { event: { date: 'asc' } },
        },
        seasonPasses: { orderBy: { createdAt: 'desc' } },
        // Цена, скидка и итог: по оплаченному счёту или по коду на 100% (без счёта).
        payments: { where: { state: 'PAID' }, include: { promoCode: true }, orderBy: { paidAt: 'desc' } },
        promoRedemptions: { where: { status: 'USED', paymentId: null }, include: { promoCode: true } },
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
      // Зачёт — среди своего пола: «N-е место из M мужчин/женщин».
      const finishers = await prisma.result.groupBy({
        by: ['eventId'],
        where: {
          eventId: { in: user.results.map((r) => r.eventId) },
          status: 'FINISHED',
          ...(user.gender ? { user: { gender: user.gender } } : {}),
        },
        _count: { _all: true },
      });
      for (const row of finishers) {
        finishersByEvent.set(row.eventId, row._count._all);
      }
    }

    type Price = { base: number; discount: number; total: number; promoCode: string | null };
    const priceFor = (where: { registrationId?: number | null; seasonPassId?: number | null }): Price | null => {
      const match = (x: { registrationId: number | null; seasonPassId: number | null }) =>
        where.seasonPassId ? x.seasonPassId === where.seasonPassId : x.registrationId === where.registrationId;
      const pay = user.payments.find(match);
      if (pay) {
        const total = Math.round(Number(pay.amount));
        const discount = Math.round(Number(pay.discount));
        const base = pay.baseAmount !== null ? Math.round(Number(pay.baseAmount)) : total + discount;
        return { base, discount, total, promoCode: pay.promoCode?.code ?? null };
      }
      const free = user.promoRedemptions.find(match);
      if (free) {
        const base = Math.round(Number(free.baseAmount));
        const discount = Math.round(Number(free.discount));
        return { base, discount, total: base - discount, promoCode: free.promoCode.code };
      }
      return null;
    };

    return {
      user: serializeUser(user),
      registrations: user.registrations.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        seasonPassId: r.seasonPassId,
        paymentStatus: r.paymentStatus,
        qrCode: r.qrCode,
        registeredAt: r.registeredAt,
        // Дистанция участника — для билета и профиля.
        distanceId: r.distanceId,
        distance: r.distance?.label ?? null,
        // Стартовый номер (у абонемента — общий на сезон) и оформлен ли возврат.
        bibNumber: r.bibNumber,
        refunded: r.refundedAt !== null,
        // Цена, скидка, итог; у старта из абонемента — цена абонемента целиком.
        price: priceFor(r.seasonPassId ? { seasonPassId: r.seasonPassId } : { registrationId: r.id }),
        event: serializeEvent(r.event),
      })),
      results: user.results.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        finishTime: r.finishTime,
        // Место среди своего пола (зачёт рейтинга); пол не указан — общее.
        place: (user.gender ? r.genderPlace : r.place) ?? r.place,
        // Считается на лету, в модели Result этого поля нет.
        finishersTotal: finishersByEvent.get(r.eventId) ?? 1,
        status: r.status,
        points: resultPoints(r, user.gender),
        recordedAt: r.recordedAt,
        event: serializeEvent(r.event),
      })),
      // Рейтинг сезона: свои баллы и место среди своего пола.
      rating: await myRating(user.id, user.gender),
      seasonPasses: user.seasonPasses.map((p) => ({
        id: p.id,
        seasonId: p.seasonId,
        price: Number(p.price),
        paymentStatus: p.paymentStatus,
        bibNumber: p.bibNumber,
        paid: priceFor({ seasonPassId: p.id }),
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
