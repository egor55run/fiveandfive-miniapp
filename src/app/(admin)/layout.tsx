import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Токены и базовые стили общие с приложением участников — чтобы админка не
// разъезжалась с брендом. Правило #root оттуда сюда не действует: корневой
// элемент называется admin-root.
import '../../styles/google-fonts.css';
import '../../index.css';
import '../../admin/admin.css';

export const metadata: Metadata = {
  title: 'FIVE&FIVE — админка',
  icons: '/favicon.svg',
  // Служебная страница: в поиске ей делать нечего.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    // SDK Telegram ещё до гидратации пишет в <html> свои CSS-переменные
    // (--tg-viewport-height и т.п.) — это ожидаемо, а не расхождение разметки.
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Mini App SDK нужен только для одного случая: если /admin открыли
            внутри Telegram, вход пройдёт по initData и кнопка-виджет не
            понадобится. В обычном браузере скрипт просто не создаёт
            window.Telegram.WebApp. Сам Login Widget подключается динамически
            из TelegramLoginButton.tsx. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body>
        {/* Идентификатор намеренно не "root": правило #root в index.css сужает
            контейнер до 430px под мобильный Mini App, а админке нужна вся ширина. */}
        <div id="admin-root">{children}</div>
      </body>
    </html>
  );
}
