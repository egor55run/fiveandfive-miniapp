// Оферта, политика обработки ПДн и бланк согласия родителя — тексты в
// legal/*.md в корне репозитория. Оферту и политику читает и сервер: из
// точного русского текста он считает редакцию, под которую записывает
// согласия участников (backend/src/lib/legal.ts).

export type Lang = 'ru' | 'kk';

/**
 * Казахские версии — только на staging, пока их не проверит юрист (решение
 * пользователя 2026-10-08): без флага страниц /kk/... и переключателя нет.
 * Флаг ставит scripts/deploy-web.sh для staging; прод-сборка его не получает
 * и вдобавок проверяется на отсутствие казахского текста.
 */
export const KK_ENABLED = process.env.NEXT_PUBLIC_LEGAL_KK === '1';

type DocInfo = {
  /** Русская страница; казахская — /kk + path. */
  path: string;
  file: Record<Lang, string>;
  title: Record<Lang, string>;
  /** Бланк: на странице кнопка «Распечатать», при печати — только он. */
  printable?: boolean;
};

export const LEGAL_DOCS = {
  oferta: {
    path: '/oferta',
    file: { ru: 'oferta.md', kk: 'oferta-kk.md' },
    title: { ru: 'Публичная оферта', kk: 'Жария оферта' },
  },
  privacy: {
    path: '/privacy',
    file: { ru: 'privacy.md', kk: 'privacy-kk.md' },
    title: {
      ru: 'Политика обработки персональных данных',
      kk: 'Дербес деректерді өңдеу саясаты',
    },
  },
  parentConsent: {
    path: '/soglasie-roditelya',
    file: { ru: 'parent-consent.md', kk: 'parent-consent-kk.md' },
    title: { ru: 'Согласие родителя', kk: 'Ата-ананың келісімі' },
    printable: true,
  },
} satisfies Record<string, DocInfo>;

export type LegalDocKey = keyof typeof LEGAL_DOCS;

export function docPath(doc: LegalDocKey, lang: Lang): string {
  return lang === 'kk' ? `/kk${LEGAL_DOCS[doc].path}` : LEGAL_DOCS[doc].path;
}
