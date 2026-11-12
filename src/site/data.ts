import { cache } from 'react';
import type { EventDto } from '../lib/api';
import type { EventResults, SeasonRating, StageRating } from '../lib/rating';

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

/** Настройки из админки, которые нужны сайту (дата открытия регистрации — для разметки). */
export const fetchSiteSettings = cache(() =>
  getJson<{ pricesPublic: boolean; registrationOpen: boolean; registrationOpenedAt: string | null }>('/settings/public'),
);

/** Частые вопросы из админки; null — бэкенд не ответил (страница возьмёт исходные). */
export const fetchFaq = cache(() => getJson<{ items: import('./faq').FaqItem[] }>('/faq'));

/** Старт по адресу страницы. null — нет такого (или бэкенд не ответил). */
export const fetchEventBySlug = cache((slug: string) =>
  getJson<EventDto>(`/events/by-slug/${encodeURIComponent(slug)}`),
);

/** Цена абонемента на активный сезон; null — сезона нет или цена не задана. */
export async function fetchSeasonPrice(): Promise<number | null> {
  const season = await getJson<{ price: number }>('/seasons/current');
  return season && season.price > 0 ? season.price : null;
}

/** Рейтинг сезона и протокол этапа (только опубликованные результаты). */
export const fetchSeasonRating = cache(() => getJson<SeasonRating>('/rating/season'));
/** Протокол старта по дистанциям (любой старт). */
export const fetchEventResults = cache((slug: string) => getJson<EventResults>(`/results/${encodeURIComponent(slug)}`));
export const fetchStageRating = cache((slug: string) => getJson<StageRating>(`/rating/stage/${encodeURIComponent(slug)}`));

// ---------- Итоги сезона (2026-11-12) ----------

export type SummaryTopRow = { place: number; name: string; total: number; stages: number };
export type SummaryPodium = { place: number; name: string; time: number | null };
export type SummaryRecord = { name: string; time: number; stage: number; title: string } | null;
export type PublicSummary = {
  year: number;
  title: string;
  publishedAt: string;
  stagesTotal: number;
  top: { men: SummaryTopRow[]; women: SummaryTopRow[] };
  stageWinners: { stage: number; title: string; slug: string | null; date: string; men: SummaryPodium[]; women: SummaryPodium[] }[];
  records: { men: SummaryRecord; women: SummaryRecord };
  stats: { participants: number; finishes: number; km: number; stars: number };
};
export type SeasonSummaryPage =
  | { season: { year: number; title: string }; published: true; finalDate: string | null; summary: PublicSummary }
  | {
      season: { year: number; title: string };
      published: false;
      finalDate: string | null;
      current: {
        stagesPublished: number;
        stagesTotal: number;
        events: { title: string; slug: string | null; date: string; published: boolean }[];
        men: SummaryTopRow[];
        women: SummaryTopRow[];
      };
    };
export type SummaryCard = {
  year: number;
  title: string;
  firstName: string;
  stagesRun: number;
  stagesTotal: number;
  km: number;
  bestRace: { stage: number; title: string; place: number | null; of: number; time: number } | null;
  record: { stage: number; title: string; time: number } | null;
  improvement: number | null;
  final: { place: number; of: number; total: number } | null;
  fasterThan: number | null;
  rays: number;
  placeMoves: number[];
};

export const fetchSeasonSummary = cache((year: number) => getJson<SeasonSummaryPage>(`/seasons/summary/${year}`));
export const fetchSummarySeasons = cache(() => getJson<{ year: number; published: boolean }[]>('/seasons/summaries'));
export const fetchSummaryCard = (year: number, token: string) =>
  getJson<SummaryCard>(`/seasons/summary/${year}/card/${encodeURIComponent(token)}`);
