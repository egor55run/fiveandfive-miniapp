import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { showTelegramBackButton } from '../lib/telegram';

type Props = {
  /** Есть ли на экране «Назад». Без него — ничего не рисуем. */
  onBack?: () => void;
};

/**
 * «Назад» для экранов Mini App. Своего заголовка нет: название и меню уже в
 * шапке Telegram (решение пользователя 2026-10-14). Внутри Telegram — его
 * нативная кнопка «Назад» в шапке; вне Telegram (браузер разработчика) —
 * своя кнопка.
 */
function Header({ onBack }: Props) {
  const [native, setNative] = useState(false);
  // Обработчик меняется на каждой перерисовке экрана (например, при вводе в
  // форму); кнопку Telegram вешаем один раз, а вызываем всегда свежий.
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  const hasBack = Boolean(onBack);

  useEffect(() => {
    if (!hasBack) return;
    const hide = showTelegramBackButton(() => latest.current?.());
    // Нативная кнопка показана — свою не рисуем (синхронизация с Telegram).
    setNative(Boolean(hide));
    return () => hide?.();
  }, [hasBack]);

  if (!onBack || native) return null;
  return (
    <div className="topbar">
      <button type="button" className="topbar__back" onClick={onBack}>
        <ChevronLeft size={22} strokeWidth={2.4} />
        Назад
      </button>
    </div>
  );
}

export default Header;
