import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ageProfileFields, parseBirthDate } from '../lib/birthDate';
import {
  birthDateField,
  emailField,
  phoneField,
  sendValidationError,
} from '../lib/validation';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';
import { serializeUser } from './auth';

// telegramId в теле больше нет намеренно: личность берётся из подписанного
// initData (req.tgUser), а не из данных, которые прислал клиент.
// Остальные поля Telegram не выдаёт, поэтому их по-прежнему спрашиваем формой.
const bodySchema = z.object({
  eventId: z.number().int().positive(),
  firstName: z.string().trim().min(1, 'Укажите имя'),
  lastName: z.string().trim().min(1, 'Укажите фамилию'),
  email: emailField,
  // Форма спрашивает дату рождения, а не возраст. age оставлен для совместимости
  // и как запасной вариант: когда дата пришла, возраст считает сервер.
  age: z.number().int().min(1).max(120),
  birthDate: birthDateField.optional(),
  phone: phoneField,
});

export async function registrationsRoutes(app: FastifyInstance) {
  // POST /registrations — create a registration.
  // Payment is a STUB for now (status PENDING, no real charge).
  app.post(
    '/registrations',
    { preHandler: requireTelegramAuth },
    async (req, reply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const data = parsed.data;
      const tg = tgUserOf(req);
      const telegramId = BigInt(tg.id);

      const event = await prisma.event.findUnique({ where: { id: data.eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      if (event.slotsTaken >= event.slotsTotal) {
        return reply.code(409).send({ error: 'No slots left for this event' });
      }

      // Участник опознаётся по telegram_id. Раньше здесь был upsert по email —
      // то есть кто угодно мог, указав чужой email, дописаться в чужой профиль.
      // Дата рождения проверена схемой, поэтому разбор здесь не может дать null.
      const birthDate = data.birthDate ? parseBirthDate(data.birthDate) : null;
      const known = await prisma.user.findUnique({
        where: { telegramId },
        select: { birthDate: true },
      });
      const profile = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        ...ageProfileFields(birthDate, known?.birthDate ?? null, data.age),
      };
      const user = await prisma.user.upsert({
        where: { telegramId },
        create: { telegramId, username: tg.username ?? null, ...profile },
        update: profile,
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
        user: serializeUser(user),
        registration,
        // Payment stub — no real gateway wired up yet.
        payment: {
          status: 'stub',
          message: 'Payment not implemented yet; registration created as PENDING',
        },
      });
    },
  );
}
