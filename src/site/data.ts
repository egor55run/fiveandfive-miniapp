import type { EventDto } from '../lib/api';
import { BOT_USERNAME } from '../lib/telegram';

/**
 * Данные сайта — с бэкенда, на сервере Next при каждом запросе.
 *
 * Сайт собирается не на сервере (на машине разработчика), поэтому данные из
 * базы при сборке недоступны: страницы рендерятся при запросе. Бэкенд — на
 * той же машине, запрос к нему — миллисекунды. Адрес задаёт pm2 через
 * API_INTERNAL_URL (scripts/deploy-web.sh); локально годится и
 * NEXT_PUBLIC_API_URL, если он абсолютный.
 */
function apiBase(): string {
  const internal = process.env.API_INTERNAL_URL?.trim();
  if (internal) return internal.replace(/\/+$/, '');
  const pub = process.env.NEXT_PUBLIC_API_URL ?? '';
  return pub.startsWith('http') ? pub.replace(/\/+$/, '') : 'http://127.0.0.1:3000';
}

/** Старты, ближайшие первыми. null — бэкенд не ответил (страница покажет заглушку). */
export async function fetchEvents(): Promise<EventDto[] | null> {
  try {
    const res = await fetch(`${apiBase()}/events`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as EventDto[]) : null;
  } catch {
    return null;
  }
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
