// Карты трасс. Пока это статическая привязка «старт → картинка»: в модели Event
// на бэкенде нет ни изображения трассы, ни GPX/координат, а в макете нарисован
// ровно один маршрут — Триатлон Парк Астана.
//
// Что нужно на бэке, чтобы это стало настоящим:
//   routeImageUrl — поле на Event со ссылкой на отрисованную карту трассы
//                   (или routeGeoJson + рендер карты на клиенте, если хочется
//                   зум/интерактив вместо растра).
// До этого для стартов без карты показываем прежний плейсхолдер — рисовать
// маршрут Астаны на карточке Президентского парка нельзя, это просто неверно.
import routeAstana2x from '../assets/route-triathlon-astana-2x.webp';
import routeAstana3x from '../assets/route-triathlon-astana-3x.webp';

export type RouteMap = {
  /** 2x (656w) — базовый источник и он же для DPR≤2. */
  src: string;
  /** srcSet с плотностями: 3x подключается только на DPR 3. */
  srcSet: string;
  /** Пропорции исходника из Figma — чтобы не растягивать маршрут. */
  aspectRatio: string;
  alt: string;
};

const ASTANA: RouteMap = {
  src: routeAstana2x,
  srcSet: `${routeAstana2x} 2x, ${routeAstana3x} 3x`,
  aspectRatio: '328 / 227',
  alt: 'Схема трассы: 5 км по Триатлон Парку в Астане',
};

/** Ключ — Event.id из сида, значение — карта трассы. */
const byEventId: Record<number, RouteMap> = {
  1: ASTANA,
};

/**
 * Карта трассы для старта или null, если её для этого старта нет.
 * Совпадение по id, с запасным вариантом по названию: id из сида на проде и
 * локально совпадают, но название переживает пересид.
 */
export function getRouteMap(event: { id: number; title: string }): RouteMap | null {
  const byId = byEventId[event.id];
  if (byId) return byId;
  return /триатлон\s+парк/i.test(event.title) ? ASTANA : null;
}
