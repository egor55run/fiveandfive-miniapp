import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import AnalyticsScreen from './components/AnalyticsScreen';
import HomeScreen from './components/HomeScreen';
import ProfileScreen from './components/ProfileScreen';
import OpenInTelegramScreen, {
  AuthErrorScreen,
  AuthLoadingScreen,
} from './components/OpenInTelegramScreen';
import RegistrationScreen, {
  type RegistrationOutcome,
  type RegistrationPrefill,
} from './components/RegistrationScreen';
import RegistrationSuccessScreen from './components/RegistrationSuccessScreen';
import TabBar, { type TabId } from './components/TabBar';
import { ApiError, getEvents, type EventDto, type UserDto } from './lib/api';
import { toRaceResults } from './data/results';
import { useTelegramAuth } from './hooks/useTelegramAuth';
import { fioFromParts, getUnsafeTelegramUser } from './lib/telegram';

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

  const {
    state: authState,
    user: authUser,
    me,
    error: authError,
    retry: retryAuth,
    refreshMe,
  } = useTelegramAuth();

  // Кто пользователь — известно сразу после входа, без всякой формы.
  // Override появляется после регистрации: оттуда приходит дополненный профиль.
  const [participantOverride, setParticipantOverride] = useState<UserDto | null>(
    null,
  );
  const participant = participantOverride ?? authUser;
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

  // Пройденные старты — из /me, один раз для профиля и аналитики: два экрана
  // должны показывать одно и то же.
  const raceResults = useMemo(() => toRaceResults(me?.results ?? []), [me]);

  const openRegistration = (event: EventDto) => {
    setRegEvent(event);
    setCurrentScreen('registration');
  };

  const handleRegistered = (result: RegistrationOutcome) => {
    setParticipantOverride(result.user);
    setOutcome(result);
    setCurrentScreen('success');
    // Обновить слоты на главной после успешной регистрации.
    loadEvents();
    // И перечитать профиль — в нём появилась новая регистрация.
    refreshMe();
  };

  // Вход в Mini App — до всего остального: пока личность неизвестна, показывать
  // старты и профиль нечему. Все хуки объявлены выше, поэтому ранний return
  // не нарушает их порядок.
  if (authState === 'loading') return <AuthLoadingScreen />;
  if (authState === 'outside') return <OpenInTelegramScreen />;
  if (authState === 'error') {
    return <AuthErrorScreen message={authError} onRetry={retryAuth} />;
  }

  // ФИО берём из профиля в БД (пользователь мог поправить его при регистрации),
  // а если там пусто — из Telegram. Контакты — из профиля, Telegram их не даёт.
  const tgUser = getUnsafeTelegramUser();
  const prefill: RegistrationPrefill = {
    fio:
      fioFromParts(participant?.lastName, participant?.firstName) ||
      fioFromParts(tgUser?.last_name, tgUser?.first_name),
    email: me?.user.email ?? undefined,
    phone: me?.user.phone ?? undefined,
  };

  // Старты, на которые пользователь записан, — из БД, а не только из состояния
  // текущей сессии: профиль должен быть верным и после переоткрытия приложения.
  const myEvents = me?.registrations.map((r) => r.event) ?? outcome?.events ?? [];

  // Флоу регистрации — свои экраны без таб-бара.
  if (currentScreen === 'registration' && regEvent) {
    return (
      <RegistrationScreen
        event={regEvent}
        onBack={() => setCurrentScreen('home')}
        onRegistered={handleRegistered}
        prefill={prefill}
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
        <AnalyticsScreen
          results={raceResults}
          onBack={() => setCurrentScreen('home')}
          onViewRaces={() => setCurrentScreen('home')}
        />
      ) : currentScreen === 'profile' ? (
        <ProfileScreen
          participant={participant}
          birthDate={outcome?.birthDate ?? null}
          registeredEvents={myEvents}
          results={raceResults}
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
