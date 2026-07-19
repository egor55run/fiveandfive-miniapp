import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import Header from './Header';
import NextRaceCard from './NextRaceCard';
import type { EventDto } from '../lib/api';

type Props = {
  event: EventDto | null;
  loading: boolean;
  error: string | null;
  onRegister: () => void;
  onRetry: () => void;
};

function HomeScreen({ event, loading, error, onRegister, onRetry }: Props) {
  return (
    <motion.main
      className="home screen screen--tabbar"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header />

      {loading && (
        <div className="card state">
          <Loader2 className="state__spinner" size={28} strokeWidth={2.2} />
          <p className="state__text">Загрузка стартов…</p>
        </div>
      )}

      {!loading && error && (
        <div className="card state">
          <AlertCircle className="state__icon" size={32} strokeWidth={1.8} />
          <p className="state__text">{error}</p>
          <button type="button" className="btn-secondary" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && !event && (
        <div className="card state">
          <p className="state__text">Пока нет предстоящих стартов</p>
        </div>
      )}

      {!loading && !error && event && (
        <NextRaceCard event={event} onRegister={onRegister} />
      )}
    </motion.main>
  );
}

export default HomeScreen;
