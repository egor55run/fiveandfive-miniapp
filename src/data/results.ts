// Результаты участника: маппинг ответа GET /me в вью-модель профиля и аналитики
// плюс производные величины. Своих данных этот модуль не содержит — всё, что
// показывают экраны, внесено через админку (PUT /admin/events/:id/results).
//
// Чего модели Result не хватает для полной картины по макету:
//   пол участника — без него нет гендерного зачёта («Среди мужчин: 98 из 241»),
//                   поэтому строка на экране аналитики скрыта. Нужно поле gender
//                   у User + место, считаемое по подмножеству протокола.
//   погода на старте — нет ни на Event, ни на Result; мета-строка разбора
//                   забега обходится без неё.
//   bibNumber   — номер участника: см. src/data/profile.ts.
// Общее число финишёров бэкенд уже отдаёт (finishersTotal), темп и скорость
// считаются здесь из времени и дистанции.
import type { MeRaceResultDto } from '../lib/api';

export type RaceResult = {
  eventId: number;
  title: string;
  date: string; // «17 авг 2025» — для вывода
  shortDate: string; // «17 авг» — для подписей графика
  distance: string; // как задано у старта, напр. «5 км»
  /** Дистанция числом — для темпа и скорости. null, если строка не разобралась. */
  distanceKm: number | null;
  time: string; // финишное время, формат M:SS
  timeSeconds: number; // то же в секундах — для вычислений
  place: number; // место в общем зачёте
  placeTotal: number; // сколько всего финишировало
};

const TZ = 'Asia/Almaty';
const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
});
const shortDateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: TZ,
});

/**
 * «13 июн. 2027 г.» → «13 июн 2027». Intl приписывает к году « г.», а короткие
 * месяцы отдаёт с точкой («июн.», но «мая» без) — в макете ни того, ни другого.
 */
function tidyDate(formatted: string): string {
  return formatted.replace(/\s*г\.$/, '').replace(/\./g, '');
}

/** 213 → «3:33». Часы, если забег длиннее часа: 3725 → «1:02:05». */
export function mmss(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Дистанция из свободной строки Event.distance: «5 км», «10.5 км», «21,1 km».
 * null — если распознать не удалось: тогда экраны прячут темп и скорость,
 * а не показывают NaN.
 */
export function parseDistanceKm(distance: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)/.exec(distance);
  if (!match) return null;
  const km = Number(match[1].replace(',', '.'));
  return Number.isFinite(km) && km > 0 ? km : null;
}

/** Ответ API → вью-модель. Порядок (от старых к новым) задаёт бэкенд. */
export function toRaceResults(dtos: MeRaceResultDto[]): RaceResult[] {
  return dtos.map((r) => ({
    eventId: r.eventId,
    title: r.event.title,
    date: tidyDate(dateFmt.format(new Date(r.event.date))),
    shortDate: tidyDate(shortDateFmt.format(new Date(r.event.date))),
    distance: r.event.distance,
    distanceKm: parseDistanceKm(r.event.distance),
    time: mmss(r.finishTime),
    timeSeconds: r.finishTime,
    place: r.place,
    placeTotal: r.finishersTotal,
  }));
}

/** Личный рекорд — лучшее (наименьшее) время. null, если забегов нет. */
export function personalBestOf(list: RaceResult[]): RaceResult | null {
  return list.reduce<RaceResult | null>(
    (best, item) => (best === null || item.timeSeconds < best.timeSeconds ? item : best),
    null,
  );
}
