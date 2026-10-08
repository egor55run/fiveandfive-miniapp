import type { FastifyInstance } from 'fastify';
import type { Event, SeasonPass, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { REGISTRATION_CLOSED_MESSAGE, registrationOpen } from '../lib/registrationWindow';
import { ageProfileFields, parseBirthDate } from '../lib/birthDate';
import { KASPI_PHONE_ERROR, normalizeKzPhone } from '../lib/apipay';
import { deliver, seasonPassText } from '../lib/notify';
import {
  apiPayConfigured,
  findActivePayment,
  invoiceDescription,
  serializePayment,
  startPayment,
} from '../lib/payments';
import {
  birthDateField,
  emailField,
  genderField,
  phoneField,
  sendValidationError,
  personNameField,
} from '../lib/validation';
import { serializeEvent } from './events';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';
import { serializeUser } from './auth';

function serializeSeasonPass(p: SeasonPass) {
  return {
    id: p.id,
    userId: p.userId,
    seasonId: p.seasonId,
    price: Number(p.price),
    paymentStatus: p.paymentStatus,
    createdAt: p.createdAt,
  };
}

const bodySchema = z.object({
  seasonId: z.number().int().positive(),
  firstName: personNameField('firstName'),
  lastName: personNameField('lastName'),
  email: emailField,
  // См. комментарий в routes/registrations.ts: форма спрашивает дату,
  // возраст остаётся запасным вариантом.
  age: z.number().int().min(1).max(120),
  birthDate: birthDateField.optional(),
  // Необязателен: прод-фронт до этого поля его не присылает. Нет — не затираем.
  gender: genderField.optional(),
  phone: phoneField,
});

// Причина, по которой абонемент нельзя оформить (all-or-nothing).
class SeasonPassBlocked extends Error {
  constructor(
    public reason: 'no_slots' | 'already_registered' | 'already_has_pass' | 'empty_season',
    public eventTitle?: string,
  ) {
    super(reason);
  }
}

export async function seasonsRoutes(app: FastifyInstance) {
  // GET /seasons/current — активный сезон + его старты и выгода абонемента.
  app.get('/seasons/current', async (_req, reply) => {
    const season = await prisma.season.findFirst({
      where: { isActive: true },
      include: { events: { orderBy: { date: 'asc' } } },
      orderBy: { year: 'desc' },
    });
    if (!season) {
      return reply.code(404).send({ error: 'No active season' });
    }

    const price = Number(season.price);
    const eventsTotal = season.events.reduce((sum, e) => sum + Number(e.price), 0);

    return {
      id: season.id,
      title: season.title,
      year: season.year,
      price,
      // Экономия против покупки всех стартов по отдельности (не меньше 0).
      savings: Math.max(0, eventsTotal - price),
      events: season.events.map(serializeEvent),
    };
  });

  // POST /season-passes — оформить абонемент на весь сезон и выставить ОДИН счёт.
  // Стратегия «всё или ничего»: если хоть один старт недоступен — 409, ничего не создаётся.
  // Места держатся, пока счёт не оплачен или не истёк (см. lib/payments.ts).
  // Без APIPAY_API_KEY — прежняя заглушка: абонемент PENDING без счёта.
  app.post('/season-passes', { preHandler: requireTelegramAuth }, async (req, reply) => {
    if (!registrationOpen()) {
      return reply
        .code(403)
        .send({ error: REGISTRATION_CLOSED_MESSAGE, reason: 'registration_closed' });
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;
    const birthDate = data.birthDate ? parseBirthDate(data.birthDate) : null;
    const tg = tgUserOf(req);
    const telegramId = BigInt(tg.id);

    const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
    if (!season) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    const price = Math.round(Number(season.price));
    const paid = price > 0 && apiPayConfigured();
    const kaspiPhone = normalizeKzPhone(data.phone);
    if (paid && !kaspiPhone) {
      return reply.code(400).send({
        error: KASPI_PHONE_ERROR,
        reason: 'validation',
        fields: { phone: KASPI_PHONE_ERROR },
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Участник опознаётся по подтверждённому telegram_id, а не по email
        // из формы: email теперь обычное поле профиля, подставить чужой нельзя.
        const known = await tx.user.findUnique({
          where: { telegramId },
          select: { birthDate: true },
        });
        const profile = {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          ...(data.gender ? { gender: data.gender } : {}),
          ...ageProfileFields(birthDate, known?.birthDate ?? null, data.age),
        };
        const user: User = await tx.user.upsert({
          where: { telegramId },
          create: { telegramId, username: tg.username ?? null, ...profile },
          update: profile,
        });

        // Абонемент на сезон у участника один (уникальный ключ). Оплаченный —
        // отказ; неоплаченный или отменённый — продолжаем с ним же.
        const existingPass = await tx.seasonPass.findUnique({
          where: { userId_seasonId: { userId: user.id, seasonId: season.id } },
        });
        if (existingPass?.paymentStatus === 'PAID') throw new SeasonPassBlocked('already_has_pass');
        if (existingPass?.paymentStatus === 'PENDING' && !paid) {
          throw new SeasonPassBlocked('already_has_pass');
        }

        // Свежие данные по стартам сезона.
        const events: Event[] = await tx.event.findMany({
          where: { seasonId: season.id },
          orderBy: { date: 'asc' },
        });
        if (events.length === 0) throw new SeasonPassBlocked('empty_season');

        const pass = existingPass
          ? await tx.seasonPass.update({
              where: { id: existingPass.id },
              data: { paymentStatus: 'PENDING', price: season.price },
            })
          : await tx.seasonPass.create({
              data: {
                userId: user.id,
                seasonId: season.id,
                price: season.price,
                paymentStatus: 'PENDING',
              },
            });

        // По каждому старту: место уже за этим абонементом — оставляем;
        // занято другой живой регистрацией — отказ; иначе занимаем.
        // Любой отказ откатывает транзакцию целиком — «всё или ничего».
        const registrations = [];
        for (const e of events) {
          const reg = await tx.registration.findUnique({
            where: { userId_eventId: { userId: user.id, eventId: e.id } },
          });

          if (reg && reg.paymentStatus === 'PENDING' && reg.seasonPassId === pass.id) {
            registrations.push(reg);
            continue;
          }
          if (reg && reg.paymentStatus !== 'CANCELLED') {
            throw new SeasonPassBlocked('already_registered', e.title);
          }

          const taken = await tx.event.updateMany({
            where: { id: e.id, slotsTaken: { lt: e.slotsTotal } },
            data: { slotsTaken: { increment: 1 } },
          });
          if (taken.count === 0) throw new SeasonPassBlocked('no_slots', e.title);

          if (reg) {
            registrations.push(
              await tx.registration.update({
                where: { id: reg.id },
                data: { paymentStatus: 'PENDING', seasonPassId: pass.id },
              }),
            );
            continue;
          }
          const created = await tx.registration.create({
            data: {
              userId: user.id,
              eventId: e.id,
              seasonPassId: pass.id,
              paymentStatus: 'PENDING',
            },
          });
          registrations.push(
            await tx.registration.update({
              where: { id: created.id },
              data: { qrCode: `fiveandfive://ticket/${created.id}` },
            }),
          );
        }

        return { user, pass, registrations, events };
      });

      // Бесплатный сезон или оплата не настроена — без счёта, как раньше.
      if (!paid) {
        let pass = result.pass;
        if (price <= 0) {
          pass = await prisma.seasonPass.update({
            where: { id: pass.id },
            data: { paymentStatus: 'PAID' },
          });
          await prisma.registration.updateMany({
            where: { seasonPassId: pass.id, paymentStatus: 'PENDING' },
            data: { paymentStatus: 'PAID' },
          });
        }
        // Одно сообщение на весь абонемент, а не пять подряд: eventId = null,
        // потому что оно относится к сезону целиком.
        await deliver({
          userId: result.user.id,
          telegramId: result.user.telegramId,
          eventId: null,
          kind: 'SEASON_PASS',
          text: seasonPassText(result.events),
          log: req.log,
        });
        return reply.code(201).send({
          user: serializeUser(result.user),
          seasonPass: serializeSeasonPass(pass),
          registrations: result.registrations,
          payment: null,
        });
      }

      const target = { purpose: 'SEASON_PASS' as const, seasonPassId: result.pass.id };
      const active = await findActivePayment(target);
      const payment =
        active && active.phone === kaspiPhone && Number(active.amount) === price
          ? active
          : await startPayment({
              userId: result.user.id,
              target,
              amount: price,
              phone: kaspiPhone!,
              description: invoiceDescription(`абонемент ${season.title}`),
              clientName: `${data.lastName} ${data.firstName}`,
              log: req.log,
            });

      if (!['PENDING', 'CREATED', 'PAID'].includes(payment.state)) {
        return reply.code(502).send({
          error: serializePayment(payment).message,
          reason: 'payment_failed',
          payment: serializePayment(payment),
        });
      }

      const pass = await prisma.seasonPass.findUnique({ where: { id: result.pass.id } });
      return reply.code(201).send({
        user: serializeUser(result.user),
        seasonPass: serializeSeasonPass(pass ?? result.pass),
        registrations: result.registrations,
        payment: serializePayment(payment),
      });
    } catch (err) {
      if (err instanceof SeasonPassBlocked) {
        const messages: Record<SeasonPassBlocked['reason'], string> = {
          already_has_pass: 'У вас уже есть абонемент на этот сезон',
          no_slots: `Нет мест на старт «${err.eventTitle}». Абонемент оформляется только на все старты сразу`,
          already_registered: `Вы уже зарегистрированы на старт «${err.eventTitle}». Абонемент оформляется только на все старты сразу`,
          empty_season: 'В сезоне пока нет стартов',
        };
        return reply.code(409).send({ error: messages[err.reason], reason: err.reason });
      }
      throw err;
    }
  });
}
