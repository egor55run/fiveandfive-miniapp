import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Токены и базовые стили общие с приложением участников — чтобы админка не
// разъезжалась с брендом. Правило #root оттуда сюда не действует: корневой
// элемент называется admin-root (см. admin.html).
import '../index.css';
import AdminApp from './AdminApp';

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
