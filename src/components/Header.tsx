import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';

type Props = {
  // Показывать кнопку «Назад». В Telegram-мини-аппе верхнюю панель позже
  // заменят нативные контролы; на web это визуальный аналог макета.
  onBack?: () => void;
};

function Header({ onBack }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.header
      className="topbar"
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {onBack ? (
        <button type="button" className="topbar__back" onClick={onBack}>
          <ChevronLeft size={22} strokeWidth={2.4} />
          Назад
        </button>
      ) : (
        <span />
      )}

      <span className="topbar__title">
        <b>5&5</b>
        <span>приложение</span>
      </span>

      <button type="button" className="topbar__menu" aria-label="Меню">
        <MoreHorizontal size={18} strokeWidth={2.2} />
      </button>
    </motion.header>
  );
}

export default Header;
