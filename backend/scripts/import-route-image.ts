/**
 * Перенос карты трассы из файла в новое хранилище, без админки и браузера.
 *
 * Нужен для того, ради чего хранилище и появилось: карта Триатлон Парка Астаны
 * была вкомпилирована во фронтенд (src/data/routeMaps.ts) и захардкожена на
 * event id 1. Скрипт кладёт её в каталог загрузок и прописывает ссылку в БД —
 * через тот же модуль, что и загрузка из админки, то есть с той же проверкой
 * содержимого, тем же лимитом и тем же способом именования файла.
 *
 * Запуск:
 *   npm run route:import -- --event 1 --file ./assets/route-triathlon-astana.webp
 *
 * Идемпотентен в том смысле, что повторный запуск просто заменит карту (прежний
 * файл будет удалён). Чтобы не перезаписывать уже загруженную карту, добавьте
 * --keep-existing: тогда старт с картой будет пропущен.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/prisma';
import { deleteRouteImage, saveRouteImage } from '../src/lib/routeImages';

type Args = { eventId: number; file: string; keepExisting: boolean };

function parseArgs(argv: string[]): Args | string {
  let eventId: number | null = null;
  let file: string | null = null;
  let keepExisting = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--event') {
      eventId = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--file') {
      file = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--keep-existing') {
      keepExisting = true;
    } else {
      return `Неизвестный аргумент: ${arg}`;
    }
  }

  if (eventId === null || !Number.isInteger(eventId) || eventId <= 0) {
    return 'Укажите --event <id старта>';
  }
  if (!file) return 'Укажите --file <путь к картинке>';

  return { eventId, file, keepExisting };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`${args}\n\nПример: npm run route:import -- --event 1 --file ./assets/route-triathlon-astana.webp`);
    process.exit(1);
  }

  const event = await prisma.event.findUnique({ where: { id: args.eventId } });
  if (!event) {
    console.error(`Старт #${args.eventId} не найден`);
    process.exit(1);
  }

  if (event.routeImageUrl && args.keepExisting) {
    console.log(`Старт #${event.id} «${event.title}»: карта уже есть (${event.routeImageUrl}) — пропускаю`);
    return;
  }

  const absolute = path.resolve(args.file);
  const data = await readFile(absolute);
  const saved = await saveRouteImage(event.id, data);

  await prisma.event.update({
    where: { id: event.id },
    data: { routeImageUrl: saved.url },
  });
  const removedOld = await deleteRouteImage(event.routeImageUrl);

  console.log(
    `Старт #${event.id} «${event.title}»: карта ${saved.url} ` +
      `(${saved.kind}, ${Math.round(saved.bytes / 1024)} КБ)` +
      (removedOld ? `, прежний файл ${event.routeImageUrl} удалён` : ''),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
