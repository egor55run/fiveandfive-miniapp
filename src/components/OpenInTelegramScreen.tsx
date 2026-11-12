import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowRight, LoaderCircle, Send } from 'lucide-react';
import Header from './Header';
import { BOT_LINK, BOT_USERNAME } from '../lib/telegram';

/**
 * Экраны входа. Приложение — Telegram Mini App: личность приходит из
 * подписанного initData, поэтому вне Telegram работать оно не может, и
 * вместо формы входа показывается ссылка на бота.
 */

function Shell({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.main
      className="screen"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header />
      <div className="glass-card empty">{children}</div>
    </motion.main>
  );
}

export default function OpenInTelegramScreen() {
  return (
    <Shell>
      <Send className="empty__icon" size={44} strokeWidth={1.6} />
      <p className="empty__text">
        Приложение работает внутри Telegram — там оно само узнаёт, кто вы,
        и вход не нужен.
      </p>
      <a className="btn-register" href={BOT_LINK} target="_blank" rel="noreferrer">
        Открыть @{BOT_USERNAME}
        <ArrowRight size={18} strokeWidth={2.4} />
      </a>
    </Shell>
  );
}

export function AuthLoadingScreen() {
  return (
    <Shell>
      <LoaderCircle className="empty__icon" size={44} strokeWidth={1.6} />
      <p className="empty__text">Входим…</p>
    </Shell>
  );
}

export function AuthErrorScreen({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <Shell>
      <AlertCircle className="empty__icon" size={44} strokeWidth={1.6} />
      <p className="empty__text">{message ?? 'Не удалось войти'}</p>
      <button type="button" className="btn-register" onClick={onRetry}>
        Попробовать снова
        <ArrowRight size={18} strokeWidth={2.4} />
      </button>
    </Shell>
  );
}
