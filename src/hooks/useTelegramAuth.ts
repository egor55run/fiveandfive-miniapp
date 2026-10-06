import { useCallback, useEffect, useState } from 'react';
import {
  authTelegram,
  getMe,
  type MeResult,
  type UserDto,
} from '../lib/api';
import { isInsideTelegram, telegramReady } from '../lib/telegram';

export type AuthState =
  /** Идёт вход. */
  | 'loading'
  /** Пользователь опознан. */
  | 'ready'
  /** Приложение открыто вне Telegram — подписать запрос нечем. */
  | 'outside'
  /** Telegram есть, но вход не удался (сеть, сервер, просроченный initData). */
  | 'error';

/**
 * Вход в Mini App при старте приложения.
 *
 * Никакой формы входа: Telegram сам передаёт подписанный initData, бэкенд
 * проверяет подпись и возвращает пользователя. Профиль (`me`) подтягивается
 * тем же заходом, чтобы форма регистрации могла предзаполниться.
 */
export function useTelegramAuth() {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<UserDto | null>(null);
  const [me, setMe] = useState<MeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    setState('loading');
    setError(null);
    telegramReady();

    // Вне Telegram initData пустой. В dev-сборке всё равно пробуем: локальный
    // бэкенд может пускать по DEV_AUTH_TELEGRAM_ID. В прод-сборке — сразу заглушка.
    if (!isInsideTelegram() && process.env.NODE_ENV === 'production') {
      setState('outside');
      return;
    }

    try {
      const auth = await authTelegram();
      setUser(auth.user);
      // Профиль не критичен для входа: если он не загрузился, пользователь
      // всё равно опознан, просто форма не предзаполнится.
      setMe(await getMe().catch(() => null));
      setState('ready');
    } catch (err) {
      if (!isInsideTelegram()) {
        // Локальный запуск без dev-обхода на бэкенде — это не ошибка,
        // а тот же случай «открыто не в Telegram».
        setState('outside');
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось войти');
      setState('error');
    }
  }, []);

  useEffect(() => {
    // Вход — это ровно та синхронизация с внешней системой, для которой effect и
    // предназначен: SDK Telegram отдаёт initData только в браузере, до рендера
    // его нет. Правило не различает такой случай от каскадных setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    signIn();
  }, [signIn]);

  /** Перечитать профиль — например после регистрации на старт. */
  const refreshMe = useCallback(async () => {
    const profile = await getMe().catch(() => null);
    if (profile) {
      setMe(profile);
      setUser(profile.user);
    }
  }, []);

  return { state, user, me, error, retry: signIn, setUser, refreshMe };
}
