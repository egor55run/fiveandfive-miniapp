import type { Metadata } from 'next';
import type { EventDto } from '../lib/api';
import { docPath, LEGAL_DOCS, type Lang, type LegalDocKey } from '../lib/legal';
import { PRICES_PUBLIC } from './links';

/**
 * Поиск и превью: адрес сайта, метаданные страниц, разметка schema.org.
 *
 * Адрес и «можно ли индексировать» задаёт сборка (scripts/deploy-web.sh):
 * staging — https://staging.fiveandfive.kz и запрет индексации (как и
 * X-Robots-Tag в nginx), прод — https://fiveandfive.kz и разрешение.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
export const SITE_INDEXABLE = process.env.NEXT_PUBLIC_SITE_INDEX === '1';
export const SITE_NAME = '5&5';

/** Картинка-превью по умолчанию (1200×630) — src/app/(site)/og/route.tsx. */
export const DEFAULT_OG = '/og';
/** Превью старта — src/app/(site)/og/[slug]/route.tsx. */
export const raceOg = (slug: string) => `/og/${encodeURIComponent(slug)}`;

type PageMetaInput = {
  /** Заголовок страницы; к нему шаблон layout добавит « — 5&5». */
  title?: string;
  /** Заголовок целиком, без шаблона (главная). */
  absoluteTitle?: string;
  description: string;
  /** Путь страницы от корня: «/voprosy». */
  path: string;
  image?: string;
  imageAlt?: string;
};

/**
 * Метаданные страницы: заголовок, описание, каноническая ссылка и превью для
 * соцсетей и мессенджеров (Telegram, WhatsApp, VK берут og:*). openGraph
 * задаётся целиком на каждой странице: Next склеивает его с layout
 * поверхностно, и без картинки здесь превью осталось бы без неё.
 */
export function pageMeta({ title, absoluteTitle, description, path, image = DEFAULT_OG, imageAlt }: PageMetaInput): Metadata {
  const fullTitle = absoluteTitle ?? `${title} — ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: absoluteTitle } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      locale: 'ru_RU',
      siteName: SITE_NAME,
      url: path,
      title: fullTitle,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: imageAlt ?? fullTitle }],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [image] },
  };
}

// Описания документов для поиска. Казахские страницы — с казахским
// заголовком вместо описания: перевод описаний проверит юрист вместе с текстами.
const DOC_DESCRIPTIONS: Record<LegalDocKey, string> = {
  oferta: 'Условия участия в забегах 5&5: регистрация, оплата через Kaspi, возврат взноса, передача слота, перенос из-за погоды.',
  privacy: 'Какие персональные данные собирает 5&5, зачем, где и сколько хранит, и как отозвать согласие.',
  parentConsent: 'Бланк письменного согласия родителя для участников 16–17 лет: распечатать, заполнить и принести за стартовым пакетом.',
};

export function legalMeta(doc: LegalDocKey, lang: Lang): Metadata {
  const title = LEGAL_DOCS[doc].title[lang];
  return pageMeta({ title, description: lang === 'ru' ? DOC_DESCRIPTIONS[doc] : title, path: docPath(doc, lang) });
}

/** Время старта по Астане в ISO с поясом: «2027-05-23T09:00:00+05:00». */
export function astanaIso(date: string | number, plusMinutes = 0): string {
  const ms = (typeof date === 'number' ? date : Date.parse(date)) + (5 * 60 + plusMinutes) * 60_000;
  return new Date(ms).toISOString().slice(0, 19) + '+05:00';
}

const organizer = () => ({
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/brand/logo.png`,
});

/** Организатор и сайт — на главной. */
export function siteJsonLd() {
  return [
    { '@context': 'https://schema.org', ...organizer(), sameAs: [`https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'fiveandfive_run_bot'}`] },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_URL, inLanguage: 'ru' },
  ];
}

/**
 * Забег для поисковиков (SportsEvent): дата и место, цена, есть ли места.
 * Пока регистрация не открыта, «наличие» не указываем — ни «в продаже»,
 * ни «распродано» не было бы правдой. Пока цены не объявлены (PRICES_PUBLIC),
 * предложения с ценой нет вовсе.
 */
export function raceJsonLd(event: EventDto, description: string, path: string, open: boolean) {
  const url = `${SITE_URL}${path}`;
  const offers =
    PRICES_PUBLIC && event.price > 0
      ? {
          '@type': 'Offer',
          price: event.price,
          priceCurrency: 'KZT',
          url,
          ...(event.slotsLeft <= 0
            ? { availability: 'https://schema.org/SoldOut' }
            : open
              ? { availability: 'https://schema.org/InStock' }
              : {}),
        }
      : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.title,
    description,
    sport: 'Running',
    startDate: astanaIso(event.date),
    endDate: astanaIso(event.date, 120),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: event.location,
      address: { '@type': 'PostalAddress', addressLocality: 'Астана', addressCountry: 'KZ' },
    },
    image: [`${SITE_URL}${event.slug ? raceOg(event.slug) : DEFAULT_OG}`],
    url,
    organizer: organizer(),
    ...(offers ? { offers } : {}),
  };
}

/** JSON для <script type="application/ld+json">: «<» экранируем — не закрыть тег. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
