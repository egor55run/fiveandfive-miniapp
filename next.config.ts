import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Корень проекта — эта папка. Иначе Turbopack цепляется за случайный
  // package-lock.json уровнем выше (в домашнем каталоге) и считает корнем его.
  turbopack: { root: import.meta.dirname },

  // Пока сайта нет, корень — это Mini App: на него смотрит кнопка в BotFather
  // и ссылки «подробнее в приложении» в уже отправленных уведомлениях.
  // Именно rewrite, а не redirect: адрес в WebView не меняется, и Telegram-
  // фрагмент #tgWebAppData=… не зависит от того, сохранит ли его клиент при
  // переходе. Когда на / появится главная сайта, правило уйдёт, а BotFather
  // переключится на /app.
  async rewrites() {
    return [{ source: '/', destination: '/app' }];
  },

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
    ];
  },
};

export default nextConfig;
