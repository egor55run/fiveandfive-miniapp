import { motion, useReducedMotion } from 'framer-motion';
import { priceShort } from '../lib/prices';
import type { EventDto } from '../lib/api';
import FitTitle from './FitTitle';
import { raceTheme } from '../lib/raceTheme';

type Props = {
  event: EventDto;
  onSelect: () => void;
};

const TZ = 'Asia/Almaty';
const dateShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

function RaceListItem({ event, onSelect }: Props) {
  const reduceMotion = useReducedMotion();
  const date = new Date(event.date);
  // Оформление старта из админки: фон, логотип, акцентный цвет.
  const theme = raceTheme(event);

  return (
    <motion.button
      type="button"
      className={`race-item${theme ? ` ${theme.className}` : ''}`}
      style={theme?.style}
      onClick={onSelect}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
    >
      {theme?.logoUrl && <img className="race-logo race-logo--sm" src={theme.logoUrl} alt="" />}
      <FitTitle as="h3" className="race-item__title u-display">
        {event.title}
      </FitTitle>
      <div className="race-item__meta">
        <span>{dateShort.format(date)}</span>
        <span className="dot">•</span>
        <span>{event.distance}</span>
        <span className="dot">•</span>
        <span>{timeFmt.format(date)}</span>
        {priceShort(event.price) && (
          <>
            <span className="dot">•</span>
            <span>{priceShort(event.price)}</span>
          </>
        )}
      </div>
    </motion.button>
  );
}

export default RaceListItem;
