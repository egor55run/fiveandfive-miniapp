import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  clearCookieOptions,
  COOKIE_NAME,
  cookieOptions,
  createSession,
  revokeSession,
} from '../../lib/adminSession';
import { verifyInitData } from '../../lib/telegramAuth';
import {
  isAdminTelegramId,
  LOGIN_FAILURE_MESSAGE,
  verifyLoginWidget,
  type LoginWidgetFields,
} from '../../lib/telegramLogin';
import {
  adminOf,
  clearLoginAttempts,
  loginRateLimited,
  requireAdmin,
} from '../../plugins/adminAuth';

/**
 * Payload Login Widget. Схему держим нежёсткой (запись скаляров) намеренно:
 * подписываются ВСЕ пришедшие поля, и если Telegram однажды добавит новое,
 * strict-схема отбросила бы его и подпись перестала бы сходиться.
 */
const widgetSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    auth_date: z.union([z.number(), z.string()]),
    hash: z.string().min(1),
  })
  .catchall(z.union([z.string(), z.number()]));

type Identity = { telegramId: number; firstName?: string; username?: string };

/** Кто пришёл: либо initData (внутри Telegram), либо payload виджета (браузер). */
function identify(
  req: FastifyRequest,
  botToken: string,
): { ok: true; via: 'initData' | 'widget'; identity: Identity } | { ok: false; code: number; body: object } {
  const header = req.headers.authorization;

  // Путь 1: /admin открыта внутри Telegram — переиспользуем уже проверенный
  // механизм Mini App, ничего дублировать не нужно.
  if (header?.startsWith('tma ')) {
    const result = verifyInitData(header.slice(4), botToken);
    if (!result.ok) {
      return {
        ok: false,
        code: 401,
        body: { error: 'Подпись initData не совпадает', reason: result.reason },
      };
    }
    return {
      ok: true,
      via: 'initData',
      identity: {
        telegramId: result.user.id,
        firstName: result.user.first_name,
        username: result.user.username,
      },
    };
  }

  // Путь 2: обычный браузер, данные от Login Widget. Другая схема подписи.
  const parsed = widgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return {
      ok: false,
      code: 400,
      body: { error: 'Ожидаются данные Telegram Login Widget', reason: 'bad_payload' },
    };
  }

  const result = verifyLoginWidget(parsed.data as LoginWidgetFields, botToken);
  if (!result.ok) {
    return {
      ok: false,
      code: 401,
      body: { error: LOGIN_FAILURE_MESSAGE[result.reason], reason: result.reason },
    };
  }

  return {
    ok: true,
    via: 'widget',
    identity: {
      telegramId: result.user.id,
      firstName: result.user.first_name,
      username: result.user.username,
    },
  };
}

export async function adminSessionRoutes(app: FastifyInstance) {
  /**
   * POST /admin/session — вход. Telegram подтверждает личность один раз, дальше
   * работает наша cookie-сессия.
   */
  app.post('/admin/session', async (req, reply) => {
    if (loginRateLimited(req.ip)) {
      req.log.warn({ ip: req.ip }, 'Слишком много попыток входа в админку');
      return reply
        .code(429)
        .send({ error: 'Слишком много попыток. Подождите пару минут', reason: 'rate_limited' });
    }

    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      req.log.error('BOT_TOKEN не задан — проверить подпись Telegram нечем');
      return reply
        .code(503)
        .send({ error: 'Сервер не настроен', reason: 'no_bot_token' });
    }

    const who = identify(req, botToken);
    if (!who.ok) return reply.code(who.code).send(who.body);

    // Подпись верна — но это ещё не значит, что перед нами администратор.
    if (!isAdminTelegramId(who.identity.telegramId)) {
      req.log.warn(
        { telegramId: who.identity.telegramId, via: who.via },
        'Отказано во входе в админку: id не в списке',
      );
      return reply
        .code(403)
        .send({ error: 'Этот Telegram-аккаунт не администратор', reason: 'not_admin' });
    }

    const { token, expiresAt } = await createSession(
      who.identity.telegramId,
      req.ip,
      req.headers['user-agent'],
    );
    clearLoginAttempts(req.ip);
    req.log.info(
      { telegramId: who.identity.telegramId, via: who.via },
      'Вход в админку',
    );

    return reply
      .setCookie(COOKIE_NAME, token, cookieOptions(expiresAt))
      .send({
        admin: {
          telegramId: String(who.identity.telegramId),
          firstName: who.identity.firstName ?? null,
          username: who.identity.username ?? null,
        },
        via: who.via,
        expiresAt,
      });
  });

  /** DELETE /admin/session — выход. Сессия удаляется из БД, cookie снимается. */
  app.delete('/admin/session', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) await revokeSession(token);
    return reply
      .clearCookie(COOKIE_NAME, clearCookieOptions())
      .send({ ok: true });
  });

  /** GET /admin/me — SPA спрашивает при загрузке, авторизована ли она. */
  app.get('/admin/me', { preHandler: requireAdmin }, async (req) => {
    const admin = adminOf(req);
    return { admin: { telegramId: String(admin.telegramId) } };
  });
}
