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
  initDataUnsafe?: { user?: TelegramWebAppUser; start_param?: string };
  ready: () => void;
  /** Открыть ссылку во встроенном браузере Telegram поверх Mini App. */
  openLink?: (url: string) => void;
  /** Попросить у пользователя разрешение боту писать ему (Bot API 6.9+). */
  requestWriteAccess?: (callback?: (granted: boolean) => void) => void;
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

// Бот, которому принадлежит этот экземпляр: на staging — тестовый. Должен
// совпадать с BOT_TOKEN бэкенда, иначе вход через виджет в админке не пройдёт
// проверку подписи. Вшивается при сборке (NEXT_PUBLIC_*).
export const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'fiveandfive_run_bot';
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

/**
 * Открыть страницу сайта (оферту, политику) так, чтобы не потерять Mini App:
 * внутри Telegram — встроенным браузером поверх приложения (форма с уже
 * введёнными данными остаётся), вне Telegram — новой вкладкой.
 * true — ссылку открыли сами, обычный переход по <a> не нужен.
 */
export function openExternalPage(path: string): boolean {
  const app = webApp();
  if (!app?.openLink || !isInsideTelegram()) return false;
  app.openLink(new URL(path, window.location.origin).toString());
  return true;
}

/**
 * Какой старт открыть сразу при запуске Mini App — его адрес (slug) или null.
 *  - ссылка с сайта t.me/<бот>?startapp=race-<slug> → start_param «race-<slug>»;
 *  - кнопка «Открыть приложение» под сообщением бота → /app?race=<slug>.
 */
export function requestedRaceSlug(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('race');
  if (fromQuery) return fromQuery;
  const start =
    webApp()?.initDataUnsafe?.start_param ??
    new URLSearchParams(window.location.search).get('tgWebAppStartParam');
  return start?.startsWith('race-') ? start.slice('race-'.length) : null;
}

/**
 * Разрешение боту писать пользователю. Telegram сам решает, спрашивать ли:
 * если диалог с ботом уже есть, ответ «да» приходит сразу. В старых клиентах
 * без этого метода считаем, что можно, — Mini App там открывают из чата с ботом.
 */
export function askWriteAccess(): Promise<boolean> {
  const app = webApp();
  if (!app?.requestWriteAccess) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      app.requestWriteAccess!((granted) => resolve(Boolean(granted)));
    } catch {
      resolve(true);
    }
  });
}
