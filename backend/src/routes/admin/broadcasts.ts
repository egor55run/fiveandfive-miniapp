import type { Broadcast } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { adminOf, requireAdmin } from '../../plugins/adminAuth';
import { writeAudit } from '../../lib/audit';
import {
  AUDIENCES,
  BroadcastError,
  audienceIds,
  deliver,
  deliveryStats,
  draftProblem,
  enqueue,
  processQueue,
  saveBroadcastPhoto,
  sanitizeHtml,
  visibleLength,
} from '../../lib/broadcasts';

/** Админка: раздел «Рассылки» (lib/broadcasts). */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const draftSchema = z.object({
  text: z.string().max(20_000),
  buttonKind: z.enum(['url', 'app']).nullable(),
  buttonText: z.string().trim().max(64).nullable(),
  buttonUrl: z.string().trim().max(500).nullable(),
  audience: z.enum(AUDIENCES),
  eventId: z.number().int().positive().nullable(),
});

async function serialize(b: Broadcast) {
  return {
    id: b.id,
    text: b.text,
    length: visibleLength(b.text),
    photoUrl: b.photoUrl,
    buttonKind: b.buttonKind,
    buttonText: b.buttonText,
    buttonUrl: b.buttonUrl,
    audience: b.audience,
    eventId: b.eventId,
    status: b.status,
    testedAt: b.testedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    startedAt: b.startedAt?.toISOString() ?? null,
    finishedAt: b.finishedAt?.toISOString() ?? null,
    problem: draftProblem(b),
    stats: b.status === 'DRAFT' ? null : await deliveryStats(b.id),
  };
}

export async function adminBroadcastsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  const load = async (raw: string) => {
    const id = parseId(raw);
    return id === null ? null : prisma.broadcast.findUnique({ where: { id } });
  };

  /** GET /admin/broadcasts — последние рассылки и старты для выбора аудитории. */
  app.get('/admin/broadcasts', async () => {
    const [list, events] = await Promise.all([
      prisma.broadcast.findMany({ orderBy: { id: 'desc' }, take: 30 }),
      prisma.event.findMany({ orderBy: { date: 'asc' }, select: { id: true, title: true, date: true } }),
    ]);
    return {
      broadcasts: await Promise.all(list.map(serialize)),
      events: events.map((e) => ({ id: e.id, title: e.title, date: e.date.toISOString() })),
    };
  });

  /** GET /admin/broadcasts/audience?audience=EVENT&eventId=1 — сколько получат сейчас. */
  app.get<{ Querystring: { audience?: string; eventId?: string } }>('/admin/broadcasts/audience', async (req, reply) => {
    const audience = String(req.query.audience ?? 'ALL');
    if (!(AUDIENCES as readonly string[]).includes(audience)) return reply.code(400).send({ error: 'Неизвестная аудитория' });
    const eventId = req.query.eventId ? parseId(req.query.eventId) : null;
    return { count: (await audienceIds(audience, eventId)).length };
  });

  /** POST /admin/broadcasts — новый черновик. */
  app.post('/admin/broadcasts', async (req, reply) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Некорректные данные' });
    const d = parsed.data;
    const created = await prisma.broadcast.create({
      data: {
        text: sanitizeHtml(d.text),
        buttonKind: d.buttonKind,
        buttonText: d.buttonKind ? d.buttonText : null,
        buttonUrl: d.buttonKind === 'url' ? d.buttonUrl : null,
        audience: d.audience,
        eventId: d.audience === 'EVENT' ? d.eventId : null,
        createdBy: BigInt(adminOf(req).telegramId),
      },
    });
    return reply.code(201).send(await serialize(created));
  });

  /** PATCH /admin/broadcasts/:id — правка черновика; тест нужно повторить. */
  app.patch<{ Params: { id: string } }>('/admin/broadcasts/:id', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    if (b.status !== 'DRAFT') return reply.code(409).send({ error: 'Отправленную рассылку не изменить', reason: 'not_draft' });
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Некорректные данные' });
    const d = parsed.data;
    const text = sanitizeHtml(d.text);
    const data = {
      text,
      buttonKind: d.buttonKind,
      buttonText: d.buttonKind ? d.buttonText : null,
      buttonUrl: d.buttonKind === 'url' ? d.buttonUrl : null,
      audience: d.audience,
      eventId: d.audience === 'EVENT' ? d.eventId : null,
    };
    // Аудитория на сообщение не влияет — тест сбрасываем, только если поменялось само сообщение.
    const messageChanged =
      text !== b.text || data.buttonKind !== b.buttonKind || data.buttonText !== b.buttonText || data.buttonUrl !== b.buttonUrl;
    const updated = await prisma.broadcast.update({
      where: { id: b.id },
      data: { ...data, ...(messageChanged ? { testedAt: null } : {}) },
    });
    return serialize(updated);
  });

  /** DELETE /admin/broadcasts/:id — удалить черновик. */
  app.delete<{ Params: { id: string } }>('/admin/broadcasts/:id', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    if (b.status !== 'DRAFT') return reply.code(409).send({ error: 'Удалить можно только черновик', reason: 'not_draft' });
    await prisma.broadcast.delete({ where: { id: b.id } });
    return { ok: true };
  });

  /** POST /admin/broadcasts/:id/photo — картинка (multipart, поле file; JPG/PNG/WebP до 5 МБ). */
  app.post<{ Params: { id: string } }>('/admin/broadcasts/:id/photo', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    if (b.status !== 'DRAFT') return reply.code(409).send({ error: 'Отправленную рассылку не изменить', reason: 'not_draft' });
    let buffer: Buffer;
    try {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'Файл не приложен', reason: 'no_file' });
      buffer = await file.toBuffer();
      if (file.file.truncated) return reply.code(413).send({ error: 'Файл больше 5 МБ', reason: 'file_too_large' });
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'Файл больше 5 МБ', reason: 'file_too_large' });
      }
      return reply.code(400).send({ error: 'Ожидается файл в multipart/form-data', reason: 'bad_multipart' });
    }
    try {
      const photoUrl = await saveBroadcastPhoto(b.id, buffer);
      const updated = await prisma.broadcast.update({ where: { id: b.id }, data: { photoUrl, photoFileId: null, testedAt: null } });
      return serialize(updated);
    } catch (err) {
      if (err instanceof BroadcastError) return reply.code(400).send({ error: err.message, reason: err.reason });
      throw err;
    }
  });

  /** DELETE /admin/broadcasts/:id/photo — убрать картинку. */
  app.delete<{ Params: { id: string } }>('/admin/broadcasts/:id/photo', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    if (b.status !== 'DRAFT') return reply.code(409).send({ error: 'Отправленную рассылку не изменить', reason: 'not_draft' });
    const updated = await prisma.broadcast.update({ where: { id: b.id }, data: { photoUrl: null, photoFileId: null, testedAt: null } });
    return serialize(updated);
  });

  /** POST /admin/broadcasts/:id/test — отправить только себе (админу, который нажал). */
  app.post<{ Params: { id: string } }>('/admin/broadcasts/:id/test', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    const problem = draftProblem(b);
    if (problem) return reply.code(400).send({ error: problem, reason: 'invalid' });
    const outcome = await deliver(b, String(adminOf(req).telegramId));
    if (!outcome.ok) {
      const error = outcome.blocked
        ? 'Бот не может написать вам: откройте бота и нажмите «Старт», затем повторите'
        : `Telegram не принял сообщение: ${outcome.error}`;
      return reply.code(502).send({ error, reason: 'telegram' });
    }
    const updated = b.status === 'DRAFT' ? await prisma.broadcast.update({ where: { id: b.id }, data: { testedAt: new Date() } }) : b;
    return serialize(updated);
  });

  /** POST /admin/broadcasts/:id/send — разослать аудитории (только после теста). */
  app.post<{ Params: { id: string } }>('/admin/broadcasts/:id/send', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    if (b.status !== 'DRAFT') return reply.code(409).send({ error: 'Рассылка уже отправлена', reason: 'not_draft' });
    const problem = draftProblem(b);
    if (problem) return reply.code(400).send({ error: problem, reason: 'invalid' });
    if (!b.testedAt) return reply.code(409).send({ error: 'Сначала отправьте тест себе', reason: 'not_tested' });
    let count: number;
    try {
      count = await enqueue(b);
    } catch (err) {
      if (err instanceof BroadcastError) return reply.code(409).send({ error: err.message, reason: err.reason });
      throw err;
    }
    const admin = adminOf(req);
    await prisma.$transaction((tx) =>
      writeAudit(tx, {
        adminTelegramId: admin.telegramId,
        action: 'broadcast.send',
        eventId: b.eventId,
        subject: `Рассылка №${b.id}`,
        changes: { audience: [null, b.audience], recipients: [null, String(count)] },
      }),
    );
    req.log.info({ broadcastId: b.id, count }, 'Рассылка запущена из админки');
    void processQueue(req.log, { retries: false });
    return reply.code(202).send(await serialize((await load(req.params.id))!));
  });

  /** POST /admin/broadcasts/:id/cancel — остановить: кому не успели, тем не уйдёт. */
  app.post<{ Params: { id: string } }>('/admin/broadcasts/:id/cancel', async (req, reply) => {
    const b = await load(req.params.id);
    if (!b) return reply.code(404).send({ error: 'Рассылка не найдена' });
    const done = await prisma.broadcast.updateMany({
      where: { id: b.id, status: 'SENDING' },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    if (done.count === 0) return reply.code(409).send({ error: 'Рассылка не идёт', reason: 'not_sending' });
    return serialize((await load(req.params.id))!);
  });
}
