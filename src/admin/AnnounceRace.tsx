import { useCallback, useEffect, useState } from 'react';
import { getAnnouncement, startAnnouncement, type AdminEvent, type AnnouncementInfo } from './api';
import { formatDate } from './helpers';

/**
 * «Сообщить о новом старте»: предпросмотр сообщения бота, сколько человек
 * получат, подтверждение и ход рассылки — как вкладка «Рассылка».
 */
export default function AnnounceRace({ event, onClose }: { event: AdminEvent; onClose: () => void }) {
  const [info, setInfo] = useState<AnnouncementInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await getAnnouncement(event.id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить');
    }
  }, [event.id]);

  useEffect(() => {
    // Загрузка с сервера при открытии — синхронизация с внешней системой.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Пока идёт рассылка — обновляем ход раз в 2 секунды.
  const running = info?.run?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const send = async () => {
    setConfirming(false);
    setError(null);
    try {
      await startAnnouncement(event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось запустить рассылку');
    }
  };

  return (
    <div className="ad-card ad-announce">
      <header className="ad-announce__head">
        <h3>
          Сообщить о старте: {event.title} — {formatDate(event.date)}
        </h3>
        <button type="button" className="ad-btn ad-btn--sm" onClick={onClose}>
          Закрыть
        </button>
      </header>

      {!info ? (
        <p className="ad-msg">{error ?? 'Загружаем…'}</p>
      ) : (
        <>
          <p className="ad-hint">
            Получат те, кто писал боту (/start или кнопка в боте) и не отписался командой /stop. Каждый —
            одно сообщение об этом старте: повторный запуск отправит только тем, кому ещё не дошло.
          </p>

          <div className="ad-announce__preview" aria-label="Предпросмотр сообщения">
            {/* Текст собирает сервер (HTML Telegram, поля старта экранированы). */}
            <div className="ad-announce__bubble" dangerouslySetInnerHTML={{ __html: info.text.replace(/\n/g, '<br>') }} />
            <div className="ad-announce__button">{info.button.text}</div>
          </div>

          <dl className="ad-opening__stats">
            <div>
              <dt>Можно писать</dt>
              <dd>{info.stats.audience}</dd>
            </div>
            <div>
              <dt>Получат сейчас</dt>
              <dd>{info.stats.pending}</dd>
            </div>
            <div>
              <dt>Дошло</dt>
              <dd>{info.stats.sent}</dd>
            </div>
            <div>
              <dt>Заблокировали бота</dt>
              <dd>{info.stats.blocked}</dd>
            </div>
            <div>
              <dt>Не дошло (повторим)</dt>
              <dd>{info.stats.failed}</dd>
            </div>
          </dl>

          {info.run?.running ? (
            <p className="ad-msg">
              Идёт рассылка: {info.run.done} из {info.run.total} (дошло {info.run.sent}, заблокировали{' '}
              {info.run.blocked}, ошибок {info.run.failed})
            </p>
          ) : info.run?.finishedAt ? (
            <p className="ad-msg ad-msg--ok">
              Готово: дошло {info.run.sent} из {info.run.total}
              {info.run.blocked > 0 && `, заблокировали бота ${info.run.blocked}`}
              {info.run.failed > 0 && `, не дошло ${info.run.failed} — повторный запуск отправит им`}
            </p>
          ) : null}

          {error && <p className="ad-msg ad-msg--error">{error}</p>}

          {info.started ? (
            <p className="ad-hint">Старт уже прошёл — сообщать о нём поздно.</p>
          ) : info.stats.pending === 0 ? (
            <p className="ad-hint">
              {info.stats.audience === 0 ? 'Пока некому писать: боту ещё никто не писал.' : 'Всем, кому можно, уже отправлено.'}
            </p>
          ) : confirming ? (
            <div className="ad-actions">
              <button type="button" className="ad-btn ad-btn--primary" onClick={() => void send()}>
                Да, разослать {info.stats.pending}
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
                disabled={running}
                onClick={() => setConfirming(true)}
              >
                Разослать «новый старт»
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
