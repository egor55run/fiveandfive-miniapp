import { DISTANCE_ORDER } from './distances';
import { ROUTE_MAP_ORDER } from './routeMaps';

/**
 * include для старта со всем, что нужно serializeEvent: дистанции и карты
 * трасс, в порядке из админки.
 */
export const EVENT_DETAILS = {
  distances: { orderBy: DISTANCE_ORDER },
  routeMaps: { orderBy: ROUTE_MAP_ORDER },
  pickupSlots: { orderBy: { startsAt: 'asc' } },
} as const;
