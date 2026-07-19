import { motion } from 'framer-motion';
import { CheckCircle2, Share2, Home } from 'lucide-react';
import { RACE } from '../data/race';
import type { Participant } from './RegistrationScreen';

type Props = {
  participant: Participant;
  onBackHome: () => void;
};

function RegistrationSuccessScreen({ participant, onBackHome }: Props) {
  const fullName = `${participant.firstName} ${participant.lastName}`.trim();

  return (
    <motion.main
      className="screen"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="success">
        <motion.span
          className="success__icon"
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
        >
          <CheckCircle2 size={72} strokeWidth={2} />
        </motion.span>
        <h2 className="success__title">Вы зарегистрированы!</h2>
        <p className="success__subtitle">
          Детали отправили на {participant.email}
        </p>
      </div>

      <div className="card ticket">
        <span className="race__eyebrow">
          <span className="race__pulse" aria-hidden="true" />
          Участник
        </span>
        <h3 className="ticket__name">{fullName}</h3>
        <div className="ticket__rows">
          <div className="ticket__row">
            <span>Старт</span>
            <strong>{RACE.title}</strong>
          </div>
          <div className="ticket__row">
            <span>Дистанция</span>
            <strong>{RACE.distance}</strong>
          </div>
          <div className="ticket__row">
            <span>Дата</span>
            <strong>
              {RACE.dateLabel}, {RACE.timeLabel}
            </strong>
          </div>
        </div>
      </div>

      <div className="success__actions">
        <motion.button
          type="button"
          className="btn-register"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <Share2 size={20} strokeWidth={2.4} />
          Поделиться
        </motion.button>

        <button type="button" className="btn-secondary" onClick={onBackHome}>
          <Home size={18} strokeWidth={2.2} />
          Вернуться на главный экран
        </button>
      </div>
    </motion.main>
  );
}

export default RegistrationSuccessScreen;
