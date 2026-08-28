import { useCallback, useEffect, useState } from 'react';
import { BOT_USERNAME, getInitData, isInsideTelegram } from '../lib/telegram';
import {
  getAdminMe,
  isUnauthorized,
  loginWithInitData,
  loginWithWidget,
  logout,
  type AdminInfo,
  type WidgetPayload,
} from './api';
import EventsSection from './EventsSection';
import ParticipantsSection from './ParticipantsSection';
import ResultsSection from './ResultsSection';
import TelegramLoginButton from './TelegramLoginButton';
import './admin.css';

type Tab = 'events' | 'participants' | 'results';
type Phase = 'checking' | 'anonymous' | 'authed';

const TABS: { id: Tab; label: string }[] = [
  { id: 'events', label: 'Старты' },
  { id: 'participants', label: 'Участники' },
  { id: 'results', label: 'Результаты' },
];

export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [tab, setTab] = useState<Tab>('events');
  const [loginError, setLoginError] = useState<string | null>(null);

  /**
   * При загрузке спрашиваем сервер, жива ли cookie-сессия. Если нет и мы внутри
   * Telegram — пробуем войти по initData, чтобы не заставлять жать виджет там,
   * где Telegram уже знает, кто мы.
   */
  const bootstrap = useCallback(async () => {
    setPhase('checking');
    setLoginError(null);
    try {
      const me = await getAdminMe();
      setAdmin(me.admin);
      setPhase('authed');
      return;
    } catch (err) {
      if (!isUnauthorized(err)) {
        setLoginError(err instanceof Error ? err.message : 'Сервер недоступен');
        setPhase('anonymous');
        return;
      }
    }

    if (isInsideTelegram()) {
      try {
        const res = await loginWithInitData(getInitData());
        setAdmin(res.admin);
        setPhase('authed');
        return;
      } catch (err) {
        // 403 значит «аккаунт не администратор» — это осмысленный ответ,
        // показываем его; остальное просто отправляет на экран входа.
        setLoginError(err instanceof Error ? err.message : null);
      }
    }

    setPhase('anonymous');
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap();
  }, [bootstrap]);

  const onWidgetAuth = async (payload: WidgetPayload) => {
    setLoginError(null);
    try {
      const res = await loginWithWidget(payload);
      setAdmin(res.admin);
      setPhase('authed');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Не удалось войти');
    }
  };

  const onLogout = async () => {
    await logout().catch(() => {});
    setAdmin(null);
    setPhase('anonymous');
  };

  if (phase === 'checking') {
    return (
      <main className="ad-shell ad-shell--center">
        <p className="ad-msg">Проверяем сессию…</p>
      </main>
    );
  }

  if (phase === 'anonymous') {
    return (
      <main className="ad-shell ad-shell--center">
        <div className="ad-card ad-login">
          <h1>FIVE&amp;FIVE</h1>
          <p className="ad-login__sub">Панель администратора</p>
          <p className="ad-hint">
            Пароля нет — вход по Telegram-аккаунту. Доступ открыт только
            аккаунтам из списка администраторов.
          </p>
          {loginError && <p className="ad-msg ad-msg--error">{loginError}</p>}
          <TelegramLoginButton botUsername={BOT_USERNAME} onAuth={onWidgetAuth} />
          <p className="ad-hint ad-hint--dim">
            Кнопка не появилась? Домен должен быть привязан к боту через
            @BotFather → /setdomain.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="ad-shell">
      <header className="ad-top">
        <div className="ad-top__brand">
          <strong>FIVE&amp;FIVE</strong>
          <span>админка</span>
        </div>
        <nav className="ad-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ad-tab${tab === t.id ? ' ad-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ad-top__user">
          <span>
            {admin?.username ? `@${admin.username}` : `id ${admin?.telegramId ?? '—'}`}
          </span>
          <button type="button" className="ad-btn ad-btn--sm" onClick={() => void onLogout()}>
            Выйти
          </button>
        </div>
      </header>

      {tab === 'events' && <EventsSection />}
      {tab === 'participants' && <ParticipantsSection />}
      {tab === 'results' && <ResultsSection />}
    </main>
  );
}
