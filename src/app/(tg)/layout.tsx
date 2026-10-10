import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../../styles/google-fonts.css';
import '../../index.css';
// App.tsx импортирует его и сам, но он грузится только в браузере (ssr: false),
// и без этого импорта стили приходили бы позже разметки — экран мигал бы.
import '../../App.css';

export const metadata: Metadata = {
  title: 'fiveandfive',
  // Mini App живёт в Telegram; в поиске — только сайт.
  robots: { index: false, follow: false },
  icons: '/favicon.svg',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Корневой layout Mini App. Свой <html>, а не общий с сайтом: SDK Telegram и
 * стили приложения (в том числе #root шириной 430px) сайту не нужны.
 */
export default function TelegramLayout({ children }: { children: ReactNode }) {
  return (
    // SDK Telegram ещё до гидратации пишет в <html> свои CSS-переменные
    // (--tg-viewport-height и т.п.) — это ожидаемо, а не расхождение разметки.
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Mini App SDK. Обязательно внешним синхронным тегом с telegram.org и
            до бандла приложения: npm-копия не создаёт рабочий
            window.Telegram.WebApp, а initData нужен уже на первом рендере.
            next/script с beforeInteractive здесь не подходит — он работает
            только в общем корневом layout, а у Mini App он свой. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
