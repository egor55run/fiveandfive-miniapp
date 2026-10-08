/**
 * Имя и фамилия участника: только кириллица (русская + казахские Ә Ғ Қ Ң Ө Ұ
 * Ү Һ І), дефис и пробел для двойных («Анна-Мария», «Иванова-Петрова»), первые
 * буквы заглавные. Отчество не собираем.
 *
 * Копия серверного правила — backend/src/lib/personName.ts. Меняете правило —
 * меняйте в обоих местах: сервер не доверяет форме, а форма должна
 * подсказывать до отправки.
 */

const LETTERS = 'А-ЯЁа-яёӘәҒғҚқҢңӨөҰұҮүҺһІі';
const NAME_RE = new RegExp(`^[${LETTERS}]+(?:[- ][${LETTERS}]+)*$`);
const LATIN_RE = /[A-Za-z]/;
export const PERSON_NAME_MAX = 50;

export type PersonNameKind = 'firstName' | 'lastName';

const MESSAGES: Record<PersonNameKind, { empty: string; latin: string }> = {
  firstName: { empty: 'Укажите имя', latin: 'Введите имя кириллицей' },
  lastName: { empty: 'Укажите фамилию', latin: 'Введите фамилию кириллицей' },
};

/**
 * Убрать лишние пробелы (в том числе вокруг дефиса) и сделать заглавной первую
 * букву каждой части: «  анна - мария » → «Анна-Мария». Остальные буквы не
 * трогаем — регистр внутри фамилии решает сам человек.
 */
export function normalizePersonName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/(^|[ -])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Текст ошибки для уже нормализованного значения или null, если всё верно. */
export function personNameError(value: string, kind: PersonNameKind): string | null {
  if (!value) return MESSAGES[kind].empty;
  // Латиница — самая частая ошибка (раскладка, имя из Telegram), отдельной фразой.
  if (LATIN_RE.test(value)) return MESSAGES[kind].latin;
  if (!NAME_RE.test(value)) return 'Только буквы, дефис и пробел';
  if (value.length > PERSON_NAME_MAX) return `Не длиннее ${PERSON_NAME_MAX} символов`;
  return null;
}

/**
 * Годится ли значение как есть — например, имя из Telegram для предзаполнения:
 * латиницу («Egor») лучше не подставлять, чем подставить и сразу ругаться.
 */
export function isValidPersonName(value: string | null | undefined): value is string {
  return Boolean(value) && personNameError(normalizePersonName(value as string), 'firstName') === null;
}

/** Есть ли латиница — подсказку про кириллицу показываем сразу, пока человек печатает. */
export function hasLatin(value: string): boolean {
  return LATIN_RE.test(value);
}
