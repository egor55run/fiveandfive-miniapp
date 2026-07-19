import type { FastifyInstance } from 'fastify';
import type { Event } from '@prisma/client';
import { prisma } from '../prisma';

function serializeEvent(e: Event) {
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
    createdAt: e.createdAt,
  };
}

export async function eventsRoutes(app: FastifyInstance) {
  // GET /events — list of races, soonest first
  app.get('/events', async () => {
    const events = await prisma.event.findMany({ orderBy: { date: 'asc' } });
    return events.map(serializeEvent);
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
