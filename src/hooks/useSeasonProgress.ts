import { useEffect, useMemo, useState } from 'react';
import { getCurrentSeason, type SeasonDto } from '../lib/api';
import type { RaceResult } from '../data/results';
import { profileMock } from '../data/profile';

export type SeasonProgress = {
  /** Сколько стартов сезона участник уже пробежал. */
  done: number;
  /** Сколько стартов в сезоне. */
  total: number;
};

/**
 * Прогресс по серии 5&5 — «N из 5» в профиле и в аналитике.
 *
 * Отдельного эндпоинта прогресса на бэкенде нет, поэтому считаем на клиенте:
 * состав сезона берём из /seasons/current, пройденное — из реальных результатов
 * участника, засчитывая только забеги, входящие в этот сезон.
 */
export function useSeasonProgress(results: RaceResult[]): SeasonProgress {
  const [season, setSeason] = useState<SeasonDto | null>(null);

  // Ошибку глотаем: без сезона экран остаётся рабочим, просто со знаменателем
  // по умолчанию.
  useEffect(() => {
    let alive = true;
    getCurrentSeason()
      .then((loaded) => {
        if (alive) setSeason(loaded);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const total = season?.events.length ?? profileMock.seriesTotalFallback;

  const done = useMemo(() => {
    // Сезон ещё не загрузился или его нет вовсе — сузить до его стартов нечем,
    // поэтому берём все забеги участника: ближе к правде, чем ноль.
    if (!season) return results.length;
    const inSeason = new Set(season.events.map((e) => e.id));
    return results.filter((r) => inSeason.has(r.eventId)).length;
  }, [season, results]);

  return { done: Math.min(done, total), total };
}
