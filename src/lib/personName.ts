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

/** Первое подходящее из кандидатов, сразу в аккуратном виде («егор» → «Егор»). */
export function firstValidName(...candidates: (string | null | undefined)[]): string | undefined {
  const found = candidates.find(isValidPersonName);
  return found ? normalizePersonName(found) : undefined;
}

/** Есть ли латиница — подсказку про кириллицу показываем сразу, пока человек печатает. */
export function hasLatin(value: string): boolean {
  return LATIN_RE.test(value);
}

// Отчество по окончанию: русские (-ович, -евна, -ична…) и казахские (-ұлы,
// -қызы, в том числе через дефис и отдельным словом).
const PATRONYMIC_RE = /(?:ович|евич|ич|овна|евна|ична|инична|[уұ]лы|[кқ]ызы)$/i;
const PATRONYMIC_WORD_RE = /^(?:[уұ]лы|[кқ]ызы)$/i;

/**
 * Имя и фамилия из записи, сделанной старой формой с одним полем «ФИО».
 *
 * Та форма брала первое слово как фамилию, остальное — как имя, поэтому
 * отчество оказалось внутри имени, а при порядке «Имя Отчество Фамилия» имя
 * легло в фамилию:
 *   «Кадыров Егор Еркинович» → фамилия «Кадыров», имя «Егор Еркинович»
 *   «Егор Еркинович Кадыров» → фамилия «Егор»,    имя «Еркинович Кадыров»
 * Отчество узнаём по окончанию и по его месту понимаем порядок. Сначала
 * проверяем третье слово: «Фамилия Имя Отчество» встречается чаще, и так
 * фамилия на -ич («Бабич Иван Петрович») не примется за отчество.
 *
 * Если отчество не нашлось — возвращаем как есть: «Анна Мария» вполне может
 * быть двойным именем. Записи в базе не меняем — это только подстановка в
 * форму; после новой регистрации в базе будет правильно.
 */
export function splitLegacyName(
  lastName: string | null | undefined,
  firstName: string | null | undefined,
): { lastName: string | null | undefined; firstName: string | null | undefined } {
  const words = `${lastName ?? ''} ${firstName ?? ''}`.trim().split(/\s+/).filter(Boolean);
  const isPatronymic = (w: string | undefined) => Boolean(w) && PATRONYMIC_RE.test(w!);

  // «Кадыров Егор Еркин ұлы» — казахское отчество двумя словами.
  if (words.length === 4 && PATRONYMIC_WORD_RE.test(words[3])) {
    return { lastName: words[0], firstName: words[1] };
  }
  if (words.length !== 3) return { lastName, firstName };

  const [a, b, c] = words;
  if (isPatronymic(c)) return { lastName: a, firstName: b }; // Фамилия Имя Отчество
  if (isPatronymic(b)) return { lastName: c, firstName: a }; // Имя Отчество Фамилия
  return { lastName, firstName };
}
