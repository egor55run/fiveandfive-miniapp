import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { requireAdmin } from '../../plugins/adminAuth';
import { ageOnStartDay, checkAge } from '../../lib/eligibility';
import { ageFromBirthDate, formatBirthDate, parseBirthDate } from '../../lib/birthDate';
import { diffFields, personLabel, writeAudit } from '../../lib/audit';
import { REFUND_PERCENTS, RefundError, applyAdminRefund, money, refundPreview } from '../../lib/refunds';
import { MergeError, mergeUsers } from '../../lib/merge';
import type { Prisma } from '@prisma/client';
import { BibError, assignMissingBibs, assignRegistrationBib, releaseRegistrationBib, setBibManually } from '../../lib/bibs';
import {
  birthDateField,
  emailField,
  genderField,
  personNameField,
  phoneField,
  sendValidationError,
} from '../../lib/validation';
import {
  claimDistanceSlot,
  DISTANCE_ORDER,
  distanceIdOf,
  pickDistance,
  releaseDistanceSlot,
  serializeDistance,
} from '../../lib/distances';

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
        include: { user: true, distance: true, refunds: { orderBy: { createdAt: 'asc' } } },
      });

      // Результаты подтягиваем одним запросом — чтобы в списке было видно,
      // кому финишное время уже внесли.
      const results = await prisma.result.findMany({ where: { eventId } });
      const resultByUser = new Map(results.map((r) => [r.userId, r]));

      // Цена, скидка и итог: оплаченный счёт (старта или абонемента) или код на 100%.
      const regIds = registrations.map((r) => r.id);
      const passIds = registrations.map((r) => r.seasonPassId).filter((x): x is number => x !== null);
      const paidPayments = await prisma.payment.findMany({
        where: { state: 'PAID', OR: [{ registrationId: { in: regIds } }, { seasonPassId: { in: passIds } }] },
        include: { promoCode: true },
        orderBy: { paidAt: 'desc' },
      });
      const freeCodes = await prisma.promoRedemption.findMany({
        where: { status: 'USED', paymentId: null, OR: [{ registrationId: { in: regIds } }, { seasonPassId: { in: passIds } }] },
        include: { promoCode: true },
      });
      const priceOf = (r: { id: number; seasonPassId: number | null }) => {
        const match = (x: { registrationId: number | null; seasonPassId: number | null }) =>
          r.seasonPassId ? x.seasonPassId === r.seasonPassId : x.registrationId === r.id;
        const pay = paidPayments.find(match);
        if (pay) {
          const total = Math.round(Number(pay.amount));
          const discount = Math.round(Number(pay.discount));
          return {
            base: pay.baseAmount !== null ? Math.round(Number(pay.baseAmount)) : total + discount,
            discount,
            total,
            promoCode: pay.promoCode?.code ?? null,
            pass: r.seasonPassId !== null,
          };
        }
        const free = freeCodes.find(match);
        if (free) {
          const base = Math.round(Number(free.baseAmount));
          const discount = Math.round(Number(free.discount));
          return { base, discount, total: base - discount, promoCode: free.promoCode.code, pass: r.seasonPassId !== null };
        }
        return null;
      };

      return {
        event: { id: event.id, title: event.title, date: event.date },
        distances: (
          await prisma.eventDistance.findMany({ where: { eventId }, orderBy: DISTANCE_ORDER })
        ).map(serializeDistance),
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
            gender: r.user.gender,
            birthDate: r.user.birthDate ? r.user.birthDate.toISOString().slice(0, 10) : null,
            // Возраст на день этого старта: 16–17 — нужна письменная справка
            // от родителя при выдаче стартового пакета (lib/eligibility).
            ageOnStart: r.user.birthDate ? ageOnStartDay(r.user.birthDate, event.date) : null,
            telegramId: r.user.telegramId?.toString() ?? null,
            username: r.user.username,
            paymentStatus: r.paymentStatus,
            // Стартовый номер (lib/bibs) — на этом старте.
            bibNumber: r.bibNumber,
            // Цена, скидка, итог (у абонемента — за весь абонемент, pass: true).
            price: priceOf(r),
            // Добавлен администратором без оплаты (партнёр, волонтёр).
            manual: r.manual,
            manualNote: r.manualNote,
            distanceId: r.distanceId,
            distance: r.distance?.label ?? null,
            qrCode: r.qrCode,
            // Абонемент: регистрация создана оптом, отменять её по одной нельзя
            // без последствий для остальных — помечаем, чтобы UI предупредил.
            seasonPassId: r.seasonPassId,
            // Оформлен возврат: запись CANCELLED, в списке — «Возврат».
            refund: r.refundedAt
              ? {
                  at: r.refundedAt,
                  percent: r.refunds.at(-1)?.percent ?? null,
                  amount: r.refunds.reduce((sum, x) => sum + Number(x.amount), 0),
                  confirmed: r.refunds.length > 0 && r.refunds.every((x) => x.confirmedAt !== null),
                }
              : null,
            registeredAt: r.registeredAt,
            result: result
              ? { id: result.id, finishTime: result.finishTime, place: result.genderPlace ?? result.place, status: result.status }
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
        include: { event: true, user: true },
      });
      if (!registration) {
        return reply.code(404).send({ error: 'Регистрация не найдена' });
      }

      const prev = registration.paymentStatus;
      // По оформленному возврату статус не меняем: человек записывается заново сам.
      if (registration.refundedAt) {
        return reply.code(409).send({ error: 'По этой записи оформлен возврат — статус не меняется', reason: 'refunded' });
      }
      if (prev === next) {
        return { registrationId: id, paymentStatus: next, slotsChanged: 0 };
      }

      const wasHolding = HOLDS_SLOT(prev);
      const willHold = HOLDS_SLOT(next);
      const delta = Number(willHold) - Number(wasHolding); // -1, 0 или +1

      const NO_SLOTS = {
        error: 'Свободных мест на этой дистанции нет — вернуть регистрацию нельзя',
        reason: 'no_slots',
      };
      let updated;
      let bibNote: 'released' | 'kept' | 'none' | number | null = null;
      try {
        updated = await prisma.$transaction(async (tx) => {
          const distanceId = await distanceIdOf(tx, registration);
          if (delta > 0) {
            // Возвращаем место занятым — может упереться в лимит дистанции.
            if (!distanceId || !(await claimDistanceSlot(tx, distanceId))) throw new Error('no_slots');
          } else if (delta < 0 && distanceId) {
            await releaseDistanceSlot(tx, distanceId);
          }
          await writeAudit(tx, {
            adminTelegramId: req.admin!.telegramId,
            action: 'registration.status',
            eventId: registration.eventId,
            registrationId: id,
            userId: registration.userId,
            subject: personLabel(registration.user),
            changes: { paymentStatus: [prev, next] },
          });
          const saved = await tx.registration.update({
            where: { id },
            data: { paymentStatus: next, ...(distanceId ? { distanceId } : {}) },
          });
          // Номер: оплатили — выдать; отменили — в пул (до начала выдачи пакетов).
          if (next === 'PAID') bibNote = await assignRegistrationBib(tx, id);
          if (next === 'CANCELLED') bibNote = await releaseRegistrationBib(tx, saved);
          return tx.registration.findUniqueOrThrow({ where: { id } });
        });
      } catch (err) {
        if ((err as Error).message === 'no_slots') return reply.code(409).send(NO_SLOTS);
        throw err;
      }

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
        bibNumber: updated.bibNumber,
        // 'kept' — выдача пакетов уже началась: номер остался за записью.
        bibNote,
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

  /**
   * PATCH /admin/registrations/:id/participant — правка данных участника и его
   * дистанции. Проверки — те же, что в форме приложения (кириллица, телефон,
   * email, возраст на день старта). Данные человека общие для всех его стартов.
   */
  app.patch<{ Params: { id: string } }>('/admin/registrations/:id/participant', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = participantSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;

    const reg = await prisma.registration.findUnique({
      where: { id },
      include: { user: true, event: true, distance: true },
    });
    if (!reg) return reply.code(404).send({ error: 'Регистрация не найдена' });

    const birthDate = parseBirthDate(data.birthDate)!;
    // Возраст — то же правило 16+, что в приложении; согласие родителя для
    // 16–17 администратор проверяет на выдаче пакета (метка «16–17» в списке).
    const age = checkAge(birthDate, reg.event.date, true);
    if (!age.ok) return reply.code(400).send(age.body);

    const distance = await pickDistance(prisma, reg.eventId, data.distanceId);
    if (!distance) return reply.code(400).send({ error: 'Такой дистанции у старта нет', reason: 'bad_distance' });

    const before = personFields(reg.user, reg.distance?.label ?? null);
    const after = {
      lastName: data.lastName,
      firstName: data.firstName,
      birthDate: formatBirthDate(birthDate),
      gender: data.gender,
      phone: data.phone,
      email: data.email,
      distance: distance.label,
    };
    const changes = diffFields(before, after);
    if (Object.keys(changes).length === 0) return { changed: false };

    try {
      await prisma.$transaction(async (tx) => {
        // Сменилась дистанция у живой записи — место переезжает вместе с ней.
        if (reg.distanceId !== distance.id && reg.paymentStatus !== 'CANCELLED') {
          if (!(await claimDistanceSlot(tx, distance.id))) throw new Error('no_slots');
          if (reg.distanceId) await releaseDistanceSlot(tx, reg.distanceId);
        }
        await tx.registration.update({ where: { id }, data: { distanceId: distance.id } });
        await tx.user.update({
          where: { id: reg.userId },
          data: {
            lastName: data.lastName,
            firstName: data.firstName,
            birthDate,
            age: ageFromBirthDate(birthDate),
            gender: data.gender,
            phone: data.phone,
            email: data.email,
          },
        });
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'participant.update',
          eventId: reg.eventId,
          registrationId: id,
          userId: reg.userId,
          subject: personLabel({ lastName: data.lastName, firstName: data.firstName }),
          changes,
        });
      });
    } catch (err) {
      if ((err as Error).message === 'no_slots') {
        return reply.code(409).send({ error: `На «${distance.label}» мест нет`, reason: 'no_slots' });
      }
      throw err;
    }
    req.log.info({ registrationId: id, fields: Object.keys(changes) }, 'Данные участника изменены из админки');
    return { changed: true, changes };
  });

  /**
   * POST /admin/events/:id/participants — добавить участника вручную, без
   * оплаты (партнёр, волонтёр). Занимает место на дистанции, считается
   * подтверждённым; помечен «вручную» и в деньгах не считается (платежа нет).
   */
  app.post<{ Params: { id: string } }>('/admin/events/:id/participants', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = createParticipantSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    const birthDate = parseBirthDate(data.birthDate)!;
    const age = checkAge(birthDate, event.date, true);
    if (!age.ok) return reply.code(400).send(age.body);
    const distance = await pickDistance(prisma, eventId, data.distanceId);
    if (!distance) return reply.code(400).send({ error: 'Такой дистанции у старта нет', reason: 'bad_distance' });

    let registrationId: number;
    try {
      registrationId = await prisma.$transaction(async (tx) => {
        if (!(await claimDistanceSlot(tx, distance.id))) throw new Error('no_slots');
        // Без Telegram: такой участник не входит в приложение, данные — со слов
        // администратора.
        const user = await tx.user.create({
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            birthDate,
            age: ageFromBirthDate(birthDate),
            gender: data.gender,
            phone: data.phone,
            email: data.email,
          },
        });
        const reg = await tx.registration.create({
          data: {
            userId: user.id,
            eventId,
            distanceId: distance.id,
            paymentStatus: 'PAID',
            manual: true,
            manualNote: data.note || null,
          },
        });
        await tx.registration.update({ where: { id: reg.id }, data: { qrCode: `fiveandfive://ticket/${reg.id}` } });
        await assignRegistrationBib(tx, reg.id);
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'participant.create',
          eventId,
          registrationId: reg.id,
          userId: user.id,
          subject: personLabel(user),
          changes: diffFields({}, { ...personFields(user, distance.label), note: data.note || null }),
        });
        return reg.id;
      });
    } catch (err) {
      if ((err as Error).message === 'no_slots') {
        return reply.code(409).send({ error: `На «${distance.label}» мест нет`, reason: 'no_slots' });
      }
      throw err;
    }
    req.log.info({ eventId, registrationId }, 'Участник добавлен вручную из админки');
    return reply.code(201).send({ registrationId });
  });

  /**
   * GET /admin/users/:id/duplicates — возможные двойники: тот же телефон,
   * email или те же фамилия и имя.
   */
  app.get<{ Params: { id: string } }>('/admin/users/:id/duplicates', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return reply.code(404).send({ error: 'Участник не найден' });
    const or: Prisma.UserWhereInput[] = [
      { firstName: { equals: u.firstName, mode: 'insensitive' }, lastName: { equals: u.lastName ?? '', mode: 'insensitive' } },
    ];
    if (u.phone) or.push({ phone: u.phone });
    if (u.email) or.push({ email: { equals: u.email, mode: 'insensitive' } });
    const list = await prisma.user.findMany({
      where: { id: { not: id }, OR: or },
      include: { registrations: { include: { event: true } } },
      take: 20,
    });
    return list.map((x) => ({
      userId: x.id,
      name: personLabel(x),
      phone: x.phone,
      email: x.email,
      birthDate: formatBirthDate(x.birthDate),
      telegram: x.telegramId !== null,
      username: x.username,
      events: x.registrations.map((r) => r.event.title),
    }));
  });

  /** POST /admin/users/merge — { intoUserId, fromUserId }: перенести всё и удалить второго. */
  const mergeSchema = z.object({ intoUserId: z.number().int().positive(), fromUserId: z.number().int().positive() });
  app.post('/admin/users/merge', async (req, reply) => {
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      const moved = await prisma.$transaction((tx) => mergeUsers(tx, { ...parsed.data, adminTelegramId: req.admin!.telegramId }));
      req.log.info({ ...parsed.data, moved }, 'Двойники объединены');
      return { moved };
    } catch (err) {
      if (err instanceof MergeError) return reply.code(409).send({ error: err.message, reason: 'merge_conflict' });
      throw err;
    }
  });

  /**
   * PATCH /admin/registrations/:id/bib — ручная смена номера { bib: число | null }.
   * Только на этом старте (у абонемента номера на каждом старте свои). В журнал изменений.
   */
  const bibSchema = z.object({ bib: z.number().int().min(1).max(999_999).nullable() });
  app.patch<{ Params: { id: string } }>('/admin/registrations/:id/bib', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = bibSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const reg = await prisma.registration.findUnique({ where: { id }, include: { user: true } });
    if (!reg) return reply.code(404).send({ error: 'Регистрация не найдена' });
    try {
      const res = await prisma.$transaction(async (tx) => {
        const out = await setBibManually(tx, id, parsed.data.bib);
        const before = reg.bibNumber === null ? null : String(reg.bibNumber);
        const after = parsed.data.bib === null ? null : String(parsed.data.bib);
        for (const rid of out.changed) {
          const r = await tx.registration.findUniqueOrThrow({ where: { id: rid } });
          await writeAudit(tx, {
            adminTelegramId: req.admin!.telegramId,
            action: 'registration.bib',
            eventId: r.eventId,
            registrationId: rid,
            userId: reg.userId,
            subject: personLabel(reg.user),
            changes: { bib: [before, after] },
          });
        }
        return out;
      });
      return { bibNumber: parsed.data.bib, registrations: res.changed.length };
    } catch (err) {
      if (err instanceof BibError) return reply.code(409).send({ error: err.message, reason: 'bib_taken' });
      throw err;
    }
  });

  /** POST /admin/events/:id/assign-bibs — выдать номера оплаченным без номера. */
  app.post<{ Params: { id: string } }>('/admin/events/:id/assign-bibs', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const res = await prisma.$transaction((tx) => assignMissingBibs(tx, eventId));
    req.log.info({ eventId, ...res }, 'Номера выданы оплаченным без номера');
    return res;
  });

  /**
   * GET /admin/registrations/:id/refund — что можно вернуть: сумма оплаты,
   * этапы (для абонемента — все старты), подсказка по п. 5.1 оферты.
   */
  app.get<{ Params: { id: string } }>('/admin/registrations/:id/refund', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    try {
      return await refundPreview(id);
    } catch (err) {
      if (err instanceof RefundError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  /**
   * POST /admin/registrations/:id/refund — оформить возврат. Деньги владелец
   * возвращает сам в ApiPay/Kaspi; здесь — статус «Возврат», место, журнал.
   */
  const refundSchema = z.object({
    stages: z
      .array(
        z.object({
          registrationId: z.number().int().positive(),
          percent: z.union([z.literal(REFUND_PERCENTS[0]), z.literal(REFUND_PERCENTS[1]), z.literal(REFUND_PERCENTS[2])]),
        }),
      )
      .min(1)
      .max(20),
    wholePass: z.boolean().default(false),
  });
  app.post<{ Params: { id: string } }>('/admin/registrations/:id/refund', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    try {
      const res = await applyAdminRefund({ registrationId: id, ...parsed.data, adminTelegramId: req.admin!.telegramId });
      req.log.info({ registrationId: id, ...res }, 'Возврат оформлен из админки');
      return { ...res, totalText: money(res.total) };
    } catch (err) {
      if (err instanceof RefundError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  /** GET /admin/events/:id/audit — журнал изменений по старту, свежие сверху. */
  app.get<{ Params: { id: string } }>('/admin/events/:id/audit', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const rows = await prisma.adminAuditLog.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    // Имена администраторов — из их профилей участника, если они есть.
    const admins = await prisma.user.findMany({
      where: { telegramId: { in: [...new Set(rows.map((r) => r.adminTelegramId))] } },
      select: { telegramId: true, firstName: true, lastName: true, username: true },
    });
    const nameOf = (id: bigint) => {
      if (id === 0n) return 'ApiPay';
      const u = admins.find((a) => a.telegramId === id);
      if (!u) return `id ${id}`;
      return u.username ? `@${u.username}` : personLabel(u);
    };
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      admin: nameOf(r.adminTelegramId),
      action: r.action,
      registrationId: r.registrationId,
      subject: r.subject,
      changes: r.changes,
    }));
  });
}

/** Поля участника для сравнения и журнала: строками, как их видит человек. */
function personFields(
  u: {
    lastName: string | null;
    firstName: string;
    birthDate: Date | null;
    gender: string | null;
    phone: string | null;
    email: string | null;
  },
  distance: string | null,
): Record<string, string | null> {
  return {
    lastName: u.lastName,
    firstName: u.firstName,
    birthDate: formatBirthDate(u.birthDate),
    gender: u.gender,
    phone: u.phone,
    email: u.email,
    distance,
  };
}

const participantSchema = z.object({
  lastName: personNameField('lastName'),
  firstName: personNameField('firstName'),
  birthDate: birthDateField,
  gender: genderField,
  phone: phoneField,
  email: emailField,
  distanceId: z.number().int().positive(),
});

const createParticipantSchema = participantSchema.extend({
  note: z.string().trim().max(100).optional(),
});
