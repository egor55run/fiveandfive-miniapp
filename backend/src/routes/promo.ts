import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../prisma';
import { PromoError, quotePromo } from '../lib/promo';
import { pickDistance } from '../lib/distances';
import { sendValidationError } from '../lib/validation';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';

/**
 * POST /promo/check — проверить промокод в форме регистрации до отправки:
 * { code, eventId, distanceId? } для старта или { code, seasonId } для
 * абонемента. Ответ — цена, скидка и итог. Окончательно код проверяется ещё
 * раз при регистрации (lib/promo), так что этот ответ — только подсказка.
 */
const checkSchema = z.union([
  z.object({ code: z.string().trim().min(1).max(40), eventId: z.number().int().positive(), distanceId: z.number().int().positive().optional() }),
  z.object({ code: z.string().trim().min(1).max(40), seasonId: z.number().int().positive() }),
]);

export async function promoRoutes(app: FastifyInstance) {
  app.post('/promo/check', { preHandler: requireTelegramAuth }, async (req, reply) => {
    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);
    const data = parsed.data;
    const me = await prisma.user.findUnique({ where: { telegramId: BigInt(tgUserOf(req).id) }, select: { id: true } });

    let base: number;
    let target: { kind: 'race'; eventId: number } | { kind: 'pass'; seasonId: number };
    let reuseFor: { registrationId?: number; seasonPassId?: number } = {};
    if ('eventId' in data) {
      const distance = await pickDistance(prisma, data.eventId, data.distanceId);
      if (!distance) return reply.code(404).send({ error: 'Старт не найден' });
      base = Math.round(Number(distance.price));
      target = { kind: 'race', eventId: data.eventId };
      if (me) {
        const reg = await prisma.registration.findUnique({ where: { userId_eventId: { userId: me.id, eventId: data.eventId } } });
        reuseFor = { registrationId: reg?.id };
      }
    } else {
      const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
      if (!season) return reply.code(404).send({ error: 'Сезон не найден' });
      base = Math.round(Number(season.price));
      target = { kind: 'pass', seasonId: data.seasonId };
      if (me) {
        const pass = await prisma.seasonPass.findUnique({ where: { userId_seasonId: { userId: me.id, seasonId: data.seasonId } } });
        reuseFor = { seasonPassId: pass?.id };
      }
    }
    try {
      const q = await quotePromo(prisma, { code: data.code, target, base, userId: me?.id ?? null, reuseFor });
      return {
        code: q.promo.code,
        kind: q.promo.kind,
        value: q.promo.value,
        base: q.base,
        discount: q.discount,
        total: q.total,
      };
    } catch (err) {
      if (err instanceof PromoError) return reply.code(400).send({ error: err.message, reason: 'promo', fields: { promoCode: err.message } });
      throw err;
    }
  });
}
