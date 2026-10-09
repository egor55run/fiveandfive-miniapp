import type { FastifyInstance } from 'fastify';
import type { Event } from '@prisma/client';
import { prisma } from '../prisma';
import { registrationOpen } from '../lib/registrationWindow';
import { registrationClosesAt, registrationDeadlinePassed } from '../lib/eligibility';

export function serializeEvent(e: Event) {
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    location: e.location,
    distance: e.distance,
    slotsTotal: e.slotsTotal,
    slotsTaken: e.slotsTaken,
    slotsLeft: e.slotsTotal - e.slotsTaken,
    price: Number(e.price),
    // Путь относительно корня API («/uploads/routes/…») или null, если карты у
    // старта нет. Базовый адрес приклеивает клиент — см. apiAsset в src/lib/api.ts.
    routeImageUrl: e.routeImageUrl,
    // Пока общий для всех стартов (см. lib/registrationWindow). Полем у старта,
    // а не отдельным ответом: старый фронт ждёт от /events массив и лишнее
    // поле просто не заметит.
    slug: e.slug,
    // Программа дня и Положение (путь к PDF относительно корня API, как карта).
    program: e.program,
    regulationsUrl: e.regulationsUrl,
    registrationOpen: registrationOpen(),
    // Срок регистрации на этот старт (заданный в админке или за 7 дней до
    // старта) и прошёл ли он — с ним запись закрыта для всех, включая админов.
    registrationClosesAt: registrationClosesAt(e),
    registrationDeadlinePassed: registrationDeadlinePassed(e),
    createdAt: e.createdAt,
  };
}

export async function eventsRoutes(app: FastifyInstance) {
  // GET /events — list of races, soonest first
  app.get('/events', async () => {
    const events = await prisma.event.findMany({ orderBy: { date: 'asc' } });
    return events.map(serializeEvent);
  });

  // GET /events/by-slug/:slug — старт по адресу страницы на сайте (/starty/<slug>).
  app.get<{ Params: { slug: string } }>('/events/by-slug/:slug', async (req, reply) => {
    const event = await prisma.event.findUnique({ where: { slug: req.params.slug } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    return serializeEvent(event);
  });

  // GET /events/:id — single race
  app.get<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'Invalid event id' });
    }

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      return reply.code(404).send({ error: 'Event not found' });
    }

    return serializeEvent(event);
  });
}
