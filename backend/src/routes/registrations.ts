import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma';

const bodySchema = z.object({
  eventId: z.number().int().positive(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  age: z.number().int().min(1).max(120),
  phone: z.string().trim().min(3),
  telegramId: z.number().int().optional(),
});

export async function registrationsRoutes(app: FastifyInstance) {
  // POST /registrations — create a registration.
  // Payment is a STUB for now (status PENDING, no real charge).
  app.post('/registrations', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) {
      return reply.code(404).send({ error: 'Event not found' });
    }
    if (event.slotsTaken >= event.slotsTotal) {
      return reply.code(409).send({ error: 'No slots left for this event' });
    }

    // Upsert the participant by email.
    const userData = {
      firstName: data.firstName,
      lastName: data.lastName,
      age: data.age,
      phone: data.phone,
      ...(data.telegramId !== undefined
        ? { telegramId: BigInt(data.telegramId) }
        : {}),
    };
    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: userData,
      create: { email: data.email, ...userData },
    });

    // One registration per (user, event).
    const existing = await prisma.registration.findUnique({
      where: { userId_eventId: { userId: user.id, eventId: event.id } },
    });
    if (existing) {
      return reply
        .code(409)
        .send({ error: 'User already registered for this event' });
    }

    // Create registration and reserve a slot atomically.
    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.registration.create({
        data: {
          userId: user.id,
          eventId: event.id,
          paymentStatus: 'PENDING',
        },
      });
      // Stub QR — later this becomes a real ticket/QR URL.
      const withQr = await tx.registration.update({
        where: { id: created.id },
        data: { qrCode: `fiveandfive://ticket/${created.id}` },
      });
      await tx.event.update({
        where: { id: event.id },
        data: { slotsTaken: { increment: 1 } },
      });
      return withQr;
    });

    return reply.code(201).send({
      registration,
      // Payment stub — no real gateway wired up yet.
      payment: {
        status: 'stub',
        message: 'Payment not implemented yet; registration created as PENDING',
      },
    });
  });
}
