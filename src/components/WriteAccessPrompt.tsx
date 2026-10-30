import { useState } from 'react';
import { markWriteAccess } from '../lib/api';
import { askWriteAccess } from '../lib/telegram';

/**
 * Просьба разрешить боту писать (2026-10-30): при первом входе и после
 * регистрации, если бот ещё не может написать человеку. Сначала наш текст —
 * зачем это нужно, потом системное окно Telegram (requestWriteAccess).
 * Разрешил — отмечаем на сервере: человек получает напоминания и рассылки.
 */
type Props = {
  /** granted — разрешил; false — отказался или закрыл. */
  onDone: (granted: boolean) => void;
};

export default function WriteAccessPrompt({ onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const allow = async () => {
    setBusy(true);
    const granted = await askWriteAccess();
    if (granted) {
      // Сбой сохранения не мешает: бот уже может писать, отметка появится,
      // когда человек напишет боту или снова разрешит.
      await markWriteAccess().catch(() => undefined);
      onDone(true);
      return;
    }
    setBusy(false);
    setDenied(true);
  };

  return (
    <div className="wa-backdrop" role="dialog" aria-modal="true" aria-labelledby="wa-title">
      <div className="wa-sheet">
        <h2 id="wa-title" className="wa-sheet__title">Сообщения от бота</h2>
        <p className="wa-sheet__text">
          Разрешите боту присылать напоминания о старте и результаты. Писать будем только по делу.
        </p>
        {denied && (
          <p className="wa-sheet__text wa-sheet__text--muted">
            Без разрешения бот не сможет напомнить о старте. Передумаете — нажмите «Разрешить» ещё раз.
          </p>
        )}
        <button type="button" className="btn-register" disabled={busy} onClick={() => void allow()}>
          {busy ? 'Ждём ответ Telegram…' : 'Разрешить'}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onDone(false)}>
          Не сейчас
        </button>
      </div>
    </div>
  );
}
