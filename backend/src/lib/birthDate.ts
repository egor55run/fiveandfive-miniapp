/**
 * Дата рождения: разбор, проверка и возраст.
 *
 * Хранится в колонке типа DATE — без времени и часового пояса. Поэтому и здесь
 * работаем строго с календарным днём: строка «1999-12-14» (формат
 * input[type=date]) превращается в UTC-полночь и обратно без сдвигов. Если
 * взять локальное время, житель Алматы, родившийся 14-го, получил бы в базе 13-е.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Никто не живёт дольше — верхняя граница вменяемости, а не биология. */
export const MAX_AGE = 120;

/**
 * «1999-12-14» → Date (UTC-полночь). null, если строка не день календаря:
 * формат, несуществующая дата («2025-02-30»), будущее или возраст больше MAX_AGE.
 */
export function parseBirthDate(value: string, now: Date = new Date()): Date | null {
  const m = ISO_DAY.exec(value.trim());
  if (!m) return null;

  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  // Date молча переносит перебор: 30 февраля станет 2 марта. Ловим это тем,
  // что собранная обратно строка обязана совпасть с исходной.
  if (formatBirthDate(date) !== `${y}-${mo}-${d}`) return null;

  if (date.getTime() > now.getTime()) return null;
  if (ageFromBirthDate(date, now) > MAX_AGE) return null;

  return date;
}

/** Date → «1999-12-14». null остаётся null. */
export function formatBirthDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

/**
 * Поля профиля, отвечающие за возраст, для upsert при регистрации.
 *
 * Форма присылает и дату рождения, и посчитанный из неё возраст. Верить надо
 * дате: возраст от клиента берём только когда даты нет ни в запросе, ни уже в
 * профиле. Иначе повторная регистрация «старым» телом (age без birthDate)
 * перезаписала бы возраст, посчитанный из сохранённой даты, и два поля
 * разъехались бы.
 *
 * `birthDate` в результате появляется только когда она пришла в запросе —
 * этот же объект уходит в update, и затирать сохранённое нечем.
 */
export function ageProfileFields(
  incoming: Date | null,
  stored: Date | null,
  clientAge: number,
): { age: number; birthDate?: Date } {
  const known = incoming ?? stored;
  return {
    age: known ? ageFromBirthDate(known) : clientAge,
    ...(incoming ? { birthDate: incoming } : {}),
  };
}

/** Полных лет на сегодня. Считаем по UTC — в этой колонке времени нет. */
export function ageFromBirthDate(date: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) {
    age--;
  }
  return age;
}
