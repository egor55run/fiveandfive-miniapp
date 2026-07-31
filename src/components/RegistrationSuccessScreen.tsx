import { motion, useReducedMotion } from 'framer-motion';
import { Check, Home, Share2 } from 'lucide-react';
import Header from './Header';
import type { EventDto, UserDto } from '../lib/api';

type Props = {
  user: UserDto;
  events: EventDto[]; // один старт — одиночная регистрация; несколько — абонемент
  seasonPass: boolean;
  onBackHome: () => void;
};

const TZ = 'Asia/Almaty';
const dateFull = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TZ,
});
const dateShort = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TZ,
});

function RegistrationSuccessScreen({ user, events, seasonPass, onBackHome }: Props) {
  const reduceMotion = useReducedMotion();
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const single = events[0];
  const singleDate = new Date(single.date);

  return (
    <motion.main
      className="screen su"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <Header />

      <section className="hero-card su-hero">
        <motion.span
          className="su-hero__badge"
          aria-hidden="true"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          <Check size={38} strokeWidth={2.6} />
        </motion.span>

        {/* Короткие заголовки — «ЗАРЕГИСТРИРОВАНЫ» одним словом не влезает
            в ширину карточки дисплейным шрифтом. */}
        <h2 className="su-hero__title u-display">
          {seasonPass ? 'Вы в сезоне 5&5' : 'Вы на старте'}
        </h2>

        <p className="su-hero__text">
          {seasonPass
            ? `Записали на все ${events.length} стартов сезона`
            : 'Место забронировано'}
          <br />
          Детали отправили на <b>{user.email}</b>
        </p>
      </section>

      <section className="glass-card su-card">
        <span className="su-card__eyebrow">
          {seasonPass ? 'Абонемент 5&5' : 'Участник'}
        </span>
        <h3 className="su-card__name">{fullName}</h3>

        {seasonPass ? (
          <div className="su-races">
            {events.map((e) => (
              <div className="su-race" key={e.id}>
                <span className="su-race__title u-display">{e.title}</span>
                <span className="su-race__date">{dateShort.format(new Date(e.date))}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="su-rows">
            <div className="su-row">
              <span>Старт</span>
              <b>{single.title}</b>
            </div>
            <div className="su-row">
              <span>Дата</span>
              <b>
                {dateFull.format(singleDate)}, {timeFmt.format(singleDate)}
              </b>
            </div>
            <div className="su-row">
              <span>Дистанция</span>
              <b>{single.distance}</b>
            </div>
            <div className="su-row">
              <span>Место старта</span>
              <b>{single.location}</b>
            </div>
          </div>
        )}
      </section>

      <div className="su-actions">
        {/* TODO: шеринг пока без обработчика — нужен текст/ссылка приглашения. */}
        <motion.button
          type="button"
          className="btn-register btn-register--gradient"
          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          <Share2 size={18} strokeWidth={2.4} />
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
