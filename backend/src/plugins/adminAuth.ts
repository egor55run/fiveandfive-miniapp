import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  COOKIE_NAME,
  findValidSession,
  touchSession,
} from '../lib/adminSession';
import { adminTelegramIds } from '../lib/telegramLogin';

declare module 'fastify' {
  interface FastifyRequest {
    /** Администратор текущей сессии. Заполняет requireAdmin. */
    admin: { telegramId: number; sessionId: number } | null;
  }
}

/**
 * Готовит инстанс к работе с админскими сессиями. Вызывать напрямую на
 * корневом app, а не через app.register(): декораторы из зарегистрированного
 * плагина не видны роутам, зарегистрированным рядом (тот же приём, что в
 * plugins/telegramAuth.ts).
 */
export function setupAdminAuth(app: FastifyInstance) {
  app.decorateRequest('admin', null);

  const ids = adminTelegramIds();
  if (ids.size === 0) {
    // Не падаем: остальное приложение (Mini App участников) работать должно.
    // Но вход в админку при этом закрыт для всех — fail-closed.
    app.log.warn(
      'ADMIN_TELEGRAM_IDS пуст — вход в /admin закрыт для всех. ' +
        'Укажите telegram_id администратора в backend/.env.',
    );
  } else {
    app.log.info({ adminCount: ids.size }, 'Админский доступ настроен');
  }
}

/**
 * preHandler для всех /admin/* кроме создания сессии: проверяет cookie.
 * Данные Telegram здесь уже не участвуют — только наша сессия.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return reply.code(401).send({ error: 'Требуется вход', reason: 'no_cookie' });
  }

  const session = await findValidSession(token);
  if (!session) {
    return reply
      .code(401)
      .send({ error: 'Сессия истекла — войдите заново', reason: 'no_session' });
  }

  const telegramId = Number(session.telegramId);

  // Права проверяем на каждом запросе, а не только при входе: если id убрали
  // из ADMIN_TELEGRAM_IDS, выданная ранее сессия должна перестать работать.
  if (!adminTelegramIds().has(telegramId)) {
    req.log.warn({ telegramId }, 'Сессия есть, но id больше не в списке админов');
    return reply.code(403).send({ error: 'Доступ запрещён', reason: 'not_admin' });
  }

  await touchSession(session);
  req.admin = { telegramId, sessionId: session.id };
}

export function adminOf(req: FastifyRequest): { telegramId: number; sessionId: number } {
  if (!req.admin) throw new Error('requireAdmin не подключён к этому роуту');
  return req.admin;
}

/**
 * Ограничитель попыток входа. Пароля нет, брутфорсить нечего, но перебирать
 * подписи в надежде на ошибку в проверке тоже не должно быть дёшево.
 *
 * Хранение в памяти процесса осознанно: бэкенд один (pm2, fork mode), а тащить
 * зависимость ради одного роута незачем. Перезапуск сбрасывает счётчики.
 */
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const ATTEMPT_LIMIT = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);

  if (!rec || rec.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    // Подчищаем протухшие записи, чтобы Map не рос без предела.
    if (attempts.size > 1000) {
      for (const [key, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(key);
      }
    }
    return false;
  }

  rec.count += 1;
  return rec.count > ATTEMPT_LIMIT;
}

/** Успешный вход обнуляет счётчик — чтобы себя же не заблокировать. */
export function clearLoginAttempts(ip: string): void {
  attempts.delete(ip);
}
