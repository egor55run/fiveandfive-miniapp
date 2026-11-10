import type { EventDto } from './api';

/**
 * Этапы серии и отдельные старты (2026-11-11). Этап — старт с сезоном: он в
 * блоке этапов, в звезде из лучей, в рейтинге сезона и в абонементе. Отдельный
 * старт (например, «Родина Ран») — только в «Других забегах».
 */

export const isStage = (e: EventDto): boolean => e.seriesStage !== false;

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
