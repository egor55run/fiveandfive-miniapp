'use client';

import dynamic from 'next/dynamic';

// Mini App живёт только в браузере: initData и window.Telegram есть лишь там,
// а серверный рендер разошёлся бы с первым клиентским. Индексировать здесь
// нечего — всё за входом через Telegram.
const App = dynamic(() => import('../../../App'), { ssr: false });

export default function MiniApp() {
  return <App />;
}
