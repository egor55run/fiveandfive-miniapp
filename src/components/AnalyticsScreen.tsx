import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import Header from './Header';
import { getCurrentSeason } from '../lib/api';
// TODO: результаты — мок. Заменить на GET /results/:userId, когда бэкенд начнёт
// отдавать финишные протоколы; погода/общее число финишёров тоже с бэка.
import { personalBest, results } from '../data/results';
// TODO: прогресс по сезону бэкенд не считает — см. src/data/profile.ts.
import { profileMock } from '../data/profile';

type Props = {
  onBack: () => void;
};

// 213 → «3:33»
function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Темп в минутах на километр.
function pace(timeSeconds: number, km: number): string {
  return `${mmss(Math.round(timeSeconds / km))}/КМ`;
}

// Средняя скорость, км/ч.
function speed(timeSeconds: number, km: number): string {
  return (km / (timeSeconds / 3600)).toFixed(1);
}

// «17 авг 2025» → «17 авг»
function shortDate(date: string): string {
  return date.split(' ').slice(0, 2).join(' ');
}

function AnalyticsScreen({ onBack }: Props) {
  const reduceMotion = useReducedMotion();
  const [seasonTotal, setSeasonTotal] = useState(profileMock.seriesTotalFallback);
  // Разбор показываем по выбранному забегу, по умолчанию — последний.
  const [selected, setSelected] = useState(results.length - 1);

  // Число стартов в сезоне — реальное, из API. Ошибку игнорируем: остаётся 5.
  useEffect(() => {
    let alive = true;
    getCurrentSeason()
      .then((season) => {
        if (alive && season) setSeasonTotal(season.events.length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const done = Math.min(profileMock.seriesDone, seasonTotal);
  const totalKm = results.reduce((sum, r) => sum + r.distanceKm, 0);

  // Динамика: чем медленнее забег, тем выше метка.
  const times = results.map((r) => r.timeSeconds);
  const slowest = Math.max(...times);
  const fastest = Math.min(...times);
  const spread = slowest - fastest;

  const first = results[0];
  const last = results[results.length - 1];
  const totalGain = first.timeSeconds - last.timeSeconds; // > 0 = стал быстрее

  const race = results[selected];
  const prev = selected > 0 ? results[selected - 1] : null;
  const delta = prev ? race.timeSeconds - prev.timeSeconds : 0;
  const outrun = Math.round((1 - race.place / race.placeTotal) * 100);

  return (
    <motion.main
      className="screen screen--tabbar an"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header onBack={onBack} />

      {/* Сводка */}
      <section className="an-chips">
        <div className="an-chip">
          <span className="an-chip__label">Забегов:</span>
          <span className="an-chip__value u-display">
            {done} <small>из {seasonTotal}</small>
          </span>
        </div>
        <div className="an-chip">
          <span className="an-chip__label">Всего:</span>
          <span className="an-chip__value u-display">
            {totalKm} <small>км</small>
          </span>
        </div>
        <div className="an-chip an-chip--record">
          <span className="an-chip__label">Рекорд:</span>
          <span className="an-chip__value u-display num">{personalBest.time}</span>
        </div>
      </section>

      {/* Динамика времени */}
      <section className="hero-card an-chart">
        <h3 className="an-chart__title">Динамика времени</h3>

        <div className="an-chart__cols">
          {results.map((r, i) => {
            const norm = spread === 0 ? 0.5 : (slowest - r.timeSeconds) / spread;
            return (
              <div className="an-chart__col" key={`${r.title}-${r.date}`}>
                <span className="an-chart__spacer" style={{ height: `${norm * 48}%` }} />
                <span
                  className={`an-chart__pill num${i === selected ? ' an-chart__pill--on' : ''}`}
                >
                  {r.time}
                </span>
                <span className="an-chart__line" aria-hidden="true" />
                <span className="an-chart__date">{shortDate(r.date)}</span>
              </div>
            );
          })}
        </div>

        {totalGain !== 0 && (
          <div className={`an-gain${totalGain > 0 ? ' an-gain--up' : ' an-gain--down'}`}>
            {totalGain > 0 ? (
              <TrendingUp size={18} strokeWidth={2.4} />
            ) : (
              <TrendingDown size={18} strokeWidth={2.4} />
            )}
            {totalGain > 0 ? 'Минус' : 'Плюс'} {mmss(Math.abs(totalGain))} с первого старта
          </div>
        )}
      </section>

      {/* Разбор выбранного забега */}
      <p className="an-section-label">По забегам</p>

      <article className="glass-card an-detail">
        <h3 className="an-detail__title u-display">{race.title}</h3>
        <p className="an-detail__meta">
          {race.date}
          <span className="dot">•</span>
          {race.weather}
        </p>

        <div className="an-detail__stats">
          <span className="an-stat">
            <span className="an-stat__label">Время:</span>
            <span className="an-stat__value num">{race.time}</span>
          </span>
          <span className="an-stat">
            <span className="an-stat__label">Темп</span>
            <span className="an-stat__value num">{pace(race.timeSeconds, race.distanceKm)}</span>
          </span>
          <span className="an-stat">
            <span className="an-stat__label">Скорость</span>
            <span className="an-stat__value num">
              {speed(race.timeSeconds, race.distanceKm)} <small>км/ч</small>
            </span>
          </span>
        </div>

        <div className="an-rows">
          <div className="an-row">
            <span>Место в абсолюте</span>
            <span className="an-row__value">
              <b className="num">{race.place}</b> из {race.placeTotal}
            </span>
          </div>
          <div className="an-row">
            {/* В макете «Среди мужчин», но пола бэкенд не хранит — формулировка нейтральная. */}
            <span>В своём зачёте</span>
            <span className="an-row__value">
              <b className="num">{race.genderPlace}</b> из {race.genderTotal}
            </span>
          </div>
          <div className="an-row">
            <span>Обошёл участников</span>
            <span className="an-row__value">
              <b className="num">{outrun}%</b>
            </span>
          </div>
          <div className="an-row">
            <span>К прошлому забегу</span>
            {prev ? (
              <span className={`an-row__value ${delta < 0 ? 'is-up' : 'is-down'}`}>
                {delta < 0 ? 'быстрее' : 'медленнее'} на {mmss(Math.abs(delta))}
              </span>
            ) : (
              <span className="an-row__value an-row__value--muted">первый старт</span>
            )}
          </div>
        </div>
      </article>

      {/* Все забеги — тап переключает разбор выше */}
      <section className="an-list">
        {[...results]
          .map((r, i) => ({ r, i }))
          .reverse()
          .map(({ r, i }) => (
            <button
              type="button"
              key={`${r.title}-${r.date}`}
              className={`glass-card an-item${i === selected ? ' an-item--on' : ''}`}
              aria-pressed={i === selected}
              onClick={() => setSelected(i)}
            >
              <span className="an-item__main">
                <span className="an-item__title u-display">{r.title}</span>
                <span className="an-item__date">{r.date}</span>
              </span>
              <span className="an-item__result">
                <span className="an-item__time num">{r.time}</span>
                <span className="an-item__place">{r.place} место</span>
              </span>
              <ChevronRight size={22} strokeWidth={2} />
            </button>
          ))}
      </section>
    </motion.main>
  );
}

export default AnalyticsScreen;
