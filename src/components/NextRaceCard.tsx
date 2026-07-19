import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Calendar, Clock, Route, Users, ArrowRight } from 'lucide-react';
import { RACE, RACE_DATE } from '../data/race';

type Props = {
  onRegister: () => void;
};

type TimeLeft = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
};

function getTimeLeft(target: Date): TimeLeft {
  const diff = target.getTime() - Date.now();
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  }
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1000),
    done: false,
  };
}

function useCountdown(target: Date): TimeLeft {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => getTimeLeft(target));

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(getTimeLeft(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  return timeLeft;
}

const pad = (n: number) => n.toString().padStart(2, '0');

function NextRaceCard({ onRegister }: Props) {
  const { days, hours, minutes, seconds, done } = useCountdown(RACE_DATE);
  const reduceMotion = useReducedMotion();

  const blocks = [
    { key: 'd', value: String(days), label: 'дней' },
    { key: 'h', value: pad(hours), label: 'часов' },
    { key: 'm', value: pad(minutes), label: 'минут' },
    { key: 's', value: pad(seconds), label: 'секунд' },
  ];

  const meta = [
    { icon: Calendar, label: 'Дата', value: RACE.dateLabel },
    { icon: Clock, label: 'Старт', value: RACE.timeLabel },
    { icon: Route, label: 'Дистанция', value: RACE.distance },
    { icon: Users, label: 'Лимит', value: `${RACE.slots} слотов` },
  ];

  return (
    <motion.section
      className="card race"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
    >
      <span className="race__eyebrow">
        <span className="race__pulse" aria-hidden="true" />
        Ближайший старт
      </span>

      <h2 className="race__title">{RACE.title}</h2>

      <div className="race__meta">
        {meta.map(({ icon: Icon, label, value }) => (
          <div className="race__meta-item" key={label}>
            <Icon className="race__meta-icon" size={20} strokeWidth={2.2} />
            <div className="race__meta-text">
              <span className="race__meta-label">{label}</span>
              <span className="race__meta-value">{value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="countdown">
        <span className="countdown__caption">
          {done ? 'Старт уже идёт!' : 'До старта осталось'}
        </span>
        <div className="countdown__grid">
          {blocks.map((block) => (
            <div className="countdown__block" key={block.key}>
              <motion.span
                className="countdown__value"
                // Лёгкий "тик" при смене значения (кроме reduced-motion)
                key={reduceMotion ? undefined : `${block.key}-${block.value}`}
                initial={reduceMotion ? false : { y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                {block.value}
              </motion.span>
              <span className="countdown__label">{block.label}</span>
            </div>
          ))}
        </div>
      </div>

      <motion.button
        type="button"
        className="btn-register"
        onClick={onRegister}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        Зарегистрироваться
        <ArrowRight size={20} strokeWidth={2.6} />
      </motion.button>
    </motion.section>
  );
}

export default NextRaceCard;
