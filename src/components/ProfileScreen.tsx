import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Trophy, TrendingUp, TrendingDown, CalendarX2, ArrowRight } from 'lucide-react';
import type { Participant } from './RegistrationScreen';
import { results, personalBest, progress } from '../data/results';

type Props = {
  participant: Participant | null;
  onViewRaces: () => void;
};

type SubTab = 'profile' | 'results';

const SUBTABS = [
  { id: 'profile', label: 'Профиль' },
  { id: 'results', label: 'Результаты' },
] as const;

function ProfileTab({
  participant,
  onViewRaces,
}: {
  participant: Participant | null;
  onViewRaces: () => void;
}) {
  if (!participant) {
    return (
      <div className="card empty">
        <CalendarX2 className="empty__icon" size={44} strokeWidth={1.6} />
        <p className="empty__text">
          Вы ещё не зарегистрированы ни на один старт
        </p>
        <button type="button" className="btn-register" onClick={onViewRaces}>
          Посмотреть старты
          <ArrowRight size={18} strokeWidth={2.4} />
        </button>
      </div>
    );
  }

  const fullName = `${participant.firstName} ${participant.lastName}`.trim();
  const rows = [
    { label: 'Имя', value: participant.firstName },
    { label: 'Фамилия', value: participant.lastName },
    { label: 'Email', value: participant.email },
    { label: 'Возраст', value: `${participant.age} лет` },
    { label: 'Телефон', value: participant.phone },
  ];

  return (
    <div className="card ticket">
      <span className="race__eyebrow">
        <span className="race__pulse" aria-hidden="true" />
        Мои данные
      </span>
      <h3 className="ticket__name">{fullName}</h3>
      <div className="ticket__rows">
        {rows.map((row) => (
          <div className="ticket__row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// Спарклайн истории финишного времени. Меньше время = выше точка.
function Sparkline() {
  const W = 100;
  const H = 30;
  const padX = 3;
  const padY = 4;
  const times = results.map((r) => r.timeSeconds);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const n = results.length;

  const points = results.map((race, i) => {
    const x = n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2);
    const norm = max === min ? 0.5 : (race.timeSeconds - min) / (max - min);
    const y = padY + norm * (H - padY * 2);
    return { x, y, best: race.timeSeconds === min };
  });

  const lineD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaD =
    `M ${points[0].x.toFixed(1)} ${H} ` +
    points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
    ` L ${points[n - 1].x.toFixed(1)} ${H} Z`;

  return (
    <div className="pr__chart">
      <div className="pr__chart-head">
        <span>Финишное время · 5 км</span>
        <span>{n} стартов</span>
      </div>
      <div
        className="sparkline"
        role="img"
        aria-label="История финишного времени: улучшается от старта к старту"
      >
        <svg
          className="sparkline__svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          <path className="sparkline__area" d={areaD} />
          <path className="sparkline__line" d={lineD} />
        </svg>
        {points.map((p, i) => (
          <span
            key={results[i].date}
            className={`sparkline__dot${p.best ? ' sparkline__dot--best' : ''}`}
            style={{ left: `${p.x}%`, top: `${(p.y / H) * 100}%` }}
          />
        ))}
      </div>
      <div className="pr__chart-head" style={{ margin: '10px 0 0' }}>
        <span>{results[0].date}</span>
        <span>{results[n - 1].date}</span>
      </div>
    </div>
  );
}

function ResultsTab() {
  const history = [...results].reverse(); // новые сверху
  const percentLabel = progress.percent.toFixed(1).replace('.', ',');
  const TrendIcon = progress.improved ? TrendingUp : TrendingDown;

  return (
    <div className="results">
      <div className="card pr">
        <div className="pr__record">
          <span className="pr__record-icon" aria-hidden="true">
            <Trophy size={20} strokeWidth={2.2} />
          </span>
          <span className="pr__record-text">
            <span className="pr__label">Личный рекорд</span>
            <span className="pr__value">
              {personalBest.time}
              <small>{personalBest.distance}</small>
            </span>
          </span>
        </div>

        <div className={`pr__progress ${progress.improved ? 'is-up' : 'is-down'}`}>
          <span className="pr__progress-icon" aria-hidden="true">
            <TrendIcon size={20} strokeWidth={2.4} />
          </span>
          <span className="pr__progress-text">
            <span className="pr__progress-value">
              {progress.improved ? '−' : '+'}
              {progress.absSeconds} сек
            </span>{' '}
            ({percentLabel}%) к предыдущему старту
          </span>
        </div>

        <Sparkline />
      </div>

      <div className="results-list">
        {history.map((race) => (
          <div className="result-card" key={`${race.title}-${race.date}`}>
            <div className="result-card__head">
              <h4 className="result-card__title">{race.title}</h4>
              <span className="result-card__date">{race.date}</span>
            </div>
            <div className="result-card__stats">
              <span className="result-stat">
                <span className="result-stat__label">Дистанция</span>
                <span className="result-stat__value">{race.distance}</span>
              </span>
              <span className="result-stat">
                <span className="result-stat__label">Время</span>
                <span className="result-stat__value">{race.time}</span>
              </span>
              <span className="result-stat">
                <span className="result-stat__label">Место</span>
                <span className="result-stat__value">#{race.place}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileScreen({ participant, onViewRaces }: Props) {
  const [tab, setTab] = useState<SubTab>('profile');
  const reduceMotion = useReducedMotion();

  return (
    <motion.main
      className="screen screen--tabbar"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <h2 className="screen__title">Профиль</h2>

      <div className="segmented" role="tablist">
        {SUBTABS.map((item) => {
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`segmented__btn${isActive ? ' segmented__btn--active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {isActive && (
                <motion.span
                  className="segmented__pill"
                  layoutId="subtab-pill"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
                  }
                />
              )}
              <span className="segmented__label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {tab === 'profile' ? (
            <ProfileTab participant={participant} onViewRaces={onViewRaces} />
          ) : (
            <ResultsTab />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.main>
  );
}

export default ProfileScreen;
