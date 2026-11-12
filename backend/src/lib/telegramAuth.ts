import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подлинности Telegram Mini App initData.
 *
 * Telegram передаёт данные о пользователе строкой query-параметров, подписанной
 * HMAC-SHA256 на производном от токена бота ключе. Проверив подпись, бэкенд может
 * доверять полю `user` — подделать его, не зная токена, нельзя.
 *
 * Зависимостей нет намеренно: только node:crypto, чтобы код, отвечающий за
 * авторизацию, не тянул за собой сторонние пакеты.
 */

/** Поле `user` внутри initData. Приходит JSON-строкой. */
export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
};

export type InitDataFailure =
  | 'empty'
  | 'no_hash'
  | 'bad_hash'
  | 'no_auth_date'
  | 'stale'
  | 'no_user';

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: Date }
  | { ok: false; reason: InitDataFailure };

/**
 * Окно свежести initData. Широкое намеренно: Telegram пересоздаёт initData
 * только при переоткрытии Mini App, а не по таймеру. На коротком окне сессия
 * рвалась бы у пользователя, который просто держит приложение открытым.
 */
export const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60;

export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): InitDataResult {
  if (!initData) return { ok: false, reason: 'empty' };

  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };

  // Из строки для подписи исключается ТОЛЬКО hash. Поле `signature`
  // (Ed25519, для сторонней валидации) остаётся на месте — выкинув его,
  // получим несходящийся HMAC. Это самая частая ошибка в самописных проверках.
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Порядок аргументов важен и неинтуитивен: ключом идёт литерал "WebAppData",
  // а сообщением — токен бота. (В Telegram Login Widget схема другая: SHA256 от
  // токена; перепутать их — значит всегда получать bad_hash.)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();

  // Buffer.from(..., 'hex') на мусорном вводе не бросает, а молча обрезает,
  // поэтому расхождение длин ловим явно: timingSafeEqual на разных длинах бросает.
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDateRaw = params.get('auth_date');
  const authDateSec = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authDateSec)) {
    return { ok: false, reason: 'no_auth_date' };
  }
  if (Math.floor(Date.now() / 1000) - authDateSec > maxAgeSec) {
    return { ok: false, reason: 'stale' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'no_user' };

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    return { ok: false, reason: 'no_user' };
  }
  if (typeof user?.id !== 'number' || typeof user.first_name !== 'string') {
    return { ok: false, reason: 'no_user' };
  }

  return { ok: true, user, authDate: new Date(authDateSec * 1000) };
}

/** Человекочитаемая причина отказа — для тела 401. */
export const FAILURE_MESSAGE: Record<InitDataFailure, string> = {
  empty: 'initData отсутствует',
  no_hash: 'initData без подписи',
  bad_hash: 'Подпись initData не совпадает',
  no_auth_date: 'initData без auth_date',
  stale: 'initData просрочен — переоткройте приложение',
  no_user: 'initData без данных пользователя',
};
