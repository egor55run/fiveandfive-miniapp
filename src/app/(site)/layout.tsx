import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../../index.css';
import './site.css';

export const metadata: Metadata = {
  title: { default: '5&5', template: '%s — 5&5' },
  icons: '/favicon.svg',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Корневой layout публичного сайта (документы, позже — главная, старты,
 * результаты). Без SDK Telegram и без стилей Mini App: им здесь не место.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="site">{children}</div>
      </body>
    </html>
  );
}
