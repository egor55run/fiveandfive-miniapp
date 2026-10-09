import type { EventDto } from '../lib/api';
import { BOT_USERNAME } from '../lib/telegram';

/**
 * Ссылки в бота и признак «запись идёт». Без серверных зависимостей — нужны и
 * серверным страницам (через site/data), и компонентам в браузере.
 */

/** Идёт ли сейчас запись хоть на один старт (для кнопки в шапке и на главной). */
export function anyRegistrationOpen(events: EventDto[] | null): boolean {
  return (events ?? []).some(
    (e) => e.registrationOpen !== false && !e.registrationDeadlinePassed && e.slotsLeft > 0,
  );
}

/** Mini App сразу на этом старте (нужен «основной Mini App» в BotFather). */
export function botRaceLink(slug: string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=race-${encodeURIComponent(slug)}`;
}

/** Чат с ботом. payload — для /start (подписка «узнать об открытии», этап 2). */
export function botChatLink(payload?: string): string {
  return payload
    ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(payload)}`
    : `https://t.me/${BOT_USERNAME}`;
}

/** Сезон в подвале сайта. Сменить к следующему сезону. */
export const SEASON_YEAR = '2027';
