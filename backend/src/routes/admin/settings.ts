import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { adminOf, requireAdmin } from '../../plugins/adminAuth';
import { writeAudit } from '../../lib/audit';
import { apiPayConfigured } from '../../lib/apipay';
import { faqItems } from '../../lib/support';
import { invoicesToday } from '../../lib/invoiceLimit';
import { registrationOpen } from '../../lib/registrationWindow';
import { saveSettings, settings, type Settings } from '../../lib/settings';

/** Админка: «Настройки» и «Вопросы» (2026-11-10) — то, что раньше было в .env и коде. */

const patchSchema = z
  .object({
    pricesPublic: z.boolean(),
    registrationOpen: z.boolean(),
    invoiceDailyLimit: z.number().int().min(1).max(100_000),
    invoiceDailyWarn: z.number().int().min(1).max(100_000),
    emailDailyLimit: z.number().int().min(1).max(1_000_000),
  })
  .partial();

const blockSchema = z.union([z.string().trim().min(1).max(2000), z.object({ list: z.array(z.string().trim().min(1).max(500)).min(1).max(30) })]);
const faqSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
        q: z.string().trim().min(3).max(300),
        a: z.array(blockSchema).min(1).max(20),
      }),
    )
    .min(1)
    .max(100),
});

function view(s: Settings) {
  return {
    pricesPublic: s.pricesPublic,
    registrationOpen: s.registrationOpen,
    registrationOpenedAt: s.registrationOpenedAt,
    invoiceDailyLimit: s.invoiceDailyLimit,
    invoiceDailyWarn: s.invoiceDailyWarn,
    emailDailyLimit: s.emailDailyLimit,
    // Что на самом деле видят участники — с учётом подключения оплаты.
    paymentConfigured: apiPayConfigured(),
    registrationEffective: registrationOpen(),
  };
}

export async function adminSettingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/settings', async () => ({ ...view(settings()), invoicesToday: await invoicesToday() }));

  app.patch('/admin/settings', async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Проверьте поля' });
    const patch = parsed.data;
    const before = settings();
    const warn = patch.invoiceDailyWarn ?? before.invoiceDailyWarn;
    const limit = patch.invoiceDailyLimit ?? before.invoiceDailyLimit;
    if (warn > limit) return reply.code(400).send({ error: 'Порог предупреждения не может быть больше лимита' });
    const admin = adminOf(req);
    const after = await saveSettings(patch, admin.telegramId);
    const changes: Record<string, [string | null, string | null]> = {};
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      if (String(before[key]) !== String(after[key])) changes[key] = [String(before[key]), String(after[key])];
    }
    if (Object.keys(changes).length > 0) {
      await prisma.$transaction((tx) => writeAudit(tx, { adminTelegramId: admin.telegramId, action: 'settings.update', subject: 'Настройки', changes }));
      req.log.info({ changes }, 'Настройки изменены из админки');
    }
    return { ...view(after), invoicesToday: await invoicesToday() };
  });

  app.get('/admin/faq', async () => ({ items: faqItems(), custom: settings().faq !== null }));

  app.put('/admin/faq', async (req, reply) => {
    const parsed = faqSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ? `Проверьте вопросы: ${parsed.error.issues[0].message}` : 'Проверьте вопросы' });
    }
    const ids = parsed.data.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: 'Два вопроса с одинаковым кодом' });
    const admin = adminOf(req);
    await saveSettings({ faq: parsed.data.items }, admin.telegramId);
    await prisma.$transaction((tx) =>
      writeAudit(tx, { adminTelegramId: admin.telegramId, action: 'settings.update', subject: 'Вопросы', changes: { faq: [null, `${ids.length} вопросов`] } }),
    );
    return { items: faqItems(), custom: true };
  });
}
