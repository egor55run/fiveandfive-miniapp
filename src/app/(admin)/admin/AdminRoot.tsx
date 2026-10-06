'use client';

import dynamic from 'next/dynamic';

// Админка целиком клиентская: вход по cookie-сессии или initData, данные —
// запросами к /api. Серверный рендер ей ничего не даёт.
const AdminApp = dynamic(() => import('../../../admin/AdminApp'), { ssr: false });

export default function AdminRoot() {
  return <AdminApp />;
}
