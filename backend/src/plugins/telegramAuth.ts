import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  FAILURE_MESSAGE,
  verifyInitData,
  type TelegramUser,
} from '../lib/telegramAuth';

declare module 'fastify' {
  interface FastifyRequest {
    /** Подтверждённый Telegram-пользователь. Заполняется requireTelegramAuth. */
    tgUser: TelegramUser | null;
  }
}

/** Схема заголовка: `Authorization: tma <initData>` — соглашение Telegram SDK. */
const AUTH_SCHEME = 'tma ';

/**
 * Dev-обход авторизации: работает ТОЛЬКО когда оба условия выполнены —
 * сборка не продовая и явно задан DEV_AUTH_TELEGRAM_ID. В проде
 * NODE_ENV=production (см. backend/.env), поэтому обход недостижим даже
 * при случайно выставленной второй переменной.
 */
function devUser(): TelegramUser | null {
  if (process.env.NODE_ENV === 'production') return null;
  const raw = process.env.DEV_AUTH_TELEGRAM_ID;
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    first_name: process.env.DEV_AUTH_FIRST_NAME ?? 'Dev',
    last_name: process.env.DEV_AUTH_LAST_NAME ?? 'User',
    username: process.env.DEV_AUTH_USERNAME ?? 'dev_user',
  };
}

/**
 * Готовит инстанс к работе с Telegram-авторизацией.
 *
 * Вызывать напрямую на корневом app, а НЕ через app.register(): декораторы,
 * добавленные внутри зарегистрированного плагина, живут в его инкапсуляции и
 * до роутов, зарегистрированных рядом, не доходят.
 */
export function setupTelegramAuth(app: FastifyInstance) {
  const dev = devUser();

  if (!process.env.BOT_TOKEN) {
    // Без токена подпись проверить нельзя. Локально это допустимо, если явно
    // включён dev-обход; в проде — фатально, пускать всех без проверки нельзя.
    if (!dev) {
      throw new Error(
        'BOT_TOKEN не задан. Без него подпись initData проверить нельзя, ' +
          'а пускать всех без проверки — дыра. Добавьте BOT_TOKEN в backend/.env.',
      );
    }
    app.log.warn('BOT_TOKEN не задан — работает только dev-обход, реальный initData будет отвергнут.');
  }

  app.decorateRequest('tgUser', null);

  if (dev) {
    app.log.warn(
      { telegramId: dev.id },
      'DEV_AUTH_TELEGRAM_ID активен: запросы без initData авторизуются как фейковый ' +
        'пользователь. В проде это отключено через NODE_ENV=production.',
    );
  }
}

/**
 * preHandler для защищённых роутов: проверяет подпись initData и кладёт
 * подтверждённого пользователя в req.tgUser. При провале — 401, роут не вызывается.
 */
export async function requireTelegramAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(AUTH_SCHEME)) {
    const dev = devUser();
    if (dev) {
      req.tgUser = dev;
      return;
    }
    return reply.code(401).send({
      error: 'Требуется авторизация Telegram',
      reason: 'no_header',
    });
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    req.log.error('Пришёл initData, но BOT_TOKEN не задан — проверить подпись нечем');
    return reply.code(401).send({
      error: 'Сервер не настроен для проверки Telegram-подписи',
      reason: 'no_bot_token',
    });
  }

  const initData = header.slice(AUTH_SCHEME.length);
  const result = verifyInitData(initData, botToken);

  if (!result.ok) {
    // Логируем причину, но не сам initData — в нём персональные данные.
    req.log.warn({ reason: result.reason }, 'initData не прошёл проверку');
    return reply.code(401).send({
      error: FAILURE_MESSAGE[result.reason],
      reason: result.reason,
    });
  }

  req.tgUser = result.user;
}

/** Сужение типа: внутри защищённого роута tgUser гарантированно есть. */
export function tgUserOf(req: FastifyRequest): TelegramUser {
  if (!req.tgUser) {
    throw new Error('requireTelegramAuth не был подключён к этому роуту');
  }
  return req.tgUser;
}
