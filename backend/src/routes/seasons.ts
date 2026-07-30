import type { FastifyInstance } from 'fastify';
import type { Event, SeasonPass, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { serializeEvent } from './events';

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
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  age: z.number().int().min(1).max(120),
  phone: z.string().trim().min(3),
  telegramId: z.number().int().optional(),
});

// Причина, по которой абонемент нельзя оформить (all-or-nothing).
class SeasonPassBlocked extends Error {
  constructor(
    public reason: 'no_slots' | 'already_registered' | 'already_has_pass',
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

  // POST /season-passes — оформить абонемент на весь сезон.
  // Стратегия «всё или ничего»: если хоть один старт недоступен — 409, ничего не создаётся.
  // Оплата — заглушка (paymentStatus PENDING).
  app.post('/season-passes', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
    if (!season) {
      return reply.code(404).send({ error: 'Season not found' });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Участник — upsert по email.
        const userData = {
          firstName: data.firstName,
          lastName: data.lastName,
          age: data.age,
          phone: data.phone,
          ...(data.telegramId !== undefined
            ? { telegramId: BigInt(data.telegramId) }
            : {}),
        };
        const user: User = await tx.user.upsert({
          where: { email: data.email },
          update: userData,
          create: { email: data.email, ...userData },
        });

        // Уже есть абонемент на этот сезон?
        const existingPass = await tx.seasonPass.findUnique({
          where: { userId_seasonId: { userId: user.id, seasonId: season.id } },
        });
        if (existingPass) throw new SeasonPassBlocked('already_has_pass');

        // Свежие данные по стартам сезона.
        const events: Event[] = await tx.event.findMany({
          where: { seasonId: season.id },
          orderBy: { date: 'asc' },
        });

        // Проверка доступности — «всё или ничего».
        for (const e of events) {
          if (e.slotsTaken >= e.slotsTotal) {
            throw new SeasonPassBlocked('no_slots', e.title);
          }
          const reg = await tx.registration.findUnique({
            where: { userId_eventId: { userId: user.id, eventId: e.id } },
          });
          if (reg) throw new SeasonPassBlocked('already_registered', e.title);
        }

        // Создать абонемент + регистрации на все старты + занять слоты.
        const pass = await tx.seasonPass.create({
          data: {
            userId: user.id,
            seasonId: season.id,
            price: season.price,
            paymentStatus: 'PENDING',
          },
        });

        const registrations = [];
        for (const e of events) {
          const created = await tx.registration.create({
            data: {
              userId: user.id,
              eventId: e.id,
              seasonPassId: pass.id,
              paymentStatus: 'PENDING',
            },
          });
          const withQr = await tx.registration.update({
            where: { id: created.id },
            data: { qrCode: `fiveandfive://ticket/${created.id}` },
          });
          await tx.event.update({
            where: { id: e.id },
            data: { slotsTaken: { increment: 1 } },
          });
          registrations.push(withQr);
        }

        return { user, pass, registrations };
      });

      return reply.code(201).send({
        user: result.user,
        seasonPass: serializeSeasonPass(result.pass),
        registrations: result.registrations,
        payment: {
          status: 'stub',
          message: 'Payment not implemented yet; season pass created as PENDING',
        },
      });
    } catch (err) {
      if (err instanceof SeasonPassBlocked) {
        const messages: Record<SeasonPassBlocked['reason'], string> = {
          already_has_pass: 'У вас уже есть абонемент на этот сезон',
          no_slots: `Нет мест на старт «${err.eventTitle}». Абонемент оформляется только на все старты сразу`,
          already_registered: `Вы уже зарегистрированы на старт «${err.eventTitle}». Абонемент оформляется только на все старты сразу`,
        };
        return reply.code(409).send({ error: messages[err.reason], reason: err.reason });
      }
      throw err;
    }
  });
}
