import type { Metadata, Viewport } from 'next';
import { Montserrat, Unbounded } from 'next/font/google';
import type { ReactNode } from 'react';
import SiteFooter from '../../components/site/SiteFooter';
import SiteHeader from '../../components/site/SiteHeader';
import { SITE_INDEXABLE, SITE_NAME, SITE_URL } from '../../site/seo';
import '../../index.css';
import './site.css';

// Шрифты бренда — с нашего сервера: next/font скачивает их при сборке, и
// браузер не ходит на Google Fonts (быстрее, и посетитель не уходит к Google).
// Наборы букв — латиница и кириллица: каждый набор браузер грузит заранее, а
// казахских букв (cyrillic-ext) на русском сайте нет. Казахские документы
// (пока только staging) берут эти буквы из системного шрифта; когда будет
// казахский сайт — вернуть 'cyrillic-ext' в оба шрифта.
// Без weight — вариативные шрифты: один файл на все начертания (макет главной
// берёт Montserrat 400–700 и Unbounded до 900).
const ui = Montserrat({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-site-ui',
  display: 'swap',
});
const display = Unbounded({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-site-display',
  display: 'swap',
});

export const metadata: Metadata = {
  // Абсолютные адреса в og:image, canonical и т. п. — от адреса сайта.
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  applicationName: SITE_NAME,
  // Staging и локальная сборка — вне поиска (на проде разрешено, см. seo.ts).
  ...(SITE_INDEXABLE ? {} : { robots: { index: false, follow: false } }),
  // Вкладка — амперсанд-трасса из логотипа (целый «5&5» в 32 px не читается),
  // на телефоне (иконка «на экран Домой») — знак целиком.
  icons: {
    icon: [
      { url: '/brand/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/icon-48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
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
/**
 * Статистика посещений — Umami на нашем сервере (/stats), без cookies;
 * «Не отслеживать» в браузере уважаем (data-do-not-track). Счётчик только там,
 * где при сборке задан id сайта (scripts/deploy-web.sh), и только на страницах
 * сайта: Mini App и админка — в других layout.
 */
const UMAMI_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

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
        {UMAMI_ID && (
          <script defer src="/stats/m.js" data-website-id={UMAMI_ID} data-do-not-track="true" />
        )}
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
