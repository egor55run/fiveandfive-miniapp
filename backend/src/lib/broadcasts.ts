import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Broadcast } from '@prisma/client';
import { prisma } from '../prisma';
import { appUrl } from './openingSubscribers';
import { UPLOADS_PREFIX, sniffImageKind, uploadsRoot } from './routeImages';
import { escapeHtml, sendMessage, sendPhoto, type InlineButton, type PhotoSource, type SendOutcome } from './telegramBot';

/**
 * Рассылки из админки (раздел «Рассылки», 2026-10-28).
 *
 * Сообщение — текст с оформлением (HTML Telegram), картинка и кнопка по
 * желанию; внизу всегда «Не присылать новости». Сначала тест админу, потом
 * всем: получатели ложатся в broadcast_deliveries, и очередь рассылает их не
 * быстрее ~22 сообщений в секунду (лимит Telegram — около 30). Очередь в
 * базе: после перезапуска сервера отправка продолжается с того же места.
 *
 * «Не присылать новости» и /stop ставят bot_contacts.stopped_at — такие
 * рассылок не получают, а служебные сообщения (оплата, напоминание о старте)
 * идут как обычно: они stopped_at не смотрят.
 */

export const AUDIENCES = ['ALL', 'EVENT', 'PASS', 'NO_REG'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Пауза между сообщениями: ~22 в секунду, с запасом до лимита Telegram. */
const PACE_MS = 45;
/** Сбой сети или Telegram (не 403) — столько попыток, потом FAILED. */
const MAX_ATTEMPTS = 3;
/** Лимиты Telegram: текст сообщения и подпись к фото. */
export const MAX_TEXT = 4096;
export const MAX_CAPTION = 1024;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const UNSUBSCRIBE_CALLBACK = 'news:stop';
const UNSUBSCRIBE_BUTTON: InlineButton = { text: 'Не присылать новости', callback_data: UNSUBSCRIBE_CALLBACK };

export class BroadcastError extends Error {
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

// ---------- Текст ----------

const SIMPLE_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'blockquote']);
const ALIASES: Record<string, string> = { strong: 'b', em: 'i', ins: 'u', strike: 's', del: 's' };

/**
 * Оставить только теги, которые понимает Telegram (b, i, u, s, code,
 * blockquote, a href), остальное экранировать; незакрытые теги закрыть,
 * лишние закрывающие убрать. Иначе Telegram отклонит сообщение целиком.
 */
export function sanitizeHtml(input: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z]+)((?:\s[^<>]*)?)>/g;
  let last = 0;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    out.push(escapeHtml(input.slice(last, m.index)));
    last = re.lastIndex;
    const closing = m[1] === '/';
    const raw = m[2].toLowerCase();
    const tag = ALIASES[raw] ?? raw;
    if (!SIMPLE_TAGS.has(tag) && tag !== 'a') {
      out.push(escapeHtml(m[0]));
      continue;
    }
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      // Закрываем и всё, что открыто внутри, — вложенность должна быть правильной.
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (tag === 'a') {
      const href = /href\s*=\s*"([^"]*)"/i.exec(m[3])?.[1] ?? /href\s*=\s*'([^']*)'/i.exec(m[3])?.[1];
      if (!href || !/^(https?:\/\/|tg:\/\/)/i.test(href.trim())) continue;
      out.push(`<a href="${escapeHtml(href.trim()).replace(/"/g, '&quot;')}">`);
    } else {
      out.push(`<${tag}>`);
    }
    stack.push(tag);
  }
  out.push(escapeHtml(input.slice(last)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').trim();
}

/** Длина так, как её считает Telegram: без тегов, сущности — одним символом. */
export function visibleLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot);/g, '_').length;
}

// ---------- Картинка ----------

const PHOTO_KINDS = { jpeg: ['jpg', 'image/jpeg'], png: ['png', 'image/png'], webp: ['webp', 'image/webp'] } as const;
const BROADCASTS_SUBDIR = 'broadcasts';

export async function saveBroadcastPhoto(broadcastId: number, data: Buffer): Promise<string> {
  if (data.length === 0) throw new BroadcastError('Файл пустой', 'empty_file');
  if (data.length > MAX_PHOTO_BYTES) throw new BroadcastError('Файл больше 5 МБ', 'file_too_large');
  const kind = sniffImageKind(data);
  if (!kind) throw new BroadcastError('Формат не поддерживается — нужен JPG, PNG или WebP', 'unsupported_format');
  const dir = path.join(uploadsRoot(), BROADCASTS_SUBDIR);
  await mkdir(dir, { recursive: true });
  const name = `broadcast-${broadcastId}-${randomBytes(4).toString('hex')}.${PHOTO_KINDS[kind][0]}`;
  await writeFile(path.join(dir, name), data);
  return `${UPLOADS_PREFIX}/${BROADCASTS_SUBDIR}/${name}`;
}

async function photoSource(b: Broadcast): Promise<PhotoSource | null> {
  if (!b.photoUrl) return null;
  if (b.photoFileId) return { fileId: b.photoFileId };
  const name = path.basename(b.photoUrl);
  const buffer = await readFile(path.join(uploadsRoot(), BROADCASTS_SUBDIR, name));
  const kind = sniffImageKind(buffer) ?? 'jpeg';
  return { buffer, filename: name, mime: PHOTO_KINDS[kind][1] };
}

// ---------- Проверка и отправка одного сообщения ----------

/** Что не так с черновиком (null — можно отправлять). */
export function draftProblem(b: Pick<Broadcast, 'text' | 'photoUrl' | 'buttonKind' | 'buttonText' | 'buttonUrl' | 'audience' | 'eventId'>): string | null {
  const len = visibleLength(b.text);
  if (len === 0) return 'Напишите текст сообщения';
  if (b.photoUrl && len > MAX_CAPTION) return `С картинкой текст — не длиннее ${MAX_CAPTION} символов (сейчас ${len})`;
  if (len > MAX_TEXT) return `Текст — не длиннее ${MAX_TEXT} символов (сейчас ${len})`;
  if (b.buttonKind) {
    if (!b.buttonText?.trim()) return 'Укажите надпись на кнопке';
    if (b.buttonKind === 'url' && !/^https?:\/\/\S+$/i.test(b.buttonUrl ?? '')) return 'Ссылка кнопки должна начинаться с https://';
  }
  if (b.audience === 'EVENT' && !b.eventId) return 'Выберите старт';
  return null;
}

function buttonsOf(b: Broadcast): InlineButton[][] {
  const rows: InlineButton[][] = [];
  if (b.buttonKind === 'url' && b.buttonText && b.buttonUrl) rows.push([{ text: b.buttonText, url: b.buttonUrl }]);
  if (b.buttonKind === 'app' && b.buttonText) rows.push([{ text: b.buttonText, web_app: { url: appUrl() } }]);
  rows.push([UNSUBSCRIBE_BUTTON]);
  return rows;
}

/** Отправить рассылку одному человеку. file_id картинки запоминается после первой загрузки. */
export async function deliver(b: Broadcast, chatId: string): Promise<SendOutcome> {
  const photo = await photoSource(b);
  if (!photo) return sendMessage(chatId, b.text, buttonsOf(b));
  const outcome = await sendPhoto(chatId, photo, b.text, buttonsOf(b));
  if (outcome.ok && outcome.fileId && !('fileId' in photo)) {
    await prisma.broadcast.update({ where: { id: b.id }, data: { photoFileId: outcome.fileId } });
    b.photoFileId = outcome.fileId;
  }
  return outcome;
}

// ---------- Аудитория ----------

/** Кому рассылка не уходит: нажал «Не присылать новости» / /stop или заблокировал бота. */
async function excludedIds(): Promise<Set<string>> {
  const rows = await prisma.botContact.findMany({
    where: { OR: [{ stoppedAt: { not: null } }, { blockedAt: { not: null } }] },
    select: { telegramId: true },
  });
  return new Set(rows.map((r) => r.telegramId.toString()));
}

/** Все, кому бот может написать: писали боту или входили в приложение. */
async function everyone(): Promise<Set<string>> {
  const [contacts, users] = await Promise.all([
    prisma.botContact.findMany({ select: { telegramId: true } }),
    prisma.user.findMany({ where: { telegramId: { not: null } }, select: { telegramId: true } }),
  ]);
  const ids = new Set(contacts.map((c) => c.telegramId.toString()));
  for (const u of users) if (u.telegramId !== null) ids.add(u.telegramId.toString());
  return ids;
}

async function usersWith(where: object): Promise<Set<string>> {
  const users = await prisma.user.findMany({ where: { telegramId: { not: null }, ...where }, select: { telegramId: true } });
  return new Set(users.map((u) => u.telegramId!.toString()));
}

export async function audienceIds(audience: string, eventId: number | null): Promise<string[]> {
  let ids: Set<string>;
  if (audience === 'EVENT') {
    ids = await usersWith({ registrations: { some: { eventId: eventId ?? -1, paymentStatus: 'PAID' } } });
  } else if (audience === 'PASS') {
    ids = await usersWith({ seasonPasses: { some: { paymentStatus: 'PAID' } } });
  } else if (audience === 'NO_REG') {
    const [all, registered] = await Promise.all([
      everyone(),
      usersWith({ registrations: { some: { paymentStatus: 'PAID' } } }),
    ]);
    ids = new Set([...all].filter((id) => !registered.has(id)));
  } else {
    ids = await everyone();
  }
  const excluded = await excludedIds();
  return [...ids].filter((id) => !excluded.has(id));
}

// ---------- Очередь ----------

/** Поставить рассылку в очередь: получатели — по аудитории на этот момент. */
export async function enqueue(b: Broadcast): Promise<number> {
  const ids = await audienceIds(b.audience, b.eventId);
  if (ids.length === 0) throw new BroadcastError('В этой аудитории некому отправить', 'empty_audience');
  await prisma.$transaction(async (tx) => {
    const updated = await tx.broadcast.updateMany({
      where: { id: b.id, status: 'DRAFT' },
      data: { status: 'SENDING', startedAt: new Date() },
    });
    if (updated.count === 0) throw new BroadcastError('Рассылка уже отправлена', 'not_draft');
    await tx.broadcastDelivery.createMany({
      data: ids.map((id) => ({ broadcastId: b.id, telegramId: BigInt(id) })),
      skipDuplicates: true,
    });
  });
  return ids.length;
}

type Logger = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

let busy = false;
let again = false;
let lastSendAt = 0;

/**
 * Разослать всё, что ждёт. kick — сразу после запуска рассылки (только новые
 * получатели); таймер раз в 30 с — ещё и повторы после сбоев, и продолжение
 * после перезапуска сервера. Работает один цикл на процесс.
 */
export async function processQueue(log: Logger, opts: { retries: boolean }): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      await drain(opts.retries);
      await finishDone(log);
    } while (again);
  } catch (err) {
    log.error({ err: String(err) }, 'Рассылки: сбой очереди');
  } finally {
    busy = false;
  }
}

async function drain(retries: boolean): Promise<void> {
  const cache = new Map<number, Broadcast>();
  // Не дошедшие в этом проходе — повторит следующий тик таймера, не сразу.
  const tried: number[] = [];
  for (;;) {
    const batch = await prisma.broadcastDelivery.findMany({
      where: {
        status: 'PENDING',
        broadcast: { status: 'SENDING' },
        ...(retries ? {} : { attempts: 0 }),
        ...(tried.length ? { id: { notIn: tried } } : {}),
      },
      orderBy: [{ attempts: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    if (batch.length === 0) return;
    const excluded = await excludedIds();
    let progressed = false;
    for (const d of batch) {
      let b = cache.get(d.broadcastId);
      if (!b) {
        b = await prisma.broadcast.findUniqueOrThrow({ where: { id: d.broadcastId } });
        cache.set(b.id, b);
      }
      // Остановили — оставшиеся PENDING так и останутся неотправленными.
      const fresh = await prisma.broadcast.findUnique({ where: { id: b.id }, select: { status: true } });
      if (fresh?.status !== 'SENDING') {
        cache.delete(b.id);
        continue;
      }
      // Отписался, пока шла рассылка.
      if (excluded.has(d.telegramId.toString())) {
        await prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED' } });
        progressed = true;
        continue;
      }
      const wait = lastSendAt + PACE_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastSendAt = Date.now();
      const outcome = await deliver(b, d.telegramId.toString());
      progressed = true;
      if (outcome.ok) {
        await prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: 'SENT', sentAt: new Date(), attempts: d.attempts + 1, error: null } });
        continue;
      }
      const error = outcome.error.slice(0, 300);
      if (outcome.blocked || /chat not found|user is deactivated/i.test(outcome.error)) {
        const blocked = /blocked by the user/i.test(outcome.error);
        await prisma.broadcastDelivery.update({
          where: { id: d.id },
          data: { status: blocked ? 'BLOCKED' : 'UNREACHABLE', attempts: d.attempts + 1, error },
        });
        if (blocked) await prisma.botContact.updateMany({ where: { telegramId: d.telegramId }, data: { blockedAt: new Date() } });
        continue;
      }
      const attempts = d.attempts + 1;
      tried.push(d.id);
      await prisma.broadcastDelivery.update({
        where: { id: d.id },
        data: { status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', attempts, error },
      });
    }
    if (!progressed) return;
  }
}

/** Рассылки, где ждать больше некого, — завершить и прислать итог тому, кто запускал. */
async function finishDone(log: Logger): Promise<void> {
  const sending = await prisma.broadcast.findMany({ where: { status: 'SENDING' } });
  for (const b of sending) {
    const pending = await prisma.broadcastDelivery.count({ where: { broadcastId: b.id, status: 'PENDING' } });
    if (pending > 0) continue;
    const done = await prisma.broadcast.updateMany({ where: { id: b.id, status: 'SENDING' }, data: { status: 'DONE', finishedAt: new Date() } });
    if (done.count === 0) continue;
    const s = await deliveryStats(b.id);
    log.info({ broadcastId: b.id, ...s }, 'Рассылка завершена');
    await sendMessage(String(b.createdBy), summaryText(b.id, s)).catch(() => undefined);
  }
}

export type DeliveryStats = {
  total: number;
  pending: number;
  sent: number;
  blocked: number;
  unreachable: number;
  failed: number;
  skipped: number;
};

export async function deliveryStats(broadcastId: number): Promise<DeliveryStats> {
  const grouped = await prisma.broadcastDelivery.groupBy({ by: ['status'], where: { broadcastId }, _count: { _all: true } });
  const by = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return {
    total: grouped.reduce((n, g) => n + g._count._all, 0),
    pending: by('PENDING'),
    sent: by('SENT'),
    blocked: by('BLOCKED'),
    unreachable: by('UNREACHABLE'),
    failed: by('FAILED'),
    skipped: by('SKIPPED'),
  };
}

function summaryText(id: number, s: DeliveryStats): string {
  return [
    `📬 <b>Рассылка №${id} завершена</b>`,
    `Доставлено: ${s.sent} из ${s.total}`,
    `Заблокировали бота: ${s.blocked}`,
    ...(s.unreachable ? [`Не начинали диалог с ботом: ${s.unreachable}`] : []),
    ...(s.skipped ? [`Отписались во время рассылки: ${s.skipped}`] : []),
    ...(s.failed ? [`Не дошло из-за сбоя: ${s.failed}`] : []),
  ].join('\n');
}
