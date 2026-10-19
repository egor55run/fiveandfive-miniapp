import type { Participant } from './api';
import { formatDateTime, formatSeconds, PAYMENT_LABEL } from './helpers';

/**
 * Выгрузка участников старта в CSV для Excel: разделитель «;» и BOM — так
 * русский Excel открывает файл двойным щелчком с кириллицей и колонками.
 */
const COLUMNS: [string, (p: Participant) => string | number | null][] = [
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
  ['Абонемент', (p) => (p.seasonPassId !== null ? `#${p.seasonPassId}` : null)],
  ['Добавлен вручную', (p) => (p.manual ? p.manualNote || 'да' : null)],
  ['Время', (p) => (p.result ? formatSeconds(p.result.finishTime) : null)],
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
  const rows = [COLUMNS.map(([title]) => title), ...participants.map((p) => COLUMNS.map(([, get]) => get(p)))];
  const csv = '\uFEFF' + rows.map((r) => r.map((v) => cell(v as string | number | null)).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
