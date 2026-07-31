import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import AnalyticsScreen from './components/AnalyticsScreen';
import HomeScreen from './components/HomeScreen';
import ProfileScreen from './components/ProfileScreen';
import RegistrationScreen, {
  type RegistrationOutcome,
} from './components/RegistrationScreen';
import RegistrationSuccessScreen from './components/RegistrationSuccessScreen';
import TabBar, { type TabId } from './components/TabBar';
import { ApiError, getEvents, type EventDto, type UserDto } from './lib/api';

type Screen = 'analytics' | 'home' | 'profile' | 'registration' | 'success';

// Ближайший старт: самый ранний из будущих; иначе самый недавний из прошедших.
function pickNearest(events: EventDto[]): EventDto | null {
  if (events.length === 0) return null;
  const now = Date.now();
  const byDateAsc = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const upcoming = byDateAsc.find((e) => new Date(e.date).getTime() >= now);
  return upcoming ?? byDateAsc[byDateAsc.length - 1];
}

function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [events, setEvents] = useState<EventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [participant, setParticipant] = useState<UserDto | null>(null);
  // Итог регистрации: участник + старт(ы) + был ли это абонемент.
  const [outcome, setOutcome] = useState<RegistrationOutcome | null>(null);
  // Старт, выбранный для регистрации (hero, карточка ленты или промо серии).
  const [regEvent, setRegEvent] = useState<EventDto | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await getEvents());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить старты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const nearest = useMemo(() => pickNearest(events), [events]);

  const openRegistration = (event: EventDto) => {
    setRegEvent(event);
    setCurrentScreen('registration');
  };

  const handleRegistered = (result: RegistrationOutcome) => {
    setParticipant(result.user);
    setOutcome(result);
    setCurrentScreen('success');
    // Обновить слоты на главной после успешной регистрации.
    loadEvents();
  };

  // Флоу регистрации — свои экраны без таб-бара.
  if (currentScreen === 'registration' && regEvent) {
    return (
      <RegistrationScreen
        event={regEvent}
        onBack={() => setCurrentScreen('home')}
        onRegistered={handleRegistered}
      />
    );
  }

  if (currentScreen === 'success' && outcome) {
    return (
      <RegistrationSuccessScreen
        user={outcome.user}
        events={outcome.events}
        seasonPass={outcome.seasonPass}
        onBackHome={() => setCurrentScreen('home')}
      />
    );
  }

  const activeTab: TabId =
    currentScreen === 'analytics'
      ? 'analytics'
      : currentScreen === 'profile'
        ? 'profile'
        : 'home';

  // Основные экраны — с нижним таб-баром.
  return (
    <>
      {currentScreen === 'analytics' ? (
        <AnalyticsScreen onBack={() => setCurrentScreen('home')} />
      ) : currentScreen === 'profile' ? (
        <ProfileScreen
          participant={participant}
          birthDate={outcome?.birthDate ?? null}
          registeredEvents={outcome?.events ?? []}
          nearest={nearest}
          onViewRaces={() => setCurrentScreen('home')}
        />
      ) : (
        <HomeScreen
          events={events}
          nearest={nearest}
          loading={loading}
          error={error}
          onRegister={openRegistration}
          onJoinSeries={() => nearest && openRegistration(nearest)}
          onRetry={loadEvents}
        />
      )}

      <TabBar active={activeTab} onNavigate={(tab) => setCurrentScreen(tab)} />
    </>
  );
}

export default App;
