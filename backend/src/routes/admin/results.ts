import type { FastifyInstance } from 'fastify';
import type { ResultStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { deliver, formatFinishTime, resultText } from '../../lib/notify';
import { personLabel, writeAudit } from '../../lib/audit';
import { protestUntil, recomputePlaces, resultPoints } from '../../lib/rating';
import { parseTimingCsv } from '../../lib/timingImport';
import { requireAdmin } from '../../plugins/adminAuth';

/**
 * Результаты старта в админке (решения пользователя 2026-10-23).
 *
 *  - Время — одно, от выстрела (gun time), из файла хронометража; оно и для
 *    баллов, и для призов. Статус: финиш / сошёл / не стартовал / дисквал.
 *  - Загрузка файла: сначала предпросмотр (кто сопоставился по номеру, какие
 *    номера незнакомы, кого нет в файле), потом «Сохранить».
 *  - «Опубликовать» — результаты видны на сайте и в приложении, участникам
 *    уходит сообщение; 48 часов — окно протестов. После него правки — только
 *    с подтверждением (force) и записью в журнал.
 */

const STATUSES = ['FINISHED', 'DNF', 'DNS', 'DSQ'] as const;

const upsertSchema = z
  .object({
    userId: z.number().int().positive(),
    status: z.enum(STATUSES).default('FINISHED'),
    // Время от выстрела в секундах; у не финишировавших — null.
    finishTime: z.number().int().min(1).max(24 * 60 * 60).nullable().optional(),
    force: z.boolean().optional(),
  })
  .refine((v) => v.status !== 'FINISHED' || (v.finishTime ?? null) !== null, {
    message: 'Для финиша нужно время',
    path: ['finishTime'],
  });

const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  /** true — только предпросмотр, ничего не записывать. */
  dryRun: z.boolean(),
  /** Оплаченных, кого нет в файле, отметить «не стартовал». */
  missingAsDns: z.boolean().default(false),
  force: z.boolean().optional(),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const STATUS_LABEL: Record<ResultStatus, string> = { FINISHED: 'финиш', DNF: 'сошёл', DNS: 'не стартовал', DSQ: 'дисквалифицирован' };

/** После окна протестов правки — только осознанно (force). */
function protestClosed(publishedAt: Date | null, now = new Date()): boolean {
  const until = protestUntil(publishedAt);
  return until !== null && now > until;
}
const PROTEST_CLOSED = {
  error: 'Окно протестов (48 часов после публикации) закрыто. Изменить результат всё равно?',
  reason: 'protest_closed',
};

async function protocolOf(eventId: number) {
  const results = await prisma.result.findMany({
    where: { eventId },
    orderBy: [{ place: 'asc' }, { finishTime: 'asc' }],
    include: { user: true },
  });
  const regs = await prisma.registration.findMany({ where: { eventId }, select: { userId: true, bibNumber: true } });
  const bibOf = new Map(regs.map((r) => [r.userId, r.bibNumber]));
  return results.map((r) => ({
    id: r.id,
    userId: r.userId,
    lastName: r.user.lastName,
    firstName: r.user.firstName,
    username: r.user.username,
    gender: r.user.gender,
    bib: bibOf.get(r.userId) ?? null,
    status: r.status,
    finishTime: r.finishTime,
    place: r.place,
    genderPlace: r.genderPlace,
    points: resultPoints(r, r.user.gender),
    recordedAt: r.recordedAt,
  }));
}

async function eventInfo(eventId: number) {
  const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    distance: e.distance,
    resultsPublishedAt: e.resultsPublishedAt,
    protestUntil: protestUntil(e.resultsPublishedAt),
  };
}

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/** Сообщения участникам с результатом — тем, кому ещё не отправляли. */
async function notifyResults(eventId: number, log: Logger): Promise<{ sent: number }> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const results = await prisma.result.findMany({ where: { eventId, status: 'FINISHED' }, include: { user: true } });
  const done = new Set(
    (await prisma.notification.findMany({ where: { eventId, kind: 'RESULT', status: 'SENT' }, select: { userId: true } })).map((n) => n.userId),
  );
  const finishersByGender = new Map<string, number>();
  for (const r of results) finishersByGender.set(r.user.gender ?? '', (finishersByGender.get(r.user.gender ?? '') ?? 0) + 1);
  let sent = 0;
  for (const r of results) {
    if (done.has(r.userId) || r.finishTime === null) continue;
    const gender = r.user.gender;
    const status = await deliver({
      userId: r.userId,
      telegramId: r.user.telegramId,
      eventId,
      kind: 'RESULT',
      text: resultText(event, {
        finishTime: formatFinishTime(r.finishTime),
        place: (gender ? r.genderPlace : r.place) ?? 0,
        finishersTotal: gender ? finishersByGender.get(gender) ?? 1 : results.length,
        points: gender ? resultPoints(r, gender) : undefined,
        gender,
      }),
      log,
    });
    if (status === 'SENT') sent++;
  }
  return { sent };
}

export async function adminResultsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** GET /admin/events/:id/results — протокол старта: статус, места, баллы. */
  app.get<{ Params: { id: string } }>('/admin/events/:id/results', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    return { event: await eventInfo(eventId), results: await protocolOf(eventId) };
  });

  /**
   * PUT /admin/events/:id/results — внести или изменить результат участнику:
   * статус и время. Место и баллы считает сервер.
   */
  app.put<{ Params: { id: string } }>('/admin/events/:id/results', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля', details: parsed.error.flatten() });
    }
    const { userId, status, force } = parsed.data;
    const finishTime = status === 'FINISHED' ? parsed.data.finishTime! : null;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    if (protestClosed(event.resultsPublishedAt) && !force) return reply.code(409).send(PROTEST_CLOSED);

    // Результат только зарегистрированному, иначе протокол разойдётся со
    // списком участников. Отменённые регистрации тоже не в счёт.
    const registration = await prisma.registration.findUnique({
      where: { userId_eventId: { userId, eventId } },
      include: { user: true },
    });
    if (!registration) {
      return reply.code(409).send({ error: 'Участник не зарегистрирован на этот старт', reason: 'not_registered' });
    }
    if (registration.paymentStatus === 'CANCELLED') {
      return reply.code(409).send({ error: 'Регистрация отменена — результат внести нельзя', reason: 'registration_cancelled' });
    }

    const before = await prisma.result.findUnique({ where: { userId_eventId: { userId, eventId } } });
    await prisma.$transaction(async (tx) => {
      await tx.result.upsert({
        where: { userId_eventId: { userId, eventId } },
        // Дистанция результата — из регистрации: рейтинг идёт по 5 км.
        create: { userId, eventId, finishTime, status, eventDistanceId: registration.distanceId },
        update: { finishTime, status, eventDistanceId: registration.distanceId },
      });
      await recomputePlaces(tx, eventId);
      // Правки опубликованных результатов — в журнал (окно протестов).
      if (event.resultsPublishedAt) {
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'result.update',
          eventId,
          registrationId: registration.id,
          userId,
          subject: personLabel(registration.user),
          changes: {
            result: [
              before ? `${STATUS_LABEL[before.status]}${before.finishTime ? ` ${formatFinishTime(before.finishTime)}` : ''}` : null,
              `${STATUS_LABEL[status]}${finishTime ? ` ${formatFinishTime(finishTime)}` : ''}`,
            ],
          },
        });
      }
    });
    req.log.info({ eventId, userId, status, finishTime }, 'Результат внесён из админки');
    return { results: await protocolOf(eventId), event: await eventInfo(eventId) };
  });

  /** DELETE /admin/results/:id — снять результат и пересчитать места. */
  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>('/admin/results/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const result = await prisma.result.findUnique({ where: { id }, include: { event: true, user: true } });
    if (!result) return reply.code(404).send({ error: 'Результат не найден' });
    if (protestClosed(result.event.resultsPublishedAt) && req.query.force !== '1') return reply.code(409).send(PROTEST_CLOSED);
    await prisma.$transaction(async (tx) => {
      await tx.result.delete({ where: { id } });
      await recomputePlaces(tx, result.eventId);
      if (result.event.resultsPublishedAt) {
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'result.update',
          eventId: result.eventId,
          userId: result.userId,
          subject: personLabel(result.user),
          changes: { result: [STATUS_LABEL[result.status], 'снят'] },
        });
      }
    });
    req.log.info({ resultId: id, eventId: result.eventId }, 'Результат снят');
    return { results: await protocolOf(result.eventId), event: await eventInfo(result.eventId) };
  });

  /**
   * POST /admin/events/:id/results/import — файл хронометража (CSV): номер и
   * время от выстрела, по желанию статус. dryRun — только предпросмотр.
   */
  app.post<{ Params: { id: string } }>('/admin/events/:id/results/import', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Нужен файл', details: parsed.error.flatten() });
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    if (!parsed.data.dryRun && protestClosed(event.resultsPublishedAt) && !parsed.data.force) return reply.code(409).send(PROTEST_CLOSED);

    const file = parseTimingCsv(parsed.data.csv);
    if ('error' in file) return reply.code(400).send({ error: file.error, reason: 'bad_file' });

    // Бегут оплаченные (и добавленные вручную) — по номеру.
    const regs = await prisma.registration.findMany({
      where: { eventId, paymentStatus: 'PAID' },
      include: { user: true },
    });
    const byBib = new Map(regs.filter((r) => r.bibNumber !== null).map((r) => [r.bibNumber!, r]));
    const seen = new Set<number>();
    const matched: { bib: number; userId: number; registrationId: number; distanceId: number | null; name: string; status: ResultStatus; finishTime: number | null }[] = [];
    const unknown: number[] = [];
    const duplicates: number[] = [];
    for (const row of file.rows) {
      if (seen.has(row.bib)) {
        duplicates.push(row.bib);
        continue;
      }
      seen.add(row.bib);
      const reg = byBib.get(row.bib);
      if (!reg) {
        unknown.push(row.bib);
        continue;
      }
      matched.push({
        bib: row.bib,
        userId: reg.userId,
        registrationId: reg.id,
        distanceId: reg.distanceId,
        name: personLabel(reg.user),
        status: row.status,
        finishTime: row.status === 'FINISHED' ? row.seconds : null,
      });
    }
    const missing = regs
      .filter((r) => r.bibNumber === null || !seen.has(r.bibNumber))
      .map((r) => ({ bib: r.bibNumber, userId: r.userId, registrationId: r.id, distanceId: r.distanceId, name: personLabel(r.user) }));
    const preview = {
      matched: matched.map(({ bib, name, status, finishTime }) => ({ bib, name, status, finishTime })),
      unknown,
      duplicates,
      missing: missing.map(({ bib, name }) => ({ bib, name })),
      warnings: file.warnings,
    };
    if (parsed.data.dryRun) return { preview };

    await prisma.$transaction(
      async (tx) => {
        const rows = [
          ...matched,
          ...(parsed.data.missingAsDns ? missing.map((m) => ({ ...m, bib: m.bib ?? 0, status: 'DNS' as const, finishTime: null })) : []),
        ];
        for (const m of rows) {
          await tx.result.upsert({
            where: { userId_eventId: { userId: m.userId, eventId } },
            create: { userId: m.userId, eventId, status: m.status, finishTime: m.finishTime, eventDistanceId: m.distanceId },
            update: { status: m.status, finishTime: m.finishTime, eventDistanceId: m.distanceId },
          });
        }
        await recomputePlaces(tx, eventId);
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'result.import',
          eventId,
          subject: `Протокол «${event.title}»`,
          changes: {
            import: [null, `из файла: ${matched.length}${parsed.data.missingAsDns ? `, не стартовали: ${missing.length}` : ''}`],
          },
        });
      },
      { timeout: 60_000 },
    );
    req.log.info({ eventId, matched: matched.length, unknown: unknown.length }, 'Результаты загружены из файла хронометража');
    return { preview, results: await protocolOf(eventId), event: await eventInfo(eventId) };
  });

  /**
   * POST /admin/events/:id/results/publish — опубликовать: результаты видны на
   * сайте и в приложении, участникам — сообщение, пошло окно протестов 48 ч.
   * Повторно — досылает тем, кому ещё не отправляли (например, после правки).
   */
  app.post<{ Params: { id: string } }>('/admin/events/:id/results/publish', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    if ((await prisma.result.count({ where: { eventId } })) === 0) {
      return reply.code(409).send({ error: 'Результатов ещё нет', reason: 'no_results' });
    }
    if (!event.resultsPublishedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: new Date() } });
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'result.publish',
          eventId,
          subject: `Протокол «${event.title}»`,
          changes: { published: [null, 'опубликованы'] },
        });
      });
    }
    // Сообщения — в фоне: участников может быть много.
    const log = req.log;
    setImmediate(() => {
      notifyResults(eventId, log)
        .then((r) => log.info({ eventId, ...r }, 'Результаты разосланы участникам'))
        .catch((err) => log.warn({ eventId, err: String(err) }, 'Сбой рассылки результатов'));
    });
    req.log.info({ eventId }, 'Результаты опубликованы');
    return { event: await eventInfo(eventId) };
  });

  /** POST /admin/events/:id/results/unpublish — снять публикацию (ошибка в протоколе). */
  app.post<{ Params: { id: string } }>('/admin/events/:id/results/unpublish', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: null } });
      await writeAudit(tx, {
        adminTelegramId: req.admin!.telegramId,
        action: 'result.publish',
        eventId,
        subject: `Протокол «${event.title}»`,
        changes: { published: ['опубликованы', 'сняты с публикации'] },
      });
    });
    return { event: await eventInfo(eventId) };
  });
}
