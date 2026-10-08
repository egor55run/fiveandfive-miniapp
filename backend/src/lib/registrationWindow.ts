import { apiPayConfigured } from './apipay';

/**
 * Открыта ли регистрация на старты (и на абонемент).
 *
 * По умолчанию — только когда настроена оплата (APIPAY_API_KEY): без неё
 * регистрация создавалась бы бесплатно, и счёт таким участникам потом никто
 * не выставит. Решение пользователя 2026-10-08: на проде регистрацию не
 * открываем, пока не включена оплата.
 *
 * REGISTRATION_OPEN=true|false в .env перекрывает правило вручную — например,
 * закрыть регистрацию при включённой оплате или открыть её локально без ключа.
 * Читается на каждом запросе: правка .env + перезапуск, без выкладки кода.
 */
export function registrationOpen(): boolean {
  const flag = process.env.REGISTRATION_OPEN?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return apiPayConfigured();
}

/** Тот же текст на кнопке в приложении. */
export const REGISTRATION_CLOSED_MESSAGE = 'Регистрация скоро откроется';
