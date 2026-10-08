import { motion, useReducedMotion } from 'framer-motion';
import type { EventDto } from '../lib/api';
import FitTitle from './FitTitle';

type Props = {
  event: EventDto;
  onSelect: () => void;
};

const TZ = 'Asia/Almaty';
const dateShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const priceFmt = new Intl.NumberFormat('ru-RU');

function RaceListItem({ event, onSelect }: Props) {
  const reduceMotion = useReducedMotion();
  const date = new Date(event.date);

  return (
    <motion.button
      type="button"
      className="race-item"
      onClick={onSelect}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
    >
      <FitTitle as="h3" className="race-item__title u-display">
        {event.title}
      </FitTitle>
      <div className="race-item__meta">
        <span>{dateShort.format(date)}</span>
        <span className="dot">•</span>
        <span>{event.distance}</span>
        <span className="dot">•</span>
        <span>{timeFmt.format(date)}</span>
        <span className="dot">•</span>
        <span>{priceFmt.format(event.price)}₸</span>
      </div>
    </motion.button>
  );
}

export default RaceListItem;
