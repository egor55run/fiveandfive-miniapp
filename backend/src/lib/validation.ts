import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBirthDate } from './birthDate';
import { normalizePersonName, personNameError, type PersonNameKind } from './personName';

/**
 * Общие поля форм участника и единый формат ответа на 400.
 *
 * Тексты сразу по-русски и живут в схеме, а не в UI: фронт показывает то, что
 * прислал сервер (см. preferServerMessage в src/lib/api.ts), и англоязычный
 * дефолт zod утёк бы прямо на экран.
 */

export const emailField = z
  .string()
  .trim()
  .min(1, 'Укажите email')
  .email('Некорректный email');

/**
 * Телефон. Формат записи оставляем пользователю (+7, скобки, пробелы —
 * что угодно), но цифр должно быть достаточно, чтобы это был телефон:
 * прежняя проверка min(3) пропускала строку «abc».
 */
export const phoneField = z
  .string()
  .trim()
  .min(1, 'Укажите телефон')
  .refine(
    (v) => (v.match(/\d/g) ?? []).length >= 10,
    'В телефоне должно быть минимум 10 цифр',
  );

/**
 * Имя или фамилия: кириллица, дефис, пробел; приходит нормализованным
 * («анна-мария» → «Анна-Мария»). Правило — lib/personName.
 */
export function personNameField(kind: PersonNameKind) {
  return z
    .string()
    .transform(normalizePersonName)
    .superRefine((value, ctx) => {
      const message = personNameError(value, kind);
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    });
}

/** Дата рождения в формате input[type=date]. Разбор и границы — в lib/birthDate. */
export const birthDateField = z
  .string()
  .trim()
  .refine((v) => parseBirthDate(v) !== null, 'Проверьте дату рождения');

/**
 * Ответ 400 в том виде, который фронт умеет показать: `error` — готовая фраза
 * для плашки, `fields` — та же фраза, но привязанная к конкретному полю, чтобы
 * подсветить именно его.
 */
export function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  const flat = error.flatten();

  const fields: Record<string, string> = {};
  for (const [name, messages] of Object.entries(flat.fieldErrors)) {
    const first = messages?.[0];
    if (first) fields[name] = first;
  }

  const summary = Object.values(fields)[0] ?? flat.formErrors[0] ?? 'Проверьте поля';

  return reply.code(400).send({ error: summary, reason: 'validation', fields });
}
