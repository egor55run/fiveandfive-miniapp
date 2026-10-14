import type { Prisma, RouteMap } from '@prisma/client';
import { prisma } from '../prisma';
import { deleteRouteImage } from './routeImages';

/**
 * Карты трасс старта (несколько: «5 км», «3 км»…). Файлы — те же, что раньше
 * (lib/routeImages), в БД — по строке на карту с подписью и порядком.
 * events.route_image_url держим равным первой карте: его читают превью для
 * соцсетей и старые версии приложения.
 */

type Tx = Prisma.TransactionClient;

export const MAX_ROUTE_MAPS = 10;

export const ROUTE_MAP_ORDER: Prisma.RouteMapOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { id: 'asc' },
];

export function serializeRouteMap(m: RouteMap) {
  return { id: m.id, url: m.url, caption: m.caption };
}

/** events.route_image_url = первая карта (или null, если карт нет). */
export async function syncFirstRouteMap(tx: Tx, eventId: number): Promise<void> {
  const first = await tx.routeMap.findFirst({ where: { eventId }, orderBy: ROUTE_MAP_ORDER });
  await tx.event.update({ where: { id: eventId }, data: { routeImageUrl: first?.url ?? null } });
}

/**
 * Удалить файл карты, если на него больше никто не ссылается. Один файл может
 * висеть на двух стартах (одна трасса у этапа и финала) — тогда файл остаётся.
 */
export async function deleteRouteFileIfUnused(url: string): Promise<boolean> {
  const [maps, events] = await Promise.all([
    prisma.routeMap.count({ where: { url } }),
    prisma.event.count({ where: { routeImageUrl: url } }),
  ]);
  if (maps > 0 || events > 0) return false;
  return deleteRouteImage(url);
}
