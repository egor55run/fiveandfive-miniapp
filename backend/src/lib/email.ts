import type { NotificationKind } from '@prisma/client';
import { prisma } from '../prisma';
import { escapeHtml, sendMessage } from './telegramBot';
import { adminTelegramIds } from './telegramLogin';

/**
 * Письма участникам через Brevo (Франция, серверы в ЕС) — HTTP API.
 *
 * Решение пользователя 2026-10-19 (вместо Yandex Postbox): в Brevo уходят
 * только адрес, имя и текст письма; база остаётся в kz1. Пока юрист смотрит
 * политику — только staging: на проде EMAIL_ENABLED не задан, модуль молчит.
 *
 * Почему API, а не SMTP: ответ сразу говорит, принято ли письмо, кончился ли
 * лимит или ключ неверный; нет долгих соединений и сторонних библиотек.
 *
 * Лимит бесплатного тарифа — 300 писем в день. Когда Brevo обнуляет счётчик,
 * в документации не сказано, поэтому считаем сами: если за последние 24 часа
 * отправлено EMAIL_DAILY_LIMIT писем (по умолчанию 290 — с запасом), новые
 * встают в очередь (QUEUED) и уходят, когда окно освободится
 * (processEmailQueue, раз в 10 минут из server.ts). Ответ Brevo «лимит
 * исчерпан» — тоже в очередь. Сообщения в Telegram от этого не зависят.
 *
 * Настройки (backend/.env; ключ кладёт scripts/set-email-key.sh, в чат он не
 * попадает):
 *   EMAIL_ENABLED=true
 *   BREVO_API_KEY=<ключ API v3>
 *   EMAIL_FROM_NAME=5&5                     (по умолчанию)
 *   EMAIL_FROM=noreply@fiveandfive.kz       (по умолчанию)
 *   EMAIL_REPLY_TO=egorkadirov1@gmail.com   (по умолчанию; ящика info@ нет —
 *                                           вопросы идут в бота, решение 2026-10-19)
 *   EMAIL_DAILY_LIMIT=290                   (по умолчанию)
 */

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || 'noreply@fiveandfive.kz';
export const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME?.trim() || '5&5';
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO?.trim() || 'egorkadirov1@gmail.com';
const DAILY_LIMIT = Number(process.env.EMAIL_DAILY_LIMIT) || 290;
const DAY_MS = 86_400_000;
/** Сколько раз пробуем письмо, которое Brevo отклоняет не из-за лимита. */
const MAX_ATTEMPTS = 3;

export function emailEnabled(): boolean {
  return process.env.EMAIL_ENABLED === 'true' && Boolean(process.env.BREVO_API_KEY?.trim());
}

export type EmailMessage = { subject: string; html: string; text: string };

export type SendResult =
  | { ok: true }
  | { ok: false; error: string; /** лимит/частота — подождать и повторить */ retryLater: boolean };

/** Отправить одно письмо через Brevo. Ошибка — значением, без исключения. */
export async function sendEmail(to: string, msg: EmailMessage, toName?: string | null): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY!.trim(),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        replyTo: { email: EMAIL_REPLY_TO },
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Сеть или таймаут — повторим позже, это не вина письма.
    return { ok: false, error: err instanceof Error ? err.message : 'Сеть недоступна', retryLater: true };
  }
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  const error = `HTTP ${res.status}${body?.code ? ` ${body.code}` : ''}: ${body?.message ?? ''}`.trim();
  // 401/403 — ключ отозван, неверен или IP сервера не в Authorised IPs.
  // Письмо не виновато: держим в очереди и сразу пишем владельцу.
  const keyProblem = res.status === 401 || res.status === 403;
  if (keyProblem) void alertKeyProblem(error);
  // 429 — частота; 402 и «credits/limit/quota» в тексте — кончился дневной
  // лимит тарифа; 5xx — сбой у Brevo. Всё это — подождать, а не бросить.
  const limitWords = /credit|limit|quota/i.test(`${body?.code ?? ''} ${body?.message ?? ''}`);
  const retryLater = keyProblem || res.status === 429 || res.status === 402 || res.status >= 500 || limitWords;
  return { ok: false, error, retryLater };
}

/**
 * Brevo отказал из-за ключа — сообщение админам в Telegram (просьба
 * пользователя 2026-10-19). Не чаще раза в час, чтобы очередь, которая
 * пробует каждые 10 минут, не засыпала сообщениями.
 */
const KEY_ALERT_EVERY_MS = 60 * 60_000;
let lastKeyAlert = 0;
async function alertKeyProblem(error: string): Promise<void> {
  if (Date.now() - lastKeyAlert < KEY_ALERT_EVERY_MS) return;
  lastKeyAlert = Date.now();
  const text =
    `⛔ Brevo не принимает письма: ${escapeHtml(error.slice(0, 200))}.\n` +
    'Похоже, ключ API отозван или неверен, либо IP сервера убран из Authorised IPs. ' +
    'Письма ждут в очереди и уйдут, когда ключ заработает. Новый ключ — scripts/set-email-key.sh prod.';
  for (const id of adminTelegramIds()) await sendMessage(String(id), text).catch(() => undefined);
}

/** Сколько писем ушло за последние 24 часа — наш счётчик лимита Brevo. */
async function sentLastDay(): Promise<number> {
  return prisma.emailNotification.count({
    where: { status: 'SENT', sentAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
}

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/**
 * Письмо участнику по событию — с журналом в email_notifications: одно письмо
 * на (участник, старт, вид); SENT повторно не уходит. Лимит исчерпан — письмо
 * в очередь. Никогда не бросает: письмо не должно ломать регистрацию, оплату
 * или Telegram.
 */
export async function deliverEmail(input: {
  userId: number;
  eventId: number | null;
  kind: NotificationKind;
  to: string | null;
  toName?: string | null;
  message: EmailMessage;
  log?: Logger;
}): Promise<'SENT' | 'QUEUED' | 'FAILED' | 'SKIPPED' | 'ALREADY'> {
  const { userId, eventId, kind, to, message, log } = input;
  try {
    if (!emailEnabled() || !to) return 'SKIPPED';
    const prev = await prisma.emailNotification.findFirst({ where: { userId, eventId, kind } });
    if (prev?.status === 'SENT') return 'ALREADY';
    if (prev?.status === 'QUEUED') return 'QUEUED';

    const content = { subject: message.subject, html: message.html, text: message.text };
    const save = async (status: 'SENT' | 'QUEUED' | 'FAILED', error: string | null) => {
      const data = {
        to,
        status,
        error: error?.slice(0, 300) ?? null,
        attempts: (prev?.attempts ?? 0) + (status === 'QUEUED' && !error ? 0 : 1),
        sentAt: status === 'SENT' ? new Date() : null,
        // Текст храним, только пока письмо ждёт в очереди.
        ...(status === 'QUEUED' ? content : { subject: null, html: null, text: null }),
      };
      if (prev) await prisma.emailNotification.update({ where: { id: prev.id }, data });
      else await prisma.emailNotification.create({ data: { userId, eventId, kind, ...data } });
    };

    if ((await sentLastDay()) >= DAILY_LIMIT) {
      await save('QUEUED', null);
      log?.info({ userId, eventId, kind }, 'Письмо в очереди: дневной лимит');
      return 'QUEUED';
    }
    const outcome = await sendEmail(to, message, input.toName);
    if (outcome.ok) {
      await save('SENT', null);
      log?.info({ userId, eventId, kind }, 'Письмо отправлено');
      return 'SENT';
    }
    const status = outcome.retryLater ? 'QUEUED' : 'FAILED';
    await save(status, outcome.error);
    log?.warn({ userId, eventId, kind, error: outcome.error }, status === 'QUEUED' ? 'Письмо в очереди' : 'Письмо не отправлено');
    return status;
  } catch (err) {
    log?.warn({ userId, kind, err: err instanceof Error ? err.message : String(err) }, 'Сбой отправки письма');
    return 'FAILED';
  }
}

/**
 * Разобрать очередь: письма QUEUED по порядку, пока не упрёмся в лимит.
 * Вызывается раз в 10 минут из server.ts; повторный запуск безопасен.
 */
export async function processEmailQueue(log?: Logger): Promise<{ sent: number; left: number }> {
  if (!emailEnabled()) return { sent: 0, left: 0 };
  let sent = 0;
  const queue = await prisma.emailNotification.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const item of queue) {
    if ((await sentLastDay()) >= DAILY_LIMIT) break;
    if (!item.subject || !item.html || !item.text) {
      await prisma.emailNotification.update({ where: { id: item.id }, data: { status: 'FAILED', error: 'Нет текста письма' } });
      continue;
    }
    const outcome = await sendEmail(item.to, { subject: item.subject, html: item.html, text: item.text });
    if (outcome.ok) {
      sent++;
      await prisma.emailNotification.update({
        where: { id: item.id },
        data: { status: 'SENT', sentAt: new Date(), error: null, attempts: item.attempts + 1, subject: null, html: null, text: null },
      });
      continue;
    }
    const attempts = item.attempts + 1;
    // Лимит/сеть — ждём следующего прогона; ошибка письма — не больше MAX_ATTEMPTS.
    const giveUp = !outcome.retryLater && attempts >= MAX_ATTEMPTS;
    await prisma.emailNotification.update({
      where: { id: item.id },
      data: {
        attempts,
        error: outcome.error.slice(0, 300),
        ...(giveUp ? { status: 'FAILED', subject: null, html: null, text: null } : {}),
      },
    });
    if (outcome.retryLater) break; // Brevo просит подождать — не долбим.
  }
  const left = await prisma.emailNotification.count({ where: { status: 'QUEUED' } });
  if (sent > 0 || left > 0) log?.info({ sent, left }, 'Очередь писем');
  return { sent, left };
}
