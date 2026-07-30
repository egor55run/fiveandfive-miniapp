import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Share2, Home } from 'lucide-react';
import type { EventDto, UserDto } from '../lib/api';

type Props = {
  user: UserDto;
  events: EventDto[]; // один старт — одиночная регистрация; несколько — абонемент
  seasonPass: boolean;
  onBackHome: () => void;
};

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Almaty',
});
const dateShort = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Almaty',
});

function RegistrationSuccessScreen({ user, events, seasonPass, onBackHome }: Props) {
  const reduceMotion = useReducedMotion();
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const single = events[0];

  return (
    <motion.main
      className="screen"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="success">
        <motion.span
          className="success__icon"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          <CheckCircle2 size={64} strokeWidth={2} />
        </motion.span>
        <h2 className="success__title">
          {seasonPass ? 'Вы в сезоне 5&5' : 'Вы зарегистрированы'}
        </h2>
        <p className="success__subtitle">
          {seasonPass
            ? `Записали на все ${events.length} стартов сезона. Детали — на ${user.email}`
            : `Детали отправили на ${user.email}`}
        </p>
      </div>

      <div className="card ticket">
        <span className="race__eyebrow">
          {seasonPass ? 'Абонемент 5&5' : 'Участник'}
        </span>
        <h3 className="ticket__name">{fullName}</h3>

        {seasonPass ? (
          <div className="ticket__rows">
            {events.map((e) => (
              <div className="ticket__row" key={e.id}>
                <span>{dateShort.format(new Date(e.date))}</span>
                <strong>{e.title}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="ticket__rows">
            <div className="ticket__row">
              <span>Старт</span>
              <strong>{single.title}</strong>
            </div>
            <div className="ticket__row">
              <span>Дистанция</span>
              <strong>{single.distance}</strong>
            </div>
            <div className="ticket__row">
              <span>Дата</span>
              <strong>{dateTimeFmt.format(new Date(single.date))}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="success__actions">
        <motion.button
          type="button"
          className="btn-register"
          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          <Share2 size={18} strokeWidth={2.4} />
          Поделиться
        </motion.button>

        <button type="button" className="btn-secondary" onClick={onBackHome}>
          <Home size={17} strokeWidth={2.2} />
          Вернуться на главный экран
        </button>
      </div>
    </motion.main>
  );
}

export default RegistrationSuccessScreen;
