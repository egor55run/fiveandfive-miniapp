import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подлинности данных Telegram Login Widget.
 *
 * ЭТО НЕ ТО ЖЕ, ЧТО initData Mini App (см. lib/telegramAuth.ts). Отличий два, и
 * оба ломают подпись, если их перепутать:
 *
 *   initData:      secret = HMAC_SHA256(key: "WebAppData", msg: bot_token)
 *   Login Widget:  secret = SHA256(bot_token)
 *
 * И формат: у initData пользователь лежит внутри поля user как JSON, а виджет
 * отдаёт плоские поля id / first_name / last_name / username / photo_url /
 * auth_date / hash.
 *
 * Виджет выдаёт эти данные однократно, в момент нажатия кнопки, поэтому окно
 * свежести здесь короткое — они сразу же обмениваются на нашу сессию.
 */

/** Плоский payload от виджета. Значения приходят строками или числами. */
export type LoginWidgetFields = Record<string, string | number>;

export type LoginWidgetUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

export type LoginFailure =
  | 'empty'
  | 'no_hash'
  | 'bad_hash'
  | 'no_auth_date'
  | 'stale'
  | 'no_id';

export type LoginResult =
  | { ok: true; user: LoginWidgetUser; authDate: Date }
  | { ok: false; reason: LoginFailure };

/**
 * Пять минут. У initData окно 24 часа, потому что Telegram обновляет его только
 * при переоткрытии приложения. Здесь наоборот: payload создаётся в момент
 * нажатия и тут же меняется на сессию, поэтому долгое окно только расширяет
 * возможность переиспользовать перехваченный payload.
 */
export const LOGIN_MAX_AGE_SEC = 5 * 60;

export function verifyLoginWidget(
  fields: LoginWidgetFields,
  botToken: string,
  maxAgeSec: number = LOGIN_MAX_AGE_SEC,
): LoginResult {
  if (!fields || typeof fields !== 'object') return { ok: false, reason: 'empty' };

  const hash = fields.hash;
  if (typeof hash !== 'string' || hash.length === 0) {
    return { ok: false, reason: 'no_hash' };
  }

  // Подписываются ВСЕ полученные поля кроме hash. Отсутствующие поля (например
  // last_name у аккаунта без фамилии) в строку не попадают — добавить их
  // пустыми значит не сойтись с подписью Telegram.
  const dataCheckString = Object.keys(fields)
    .filter((k) => k !== 'hash' && fields[k] !== undefined && fields[k] !== null)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((k) => `${k}=${String(fields[k])}`)
    .join('\n');

  // Вот здесь ключевое расхождение с initData: секрет — простой SHA256 токена,
  // без HMAC и без литерала "WebAppData".
  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();

  // Buffer.from(..., 'hex') на мусоре не бросает, а молча обрезает, поэтому
  // расхождение длин ловим явно: timingSafeEqual на разных длинах бросает.
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDateSec = Number(fields.auth_date);
  if (fields.auth_date === undefined || !Number.isFinite(authDateSec)) {
    return { ok: false, reason: 'no_auth_date' };
  }
  if (Math.floor(Date.now() / 1000) - authDateSec > maxAgeSec) {
    return { ok: false, reason: 'stale' };
  }

  const id = Number(fields.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'no_id' };

  const str = (v: string | number | undefined) =>
    v === undefined ? undefined : String(v);

  return {
    ok: true,
    user: {
      id,
      first_name: str(fields.first_name),
      last_name: str(fields.last_name),
      username: str(fields.username),
      photo_url: str(fields.photo_url),
    },
    authDate: new Date(authDateSec * 1000),
  };
}

export const LOGIN_FAILURE_MESSAGE: Record<LoginFailure, string> = {
  empty: 'Пустые данные авторизации',
  no_hash: 'Данные без подписи',
  bad_hash: 'Подпись Telegram не совпадает',
  no_auth_date: 'Данные без auth_date',
  stale: 'Данные авторизации просрочены — войдите заново',
  no_id: 'Данные без telegram id',
};

/**
 * Кому разрешён вход. Читается из ADMIN_TELEGRAM_IDS при каждом обращении,
 * чтобы правка .env + рестарт применялись без правок кода.
 *
 * Fail-closed: пустая или незаданная переменная означает «никому», а не «всем».
 */
export function adminTelegramIds(): Set<number> {
  const raw = process.env.ADMIN_TELEGRAM_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

export function isAdminTelegramId(id: number): boolean {
  return adminTelegramIds().has(id);
}
