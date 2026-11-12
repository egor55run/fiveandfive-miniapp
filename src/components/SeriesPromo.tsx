import { motion, useReducedMotion } from 'framer-motion';

type Props = {
  onJoin: () => void;
};

function SeriesPromo({ onJoin }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <section className="glass-card promo">
      <h2 className="promo__title u-display">
        Заберите серию <span className="accent">5&5</span>
      </h2>
      <p className="promo__text">
        Зарегистрируйтесь один раз и бегите все пять парков с мая по сентябрь. Мы
        зарегистрируем вас на все забеги и отправим напоминания о старте.
      </p>
      <motion.button
        type="button"
        className="btn-register"
        onClick={onJoin}
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      >
        Пройти все забеги!
      </motion.button>
    </section>
  );
}

export default SeriesPromo;
