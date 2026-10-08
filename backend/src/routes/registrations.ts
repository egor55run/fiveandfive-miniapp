import type { FastifyInstance } from 'fastify';
import type { Prisma, Registration } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import {
  REGISTRATION_CLOSED_MESSAGE,
  registrationOpen,
  registrationOpenFor,
} from '../lib/registrationWindow';
import { KASPI_PHONE_ERROR, normalizeKzPhone } from '../lib/apipay';
import { recordConsents } from '../lib/legal';
import { ageProfileFields, parseBirthDate } from '../lib/birthDate';
import { deliver, registrationText } from '../lib/notify';
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
  consentsField,
  personNameField,
} from '../lib/validation';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';
import { serializeUser } from './auth';

// telegramId в теле больше нет намеренно: личность берётся из подписанного
// initData (req.tgUser), а не из данных, которые прислал клиент.
// Остальные поля Telegram не выдаёт, поэтому их по-прежнему спрашиваем формой.
const bodySchema = z.object({
  eventId: z.number().int().positive(),
  firstName: personNameField('firstName'),
  lastName: personNameField('lastName'),
  email: emailField,
  // Форма спрашивает дату рождения, а не возраст. age оставлен для совместимости
  // и как запасной вариант: когда дата пришла, возраст считает сервер.
  age: z.number().int().min(1).max(120),
  birthDate: birthDateField.optional(),
  // Необязателен: прод-фронт до этого поля его не присылает. Нет — не затираем.
  gender: genderField.optional(),
  phone: phoneField,
  consents: consentsField,
});

/** Почему место занять нельзя — ответ 409 с готовой фразой. */
class RegistrationBlocked extends Error {
  constructor(public reason: 'no_slots' | 'already_registered' | 'in_season_pass') {
    super(reason);
  }
}

const BLOCKED_MESSAGES: Record<RegistrationBlocked['reason'], string> = {
  no_slots: 'Мест на этот старт больше нет',
  already_registered: 'Вы уже зарегистрированы на этот старт',
  in_season_pass:
    'Этот старт входит в ваш неоплаченный абонемент — оплатите абонемент или дождитесь, пока счёт истечёт',
};

export async function registrationsRoutes(app: FastifyInstance) {
  /**
   * POST /registrations — занять место и выставить счёт в Kaspi.
   *
   * Место занимается сразу (регистрация PENDING) и держится PAYMENT_TTL_MINUTES.
   * Оплатил — PAID и сообщение в Telegram (lib/payments.ts). Не оплатил —
   * место освобождается, и повторный POST просто выставит новый счёт.
   *
   * Без APIPAY_API_KEY регистрация закрыта (lib/registrationWindow) — кроме
   * администраторов: у них запись идёт без счёта, регистрация PENDING.
   */
  app.post(
    '/registrations',
    { preHandler: requireTelegramAuth },
    async (req, reply) => {
      if (!registrationOpenFor(tgUserOf(req).id)) {
        return reply
          .code(403)
          .send({ error: REGISTRATION_CLOSED_MESSAGE, reason: 'registration_closed' });
      }
      if (!registrationOpen()) {
        req.log.info({ telegramId: tgUserOf(req).id }, 'Запись администратора при закрытой регистрации');
      }
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);
      const data = parsed.data;
      const tg = tgUserOf(req);
      const telegramId = BigInt(tg.id);

      const event = await prisma.event.findUnique({ where: { id: data.eventId } });
      if (!event) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const price = Math.round(Number(event.price));
      const paid = price > 0 && apiPayConfigured();
      const kaspiPhone = normalizeKzPhone(data.phone);
      if (paid && !kaspiPhone) {
        return reply.code(400).send({
          error: KASPI_PHONE_ERROR,
          reason: 'validation',
          fields: { phone: KASPI_PHONE_ERROR },
        });
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
        ...(data.gender ? { gender: data.gender } : {}),
        ...ageProfileFields(birthDate, known?.birthDate ?? null, data.age),
      };
      const user = await prisma.user.upsert({
        where: { telegramId },
        create: { telegramId, username: tg.username ?? null, ...profile },
        update: profile,
      });

      // Занять место. Одна регистрация на (участник, старт): неоплаченную
      // продолжаем, отменённую (не успел оплатить) — оживляем.
      const claimSlot = async (tx: Prisma.TransactionClient): Promise<Registration> => {
        const existing = await tx.registration.findUnique({
          where: { userId_eventId: { userId: user.id, eventId: event.id } },
        });

        if (existing?.paymentStatus === 'PAID') {
          throw new RegistrationBlocked('already_registered');
        }
        if (existing?.paymentStatus === 'PENDING') {
          if (existing.seasonPassId !== null) throw new RegistrationBlocked('in_season_pass');
          // Без оплаты PENDING — это и есть «зарегистрирован».
          if (!paid) throw new RegistrationBlocked('already_registered');
          return existing; // место уже за участником
        }

        // Новое место: условный инкремент, чтобы двое не заняли последнее.
        const taken = await tx.event.updateMany({
          where: { id: event.id, slotsTaken: { lt: event.slotsTotal } },
          data: { slotsTaken: { increment: 1 } },
        });
        if (taken.count === 0) throw new RegistrationBlocked('no_slots');

        if (existing) {
          return tx.registration.update({
            where: { id: existing.id },
            data: { paymentStatus: 'PENDING', seasonPassId: null },
          });
        }
        const created = await tx.registration.create({
          data: { userId: user.id, eventId: event.id, paymentStatus: 'PENDING' },
        });
        // Stub QR — later this becomes a real ticket/QR URL.
        return tx.registration.update({
          where: { id: created.id },
          data: { qrCode: `fiveandfive://ticket/${created.id}` },
        });
      };

      let registration: Registration;
      try {
        registration = await prisma.$transaction(async (tx) => {
          const reg = await claimSlot(tx);
          // Согласия с офертой и политикой — в той же транзакции: регистрации
          // без записанного согласия быть не должно (lib/legal).
          await recordConsents(tx, { userId: user.id, registrationId: reg.id });
          return reg;
        });
      } catch (err) {
        if (err instanceof RegistrationBlocked) {
          return reply
            .code(409)
            .send({ error: BLOCKED_MESSAGES[err.reason], reason: err.reason });
        }
        throw err;
      }

      // Бесплатный старт или оплата не настроена — без счёта.
      if (!paid) {
        if (price <= 0) {
          registration = await prisma.registration.update({
            where: { id: registration.id },
            data: { paymentStatus: 'PAID' },
          });
        }
        await deliver({
          userId: user.id,
          telegramId: user.telegramId,
          eventId: event.id,
          kind: 'REGISTERED',
          text: registrationText(event),
          log: req.log,
        });
        return reply.code(201).send({
          user: serializeUser(user),
          registration,
          payment: null,
        });
      }

      // Повторное нажатие с тем же номером — тот же счёт, а не второй в Kaspi.
      const target = { purpose: 'REGISTRATION' as const, registrationId: registration.id };
      const active = await findActivePayment(target);
      const payment =
        active && active.phone === kaspiPhone && Number(active.amount) === price
          ? active
          : await startPayment({
              userId: user.id,
              target,
              amount: price,
              phone: kaspiPhone!,
              description: invoiceDescription(event.title),
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

      const fresh = await prisma.registration.findUnique({ where: { id: registration.id } });
      return reply.code(201).send({
        user: serializeUser(user),
        registration: fresh ?? registration,
        payment: serializePayment(payment),
      });
    },
  );
}
