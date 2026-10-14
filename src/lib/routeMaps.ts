/** Карта трассы старта: путь к файлу (относительно корня API) и подпись. */
export type RouteMapItem = { id: number; url: string; caption: string };

/**
 * Карты старта: новый список или, у старого сервера, единственная карта.
 * Обычный модуль, а не клиентский компонент — вызывается и на сервере (сайт),
 * и в Mini App.
 */
export function routeMapsOf(event: {
  routeMaps?: RouteMapItem[];
  routeImageUrl: string | null;
}): RouteMapItem[] {
  if (event.routeMaps && event.routeMaps.length > 0) return event.routeMaps;
  return event.routeImageUrl ? [{ id: 0, url: event.routeImageUrl, caption: '' }] : [];
}
