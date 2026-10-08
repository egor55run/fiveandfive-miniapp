import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import Header from './Header';
import NextRaceCard from './NextRaceCard';
import RaceListItem from './RaceListItem';
import SeriesPromo from './SeriesPromo';
import type { EventDto } from '../lib/api';

type Props = {
  events: EventDto[];
  nearest: EventDto | null;
  loading: boolean;
  error: string | null;
  onRegister: (event: EventDto) => void;
  onJoinSeries: () => void;
  onRetry: () => void;
  /** Администратор может записаться и при закрытой регистрации. */
  registrationOpenForMe: boolean;
};

function HomeScreen({
  events,
  nearest,
  loading,
  error,
  onRegister,
  onJoinSeries,
  onRetry,
  registrationOpenForMe,
}: Props) {
  // Остальные старты — все, кроме показанного в hero, по дате.
  const rest = events
    .filter((e) => e.id !== nearest?.id)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <motion.main
      className="home screen screen--tabbar"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header />

      {loading && (
        <div className="glass-card state">
          <Loader2 className="state__spinner" size={28} strokeWidth={2.2} />
          <p className="state__text">Загрузка стартов…</p>
        </div>
      )}

      {!loading && error && (
        <div className="glass-card state">
          <AlertCircle className="state__icon" size={32} strokeWidth={1.8} />
          <p className="state__text">{error}</p>
          <button type="button" className="btn-secondary" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && !nearest && (
        <div className="glass-card state">
          <p className="state__text">Пока нет предстоящих стартов</p>
        </div>
      )}

      {!loading && !error && nearest && (
        <>
          <NextRaceCard
            event={nearest}
            onRegister={() => onRegister(nearest)}
            registrationOpenForMe={registrationOpenForMe}
          />

          {rest.length > 0 && (
            <div className="races-list">
              {rest.map((e) => (
                <RaceListItem key={e.id} event={e} onSelect={() => onRegister(e)} />
              ))}
            </div>
          )}

          <SeriesPromo onJoin={onJoinSeries} />
        </>
      )}
    </motion.main>
  );
}

export default HomeScreen;
