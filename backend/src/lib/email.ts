import nodemailer, { type Transporter } from 'nodemailer';
import type { NotificationKind } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Письма участникам через Yandex Cloud Postbox (SMTP).
 *
 * Решение пользователя 2026-10-18: база остаётся в kz1, в Postbox (регион
 * «Россия») уходят только адрес, имя и текст письма. Пока юрист смотрит —
 * только staging: на проде EMAIL_ENABLED не задан, и модуль ничего не шлёт.
 *
 * Настройки (backend/.env, ключи кладёт scripts/set-postbox-keys.sh, в чат
 * они не попадают):
 *   EMAIL_ENABLED=true
 *   POSTBOX_SMTP_USER=<id API-ключа сервисного аккаунта, scope yc.postbox.send>
 *   POSTBOX_SMTP_PASSWORD=<секрет API-ключа>
 *   EMAIL_FROM="5&5 <noreply@fiveandfive.kz>"   (по умолчанию)
 *   EMAIL_REPLY_TO=info@fiveandfive.kz           (по умолчанию)
 */

const SMTP_HOST = 'postbox.cloud.yandex.net';
const SMTP_PORT = 465; // SMTPS; TLS 1.2+

export const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || '5&5 <noreply@fiveandfive.kz>';
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO?.trim() || 'info@fiveandfive.kz';

export function emailEnabled(): boolean {
  return (
    process.env.EMAIL_ENABLED === 'true' &&
    Boolean(process.env.POSTBOX_SMTP_USER?.trim()) &&
    Boolean(process.env.POSTBOX_SMTP_PASSWORD?.trim())
  );
}

let transporter: Transporter | null = null;
function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user: process.env.POSTBOX_SMTP_USER!.trim(), pass: process.env.POSTBOX_SMTP_PASSWORD!.trim() },
      // Не висеть на сети: письмо — не повод держать запрос участника.
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

export type EmailMessage = { subject: string; html: string; text: string };

/** Отправить одно письмо. Ошибка — строкой, без исключения. */
export async function sendEmail(to: string, msg: EmailMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await transport().sendMail({ from: EMAIL_FROM, replyTo: EMAIL_REPLY_TO, to, ...msg });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/**
 * Письмо участнику по событию — с журналом в email_notifications: одно письмо
 * на (участник, старт, вид); SENT повторно не уходит, FAILED — пробуем снова.
 * Никогда не бросает: письмо не должно ломать регистрацию или оплату.
 */
export async function deliverEmail(input: {
  userId: number;
  eventId: number | null;
  kind: NotificationKind;
  to: string | null;
  message: EmailMessage;
  log?: Logger;
}): Promise<'SENT' | 'FAILED' | 'SKIPPED' | 'ALREADY'> {
  const { userId, eventId, kind, to, message, log } = input;
  try {
    if (!emailEnabled() || !to) return 'SKIPPED';
    const prev = await prisma.emailNotification.findFirst({ where: { userId, eventId, kind } });
    if (prev?.status === 'SENT') return 'ALREADY';
    const outcome = await sendEmail(to, message);
    const data = { to, status: outcome.ok ? 'SENT' : 'FAILED', error: outcome.ok ? null : outcome.error.slice(0, 300) };
    if (prev) await prisma.emailNotification.update({ where: { id: prev.id }, data });
    else await prisma.emailNotification.create({ data: { userId, eventId, kind, ...data } });
    if (outcome.ok) log?.info({ userId, eventId, kind }, 'Письмо отправлено');
    else log?.warn({ userId, eventId, kind, error: outcome.error }, 'Письмо не отправлено');
    return outcome.ok ? 'SENT' : 'FAILED';
  } catch (err) {
    log?.warn({ userId, kind, err: err instanceof Error ? err.message : String(err) }, 'Сбой отправки письма');
    return 'FAILED';
  }
}
