import type { NextConfig } from 'next';

/**
 * CSP (2026-11-09). 'unsafe-inline' у скриптов нужен: Next вставляет свои
 * встроенные скрипты, а nonce сделал бы все страницы динамическими. Внешнее —
 * только SDK и виджет входа Telegram. В разработке CSP нет: Next там нужен eval.
 */
const csp = (frameAncestors: string) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://t.me https://*.telegram.org",
    "font-src 'self' data:",
    "connect-src 'self'",
    'frame-src https://oauth.telegram.org',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');

// Mini App встраивается в Telegram Web; остальное — ни в какие фреймы. Корень
// тоже разрешён: старая кнопка меню открывает его и он сам уводит в /app.
const TELEGRAM_FRAME = "'self' https://web.telegram.org https://*.telegram.org";
const cspHeader = (frameAncestors: string) =>
  process.env.NODE_ENV === 'production' ? [{ key: 'Content-Security-Policy', value: csp(frameAncestors) }] : [];

const nextConfig: NextConfig = {
  // Версию Next наружу не показываем.
  poweredByHeader: false,

  // Корень проекта — эта папка. Иначе Turbopack цепляется за случайный
  // package-lock.json уровнем выше (в домашнем каталоге) и считает корнем его.
  turbopack: { root: import.meta.dirname },

  // Самодостаточная сборка (.next/standalone/server.js + нужные node_modules):
  // собираем не на сервере — там 2 ГБ памяти без swap, и next build рядом с
  // продом рискует разбудить OOM-killer, — а готовый каталог копируем туда.
  output: 'standalone',

  // Стили — прямо в HTML, а не отдельными файлами: их всего ~6 КБ, а отдельный
  // запрос задерживал первую отрисовку на медленном мобильном интернете
  // (PageSpeed, 2026-10-10: «запросы, блокирующие отрисовку», до 0,9 с).
  experimental: { inlineCss: true },

  // Корень — главная сайта, Mini App живёт на /app. Если главную открыли
  // внутри Telegram (старая кнопка меню, ссылка из старого сообщения), она
  // сама уводит в /app — см. скрипт в src/app/(site)/layout.tsx.

  async redirects() {
    return [{ source: '/admin.html', destination: '/admin', permanent: true }];
  },

  async headers() {
    return [
      { source: '/', headers: cspHeader(TELEGRAM_FRAME) },
      { source: '/app', headers: cspHeader(TELEGRAM_FRAME) },
      { source: '/app/:path*', headers: cspHeader(TELEGRAM_FRAME) },
      { source: '/((?!app(?:/|$)).+)', headers: cspHeader("'none'") },
      {
        // Служебная страница: не кешируем, чтобы не залипал старый бандл,
        // запрещаем встраивание в iframe и индексацию. Раньше это делал nginx.
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // Mini App — для Telegram, не для поиска.
        source: '/app/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/app',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
