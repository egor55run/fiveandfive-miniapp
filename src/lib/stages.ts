import type { EventDto } from './api';

/**
 * Этапы серии и отдельные старты (2026-11-11). Этап — старт с сезоном: он в
 * блоке этапов, в звезде из лучей, в рейтинге сезона и в абонементе. Отдельный
 * старт (например, «Родина Ран») — только в «Других забегах».
 */

export const isStage = (e: EventDto): boolean => e.seriesStage !== false;

/**
 * Дистанции фразой: «5, 10 и 21 км»; если подписи не «N км» — как есть
 * («5 км, детский забег и скандинавская ходьба»).
 */
export function distancePhrase(e: EventDto): string {
  const labels = e.distances?.length ? e.distances.map((d) => d.label.trim()) : [e.distance];
  const km = labels.map((l) => l.match(/^(\d+(?:[.,]\d+)?)\s*км$/i)?.[1]);
  const join = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} и ${items.at(-1)}` : items[0] ?? '');
  return km.every(Boolean) ? `${join(km as string[])} км` : join(labels);
}

/** Название с годом старта, если года в нём нет: «RODINA RUN 2027». */
export function titleWithYear(e: EventDto): string {
  const year = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', timeZone: 'Asia/Almaty' }).format(new Date(e.date));
  return /\b20\d\d\b/.test(e.title) ? e.title : `${e.title} ${year}`;
}

/** Этапы серии по номеру (без номера — по дате). */
export function stagesOf(events: EventDto[]): EventDto[] {
  return events
    .filter(isStage)
    .sort((a, b) => (a.stageNumber ?? 99) - (b.stageNumber ?? 99) || Date.parse(a.date) - Date.parse(b.date));
}

/** Отдельные старты по дате. */
export function otherRacesOf(events: EventDto[]): EventDto[] {
  return events.filter((e) => !isStage(e)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Метка этапа: { final } — у последнего этапа серии (по номеру), иначе номер.
 * null — отдельный старт.
 */
export function stageInfo(e: EventDto, events: EventDto[]): { number: number; final: boolean } | null {
  if (!isStage(e)) return null;
  const stages = stagesOf(events);
  const index = stages.findIndex((s) => s.id === e.id);
  if (index < 0) return null;
  return { number: e.stageNumber ?? index + 1, final: stages.length > 1 && index === stages.length - 1 };
}
