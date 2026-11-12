import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../plugins/adminAuth';
import { financeReport, type FinanceScope } from '../../lib/finance';

/**
 * «Финансы» (2026-11-12): только просмотр. GET /admin/finance?scope=all|season|event
 * &seasonId=&eventId=&from=YYYY-MM-DD&to=YYYY-MM-DD.
 */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД');
const querySchema = z.object({
  scope: z.enum(['all', 'season', 'event']).default('all'),
  seasonId: z.coerce.number().int().positive().optional(),
  eventId: z.coerce.number().int().positive().optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});

export async function adminFinanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/finance', async (req, reply) => {
    const q = querySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.issues[0]?.message ?? 'Неверный фильтр' });
    const { scope, seasonId, eventId, from, to } = q.data;
    let s: FinanceScope;
    if (scope === 'season') {
      if (!seasonId) return reply.code(400).send({ error: 'Выберите сезон' });
      s = { kind: 'season', seasonId };
    } else if (scope === 'event') {
      if (!eventId) return reply.code(400).send({ error: 'Выберите старт' });
      s = { kind: 'event', eventId };
    } else s = { kind: 'all' };
    if (from && to && from > to) return reply.code(400).send({ error: '«С» должно быть не позже «по»' });
    return financeReport({ scope: s, from: from ?? null, to: to ?? null });
  });
}
