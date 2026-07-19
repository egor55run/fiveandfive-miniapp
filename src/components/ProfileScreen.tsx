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
        <CalendarX2 className="empty__icon" size={48} strokeWidth={1.6} />
        <p className="empty__text">
          Вы ещё не зарегистрированы ни на один старт
        </p>
        <button type="button" className="btn-register" onClick={onViewRaces}>
          Посмотреть старты
          <ArrowRight size={20} strokeWidth={2.6} />
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

function ResultsTab() {
  const history = [...results].reverse(); // новые сверху
  const percentLabel = progress.percent.toFixed(1).replace('.', ',');
  const TrendIcon = progress.improved ? TrendingUp : TrendingDown;

  return (
    <div className="results">
      <div className="card pr">
        <div className="pr__record">
          <span className="pr__record-icon" aria-hidden="true">
            <Trophy size={22} strokeWidth={2.2} />
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
            <TrendIcon size={22} strokeWidth={2.4} />
          </span>
          <span className="pr__progress-text">
            <span className="pr__progress-value">
              {progress.improved ? '−' : '+'}
              {progress.absSeconds} сек
            </span>{' '}
            ({percentLabel}%) к предыдущему старту
          </span>
        </div>
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
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
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
                      : { type: 'spring', stiffness: 420, damping: 34 }
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
          initial={reduceMotion ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
          transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
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
