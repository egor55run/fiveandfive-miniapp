import type { Participant } from './api';
import { formatDateTime, formatSeconds, PAYMENT_LABEL } from './helpers';

/**
 * Выгрузка участников старта в CSV для Excel: разделитель «;» и BOM — так
 * русский Excel открывает файл двойным щелчком с кириллицей и колонками.
 */
const COLUMNS: [string, (p: Participant) => string | number | null][] = [
  ['Номер', (p) => p.bibNumber],
  ['Фамилия', (p) => p.lastName],
  ['Имя', (p) => p.firstName],
  ['Дистанция', (p) => p.distance],
  ['Пол', (p) => (p.gender === 'MALE' ? 'М' : p.gender === 'FEMALE' ? 'Ж' : null)],
  ['Дата рождения', (p) => (p.birthDate ? p.birthDate.split('-').reverse().join('.') : null)],
  ['Возраст на день старта', (p) => p.ageOnStart ?? p.age],
  ['Телефон', (p) => p.phone],
  ['Email', (p) => p.email],
  ['Telegram', (p) => (p.username ? `@${p.username}` : p.telegramId)],
  ['Записался', (p) => formatDateTime(p.registeredAt)],
  ['Оплата', (p) => (p.refund ? `${PAYMENT_LABEL.REFUNDED} ${p.refund.amount} ₸` : PAYMENT_LABEL[p.paymentStatus])],
  ['Цена', (p) => p.price?.base ?? null],
  ['Скидка', (p) => (p.price && p.price.discount > 0 ? p.price.discount : null)],
  ['Промокод', (p) => p.price?.promoCode ?? null],
  ['Итого', (p) => p.price?.total ?? null],
  ['Абонемент', (p) => (p.seasonPassId !== null ? `#${p.seasonPassId}` : null)],
  ['Добавлен вручную', (p) => (p.manual ? p.manualNote || 'да' : null)],
  ['Время', (p) => (p.result ? (p.result.finishTime !== null ? formatSeconds(p.result.finishTime) : p.result.status) : null)],
  ['Место', (p) => p.result?.place ?? null],
];

function cell(value: string | number | null): string {
  const s = value === null || value === undefined ? '' : String(value);
  // Кавычки — если в значении разделитель, кавычка или перевод строки; ведущий
  // «=», «+», «-», «@» гасим апострофом, чтобы Excel не считал это формулой.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadParticipantsCsv(participants: Participant[], fileName: string): void {
  download([COLUMNS.map(([title]) => title), ...participants.map((p) => COLUMNS.map(([, get]) => get(p)))], fileName);
}

/**
 * \u0421\u0442\u0430\u0440\u0442\u043E\u0432\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u0434\u043B\u044F \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u044B \u0445\u0440\u043E\u043D\u043E\u043C\u0435\u0442\u0440\u0430\u0436\u0430: \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u0435, \u043A\u0442\u043E \u0431\u0435\u0436\u0438\u0442
 * (\u043E\u043F\u043B\u0430\u0447\u0435\u043D\u043E \u0438\u043B\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432\u0440\u0443\u0447\u043D\u0443\u044E), \u043F\u043E \u043D\u043E\u043C\u0435\u0440\u0443. \u041A\u043E\u043B\u043E\u043D\u043A\u0438 \u2014 \u043D\u043E\u043C\u0435\u0440, \u0444\u0430\u043C\u0438\u043B\u0438\u044F, \u0438\u043C\u044F,
 * \u043F\u043E\u043B, \u0434\u0430\u0442\u0430 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F, \u0434\u0438\u0441\u0442\u0430\u043D\u0446\u0438\u044F.
 */
export function downloadStartListCsv(participants: Participant[], fileName: string): void {
  const runners = participants
    .filter((p) => p.paymentStatus === 'PAID')
    .sort((a, b) => (a.bibNumber ?? Number.MAX_SAFE_INTEGER) - (b.bibNumber ?? Number.MAX_SAFE_INTEGER));
  download(
    [
      ['\u041D\u043E\u043C\u0435\u0440', '\u0424\u0430\u043C\u0438\u043B\u0438\u044F', '\u0418\u043C\u044F', '\u041F\u043E\u043B', '\u0414\u0430\u0442\u0430 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F', '\u0414\u0438\u0441\u0442\u0430\u043D\u0446\u0438\u044F'],
      ...runners.map((p) => [
        p.bibNumber,
        p.lastName,
        p.firstName,
        p.gender === 'MALE' ? '\u041C' : p.gender === 'FEMALE' ? '\u0416' : null,
        p.birthDate ? p.birthDate.split('-').reverse().join('.') : null,
        p.distance,
      ]),
    ],
    fileName,
  );
}

function download(rows: (string | number | null)[][], fileName: string): void {
  const csv = '\uFEFF' + rows.map((r) => r.map((v) => cell(v)).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
