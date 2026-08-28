/**
 * Обёртка над Telegram WebApp SDK (telegram-web-app.js подключён в index.html).
 *
 * Всё через optional chaining: вне Telegram window.Telegram отсутствует, и код
 * не должен от этого падать — вместо него показывается экран «Откройте в Telegram».
 */

export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
};

type TelegramWebApp = {
  /** Подписанная строка для бэкенда. Вне Telegram — пустая. */
  initData: string;
  /**
   * Разобранные данные БЕЗ проверки подписи. Годятся только для предзаполнения
   * полей до ответа сервера; доверять им нельзя — доверенный пользователь
   * приходит из POST /auth/telegram, где подпись проверена.
   */
  initDataUnsafe?: { user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  colorScheme?: 'light' | 'dark';
  platform?: string;
  version?: string;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const BOT_USERNAME = 'fiveandfive_run_bot';
export const BOT_LINK = `https://t.me/${BOT_USERNAME}`;

function webApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** Открыто ли приложение внутри Telegram. Признак — непустой initData. */
export function isInsideTelegram(): boolean {
  return Boolean(webApp()?.initData);
}

export function getInitData(): string {
  return webApp()?.initData ?? '';
}

/** Непроверенный пользователь — только для оптимистичного предзаполнения формы. */
export function getUnsafeTelegramUser(): TelegramWebAppUser | null {
  return webApp()?.initDataUnsafe?.user ?? null;
}

/**
 * Сообщает Telegram, что интерфейс готов (убирает индикатор загрузки),
 * и разворачивает окно на всю высоту.
 */
export function telegramReady(): void {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
}

/** «Фамилия Имя» — в таком порядке ФИО ожидает форма регистрации. */
export function telegramFullName(user: TelegramWebAppUser | null): string {
  if (!user) return '';
  return [user.last_name, user.first_name].filter(Boolean).join(' ');
}
