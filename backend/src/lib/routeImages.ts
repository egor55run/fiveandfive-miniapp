import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Хранилище карт трасс: сами файлы на диске, в БД (Event.routeImageUrl) — только
 * путь вида «/uploads/routes/event-1-a3f9c1d2.webp».
 *
 * Почему путь, а не абсолютный URL: одно и то же значение обязано работать и
 * локально (API на localhost:3000), и в проде, где nginx проксирует /api/ на
 * бэкенд. Приложение приклеивает свой базовый адрес само (apiAsset в
 * src/lib/api.ts), поэтому переезд на другой домен не требует переписывания БД.
 *
 * Раздаёт файлы сам бэкенд через @fastify/static на префиксе /uploads/ — то
 * есть снаружи это /api/uploads/... и правок в конфиге nginx не нужно. Если
 * когда-нибудь захочется отдавать их nginx напрямую, достаточно навести
 * location /api/uploads/ на тот же каталог: код и значения в БД не меняются.
 */

/** Публичный префикс: и в URL из БД, и в регистрации @fastify/static. */
export const UPLOADS_PREFIX = '/uploads';

/** Подпапка внутри каталога загрузок — на будущее, когда файлов станет больше видов. */
const ROUTES_SUBDIR = 'routes';

/**
 * 5 МБ. Отрисованная карта трассы в WebP весит десятки килобайт, так что лимит
 * щедрый; он тут ради защиты диска, а не ради экономии.
 *
 * Осторожно: у nginx свой лимит на тело запроса (client_max_body_size, по
 * умолчанию 1 МБ) — файлы крупнее упрутся в него раньше, чем дойдут до Node.
 * См. backend/README.md.
 */
export const MAX_ROUTE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Что принимаем. Расширение берём отсюда же — из содержимого, не из имени файла. */
const KINDS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
} as const;

export type ImageKind = keyof typeof KINDS;

export const ACCEPTED_MIME_TYPES = Object.values(KINDS).map((k) => k.mime);

/** Ошибка, текст которой можно показать администратору как есть. */
export class RouteImageError extends Error {
  reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'RouteImageError';
    this.reason = reason;
  }
}

/**
 * Корень каталога загрузок.
 *
 * По умолчанию `backend/uploads` — два уровня вверх и от `src/lib` (tsx), и от
 * `dist/lib` (сборка), так что путь одинаков в обоих режимах. Каталог не в git,
 * а `git reset --hard` в деплой-скрипте untracked-файлы не удаляет, поэтому
 * загруженные карты переживают деплой. Прод может унести его совсем в сторону
 * через UPLOAD_DIR — тогда каталог должен существовать и быть доступен на
 * запись пользователю, под которым живёт pm2.
 */
export function uploadsRoot(): string {
  const fromEnv = process.env.UPLOAD_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.resolve(__dirname, '../../uploads');
}

export function routeImagesDir(): string {
  return path.join(uploadsRoot(), ROUTES_SUBDIR);
}

/** Создать каталоги. Вызывается на старте сервера и в скрипте импорта. */
export async function ensureUploadDirs(): Promise<void> {
  await mkdir(routeImagesDir(), { recursive: true });
}

/**
 * Определение формата по магическим байтам, а не по Content-Type из запроса и
 * не по расширению: и то и другое присылает клиент, и верить им нельзя.
 */
export function sniffImageKind(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  // WebP: контейнер RIFF, где тип чанка на 8-м байте — 'WEBP'.
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export type SavedRouteImage = {
  /** Значение для Event.routeImageUrl. */
  url: string;
  kind: ImageKind;
  bytes: number;
};

/**
 * Записать карту трассы на диск и вернуть путь для БД.
 *
 * Имя файла придумывает сервер: id старта для читаемости плюс случайный хвост.
 * Имя, присланное браузером, не используется вообще — ни в пути, ни как
 * источник расширения, поэтому подобрать или подменить путь нельзя. Случайный
 * хвост заодно меняет URL при каждой замене карты, и её можно кэшировать
 * навсегда, не боясь, что у участников останется старая картинка.
 */
export async function saveRouteImage(eventId: number, data: Buffer): Promise<SavedRouteImage> {
  if (data.length === 0) {
    throw new RouteImageError('Файл пустой', 'empty_file');
  }
  if (data.length > MAX_ROUTE_IMAGE_BYTES) {
    throw new RouteImageError('Файл больше 5 МБ', 'file_too_large');
  }

  const kind = sniffImageKind(data);
  if (!kind) {
    throw new RouteImageError(
      'Формат не поддерживается — нужен JPG, PNG или WebP',
      'unsupported_format',
    );
  }

  await ensureUploadDirs();
  const name = `event-${eventId}-${randomBytes(4).toString('hex')}.${KINDS[kind].ext}`;
  await writeFile(path.join(routeImagesDir(), name), data);

  return {
    url: `${UPLOADS_PREFIX}/${ROUTES_SUBDIR}/${name}`,
    kind,
    bytes: data.length,
  };
}

/**
 * Удалить файл карты по значению из БД. Best-effort: если файла уже нет или он
 * не удаляется, строка в БД всё равно должна обновиться — висящий файл на диске
 * куда безобиднее, чем ссылка в БД на удалённую картинку.
 *
 * Возвращает true, если файл действительно удалён.
 */
export async function deleteRouteImage(url: string | null): Promise<boolean> {
  const filePath = routeImagePath(url);
  if (!filePath) return false;
  try {
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Абсолютный путь к файлу по значению из БД или null, если значение не похоже на
 * нашу карту. Проверка обязательна: в колонке лежит строка, и после ручной
 * правки в psql там может оказаться что угодно — «../../.env» в том числе.
 */
function routeImagePath(url: string | null): string | null {
  if (!url) return null;
  const expectedPrefix = `${UPLOADS_PREFIX}/${ROUTES_SUBDIR}/`;
  if (!url.startsWith(expectedPrefix)) return null;

  const name = url.slice(expectedPrefix.length);
  // Ни разделителей, ни «..» — файл лежит непосредственно в каталоге карт.
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return null;

  const dir = routeImagesDir();
  const resolved = path.resolve(dir, name);
  return resolved.startsWith(dir + path.sep) ? resolved : null;
}
