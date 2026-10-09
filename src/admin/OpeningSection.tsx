import { useCallback, useEffect, useState } from 'react';
import { getOpeningSubscribers, startOpeningBroadcast, type OpeningInfo } from './api';

/**
 * Подписчики «Узнать об открытии регистрации» и рассылка им.
 *
 * Рассылка — только когда регистрация уже открыта (сервер иначе откажет), с
 * подтверждением, один раз каждому: получившим повторно не отправляется.
 */
export default function OpeningSection() {
  const [info, setInfo] = useState<OpeningInfo | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getOpeningSubscribers();
      setInfo(next);
      setText((prev) => prev ?? next.defaultText);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить');
    }
  }, []);

  useEffect(() => {
    // Загрузка с сервера при открытии раздела — синхронизация с внешней системой.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Пока идёт рассылка — обновляем ход раз в 2 секунды.
  const running = info?.broadcast.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const send = async () => {
    if (!text) return;
    setConfirming(false);
    setError(null);
    try {
      await startOpeningBroadcast(text);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запустить рассылку');
    }
  };

  if (!info) return <p className="ad-msg">{error ?? 'Загружаем…'}</p>;
  const { stats, broadcast } = info;

  return (
    <section className="ad-card">
      <h3>Узнать об открытии регистрации</h3>
      <p className="ad-hint">
        Подписаться можно кнопкой на сайте, в боте (/start) и в приложении на экране
        «Регистрация скоро откроется». Отписаться — командой /stop в боте.
      </p>

      <dl className="ad-opening__stats">
        <div><dt>Подписаны</dt><dd>{stats.active}</dd></div>
        <div><dt>Ждут сообщения</dt><dd>{stats.pending}</dd></div>
        <div><dt>Получили</dt><dd>{stats.sent}</dd></div>
        <div><dt>Заблокировали бота</dt><dd>{stats.blocked}</dd></div>
        <div><dt>Не дошло (повторим)</dt><dd>{stats.failed}</dd></div>
        <div><dt>Отписались</dt><dd>{stats.unsubscribed}</dd></div>
      </dl>

      {broadcast.running ? (
        <p className="ad-msg">
          Идёт рассылка: {broadcast.done} из {broadcast.total} (дошло {broadcast.sent},
          заблокировали {broadcast.blocked}, ошибок {broadcast.failed})
        </p>
      ) : broadcast.finishedAt ? (
        <p className="ad-msg ad-msg--ok">
          Последняя рассылка: отправлено {broadcast.sent} из {broadcast.total}
          {broadcast.blocked > 0 && `, заблокировали бота ${broadcast.blocked}`}
          {broadcast.failed > 0 && `, не дошло ${broadcast.failed} — повторная рассылка отправит им`}
        </p>
      ) : null}

      <label className="ad-opening__text">
        <span>Текст сообщения (без оформления; под ним будет кнопка «Открыть приложение»)</span>
        <textarea
          rows={6}
          value={text ?? ''}
          onChange={(e) => setText(e.target.value)}
          disabled={broadcast.running}
        />
      </label>

      {error && <p className="ad-msg ad-msg--error">{error}</p>}

      {!info.registrationOpen ? (
        <p className="ad-hint">
          Регистрация сейчас закрыта — рассылка станет доступна, когда её откроете.
        </p>
      ) : stats.pending === 0 ? (
        <p className="ad-hint">Всем подписанным сообщение уже отправлено.</p>
      ) : confirming ? (
        <div className="ad-actions">
          <button type="button" className="ad-btn ad-btn--primary" onClick={() => void send()}>
            Да, разослать {stats.pending}
          </button>
          <button type="button" className="ad-btn" onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <div className="ad-actions">
          <button
            type="button"
            className="ad-btn ad-btn--primary"
            disabled={broadcast.running || !text?.trim()}
            onClick={() => setConfirming(true)}
          >
            Разослать «регистрация открыта»
          </button>
        </div>
      )}
    </section>
  );
}
