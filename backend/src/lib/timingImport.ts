import type { ResultStatus } from '@prisma/client';

/**
 * Разбор файла хронометража (CSV / TSV из Excel или программы хронометража).
 *
 * Нужны две колонки — номер и время от выстрела; статус по желанию. Колонки
 * ищутся по заголовку (Номер / Bib / No, Время / Time / Gun, Статус / Status);
 * без заголовка — первая колонка номер, вторая время. Разделитель — «;», «,»
 * или табуляция (по первой строке).
 *
 * Время: «22:14», «1:02:30», «22:14.7» (доли секунды округляются вверх, как
 * принято в шоссейном беге), «1334» (секунды). Статус: DNF / DNS / DSQ (или
 * «сошёл», «не стартовал», «дисквал…»), а также слова в колонке времени.
 */

export type TimingRow = { bib: number; status: ResultStatus; seconds: number | null; line: number };

const BIB_HEAD = /^(номер|№|н(омер)?\.?|bib|no\.?|number|start ?no)$/i;
const TIME_HEAD = /^(время|time|gun( ?time)?|результат|result|чистое время|финиш)$/i;
const STATUS_HEAD = /^(статус|status)$/i;

function statusOf(raw: string): ResultStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^dnf|сош/.test(s)) return 'DNF';
  if (/^dns|не ?ст/.test(s)) return 'DNS';
  if (/^dsq|^dq|дисkв|дискв/.test(s)) return 'DSQ';
  if (/^(fin|финиш|ok)/.test(s)) return 'FINISHED';
  return null;
}

/** «22:14», «1:02:30», «22:14.7», «1334» → секунды; null — не время. */
export function parseTime(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(s)) return Math.ceil(Number(s));
  const m = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  return Math.ceil(h * 3600 + min * 60 + sec);
}

function split(line: string, sep: string): string[] {
  // Простые кавычки: "a;b" — одна ячейка.
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseTimingCsv(text: string): { rows: TimingRow[]; warnings: string[] } | { error: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { error: 'Файл пустой' };
  const first = lines[0];
  const sep = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const head = split(first, sep);
  let bibCol = head.findIndex((h) => BIB_HEAD.test(h));
  let timeCol = head.findIndex((h) => TIME_HEAD.test(h));
  const statusCol = head.findIndex((h) => STATUS_HEAD.test(h));
  let start = 1;
  if (bibCol < 0 || timeCol < 0) {
    // Без заголовка: номер, время.
    if (/^\d+$/.test(head[0] ?? '') && (parseTime(head[1] ?? '') !== null || statusOf(head[1] ?? '') !== null)) {
      bibCol = 0;
      timeCol = 1;
      start = 0;
    } else {
      return { error: 'Не нашли колонки «Номер» и «Время» — проверьте заголовок файла' };
    }
  }
  const rows: TimingRow[] = [];
  const warnings: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i], sep);
    const bibRaw = cells[bibCol] ?? '';
    const bib = Number(bibRaw);
    if (!Number.isInteger(bib) || bib < 1) {
      warnings.push(`Строка ${i + 1}: номер «${bibRaw}» — пропущена`);
      continue;
    }
    const timeRaw = cells[timeCol] ?? '';
    const explicit = statusCol >= 0 ? statusOf(cells[statusCol] ?? '') : null;
    const fromTime = statusOf(timeRaw);
    const seconds = parseTime(timeRaw);
    const status: ResultStatus = explicit ?? (seconds !== null ? 'FINISHED' : fromTime ?? 'DNF');
    if (status === 'FINISHED' && seconds === null) {
      warnings.push(`Строка ${i + 1}: у номера ${bib} время «${timeRaw}» не распознано — пропущена`);
      continue;
    }
    if (status === 'FINISHED' && seconds !== null && seconds < 6 * 60) {
      warnings.push(`Строка ${i + 1}: у номера ${bib} время ${timeRaw} — меньше 6 минут, проверьте`);
    }
    if (explicit === null && seconds === null && fromTime === null) {
      warnings.push(`Строка ${i + 1}: у номера ${bib} нет времени — записан как «сошёл»`);
    }
    rows.push({ bib, status, seconds: status === 'FINISHED' ? seconds : null, line: i + 1 });
  }
  return { rows, warnings };
}
