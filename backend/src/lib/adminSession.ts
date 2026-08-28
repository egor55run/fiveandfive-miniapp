import { createHash, randomBytes } from 'node:crypto';
import type { AdminSession } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Сессии администратора.
 *
 * Telegram (Login Widget или initData) отвечает только на вопрос «кто вы», и
 * только один раз. Дальше живёт эта сессия: непрозрачный случайный токен в
 * httpOnly-cookie, а в БД — лишь его sha256. Поэтому дамп базы войти не
 * позволяет, а сессию, в отличие от JWT, можно отозвать.
 */

export const COOKIE_NAME = 'admin_session';

/** Абсолютный срок жизни: после этого нужен повторный вход через Telegram. */
const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Простой: если сессией не пользовались столько времени, она мертва. */
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type IssuedSession = {
  /** Сам токен — уходит в cookie и больше нигде не сохраняется. */
  token: string;
  expiresAt: Date;
};

export async function createSession(
  telegramId: number,
  ip?: string,
  userAgent?: string,
): Promise<IssuedSession> {
  // 32 байта -> 43 символа base64url. Безопасно для значения cookie.
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MS);

  await prisma.adminSession.create({
    data: {
      tokenHash: hashToken(token),
      telegramId: BigInt(telegramId),
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent?.slice(0, 500) ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Находит живую сессию по токену. Просроченные и залежавшиеся удаляет сразу,
 * чтобы таблица не накапливала мусор и повторная попытка не проходила.
 */
export async function findValidSession(
  token: string,
): Promise<AdminSession | null> {
  if (!token) return null;

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session) return null;

  const now = Date.now();
  const expired = session.expiresAt.getTime() <= now;
  const idle = now - session.lastSeenAt.getTime() > IDLE_TTL_MS;

  if (expired || idle) {
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session;
}

/** Отметить активность. Раз в минуту, чтобы не писать в БД на каждый запрос. */
export async function touchSession(session: AdminSession): Promise<void> {
  if (Date.now() - session.lastSeenAt.getTime() < 60_000) return;
  await prisma.adminSession
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await prisma.adminSession
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}

/** Убить все сессии — на случай «вошёл где-то и не помню где». */
export async function revokeAllSessions(): Promise<number> {
  const { count } = await prisma.adminSession.deleteMany({});
  return count;
}

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * Path и Secure зависят от среды.
 *
 * В проде браузер обращается к /api/admin/... (nginx срезает /api уже после,
 * при проксировании), поэтому Path сужен до /api/admin — со статикой и с
 * запросами участников cookie не уходит вообще.
 *
 * Локально Vite бьёт в http://localhost:3000/admin/... напрямую: там нет ни
 * префикса /api, ни HTTPS, так что Path=/ и Secure=false, иначе cookie просто
 * не будет отправляться и админку нельзя будет отладить.
 */
export function cookiePath(): string {
  return isProd() ? '/api/admin' : '/';
}

export function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true, // JS до токена не достаёт
    secure: isProd(), // только по HTTPS в проде
    sameSite: 'strict' as const, // основная защита от CSRF
    path: cookiePath(),
    expires: expiresAt,
  };
}

/** Те же атрибуты без expires — для удаления cookie при выходе. */
export function clearCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict' as const,
    path: cookiePath(),
  };
}
