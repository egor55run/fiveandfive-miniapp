import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { requireAdmin } from '../../plugins/adminAuth';
import { normalizeCode } from '../../lib/promo';
import { personLabel } from '../../lib/audit';
import { sendValidationError } from '../../lib/validation';

/**
 * Промокоды в админке: список с использованиями, создание, правка,
 * выключение. Удалять нельзя: по коду могли оплатить — история нужна.
 */

const promoSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .transform(normalizeCode)
      .refine((v) => /^[A-Z0-9А-ЯЁ_-]+$/.test(v), 'Код — буквы, цифры, «-» и «_», без пробелов'),
    kind: z.enum(['PERCENT', 'FIXED']),
    value: z.number().int().min(1).max(10_000_000),
    maxUses: z.number().int().min(1).max(1_000_000).nullable(),
    validFrom: z.coerce.date().nullable(),
    validUntil: z.coerce.date().nullable(),
    eventId: z.number().int().positive().nullable(),
    active: z.boolean(),
    note: z.string().trim().max(200).nullable(),
  })
  .refine((v) => v.kind !== 'PERCENT' || v.value <= 100, { message: 'Скидка в процентах — не больше 100', path: ['value'] })
  .refine((v) => !v.validFrom || !v.validUntil || v.validFrom < v.validUntil, {
    message: '«Действует с» должно быть раньше «до»',
    path: ['validUntil'],
  });

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function adminPromosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** GET /admin/promo-codes — коды и кто их использовал. */
  app.get('/admin/promo-codes', async () => {
    const codes = await prisma.promoCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        event: { select: { id: true, title: true, date: true } },
        redemptions: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { firstName: true, lastName: true, username: true, telegramId: true } } },
        },
      },
    });
    // Что именно оплачивали — старт или абонемент.
    const regIds = codes.flatMap((c) => c.redemptions.map((r) => r.registrationId).filter((x): x is number => x !== null));
    const regs = await prisma.registration.findMany({ where: { id: { in: regIds } }, include: { event: true } });
    const regTitle = new Map(regs.map((r) => [r.id, r.event.title]));

    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      kind: c.kind,
      value: c.value,
      maxUses: c.maxUses,
      validFrom: c.validFrom,
      validUntil: c.validUntil,
      eventId: c.eventId,
      event: c.event,
      active: c.active,
      note: c.note,
      createdAt: c.createdAt,
      // В лимит идут выставленные и оплаченные; освобождённые — нет.
      used: c.redemptions.filter((r) => r.status !== 'RELEASED').length,
      redemptions: c.redemptions.map((r) => ({
        id: r.id,
        at: r.createdAt,
        who: personLabel(r.user),
        username: r.user.username,
        telegramId: r.user.telegramId?.toString() ?? null,
        target: r.registrationId ? (regTitle.get(r.registrationId) ?? 'старт') : 'абонемент',
        base: Number(r.baseAmount),
        discount: Number(r.discount),
        total: Number(r.baseAmount) - Number(r.discount),
        status: r.status,
      })),
    }));
  });

  /** POST /admin/promo-codes — новый код. */
  app.post('/admin/promo-codes', async (req, reply) => {
    const parsed = promoSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    if (await prisma.promoCode.findUnique({ where: { code: parsed.data.code } })) {
      return reply.code(409).send({ error: 'Такой код уже есть', reason: 'code_taken', fields: { code: 'Такой код уже есть' } });
    }
    const created = await prisma.promoCode.create({ data: parsed.data });
    req.log.info({ promoCodeId: created.id, code: created.code }, 'Промокод создан');
    return reply.code(201).send({ id: created.id });
  });

  /**
   * PATCH /admin/promo-codes/:id — правка. Код (сами буквы) не меняется, если
   * его уже использовали: в истории он должен остаться тем же.
   */
  app.patch<{ Params: { id: string } }>('/admin/promo-codes/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = promoSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const current = await prisma.promoCode.findUnique({ where: { id }, include: { _count: { select: { redemptions: true } } } });
    if (!current) return reply.code(404).send({ error: 'Промокод не найден' });
    if (parsed.data.code !== current.code) {
      if (current._count.redemptions > 0) {
        return reply.code(409).send({ error: 'Код уже использовали — сами буквы менять нельзя. Создайте новый', reason: 'code_used' });
      }
      if (await prisma.promoCode.findUnique({ where: { code: parsed.data.code } })) {
        return reply.code(409).send({ error: 'Такой код уже есть', reason: 'code_taken', fields: { code: 'Такой код уже есть' } });
      }
    }
    await prisma.promoCode.update({ where: { id }, data: parsed.data });
    req.log.info({ promoCodeId: id }, 'Промокод изменён');
    return { id };
  });
}
