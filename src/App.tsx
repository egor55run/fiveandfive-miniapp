import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import HomeScreen from './components/HomeScreen';
import ProfileScreen from './components/ProfileScreen';
import RegistrationScreen from './components/RegistrationScreen';
import RegistrationSuccessScreen from './components/RegistrationSuccessScreen';
import TabBar from './components/TabBar';
import {
  ApiError,
  getEvents,
  type EventDto,
  type RegistrationResult,
  type UserDto,
} from './lib/api';

type Screen = 'home' | 'profile' | 'registration' | 'success';

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
  const [registeredEvent, setRegisteredEvent] = useState<EventDto | null>(null);

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

  const selectedEvent = useMemo(() => pickNearest(events), [events]);

  const handleRegistered = (result: RegistrationResult) => {
    setParticipant(result.user);
    setRegisteredEvent(selectedEvent);
    setCurrentScreen('success');
    // Обновить слоты на главной после успешной регистрации.
    loadEvents();
  };

  // Флоу регистрации — свои экраны без таб-бара.
  if (currentScreen === 'registration' && selectedEvent) {
    return (
      <RegistrationScreen
        event={selectedEvent}
        onBack={() => setCurrentScreen('home')}
        onRegistered={handleRegistered}
      />
    );
  }

  if (currentScreen === 'success' && participant && registeredEvent) {
    return (
      <RegistrationSuccessScreen
        user={participant}
        event={registeredEvent}
        onBackHome={() => setCurrentScreen('home')}
      />
    );
  }

  // Основные экраны — с нижним таб-баром.
  return (
    <>
      {currentScreen === 'profile' ? (
        <ProfileScreen
          participant={participant}
          onViewRaces={() => setCurrentScreen('home')}
        />
      ) : (
        <HomeScreen
          event={selectedEvent}
          loading={loading}
          error={error}
          onRegister={() => setCurrentScreen('registration')}
          onRetry={loadEvents}
        />
      )}

      <TabBar
        active={currentScreen === 'profile' ? 'profile' : 'home'}
        onNavigate={(tab) => setCurrentScreen(tab)}
      />
    </>
  );
}

export default App;
