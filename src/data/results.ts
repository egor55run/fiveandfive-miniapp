// TODO: временные мок-данные. Заменить на реальные результаты с бэкенда
// (GET /results/:userId), когда появится админ-функциональность для внесения
// финишных протоколов. Пока фронтенд показывает эти демо-результаты в профиле
// и в аналитике.
//
// Чего для этого не хватает на бэке (модель Result сейчас знает только
// finishTime и place): общее число финишёров, гендерный зачёт и погода.
// Темп и скорость считаются на клиенте из времени и дистанции.
export type RaceResult = {
  title: string;
  date: string;
  distance: string;
  distanceKm: number; // то же числом — для темпа и скорости
  time: string; // финишное время, формат M:SS
  timeSeconds: number; // то же в секундах — для вычислений
  place: number; // место в общем зачёте
  placeTotal: number; // сколько всего финишировало
  genderPlace: number; // место в своём зачёте
  genderTotal: number; // сколько всего в своём зачёте
  weather: string; // погода на старте
};

// Прошлые старты участника, отсортированы от старых к новым.
// Одна дистанция (5 км) с постепенно улучшающимся временем — виден прогресс.
export const results: RaceResult[] = [
  {
    title: 'Осенний забег «Медеу 5K»',
    date: '17 авг 2025',
    distance: '5 км',
    distanceKm: 5,
    time: '28:45',
    timeSeconds: 1725,
    place: 342,
    placeTotal: 512,
    genderPlace: 201,
    genderTotal: 298,
    weather: '+14°C, ветер 3м/с',
  },
  {
    title: 'Ночной старт Астана',
    date: '5 окт 2025',
    distance: '5 км',
    distanceKm: 5,
    time: '27:30',
    timeSeconds: 1650,
    place: 298,
    placeTotal: 486,
    genderPlace: 176,
    genderTotal: 281,
    weather: '+9°C, ветер 6м/с',
  },
  {
    title: 'Зимний кросс «Бурабай»',
    date: '14 дек 2025',
    distance: '5 км',
    distanceKm: 5,
    time: '26:18',
    timeSeconds: 1578,
    place: 245,
    placeTotal: 402,
    genderPlace: 141,
    genderTotal: 233,
    weather: '−7°C, ветер 5м/с',
  },
  {
    title: 'Весенний забег Алматы',
    date: '22 мар 2026',
    distance: '5 км',
    distanceKm: 5,
    time: '25:40',
    timeSeconds: 1540,
    place: 198,
    placeTotal: 431,
    genderPlace: 112,
    genderTotal: 247,
    weather: '+11°C, ветер 2м/с',
  },
  {
    title: 'FIVE&FIVE Городской старт',
    date: '7 июн 2026',
    distance: '5 км',
    distanceKm: 5,
    time: '25:12',
    timeSeconds: 1512,
    place: 156,
    placeTotal: 369,
    genderPlace: 98,
    genderTotal: 241,
    weather: '+19°C, ветер 4м/с',
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
