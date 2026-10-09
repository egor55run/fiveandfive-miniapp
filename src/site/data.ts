import { cache } from 'react';
import type { EventDto } from '../lib/api';

export { anyRegistrationOpen, botChatLink, botRaceLink } from './links';

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

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Старты, ближайшие первыми. null — бэкенд не ответил (страница покажет заглушку).
 * cache — один запрос на страницу, хотя старты нужны и шапке, и самой странице.
 */
export const fetchEvents = cache(() => getJson<EventDto[]>('/events'));

/** Старт по адресу страницы. null — нет такого (или бэкенд не ответил). */
export const fetchEventBySlug = cache((slug: string) =>
  getJson<EventDto>(`/events/by-slug/${encodeURIComponent(slug)}`),
);

/** Цена абонемента на активный сезон; null — сезона нет или цена не задана. */
export async function fetchSeasonPrice(): Promise<number | null> {
  const season = await getJson<{ price: number }>('/seasons/current');
  return season && season.price > 0 ? season.price : null;
}
