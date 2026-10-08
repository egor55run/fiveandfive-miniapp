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
import PaymentScreen from './components/PaymentScreen';
import TabBar, { type TabId } from './components/TabBar';
import {
  ApiError,
  getEvents,
  type EventDto,
  type PaymentDto,
  type UserDto,
} from './lib/api';
import { toRaceResults } from './data/results';
import { useTelegramAuth } from './hooks/useTelegramAuth';
import { isValidPersonName } from './lib/personName';
import { getUnsafeTelegramUser } from './lib/telegram';

type Screen = 'analytics' | 'home' | 'profile' | 'registration' | 'payment' | 'success';

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
  // Выставленный, но ещё не оплаченный счёт в Kaspi + что им оплачивается.
  const [pending, setPending] = useState<{
    outcome: RegistrationOutcome;
    payment: PaymentDto;
  } | null>(null);

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
    // Загрузка стартов с бэкенда — та самая синхронизация с внешней системой,
    // ради которой effect и существует. Правило видит только синхронный
    // setLoading(true) в начале loadEvents и не отличает этот случай от
    // каскадных setState; та же оговорка стоит в useTelegramAuth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const handlePaymentStarted = (result: RegistrationOutcome, payment: PaymentDto) => {
    setParticipantOverride(result.user);
    setPending({ outcome: result, payment });
    setCurrentScreen('payment');
    // Место уже занято — пусть главная покажет актуальные слоты.
    loadEvents();
  };

  const handleRegistered = (result: RegistrationOutcome) => {
    setPending(null);
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

  // Имя и фамилию берём из профиля в БД (их ввели при прошлой регистрации), а
  // если там их нет — из Telegram. Только если они уже кириллицей: имя из
  // Telegram часто латиницей («Egor»), и подставить его — значит сразу
  // показать ошибку. Контакты — из профиля, Telegram их не даёт.
  // Контакты и дату рождения берём из participant, а не из me: после правки
  // карандашом в профиле он свежее (в нём ответ PATCH /me), а me перечитывается
  // не на каждое изменение.
  const tgUser = getUnsafeTelegramUser();
  const prefill: RegistrationPrefill = {
    lastName: [participant?.lastName, tgUser?.last_name].find(isValidPersonName),
    firstName: [participant?.firstName, tgUser?.first_name].find(isValidPersonName),
    email: participant?.email ?? me?.user.email ?? undefined,
    phone: participant?.phone ?? me?.user.phone ?? undefined,
    birthDate: participant?.birthDate ?? me?.user.birthDate ?? undefined,
  };

  // Старты, на которые пользователь записан, — из БД, а не только из состояния
  // текущей сессии: профиль должен быть верным и после переоткрытия приложения.
  // Отменённые (не успел оплатить, место освобождено) — не в счёт.
  const myEvents =
    me?.registrations.filter((r) => r.paymentStatus !== 'CANCELLED').map((r) => r.event) ??
    outcome?.events ??
    [];

  // Флоу регистрации — свои экраны без таб-бара.
  if (currentScreen === 'registration' && regEvent) {
    return (
      <RegistrationScreen
        event={regEvent}
        onBack={() => setCurrentScreen('home')}
        onRegistered={handleRegistered}
        onPaymentStarted={handlePaymentStarted}
        prefill={prefill}
      />
    );
  }

  if (currentScreen === 'payment' && pending) {
    return (
      <PaymentScreen
        payment={pending.payment}
        title={
          pending.outcome.seasonPass
            ? `${pending.outcome.events.length} стартов сезона`
            : pending.outcome.events[0]?.title ?? ''
        }
        seasonPass={pending.outcome.seasonPass}
        onPaid={() => handleRegistered(pending.outcome)}
        onBack={() => {
          // Форма та же: можно поправить номер и выставить счёт заново.
          setCurrentScreen(regEvent ? 'registration' : 'home');
          loadEvents();
        }}
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
          registeredEvents={myEvents}
          results={raceResults}
          nearest={nearest}
          onUserUpdated={setParticipantOverride}
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
