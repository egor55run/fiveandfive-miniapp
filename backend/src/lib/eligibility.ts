/**
 * Кто и до какого момента может записаться на старт — правила Положения
 * серии (решение пользователя 2026-10-08):
 *  - участвовать можно с 16 лет — возраст считается на день старта;
 *  - 16–17 лет — обязательна галочка «Принесу письменное согласие родителя…»;
 *  - регистрация закрывается за 7 дней до старта, если в админке не задана
 *    другая дата (Event.registrationClosesAt).
 *
 * Те же правила — в приложении (src/lib/eligibility.ts): там они подсказывают
 * до отправки, здесь — не дают обойти форму. Меняете правило — меняйте оба.
 */

export const MIN_AGE = 16;
export const ADULT_AGE = 18;
export const DEFAULT_CLOSE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Астана — UTC+5 круглый год (единый часовой пояс Казахстана с 2024-03-01). */
const ASTANA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Полных лет на день старта. Дата рождения — колонка DATE (полночь UTC),
 * старт — момент времени: берём календарный день старта по Астане.
 */
export function ageOnStartDay(birthDate: Date, start: Date): number {
  const day = new Date(start.getTime() + ASTANA_OFFSET_MS);
  let age = day.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = day.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && day.getUTCDate() < birthDate.getUTCDate())) {
    age--;
  }
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

export const PARENT_CONSENT_REQUIRED =
  'Участникам 16–17 лет нужно подтвердить, что принесёте письменное согласие родителя';

/** Когда закрывается регистрация: заданная в админке дата или за 7 дней до старта. */
export function registrationClosesAt(e: { date: Date; registrationClosesAt: Date | null }): Date {
  return e.registrationClosesAt ?? new Date(e.date.getTime() - DEFAULT_CLOSE_DAYS * DAY_MS);
}

export function registrationDeadlinePassed(
  e: { date: Date; registrationClosesAt: Date | null },
  now: Date = new Date(),
): boolean {
  return now.getTime() >= registrationClosesAt(e).getTime();
}

export const REGISTRATION_DEADLINE_MESSAGE = 'Регистрация на этот старт закрыта';

type AgeCheck =
  | { ok: true; minor: boolean }
  | { ok: false; body: { error: string; reason: 'validation'; fields: Record<string, string> } };

/**
 * Возраст на день старта: младше 16 — отказ; 16–17 — нужна галочка родителя.
 * birthDate — из формы или из профиля; без неё возраст не проверить, и
 * регистрация не проходит.
 */
export function checkAge(birthDate: Date | null, start: Date, parentConsent: boolean): AgeCheck {
  const fail = (field: string, message: string): AgeCheck => ({
    ok: false,
    body: { error: message, reason: 'validation', fields: { [field]: message } },
  });
  if (!birthDate) return fail('birthDate', 'Укажите дату рождения');
  const age = ageOnStartDay(birthDate, start);
  if (age < MIN_AGE) return fail('birthDate', underageMessage(age));
  const minor = age < ADULT_AGE;
  if (minor && !parentConsent) return fail('consents', PARENT_CONSENT_REQUIRED);
  return { ok: true, minor };
}
