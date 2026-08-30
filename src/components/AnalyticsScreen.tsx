import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  ChevronRight,
  LineChart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Header from './Header';
import { mmss, personalBestOf, type RaceResult } from '../data/results';
import { useSeasonProgress } from '../hooks/useSeasonProgress';

type Props = {
  /** Пройденные старты с внесённым результатом, от старых к новым. */
  results: RaceResult[];
  onBack: () => void;
  onViewRaces: () => void;
};

// Темп в минутах на километр.
function pace(timeSeconds: number, km: number): string {
  return `${mmss(Math.round(timeSeconds / km))}/КМ`;
}

// Средняя скорость, км/ч.
function speed(timeSeconds: number, km: number): string {
  return (km / (timeSeconds / 3600)).toFixed(1);
}

function AnalyticsScreen({ results, onBack, onViewRaces }: Props) {
  const reduceMotion = useReducedMotion();
  // Разбор показываем по выбранному забегу. null — «ещё не выбирали»: тогда
  // берём последний. Индекс по умолчанию считать нельзя, список приходит с API.
  const [picked, setPicked] = useState<number | null>(null);
  const { done, total: seasonTotal } = useSeasonProgress(results);

  if (results.length === 0) {
    return (
      <motion.main
        className="screen screen--tabbar an"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Header onBack={onBack} />
        <div className="glass-card empty">
          <LineChart className="empty__icon" size={44} strokeWidth={1.6} />
          <p className="empty__text">
            Здесь появится статистика, когда организатор внесёт результаты
            вашего первого старта
          </p>
          <button type="button" className="btn-register" onClick={onViewRaces}>
            Посмотреть старты
            <ArrowRight size={18} strokeWidth={2.4} />
          </button>
        </div>
      </motion.main>
    );
  }

  const selected = Math.min(picked ?? results.length - 1, results.length - 1);

  // Километраж — только по забегам, чью дистанцию удалось разобрать.
  const totalKm = results.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0);
  const personalBest = personalBestOf(results);

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
  // Процент обойдённых имеет смысл только если на старте был кто-то ещё.
  const outrun =
    race.placeTotal > 1 ? Math.round((1 - race.place / race.placeTotal) * 100) : null;

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
            {Number(totalKm.toFixed(1))} <small>км</small>
          </span>
        </div>
        <div className="an-chip an-chip--record">
          <span className="an-chip__label">Рекорд:</span>
          <span className="an-chip__value u-display num">{personalBest?.time}</span>
        </div>
      </section>

      {/* Динамика времени */}
      <section className="hero-card an-chart">
        <h3 className="an-chart__title">Динамика времени</h3>

        <div className="an-chart__cols">
          {results.map((r, i) => {
            const norm = spread === 0 ? 0.5 : (slowest - r.timeSeconds) / spread;
            return (
              <div className="an-chart__col" key={r.eventId}>
                <span className="an-chart__spacer" style={{ height: `${norm * 48}%` }} />
                <span
                  className={`an-chart__pill num${i === selected ? ' an-chart__pill--on' : ''}`}
                >
                  {r.time}
                </span>
                <span className="an-chart__line" aria-hidden="true" />
                <span className="an-chart__date">{r.shortDate}</span>
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
        {/* В макете к дате шла погода на старте, но её бэкенд не хранит —
            см. комментарий в src/data/results.ts. */}
        <p className="an-detail__meta">
          {race.date}
          <span className="dot">•</span>
          {race.distance}
        </p>

        <div className="an-detail__stats">
          <span className="an-stat">
            <span className="an-stat__label">Время:</span>
            <span className="an-stat__value num">{race.time}</span>
          </span>
          {/* Темп и скорость — только когда дистанция старта разобралась в число. */}
          {race.distanceKm !== null && (
            <>
              <span className="an-stat">
                <span className="an-stat__label">Темп</span>
                <span className="an-stat__value num">
                  {pace(race.timeSeconds, race.distanceKm)}
                </span>
              </span>
              <span className="an-stat">
                <span className="an-stat__label">Скорость</span>
                <span className="an-stat__value num">
                  {speed(race.timeSeconds, race.distanceKm)} <small>км/ч</small>
                </span>
              </span>
            </>
          )}
        </div>

        <div className="an-rows">
          <div className="an-row">
            <span>Место в абсолюте</span>
            <span className="an-row__value">
              <b className="num">{race.place}</b> из {race.placeTotal}
            </span>
          </div>
          {/* Строки «Среди мужчин» из макета нет: пола участника бэкенд не хранит. */}
          {outrun !== null && (
            <div className="an-row">
              <span>Обошёл участников</span>
              <span className="an-row__value">
                <b className="num">{outrun}%</b>
              </span>
            </div>
          )}
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
              key={r.eventId}
              className={`glass-card an-item${i === selected ? ' an-item--on' : ''}`}
              aria-pressed={i === selected}
              onClick={() => setPicked(i)}
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
