import { apiPayConfigured } from './apipay';
import { settings } from './settings';
import { isAdminTelegramId } from './telegramLogin';

/**
 * Открыта ли регистрация на старты (и на абонемент).
 *
 * С 2026-11-10 — переключатель «Регистрация открыта» в админке (lib/settings).
 * Но только при подключённой оплате (APIPAY_API_KEY): без неё регистрация
 * создавалась бы бесплатно, и счёт таким участникам потом никто не выставит
 * (решение пользователя 2026-10-08). Админка показывает, если оплата не
 * подключена. Локально без ключа открыть можно: REGISTRATION_OPEN=true в .env
 * и NODE_ENV не production.
 */
export function registrationOpen(): boolean {
  if (!settings().registrationOpen) return false;
  if (apiPayConfigured()) return true;
  return process.env.NODE_ENV !== 'production' && process.env.REGISTRATION_OPEN?.trim().toLowerCase() === 'true';
}

/**
 * Может ли записаться конкретный человек. Администраторы (ADMIN_TELEGRAM_IDS)
 * могут и при закрытой регистрации — чтобы сделать тестовый платёж до
 * открытия (решение пользователя 2026-10-08). Остальные видят «Регистрация
 * скоро откроется».
 */
export function registrationOpenFor(telegramId: number): boolean {
  return registrationOpen() || isAdminTelegramId(telegramId);
}

/** Тот же текст на кнопке в приложении. */
export const REGISTRATION_CLOSED_MESSAGE = 'Регистрация скоро откроется';
