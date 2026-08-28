import { useEffect, useRef } from 'react';
import type { WidgetPayload } from './api';

/**
 * Кнопка «Log in with Telegram».
 *
 * Виджет — это скрипт telegram-widget.js, который рендерит iframe с кнопкой
 * ровно в то место, где стоит сам тег <script>. Поэтому его нельзя положить в
 * admin.html: вставляем динамически в наш контейнер.
 *
 * Результат приходит не в промис, а в глобальный колбэк, имя которого задаётся
 * атрибутом data-onauth. Регистрируем функцию на window и снимаем её при
 * размонтировании.
 *
 * ВАЖНО: виджет работает только если домен привязан к боту через
 * @BotFather -> /setdomain. Привязка Mini App (/newapp, кнопка меню) для
 * виджета не считается — это разные настройки.
 */

const CALLBACK_NAME = '__fiveandfiveTelegramAuth';

declare global {
  interface Window {
    [CALLBACK_NAME]?: (user: WidgetPayload) => void;
  }
}

type Props = {
  botUsername: string;
  onAuth: (payload: WidgetPayload) => void;
};

export default function TelegramLoginButton({ botUsername, onAuth }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Колбэк держим в ref: скрипт вставляется один раз, а onAuth может меняться.
  // Обновляем в эффекте, а не в теле рендера — мутировать ref во время рендера
  // нельзя (React может рендер отбросить или повторить).
  const onAuthRef = useRef(onAuth);
  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    window[CALLBACK_NAME] = (user: WidgetPayload) => onAuthRef.current(user);

    // В StrictMode эффект выполняется дважды — иначе получили бы две кнопки.
    container.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', `${CALLBACK_NAME}(user)`);
    container.appendChild(script);

    return () => {
      delete window[CALLBACK_NAME];
      container.innerHTML = '';
    };
  }, [botUsername]);

  return <div ref={containerRef} className="tg-login" />;
}
