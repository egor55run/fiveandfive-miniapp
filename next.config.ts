import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Корень проекта — эта папка. Иначе Turbopack цепляется за случайный
  // package-lock.json уровнем выше (в домашнем каталоге) и считает корнем его.
  turbopack: { root: import.meta.dirname },

  // Самодостаточная сборка (.next/standalone/server.js + нужные node_modules):
  // собираем не на сервере — там 2 ГБ памяти без swap, и next build рядом с
  // продом рискует разбудить OOM-killer, — а готовый каталог копируем туда.
  output: 'standalone',

  // Корень — главная сайта, Mini App живёт на /app. Если главную открыли
  // внутри Telegram (старая кнопка меню, ссылка из старого сообщения), она
  // сама уводит в /app — см. скрипт в src/app/(site)/layout.tsx.

  async redirects() {
    return [{ source: '/admin.html', destination: '/admin', permanent: true }];
  },

  async headers() {
    return [
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
