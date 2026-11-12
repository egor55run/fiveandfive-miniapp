import type { FastifyInstance } from 'fastify';
import type { ResultStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { deliver, formatFinishTime, resultText } from '../../lib/notify';
import { personLabel, writeAudit } from '../../lib/audit';
import { syncEventPublished } from '../../lib/results';
import { protestUntil, recomputePlaces, resultPoints, placesAfterStage, publishedStages, seasonPlaceLine, type SeasonPlace } from '../../lib/rating';
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
  /** Файл одной дистанции (2026-11-11): номера других дистанций — в отчёт, не в протокол. */
  distanceId: z.number().int().positive().optional(),
});

/** Публикация и снятие — дистанции или всего старта (без distanceId). */
const publishSchema = z.object({ distanceId: z.number().int().positive().optional() }).default({});

/** Окно протестов дистанции; у результата без дистанции — по старту. */
async function distancePublishedAt(eventId: number, distanceId: number | null): Promise<Date | null> {
  if (distanceId === null) return (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).resultsPublishedAt;
  return (await prisma.eventDistance.findUnique({ where: { id: distanceId } }))?.resultsPublishedAt ?? null;
}

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
    eventDistanceId: r.eventDistanceId,
    status: r.status,
    finishTime: r.finishTime,
    place: r.place,
    genderPlace: r.genderPlace,
    points: resultPoints(r, r.user.gender),
    recordedAt: r.recordedAt,
  }));
}

async function eventInfo(eventId: number) {
  const e = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { distances: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } });
  const counts = await prisma.result.groupBy({ by: ['eventDistanceId'], where: { eventId }, _count: { _all: true } });
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    distance: e.distance,
    seriesStage: e.seasonId !== null,
    resultsPublishedAt: e.resultsPublishedAt,
    protestUntil: protestUntil(e.resultsPublishedAt),
    // Публикация и окно протестов — по каждой дистанции (2026-11-11).
    distances: e.distances.map((d) => ({
      id: d.id,
      label: d.label,
      resultsPublishedAt: d.resultsPublishedAt,
      protestUntil: protestUntil(d.resultsPublishedAt),
      results: counts.find((c) => c.eventDistanceId === d.id)?._count._all ?? 0,
    })),
  };
}

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/** Сообщения участникам с результатом — тем, кому ещё не отправляли. */
async function notifyResults(eventId: number, log: Logger, distanceIds?: number[]): Promise<{ sent: number }> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { distances: true } });
  // Только опубликованные дистанции (или переданные).
  const published = event.distances.filter((d) => d.resultsPublishedAt !== null).map((d) => d.id);
  const ids = distanceIds ?? published;
  const results = await prisma.result.findMany({
    where: { eventId, status: 'FINISHED', OR: [{ eventDistanceId: { in: ids } }, ...(event.distances.length === 0 ? [{ eventDistanceId: null }] : [])] },
    include: { user: true },
  });
  const labelOf = new Map(event.distances.map((d) => [d.id, d.label]));
  const multi = event.distances.length > 1;
  const done = new Set(
    (await prisma.notification.findMany({ where: { eventId, kind: 'RESULT', status: 'SENT' }, select: { userId: true } })).map((n) => n.userId),
  );
  // «N из M» — на своей дистанции среди своего пола.
  const keyOf = (r: (typeof results)[number], g: string) => `${r.eventDistanceId ?? 0}:${g}`;
  const finishersByGender = new Map<string, number>();
  for (const r of results) {
    for (const g of [r.user.gender ?? '', '*']) finishersByGender.set(keyOf(r, g), (finishersByGender.get(keyOf(r, g)) ?? 0) + 1);
  }
  // Место в рейтинге сезона до и после этого этапа — строка в сообщении (только этапы серии).
  let after = new Map<number, SeasonPlace>();
  let before = new Map<number, SeasonPlace>();
  let stageNo = 0;
  if (event.seasonId !== null) {
    const stages = await publishedStages(event.seasonId);
    const at = stages.findIndex((s) => s.id === eventId);
    if (at >= 0) {
      stageNo = stages[at].stage;
      after = await placesAfterStage(event.seasonId, eventId);
      if (at > 0) before = await placesAfterStage(event.seasonId, stages[at - 1].id);
    }
  }
  let sent = 0;
  for (const r of results) {
    if (done.has(r.userId) || r.finishTime === null) continue;
    const now = after.get(r.userId);
    const gender = r.user.gender;
    const status = await deliver({
      userId: r.userId,
      telegramId: r.user.telegramId,
      eventId,
      kind: 'RESULT',
      text: resultText(event, {
        finishTime: formatFinishTime(r.finishTime),
        place: (gender ? r.genderPlace : r.place) ?? 0,
        finishersTotal: finishersByGender.get(keyOf(r, gender ?? '*')) ?? 1,
        // Баллы рейтинга — только у этапов серии; у отдельного старта их нет.
        points: gender && event.seasonId !== null ? resultPoints(r, gender) : undefined,
        gender,
        distance: multi && r.eventDistanceId ? labelOf.get(r.eventDistanceId) ?? null : null,
        seasonLine: now ? seasonPlaceLine(stageNo, before.get(r.userId)?.place ?? null, now.place) : null,
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
    // Окно протестов — своей дистанции (публикуются по дистанциям).
    const distPublishedAt = await distancePublishedAt(eventId, registration.distanceId);
    if (protestClosed(distPublishedAt) && !force) return reply.code(409).send(PROTEST_CLOSED);

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
      if (distPublishedAt) {
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
    const resultPublishedAt = await distancePublishedAt(result.eventId, result.eventDistanceId);
    if (protestClosed(resultPublishedAt) && req.query.force !== '1') return reply.code(409).send(PROTEST_CLOSED);
    await prisma.$transaction(async (tx) => {
      await tx.result.delete({ where: { id } });
      await recomputePlaces(tx, result.eventId);
      if (resultPublishedAt) {
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
    const distanceId = parsed.data.distanceId ?? null;
    if (distanceId !== null && !(await prisma.eventDistance.findFirst({ where: { id: distanceId, eventId } }))) {
      return reply.code(400).send({ error: 'Дистанция не найдена', reason: 'no_distance' });
    }
    const importPublishedAt = distanceId !== null ? await distancePublishedAt(eventId, distanceId) : event.resultsPublishedAt;
    if (!parsed.data.dryRun && protestClosed(importPublishedAt) && !parsed.data.force) return reply.code(409).send(PROTEST_CLOSED);

    const file = parseTimingCsv(parsed.data.csv);
    if ('error' in file) return reply.code(400).send({ error: file.error, reason: 'bad_file' });

    // Бегут оплаченные (и добавленные вручную) — по номеру. Файл одной
    // дистанции — только её участники; номера других — в отчёт отдельно.
    const allRegs = await prisma.registration.findMany({
      where: { eventId, paymentStatus: 'PAID' },
      include: { user: true },
    });
    const regs = distanceId === null ? allRegs : allRegs.filter((r) => r.distanceId === distanceId);
    const otherDistanceBibs = new Set(
      distanceId === null ? [] : allRegs.filter((r) => r.distanceId !== distanceId && r.bibNumber !== null).map((r) => r.bibNumber!),
    );
    const otherDistance: number[] = [];
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
        if (otherDistanceBibs.has(row.bib)) otherDistance.push(row.bib);
        else unknown.push(row.bib);
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
      otherDistance,
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
    const body = publishSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Некорректная дистанция' });
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { distances: true } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    // Дистанция или (без distanceId) все дистанции старта — как раньше у этапов.
    const targets = body.data.distanceId ? event.distances.filter((d) => d.id === body.data.distanceId) : event.distances;
    if (body.data.distanceId && targets.length === 0) return reply.code(404).send({ error: 'Дистанция не найдена' });
    const ids = targets.map((d) => d.id);
    const hasResults = await prisma.result.count({ where: { eventId, ...(body.data.distanceId ? { eventDistanceId: body.data.distanceId } : {}) } });
    if (hasResults === 0) return reply.code(409).send({ error: 'Результатов ещё нет', reason: 'no_results' });
    const fresh = targets.filter((d) => d.resultsPublishedAt === null);
    if (fresh.length > 0 || (event.distances.length === 0 && !event.resultsPublishedAt)) {
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.eventDistance.updateMany({ where: { id: { in: fresh.map((d) => d.id) } }, data: { resultsPublishedAt: now } });
        if (event.distances.length === 0) await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: now } });
        else await syncEventPublished(tx, eventId);
        await writeAudit(tx, {
          adminTelegramId: req.admin!.telegramId,
          action: 'result.publish',
          eventId,
          subject: `Протокол «${event.title}»${body.data.distanceId ? `, ${targets[0].label}` : ''}`,
          changes: { published: [null, 'опубликованы'] },
        });
      });
    }
    // Сообщения — в фоне: участников может быть много.
    const log = req.log;
    setImmediate(() => {
      notifyResults(eventId, log, event.distances.length ? ids : undefined)
        .then((r) => log.info({ eventId, ...r }, 'Результаты разосланы участникам'))
        .catch((err) => log.warn({ eventId, err: String(err) }, 'Сбой рассылки результатов'));
    });
    req.log.info({ eventId, distances: ids }, 'Результаты опубликованы');
    return { event: await eventInfo(eventId) };
  });

  /** POST /admin/events/:id/results/unpublish — снять публикацию дистанции или всего старта. */
  app.post<{ Params: { id: string } }>('/admin/events/:id/results/unpublish', async (req, reply) => {
    const eventId = parseId(req.params.id);
    if (eventId === null) return reply.code(400).send({ error: 'Некорректный id' });
    const body = publishSchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Некорректная дистанция' });
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { distances: true } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    const label = body.data.distanceId ? event.distances.find((d) => d.id === body.data.distanceId)?.label : null;
    await prisma.$transaction(async (tx) => {
      await tx.eventDistance.updateMany({
        where: { eventId, ...(body.data.distanceId ? { id: body.data.distanceId } : {}) },
        data: { resultsPublishedAt: null },
      });
      if (event.distances.length === 0) await tx.event.update({ where: { id: eventId }, data: { resultsPublishedAt: null } });
      else await syncEventPublished(tx, eventId);
      await writeAudit(tx, {
        adminTelegramId: req.admin!.telegramId,
        action: 'result.publish',
        eventId,
        subject: `Протокол «${event.title}»${label ? `, ${label}` : ''}`,
        changes: { published: ['опубликованы', 'сняты с публикации'] },
      });
    });
    return { event: await eventInfo(eventId) };
  });
}
