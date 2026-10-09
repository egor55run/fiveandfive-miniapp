import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UPLOADS_PREFIX, uploadsRoot } from './routeImages';

/**
 * Положение о забеге — PDF, загружаемый в админке. Хранится так же, как карта
 * трассы (lib/routeImages): файл на диске, в БД (Event.regulationsUrl) — путь
 * «/uploads/regulations/event-1-a3f9c1d2.pdf», раздаёт бэкенд (снаружи /api/uploads/…).
 */

const SUBDIR = 'regulations';

/**
 * 7 МБ: Положение со сканами печатей бывает тяжелее карты трассы. Ниже лимита
 * nginx на /api/ (8 МБ), чтобы на превышение отвечал бэкенд понятным текстом.
 */
export const MAX_REGULATIONS_BYTES = 7 * 1024 * 1024;

export class RegulationsError extends Error {
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'RegulationsError';
    this.reason = reason;
  }
}

function regulationsDir(): string {
  return path.join(uploadsRoot(), SUBDIR);
}

/**
 * Сохранить PDF и вернуть путь для БД. Формат — по содержимому («%PDF-» в
 * начале), имя файла придумывает сервер: присланное браузером не используется.
 */
export async function saveRegulations(eventId: number, data: Buffer): Promise<string> {
  if (data.length === 0) throw new RegulationsError('Файл пустой', 'empty_file');
  if (data.length > MAX_REGULATIONS_BYTES) {
    throw new RegulationsError('Файл больше 7 МБ', 'file_too_large');
  }
  if (data.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new RegulationsError('Нужен PDF-файл', 'unsupported_format');
  }
  await mkdir(regulationsDir(), { recursive: true });
  const name = `event-${eventId}-${randomBytes(4).toString('hex')}.pdf`;
  await writeFile(path.join(regulationsDir(), name), data);
  return `${UPLOADS_PREFIX}/${SUBDIR}/${name}`;
}

/** Удалить файл по значению из БД. Best effort, как у карт трасс. */
export async function deleteRegulations(url: string | null): Promise<boolean> {
  if (!url) return false;
  const prefix = `${UPLOADS_PREFIX}/${SUBDIR}/`;
  if (!url.startsWith(prefix)) return false;
  const name = url.slice(prefix.length);
  // Ни разделителей, ни «..» — только файл прямо в каталоге Положений.
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return false;
  const dir = regulationsDir();
  const resolved = path.resolve(dir, name);
  if (!resolved.startsWith(dir + path.sep)) return false;
  try {
    await unlink(resolved);
    return true;
  } catch {
    return false;
  }
}
