import type { Metadata, Viewport } from 'next';
import { Montserrat, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';
import SiteFooter from '../../components/site/SiteFooter';
import SiteHeader from '../../components/site/SiteHeader';
import '../../index.css';
import './site.css';

// Шрифты бренда — с нашего сервера: next/font скачивает их при сборке, и
// браузер не ходит на Google Fonts (быстрее, и посетитель не уходит к Google).
// cyrillic-ext — казахские буквы, на будущее (документы уже есть на казахском).
// Без weight — вариативные шрифты: один файл на все начертания (макет главной
// берёт Montserrat 400–700 и Unbounded до 900).
const ui = Montserrat({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-site-ui',
  display: 'swap',
});
const display = Unbounded({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-site-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: '5&5', template: '%s — 5&5' },
  icons: '/favicon.svg',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Главная, открытая как Mini App (старая кнопка меню в BotFather, ссылки из
 * давних сообщений, «основной Mini App» с адресом корня), — уводим в /app.
 * Telegram передаёт параметры запуска в адресе (#tgWebAppData=…,
 * ?tgWebAppStartParam=…); их сохраняем, иначе вход и deep-link потеряются.
 * Обычный браузер и встроенный браузер Telegram (openLink) этих параметров не
 * несут и остаются на сайте.
 */
const TELEGRAM_TO_APP = `(function(){var s=location.search,h=location.hash;if(/tgWebApp/.test(h)||/tgWebApp/.test(s)){location.replace('/app'+s+h);}})();`;

/**
 * Корневой layout публичного сайта. Без SDK Telegram и без стилей Mini App.
 * Язык пока один — русский; казахский добавится отдельными страницами под /kk
 * (тексты — в src/site/i18n.ts).
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${ui.variable} ${display.variable} site-fonts`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TELEGRAM_TO_APP }} />
      </head>
      <body>
        <div className="site">
          <SiteHeader lang="ru" />
          <div className="site-main">{children}</div>
          <SiteFooter lang="ru" />
        </div>
      </body>
    </html>
  );
}
