export type RaceResult = {
  title: string;
  date: string;
  distance: string;
  time: string; // финишное время, формат M:SS
  timeSeconds: number; // то же в секундах — для вычислений
  place: number; // место в общем зачёте
};

// Прошлые старты участника, отсортированы от старых к новым.
// Одна дистанция (5 км) с постепенно улучшающимся временем — виден прогресс.
export const results: RaceResult[] = [
  {
    title: 'Осенний забег «Медеу 5K»',
    date: '17 авг 2025',
    distance: '5 км',
    time: '28:45',
    timeSeconds: 1725,
    place: 342,
  },
  {
    title: 'Ночной старт Астана',
    date: '5 окт 2025',
    distance: '5 км',
    time: '27:30',
    timeSeconds: 1650,
    place: 298,
  },
  {
    title: 'Зимний кросс «Бурабай»',
    date: '14 дек 2025',
    distance: '5 км',
    time: '26:18',
    timeSeconds: 1578,
    place: 245,
  },
  {
    title: 'Весенний забег Алматы',
    date: '22 мар 2026',
    distance: '5 км',
    time: '25:40',
    timeSeconds: 1540,
    place: 198,
  },
  {
    title: 'FIVE&FIVE Городской старт',
    date: '7 июн 2026',
    distance: '5 км',
    time: '25:12',
    timeSeconds: 1512,
    place: 156,
  },
];

// Личный рекорд — лучшее (наименьшее) время.
export const personalBest: RaceResult = results.reduce(
  (best, item) => (item.timeSeconds < best.timeSeconds ? item : best),
  results[0],
);

const latest = results[results.length - 1];
const previous = results[results.length - 2];
const deltaSeconds = latest.timeSeconds - previous.timeSeconds; // < 0 = стал быстрее

// Прогресс между последним и предпоследним стартом.
export const progress = {
  deltaSeconds, // напр. -28
  absSeconds: Math.abs(deltaSeconds), // 28
  percent: Math.abs(deltaSeconds / previous.timeSeconds) * 100, // ~1.8
  improved: deltaSeconds < 0, // стал быстрее
  from: previous,
  to: latest,
};
