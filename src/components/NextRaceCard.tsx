import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Map } from 'lucide-react';
import {
  apiAsset,
  type EventDto,
  REGISTRATION_CLOSED_TEXT,
  REGISTRATION_ENDED_TEXT,
  registrationState,
} from '../lib/api';

type Props = {
  event: EventDto;
  onRegister: () => void;
  registrationOpenForMe: boolean;
};

type Countdown = { days: number; started: boolean };

function getCountdown(target: Date): Countdown {
  const diff = target.getTime() - Date.now();
  return { days: diff <= 0 ? 0 : Math.floor(diff / 86_400_000), started: diff <= 0 };
}

// «День до старта» с русским склонением.
function pluralDays(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

function useCountdown(target: Date): Countdown {
  const [state, setState] = useState<Countdown>(() => getCountdown(target));
  useEffect(() => {
    const id = setInterval(() => setState(getCountdown(target)), 60_000);
    return () => clearInterval(id);
  }, [target]);
  return state;
}

// Форматирование в часовом поясе Астаны (UTC+5) независимо от локали устройства.
const TZ = 'Asia/Almaty';
const dateShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const priceFmt = new Intl.NumberFormat('ru-RU');

function NextRaceCard({ event, onRegister, registrationOpenForMe }: Props) {
  const target = useMemo(() => new Date(event.date), [event.date]);
  const { days, started } = useCountdown(target);
  const reduceMotion = useReducedMotion();
  const [showRoute, setShowRoute] = useState(false);

  const soldOut = event.slotsLeft <= 0;
  const state = registrationState(event, registrationOpenForMe);
  const closed = state !== 'open';
  // Карту загружает организатор в админке; у стартов без неё показываем
  // плейсхолдер, а не чужой маршрут.
  const routeSrc = event.routeImageUrl ? apiAsset(event.routeImageUrl) : null;

  return (
    <motion.section
      className="hero-card hero"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
    >
      <span className="hero__eyebrow">Ближайший старт</span>
      <h2 className="hero__title u-display">{event.title}</h2>

      <div className="hero__meta">
        <span>{dateShort.format(target)}</span>
        <span className="dot">•</span>
        <span>{event.distance}</span>
        <span className="dot">•</span>
        <span>{timeFmt.format(target)}</span>
        <span className="dot">•</span>
        <span>{priceFmt.format(event.price)}₸</span>
      </div>

      {!started ? (
        <div className="hero__countdown">
          <span className="hero__count-num">{days}</span>
          <span className="hero__count-cap">
            {pluralDays(days)}
            <br />
            до старта
          </span>
        </div>
      ) : (
        <div className="hero__countdown">
          <span className="hero__count-cap">Старт уже идёт</span>
        </div>
      )}

      {showRoute && (
        <motion.div
          className="hero__map"
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {routeSrc ? (
            <img
              className="hero__map-img"
              src={routeSrc}
              alt={`Схема трассы: ${event.distance} — ${event.title}`}
              // Карта раскрывается по тапу, так что к моменту показа её ещё нет в кэше —
              // грузим сразу, а не лениво, иначе видно пустой блок.
              decoding="async"
              draggable={false}
            />
          ) : (
            <div className="hero__map-stub">
              <Map size={26} strokeWidth={1.8} />
              Карта трассы появится здесь
            </div>
          )}
        </motion.div>
      )}

      {!showRoute ? (
        <motion.button
          type="button"
          className="btn-register"
          onClick={() => setShowRoute(true)}
          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
        >
          Посмотреть трассу
        </motion.button>
      ) : (
        <motion.button
          type="button"
          className="btn-register"
          onClick={onRegister}
          disabled={soldOut || closed}
          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
        >
          {state === 'ended'
            ? REGISTRATION_ENDED_TEXT
            : state === 'soon'
              ? REGISTRATION_CLOSED_TEXT
              : soldOut
                ? 'Мест нет'
                : 'Зарегистрироваться'}
        </motion.button>
      )}
    </motion.section>
  );
}

export default NextRaceCard;
