import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { requireAdmin } from '../../plugins/adminAuth';
import {
  MAX_ROUTE_IMAGE_BYTES,
  RouteImageError,
  deleteRouteImage,
  saveRouteImage,
} from '../../lib/routeImages';
import { serializeEvent } from '../events';
import { eventSlug, SLUG_RE, uniqueEventSlug } from '../../lib/slug';
import {
  deleteRegulations,
  RegulationsError,
  saveRegulations,
} from '../../lib/regulations';

const eventFields = {
  title: z.string().trim().min(1).max(200),
  date: z.coerce.date(),
  location: z.string().trim().min(1).max(200),
  distance: z.string().trim().min(1).max(50),
  price: z.number().min(0).max(10_000_000),
  slotsTotal: z.number().int().min(1).max(1_000_000),
  seasonId: z.number().int().positive().nullable(),
  // null — по умолчанию за 7 дней до старта (lib/eligibility).
  registrationClosesAt: z.coerce.date().nullable(),
  // Адрес страницы на сайте: /starty/<slug>. Пусто — сервер составит сам из
  // названия и года (lib/slug).
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .refine((v) => v === '' || SLUG_RE.test(v), 'Только латиница, цифры и дефис')
    .nullable()
    .optional(),
  // Программа дня — по строке на пункт («07:00 — выдача пакетов»).
  program: z.string().trim().max(5000).nullable().optional(),
};

// routeImageUrl в eventFields сознательно нет: карту ставит только загрузка
// файла (POST /admin/events/:id/route-image), которая сама придумывает имя и
// проверяет содержимое. Иначе в колонку можно было бы вписать любую строку —
// и ссылку на чужой сайт, и путь мимо каталога загрузок.
const createSchema = z.object(eventFields);
// Правка частичная: форма присылает только изменённые поля.
const updateSchema = z.object(eventFields).partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Нужно передать хотя бы одно поле' },
);

const CLOSES_AFTER_START = 'Регистрация должна закрываться не позже старта';
const SLUG_TAKEN = { error: 'Такой адрес страницы уже занят другим стартом', reason: 'slug_taken' };

/** Адрес занят чужим стартом? (уникальный индекс в БД — последняя линия.) */
async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
  const other = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  return Boolean(other && other.id !== exceptId);
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function adminEventsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** GET /admin/seasons — для селекта «привязка к сезону» в форме старта. */
  app.get('/admin/seasons', async () => {
    const seasons = await prisma.season.findMany({
      orderBy: [{ year: 'desc' }, { id: 'desc' }],
    });
    return seasons.map((s) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      price: Number(s.price),
      isActive: s.isActive,
    }));
  });

  /** GET /admin/events — список со счётчиками регистраций по статусам. */
  app.get('/admin/events', async () => {
    const events = await prisma.event.findMany({
      orderBy: { date: 'asc' },
      include: { season: { select: { id: true, title: true, year: true } } },
    });

    // Разбивка по статусам одним запросом, чтобы не дёргать БД на каждый старт.
    const grouped = await prisma.registration.groupBy({
      by: ['eventId', 'paymentStatus'],
      _count: { _all: true },
    });
    const byEvent = new Map<number, Record<string, number>>();
    for (const row of grouped) {
      const bucket = byEvent.get(row.eventId) ?? {};
      bucket[row.paymentStatus] = row._count._all;
      byEvent.set(row.eventId, bucket);
    }

    const resultCounts = await prisma.result.groupBy({
      by: ['eventId'],
      _count: { _all: true },
    });
    const resultsByEvent = new Map(
      resultCounts.map((r) => [r.eventId, r._count._all]),
    );

    return events.map((e) => {
      const counts = byEvent.get(e.id) ?? {};
      return {
        ...serializeEvent(e),
        // Как задано в админке; null — «по умолчанию за 7 дней до старта».
        // Итоговая дата — registrationClosesAt из serializeEvent.
        registrationClosesAtCustom: e.registrationClosesAt,
        season: e.season,
        registrations: {
          total: (counts.PENDING ?? 0) + (counts.PAID ?? 0) + (counts.CANCELLED ?? 0),
          pending: counts.PENDING ?? 0,
          paid: counts.PAID ?? 0,
          cancelled: counts.CANCELLED ?? 0,
        },
        resultsCount: resultsByEvent.get(e.id) ?? 0,
      };
    });
  });

  /** POST /admin/events — создать старт. */
  app.post('/admin/events', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Проверьте поля', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    if (data.seasonId !== null) {
      const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
      if (!season) {
        return reply.code(400).send({ error: 'Сезон не найден', reason: 'no_season' });
      }
    }

    if (data.registrationClosesAt && data.registrationClosesAt > data.date) {
      return reply.code(400).send({ error: CLOSES_AFTER_START, reason: 'closes_after_start' });
    }

    if (data.slug && (await slugTaken(data.slug))) return reply.code(409).send(SLUG_TAKEN);
    const slug = data.slug || (await uniqueEventSlug(eventSlug(data.title, data.date)));

    const event = await prisma.event.create({
      data: { ...data, slug, program: data.program || null },
    });
    return reply.code(201).send(serializeEvent(event));
  });

  /** PATCH /admin/events/:id — изменить старт. */
  app.patch<{ Params: { id: string } }>('/admin/events/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Проверьте поля', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });

    // Лимит нельзя опустить ниже уже занятых мест: иначе slotsLeft в приложении
    // станет отрицательным и участники увидят «мест нет» вместе с бронью.
    if (data.slotsTotal !== undefined && data.slotsTotal < event.slotsTaken) {
      return reply.code(409).send({
        error: `Занято уже ${event.slotsTaken} мест — лимит не может быть меньше`,
        reason: 'slots_below_taken',
        slotsTaken: event.slotsTaken,
      });
    }

    if (data.seasonId !== undefined && data.seasonId !== null) {
      const season = await prisma.season.findUnique({ where: { id: data.seasonId } });
      if (!season) {
        return reply.code(400).send({ error: 'Сезон не найден', reason: 'no_season' });
      }
    }

    const closesAt =
      data.registrationClosesAt !== undefined ? data.registrationClosesAt : event.registrationClosesAt;
    if (closesAt && closesAt > (data.date ?? event.date)) {
      return reply.code(400).send({ error: CLOSES_AFTER_START, reason: 'closes_after_start' });
    }

    // Пустой адрес — вернуть составленный из названия и года.
    let slug = data.slug;
    if (slug === '' || slug === null) {
      slug = await uniqueEventSlug(eventSlug(data.title ?? event.title, data.date ?? event.date), id);
    } else if (slug && (await slugTaken(slug, id))) {
      return reply.code(409).send(SLUG_TAKEN);
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        ...data,
        ...(slug !== undefined ? { slug } : {}),
        ...(data.program !== undefined ? { program: data.program || null } : {}),
      },
    });
    return serializeEvent(updated);
  });

  /**
   * POST /admin/events/:id/route-image — загрузить карту трассы.
   *
   * Тело — multipart/form-data с единственным файлом в поле `file`. Файл
   * целиком поднимаем в память (не более MAX_ROUTE_IMAGE_BYTES, лимит стоит на
   * самом плагине multipart): так формат проверяется по содержимому ДО того,
   * как что-то попадёт на диск, и не остаётся недописанных файлов.
   */
  app.post<{ Params: { id: string } }>('/admin/events/:id/route-image', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });

    let data: Awaited<ReturnType<typeof req.file>>;
    try {
      data = await req.file();
    } catch (err) {
      req.log.warn({ err, eventId: id }, 'Не удалось разобрать multipart с картой трассы');
      return reply.code(400).send({
        error: 'Ожидается файл в multipart/form-data',
        reason: 'bad_multipart',
      });
    }
    if (!data) {
      return reply.code(400).send({ error: 'Файл не приложен', reason: 'no_file' });
    }

    const tooLarge = {
      error: `Файл больше ${Math.round(MAX_ROUTE_IMAGE_BYTES / 1024 / 1024)} МБ`,
      reason: 'file_too_large',
    };

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      // Превышение лимита — единственная ожидаемая ошибка чтения, и для неё
      // правильный код 413, а не 500.
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send(tooLarge);
      }
      throw err;
    }

    // Лимит плагина не всегда становится исключением: файл может просто
    // приехать обрезанным по лимиту. Молча сохранять такое нельзя — у
    // усечённого PNG заголовок остаётся правильным, проверка формата его
    // пропустит, и в приложение уйдёт битая картинка.
    if (data.file.truncated) {
      return reply.code(413).send(tooLarge);
    }

    let saved;
    try {
      saved = await saveRouteImage(id, buffer);
    } catch (err) {
      if (err instanceof RouteImageError) {
        return reply.code(400).send({ error: err.message, reason: err.reason });
      }
      throw err;
    }

    // Порядок: сначала новый файл на диске, потом ссылка в БД, и только затем
    // удаление прежнего файла. Обрыв на любом шаге оставляет рабочую картинку —
    // либо старую, либо новую, но не ссылку в пустоту.
    const updated = await prisma.event.update({
      where: { id },
      data: { routeImageUrl: saved.url },
    });
    await deleteRouteImage(event.routeImageUrl);

    req.log.info(
      { eventId: id, url: saved.url, bytes: saved.bytes, kind: saved.kind },
      'Карта трассы загружена',
    );
    return serializeEvent(updated);
  });

  /** DELETE /admin/events/:id/route-image — убрать карту (в приложении вернётся плейсхолдер). */
  app.delete<{ Params: { id: string } }>('/admin/events/:id/route-image', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });

    const updated = await prisma.event.update({
      where: { id },
      data: { routeImageUrl: null },
    });
    await deleteRouteImage(event.routeImageUrl);

    req.log.info({ eventId: id }, 'Карта трассы убрана');
    return serializeEvent(updated);
  });

  /**
   * POST /admin/events/:id/regulations — загрузить Положение (PDF, до 7 МБ).
   * Так же, как карта трассы: сначала новый файл, потом ссылка в БД, потом
   * удаление прежнего файла.
   */
  app.post<{ Params: { id: string } }>('/admin/events/:id/regulations', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });

    let data: Awaited<ReturnType<typeof req.file>>;
    try {
      data = await req.file();
    } catch (err) {
      req.log.warn({ err, eventId: id }, 'Не удалось разобрать multipart с Положением');
      return reply
        .code(400)
        .send({ error: 'Ожидается файл в multipart/form-data', reason: 'bad_multipart' });
    }
    if (!data) return reply.code(400).send({ error: 'Файл не приложен', reason: 'no_file' });

    const tooLarge = { error: 'Файл больше 7 МБ', reason: 'file_too_large' };
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send(tooLarge);
      }
      throw err;
    }
    // Обрезанный по лимиту PDF начинается правильно и прошёл бы проверку формата.
    if (data.file.truncated) return reply.code(413).send(tooLarge);

    let url: string;
    try {
      url = await saveRegulations(id, buffer);
    } catch (err) {
      if (err instanceof RegulationsError) {
        return reply.code(400).send({ error: err.message, reason: err.reason });
      }
      throw err;
    }
    const updated = await prisma.event.update({ where: { id }, data: { regulationsUrl: url } });
    await deleteRegulations(event.regulationsUrl);
    req.log.info({ eventId: id, url, bytes: buffer.length }, 'Положение загружено');
    return serializeEvent(updated);
  });

  /** DELETE /admin/events/:id/regulations — убрать Положение. */
  app.delete<{ Params: { id: string } }>('/admin/events/:id/regulations', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Некорректный id' });
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Старт не найден' });
    const updated = await prisma.event.update({ where: { id }, data: { regulationsUrl: null } });
    await deleteRegulations(event.regulationsUrl);
    req.log.info({ eventId: id }, 'Положение убрано');
    return serializeEvent(updated);
  });

  /**
   * DELETE /admin/events/:id — удалить старт.
   *
   * В схеме у registrations и results onDelete: Cascade, поэтому обычное
   * удаление молча снесло бы регистрации участников и их результаты. Требуем
   * осознанного подтверждения через ?force=1.
   */
  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/admin/events/:id',
    async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Некорректный id' });

      const event = await prisma.event.findUnique({
        where: { id },
        include: { _count: { select: { registrations: true, results: true } } },
      });
      if (!event) return reply.code(404).send({ error: 'Старт не найден' });

      const regs = event._count.registrations;
      const results = event._count.results;
      const force = req.query.force === '1' || req.query.force === 'true';

      if ((regs > 0 || results > 0) && !force) {
        return reply.code(409).send({
          error:
            `На старте ${regs} регистраций и ${results} результатов. ` +
            'Удаление снесёт их вместе со стартом.',
          reason: 'has_registrations',
          registrations: regs,
          results,
        });
      }

      await prisma.event.delete({ where: { id } });
      // Строки в БД больше нет — файл карты иначе остался бы на диске навсегда.
      await deleteRouteImage(event.routeImageUrl);
      req.log.warn(
        { eventId: id, title: event.title, registrations: regs, results },
        'Старт удалён из админки',
      );
      return { ok: true, deleted: { registrations: regs, results } };
    },
  );
}
