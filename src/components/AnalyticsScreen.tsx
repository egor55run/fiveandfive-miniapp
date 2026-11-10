import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronRight, LineChart, TrendingDown, TrendingUp } from 'lucide-react';
import Header from './Header';
import { mmss, personalBestOf, type RaceResult } from '../data/results';
import type { Compare, CompareByGroup, DistanceStatDto } from '../lib/api';
import { useSeasonProgress } from '../hooks/useSeasonProgress';
import FitTitle from './FitTitle';

/**
 * Аналитика (2026-11-11). «Мои забеги» — по дистанциям: переключатель только
 * из тех, что человек бежал (одна — без переключателя), забеги, личный рекорд,
 * график — от двух забегов на дистанции. Время разных дистанций не сравниваем.
 * «Общий» — сравнение с другими: на каждом забеге и за всё время на стартах
 * 5&5, среди всех / мужчин / женщин. Только финиши; чужих имён нет — проценты.
 */

type Props = {
  /** Пройденные старты с внесённым результатом, от старых к новым. */
  results: RaceResult[];
  /** По каждой дистанции: рекорд и сравнение за всё время (GET /me). */
  distanceStats: DistanceStatDto[];
  onBack: () => void;
  onViewRaces: () => void;
};

type Group = keyof CompareByGroup;
const GROUPS: { id: Group; label: string; whom: string }[] = [
  { id: 'all', label: 'Все', whom: '' },
  { id: 'MALE', label: 'Мужчины', whom: 'мужчин' },
  { id: 'FEMALE', label: 'Женщины', whom: 'женщин' },
];

const nf = new Intl.NumberFormat('ru-RU');

function pace(timeSeconds: number, km: number): string {
  return `${mmss(Math.round(timeSeconds / km))}/КМ`;
}

function speed(timeSeconds: number, km: number): string {
  return (km / (timeSeconds / 3600)).toFixed(1);
}

/** «Быстрее 87% … из 1 240»; сравнивать не с кем — null. */
function percent(c: Compare): number | null {
  return c.others > 0 ? Math.round((c.slower / c.others) * 100) : null;
}

function CompareLine({ c, what, whom }: { c: Compare; what: string; whom: string }) {
  const p = percent(c);
  if (p === null) return <p className="an-cmp__none">Пока сравнить не с кем{whom ? ` среди ${whom}` : ''}.</p>;
  return (
    <p className="an-cmp__line">
      Быстрее <b className="num">{p}%</b> {whom ? `${whom} ` : ''}
      {what} <span className="an-cmp__of">из {nf.format(c.others)}</span>
    </p>
  );
}

function AnalyticsScreen({ results, distanceStats, onBack, onViewRaces }: Props) {
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState<'mine' | 'compare'>('mine');
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [group, setGroup] = useState<Group>('all');
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
            Здесь появится статистика, когда организатор внесёт результаты вашего первого старта
          </p>
          <button type="button" className="btn-register" onClick={onViewRaces}>
            Посмотреть старты
            <ArrowRight size={18} strokeWidth={2.4} />
          </button>
        </div>
      </motion.main>
    );
  }

  // Дистанции, которые человек бежал, — в порядке первого забега на каждой.
  const keys = [...new Set(results.map((r) => r.distanceKey))];
  const key = pickedKey && keys.includes(pickedKey) ? pickedKey : keys[keys.length > 1 ? keys.length - 1 : 0];
  const runs = results.filter((r) => r.distanceKey === key);
  const selected = Math.min(picked ?? runs.length - 1, runs.length - 1);
  const race = runs[selected];
  const prev = selected > 0 ? runs[selected - 1] : null;
  const delta = prev ? race.timeSeconds - prev.timeSeconds : 0;
  const best = personalBestOf(runs);

  const times = runs.map((r) => r.timeSeconds);
  const slowest = Math.max(...times);
  const spread = slowest - Math.min(...times);
  const totalGain = runs[0].timeSeconds - runs[runs.length - 1].timeSeconds; // > 0 — стал быстрее
  const totalKm = results.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0);
  const whom = GROUPS.find((g) => g.id === group)!.whom;

  return (
    <motion.main
      className="screen screen--tabbar an"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header onBack={onBack} />

      <section className="an-chips an-chips--two">
        <div className="an-chip">
          <span className="an-chip__label">Этапов серии:</span>
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
      </section>

      <div className="rt-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'mine'} className={`rt-tab${view === 'mine' ? ' rt-tab--on' : ''}`} onClick={() => setView('mine')}>
          Мои забеги
        </button>
        <button type="button" role="tab" aria-selected={view === 'compare'} className={`rt-tab${view === 'compare' ? ' rt-tab--on' : ''}`} onClick={() => setView('compare')}>
          Общий
        </button>
      </div>

      {view === 'mine' ? (
        <>
          {/* Переключатель — только из пробеганных дистанций и только если их больше одной. */}
          {keys.length > 1 && (
            <div className="an-dist" role="tablist" aria-label="Дистанция">
              {keys.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={k === key}
                  className={`an-dist__btn${k === key ? ' an-dist__btn--on' : ''}`}
                  onClick={() => {
                    setPickedKey(k);
                    setPicked(null);
                  }}
                >
                  {results.find((r) => r.distanceKey === k)!.distance}
                </button>
              ))}
            </div>
          )}

          <section className="an-chips an-chips--two">
            <div className="an-chip an-chip--record">
              <span className="an-chip__label">Рекорд на {race.distance}:</span>
              <span className="an-chip__value u-display num">{best?.time}</span>
            </div>
            <div className="an-chip">
              <span className="an-chip__label">Забегов на {race.distance}:</span>
              <span className="an-chip__value u-display">{runs.length}</span>
            </div>
          </section>

          {/* Динамика — только если на этой дистанции два забега и больше. */}
          {runs.length >= 2 && (
            <section className="hero-card an-chart">
              <h3 className="an-chart__title">Динамика времени · {race.distance}</h3>
              <div className="an-chart__cols">
                {runs.map((r, i) => {
                  const norm = spread === 0 ? 0.5 : (slowest - r.timeSeconds) / spread;
                  return (
                    <div className="an-chart__col" key={r.eventId}>
                      <span className="an-chart__spacer" style={{ height: `${norm * 48}%` }} />
                      <span className={`an-chart__pill num${i === selected ? ' an-chart__pill--on' : ''}`}>{r.time}</span>
                      <span className="an-chart__line" aria-hidden="true" />
                      <span className="an-chart__date">{r.shortDate}</span>
                    </div>
                  );
                })}
              </div>
              {totalGain !== 0 && (
                <div className={`an-gain${totalGain > 0 ? ' an-gain--up' : ' an-gain--down'}`}>
                  {totalGain > 0 ? <TrendingUp size={18} strokeWidth={2.4} /> : <TrendingDown size={18} strokeWidth={2.4} />}
                  {totalGain > 0 ? 'Минус' : 'Плюс'} {mmss(Math.abs(totalGain))} с первого забега на {race.distance}
                </div>
              )}
            </section>
          )}

          <article className="glass-card an-detail">
            <FitTitle as="h3" className="an-detail__title u-display">
              {race.title}
            </FitTitle>
            <p className="an-detail__meta">
              {race.date}
              <span className="dot">•</span>
              {race.distance}
              <span className="dot">•</span>
              {race.location}
            </p>
            <div className="an-detail__stats">
              <span className="an-stat">
                <span className="an-stat__label">Время:</span>
                <span className="an-stat__value num">{race.time}</span>
              </span>
              {race.distanceKm !== null && (
                <>
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
                </>
              )}
            </div>
            <div className="an-rows">
              <div className="an-row">
                <span>Место на {race.distance}</span>
                <span className="an-row__value">
                  <b className="num">{race.place}</b> из {race.placeTotal}
                </span>
              </div>
              <div className="an-row">
                <span>К прошлому забегу на {race.distance}</span>
                {prev ? (
                  <span className={`an-row__value ${delta < 0 ? 'is-up' : 'is-down'}`}>
                    {delta < 0 ? 'быстрее' : 'медленнее'} на {mmss(Math.abs(delta))}
                  </span>
                ) : (
                  <span className="an-row__value an-row__value--muted">первый забег</span>
                )}
              </div>
            </div>
          </article>

          <section className="an-list">
            {[...runs]
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
                    <FitTitle as="span" className="an-item__title u-display">
                      {r.title}
                    </FitTitle>
                    <span className="an-item__date">
                      {r.date} · {r.location}
                    </span>
                  </span>
                  <span className="an-item__result">
                    <span className="an-item__time num">{r.time}</span>
                    <span className="an-item__place">{r.place} место</span>
                  </span>
                  <ChevronRight size={22} strokeWidth={2} />
                </button>
              ))}
          </section>
        </>
      ) : (
        <>
          <div className="an-dist" role="tablist" aria-label="С кем сравнивать">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={g.id === group}
                className={`an-dist__btn${g.id === group ? ' an-dist__btn--on' : ''}`}
                onClick={() => setGroup(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>

          <p className="an-section-label">За всё время на стартах 5&amp;5</p>
          {distanceStats.map((d) => (
            <article key={d.key} className="glass-card an-cmp">
              <h3 className="an-cmp__title">
                {d.label} <span className="an-cmp__best num">рекорд {mmss(d.best)}</span>
              </h3>
              <CompareLine c={d.compare[group]} what={`всех, кто бежал ${d.label} на стартах 5&5`} whom={whom} />
            </article>
          ))}

          <p className="an-section-label">По забегам</p>
          {[...results].reverse().map((r) => (
            <article key={r.eventId} className="glass-card an-cmp">
              <h3 className="an-cmp__title">
                {r.title} <span className="an-cmp__best">{r.date} · {r.distance} · {r.time}</span>
              </h3>
              {r.compare ? (
                <CompareLine c={r.compare[group]} what={`участников этого забега на ${r.distance}`} whom={whom} />
              ) : (
                <p className="an-cmp__none">Сравнение появится после обновления данных.</p>
              )}
            </article>
          ))}
          <p className="an-cmp__note">В сравнении — только финишировавшие. Имён других участников здесь нет.</p>
        </>
      )}
    </motion.main>
  );
}

export default AnalyticsScreen;
