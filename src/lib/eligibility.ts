/**
 * Правила допуска из Положения — копия серверных (backend/src/lib/eligibility.ts).
 * Здесь они подсказывают до отправки, сервер не даёт обойти форму. Меняете
 * правило — меняйте оба места.
 */

export const MIN_AGE = 16;
export const ADULT_AGE = 18;

/** Астана — UTC+5 круглый год. */
const ASTANA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Полных лет на день старта (по Астане). birthDate — «1999-12-14» из input[type=date]. */
export function ageOnStartDay(birthDate: string, startIso: string): number | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [by, bm, bd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(new Date(startIso).getTime() + ASTANA_OFFSET_MS);
  let age = day.getUTCFullYear() - by;
  const monthDiff = day.getUTCMonth() + 1 - bm;
  if (monthDiff < 0 || (monthDiff === 0 && day.getUTCDate() < bd)) age--;
  return age;
}

function years(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} год`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} года`;
  return `${n} лет`;
}

export function underageMessage(ageOnStart: number): string {
  return `Участвовать можно с ${MIN_AGE} лет. На день старта вам будет ${years(Math.max(ageOnStart, 0))}`;
}

/** Текст третьей галочки — тот же записывает сервер (PARENTAL_CONSENT_TEXT). */
export const PARENTAL_CONSENT_TEXT =
  'Принесу письменное согласие родителя или законного представителя на выдачу стартового пакета';
