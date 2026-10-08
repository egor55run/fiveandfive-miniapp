// Оферта и политика обработки ПДн — тексты в legal/*.md в корне репозитория.
// Те же файлы читает сервер: из точного текста он считает редакцию, под
// которую записывает согласия участников (backend/src/lib/legal.ts).

export const LEGAL_DOCS = {
  oferta: { path: '/oferta', file: 'oferta.md', title: 'Публичная оферта' },
  privacy: {
    path: '/privacy',
    file: 'privacy.md',
    title: 'Политика обработки персональных данных',
  },
} as const;

export type LegalDocKey = keyof typeof LEGAL_DOCS;
