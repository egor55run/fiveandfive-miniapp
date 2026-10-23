import { getInitData } from './telegram';

/**
 * Рейтинг серии — формула и данные для Mini App и сайта. Формула та же, что
 * на сервере (backend/src/lib/rating.ts): баллы = 1000 + 4340 × ((T0 / T)^0.164 − 1),
 * T — время от выстрела на 5 км; T0 = 15:00 (М), 17:15 (Ж); финиш позже
 * 60:00 — 10 баллов, без финиша — 0. Здесь — для калькулятора на /reiting.
 */

export type RatingGender = 'MALE' | 'FEMALE';

export const T0: Record<RatingGender, number> = { MALE: 15 * 60, FEMALE: 17 * 60 + 15 };
export const CUTOFF_SECONDS = 60 * 60;
export const MIN_POINTS = 10;

export function pointsFor(seconds: number, gender: RatingGender): number {
  if (seconds > CUTOFF_SECONDS) return MIN_POINTS;
  return Math.max(MIN_POINTS, Math.round(1000 + 4340 * ((T0[gender] / seconds) ** 0.164 - 1)));
}

/** «22:14», «1:02:30» → секунды; null — не время. */
export function parseRunTime(input: string): number | null {
  const m = input.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (min >= 60 || sec >= 60) return null;
  const total = h * 3600 + min * 60 + sec;
  return total > 0 ? total : null;
}

export function formatRunTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export type SeasonRow = {
  place: number;
  name: string;
  userId: number;
  gender: RatingGender;
  total: number;
  stages: (number | null)[];
  bestTime: number | null;
  hidden: boolean;
  me: boolean;
};

export type SeasonRating = {
  season: { id: number; title: string; year: number };
  events: { id: number; title: string; slug: string | null; date: string; published: boolean }[];
  men: SeasonRow[];
  women: SeasonRow[];
};

export type StageRow = {
  place: number | null;
  name: string;
  userId: number;
  bib: number | null;
  gender: RatingGender;
  time: number | null;
  status: 'FINISHED' | 'DNF' | 'DNS' | 'DSQ';
  points: number;
  hidden: boolean;
  me: boolean;
};

export type StageRating = {
  event: { id: number; title: string; slug: string | null; date: string; location: string };
  published: boolean;
  publishedAt: string | null;
  protestUntil: string | null;
  men: StageRow[];
  women: StageRow[];
};

export const STATUS_SHORT: Record<StageRow['status'], string> = {
  FINISHED: '',
  DNF: 'сошёл',
  DNS: 'не стартовал',
  DSQ: 'дисквал.',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Таблица сезона. Из Mini App — с подписью: своя строка видна с именем. */
export async function fetchSeasonRating(): Promise<SeasonRating | null> {
  const initData = typeof window !== 'undefined' ? getInitData() : '';
  const res = await fetch(`${API_URL}/rating/season`, {
    headers: initData ? { Authorization: `tma ${initData}` } : {},
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Не удалось загрузить рейтинг (${res.status})`);
  return (await res.json()) as SeasonRating;
}
