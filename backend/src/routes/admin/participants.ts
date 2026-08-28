import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { requireAdmin } from '../../plugins/adminAuth';

const statusSchema = z.object({
  paymentStatus: z.enum(['PENDING', 'PAID', 'CANCELLED']),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Занимает ли регистрация с таким статусом место на старте. */
const HOLDS_SLOT = (status: string) => status !== 'CANCELLED';

export async function adminParticipantsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** GET /admin/events/:id/participants — кто записан на старт. */
  app.get<{ Params: { id: string } }>(
    '/admin/events/:id/participants',
    async (req, reply) => {
      const eventId = parseId(req.params.id);
      if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return reply.code(404).send({ error: 'Старт не найден' });

      const registrations = await prisma.registration.findMany({
        where: { eventId },
        orderBy: { registeredAt: 'asc' },
        include: { user: true },
      });

      // Результаты подтягиваем одним запросом — чтобы в списке было видно,
      // кому финишное время уже внесли.
      const results = await prisma.result.findMany({ where: { eventId } });
      const resultByUser = new Map(results.map((r) => [r.userId, r]));

      return {
        event: { id: event.id, title: event.title, date: event.date },
        participants: registrations.map((r) => {
          const result = resultByUser.get(r.userId);
          return {
            registrationId: r.id,
            userId: r.userId,
            // ФИО как ввёл участник при регистрации.
            lastName: r.user.lastName,
            firstName: r.user.firstName,
            phone: r.user.phone,
            email: r.user.email,
            age: r.user.age,
            telegramId: r.user.telegramId?.toString() ?? null,
            username: r.user.username,
            paymentStatus: r.paymentStatus,
            qrCode: r.qrCode,
            // Абонемент: регистрация создана оптом, отменять её по одной нельзя
            // без последствий для остальных — помечаем, чтобы UI предупредил.
            seasonPassId: r.seasonPassId,
            registeredAt: r.registeredAt,
            result: result
              ? { id: result.id, finishTime: result.finishTime, place: result.place }
              : null,
          };
        }),
      };
    },
  );

  /**
   * PATCH /admin/registrations/:id — сменить статус оплаты.
   *
   * CANCELLED освобождает место, возврат из CANCELLED — снова занимает (и может
   * упереться в лимит). Без этого отменённые регистрации держали бы места вечно.
   */
  app.patch<{ Params: { id: string } }>(
    '/admin/registrations/:id',
    async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Некорректный id' });

      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Ожидается paymentStatus', details: parsed.error.flatten() });
      }
      const next = parsed.data.paymentStatus;

      const registration = await prisma.registration.findUnique({
        where: { id },
        include: { event: true },
      });
      if (!registration) {
        return reply.code(404).send({ error: 'Регистрация не найдена' });
      }

      const prev = registration.paymentStatus;
      if (prev === next) {
        return { registrationId: id, paymentStatus: next, slotsChanged: 0 };
      }

      const wasHolding = HOLDS_SLOT(prev);
      const willHold = HOLDS_SLOT(next);
      const delta = Number(willHold) - Number(wasHolding); // -1, 0 или +1

      // Возвращаем место занятым — проверяем, что оно есть.
      if (delta > 0 && registration.event.slotsTaken >= registration.event.slotsTotal) {
        return reply.code(409).send({
          error: 'Свободных мест на старте нет — вернуть регистрацию нельзя',
          reason: 'no_slots',
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const reg = await tx.registration.update({
          where: { id },
          data: { paymentStatus: next },
        });
        if (delta !== 0) {
          await tx.event.update({
            where: { id: registration.eventId },
            data: { slotsTaken: { increment: delta } },
          });
        }
        return reg;
      });

      req.log.info(
        { registrationId: id, from: prev, to: next, slotDelta: delta },
        'Статус оплаты изменён из админки',
      );

      const event = await prisma.event.findUnique({
        where: { id: registration.eventId },
      });

      return {
        registrationId: updated.id,
        paymentStatus: updated.paymentStatus,
        slotsChanged: delta,
        event: event
          ? {
              id: event.id,
              slotsTaken: event.slotsTaken,
              slotsTotal: event.slotsTotal,
              slotsLeft: event.slotsTotal - event.slotsTaken,
            }
          : null,
      };
    },
  );
}
