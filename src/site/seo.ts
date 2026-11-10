import type { Metadata } from 'next';
import type { EventDto } from '../lib/api';
import { docPath, KK_ENABLED, LEGAL_DOCS, type Lang, type LegalDocKey } from '../lib/legal';
import { botRaceLink } from './links';

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
  /** Язык страницы (og:locale). */
  lang?: Lang;
  /** Языковые версии страницы для hreflang: { ru: '/oferta', kk: '/kk/oferta' }. */
  languages?: Partial<Record<Lang, string>>;
};

/**
 * Метаданные страницы: заголовок, описание, каноническая ссылка и превью для
 * соцсетей и мессенджеров (Telegram, WhatsApp, VK берут og:*). openGraph
 * задаётся целиком на каждой странице: Next склеивает его с layout
 * поверхностно, и без картинки здесь превью осталось бы без неё.
 */
export function pageMeta({ title, absoluteTitle, description, path, image = DEFAULT_OG, imageAlt, lang = 'ru', languages }: PageMetaInput): Metadata {
  const fullTitle = absoluteTitle ?? `${title} — ${SITE_NAME}`;
  // Корень — «https://fiveandfive.kz/», как в sitemap.xml: из пути «/» Next
  // собирает адрес без слеша, и canonical главной расходился с sitemap
  // (Google Search Console, 2026-10-27). Остальные страницы — без слеша на конце.
  const url = path === '/' ? `${SITE_URL}/` : path;
  return {
    title: absoluteTitle ? { absolute: absoluteTitle } : title,
    description,
    alternates: {
      canonical: url,
      // hreflang: каждая языковая версия ссылается на все, включая себя;
      // x-default — русская (2026-11-01).
      ...(languages ? { languages: { ...languages, 'x-default': languages.ru ?? path } } : {}),
    },
    openGraph: {
      type: 'website',
      locale: lang === 'kk' ? 'kk_KZ' : 'ru_RU',
      ...(languages && Object.keys(languages).length > 1
        ? { alternateLocale: lang === 'kk' ? ['ru_RU'] : ['kk_KZ'] }
        : {}),
      siteName: SITE_NAME,
      url,
      title: fullTitle,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: imageAlt ?? fullTitle }],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [image] },
  };
}

/**
 * Длина meta description: 120–160 знаков (Bing Webmaster Tools, 2026-10-24).
 * Описания из шаблонов (страницы стартов, протоколы) собираются из частей:
 * пока короче минимума — добавляется следующая часть; длиннее максимума —
 * обрезается по слову.
 */
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

export function fitDescription(parts: string[]): string {
  let out = parts[0];
  for (const part of parts.slice(1)) {
    if (out.length >= DESCRIPTION_MIN) break;
    const next = `${out} ${part}`;
    if (next.length <= DESCRIPTION_MAX) out = next;
  }
  if (out.length > DESCRIPTION_MAX) out = `${out.slice(0, DESCRIPTION_MAX - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

// Описания документов для поиска — у каждой страницы своё, ru и kk, 120–160 знаков.
const DOC_DESCRIPTIONS: Record<LegalDocKey, Record<Lang, string>> = {
  oferta: {
    ru: 'Публичная оферта серии забегов 5&5: регистрация и оплата через Kaspi, возврат стартового взноса, передача слота, перенос забега из-за погоды.',
    kk: '5&5 жарыстар сериясының жария офертасы: тіркелу және Kaspi арқылы төлеу, жарнаны қайтару, слотты беру, ауа райына байланысты жарысты ауыстыру.',
  },
  privacy: {
    ru: 'Политика обработки персональных данных 5&5: какие данные мы собираем и зачем, где и сколько храним, кому передаём и как отозвать согласие.',
    kk: '5&5 дербес деректерді өңдеу саясаты: қандай деректер не үшін жиналады, қайда және қанша сақталады, кімге беріледі, келісімді қалай қайтаруға болады.',
  },
  parentConsent: {
    ru: 'Бланк письменного согласия родителя для участников забегов 5&5 в возрасте 16–17 лет: распечатайте, заполните и принесите за стартовым пакетом.',
    kk: '5&5 жарыстарына қатысатын 16–17 жастағылар үшін ата-ана келісімінің бланкі: басып шығарып, толтырыңыз және стартлық пакетті алғанда әкеліңіз.',
  },
};

export function legalMeta(doc: LegalDocKey, lang: Lang): Metadata {
  const title = LEGAL_DOCS[doc].title[lang];
  return pageMeta({
    title,
    description: DOC_DESCRIPTIONS[doc][lang],
    path: docPath(doc, lang),
    lang,
    // Казахская версия есть только там, где она включена (KK_ENABLED).
    languages: KK_ENABLED ? { ru: docPath(doc, 'ru'), kk: docPath(doc, 'kk') } : undefined,
  });
}

/** Время старта по Астане в ISO с поясом: «2027-05-23T09:00:00+05:00». */
export function astanaIso(date: string | number, plusMinutes = 0): string {
  const ms = (typeof date === 'number' ? date : Date.parse(date)) + (5 * 60 + plusMinutes) * 60_000;
  return new Date(ms).toISOString().slice(0, 19) + '+05:00';
}

const BOT_URL = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'fiveandfive_run_bot'}`;

const organizer = () => ({
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/brand/logo.png`,
});

/** Место старта: у этапов — парк в Астане; у отдельного старта — место как задано. */
const placeOf = (event: EventDto) => ({
  '@type': 'Place',
  name: event.location,
  address:
    event.seriesStage === false
      ? { '@type': 'PostalAddress', addressLocality: event.location, addressCountry: 'KZ' }
      : { '@type': 'PostalAddress', addressLocality: 'Астана', addressRegion: 'Астана', addressCountry: 'KZ' },
});

/** Парк без города: «Триатлон Парк, Астана» → «Триатлон Парк». */
export const parkName = (event: EventDto) => event.location.replace(/,\s*Астана\s*$/i, '');

/** Организатор и сайт — на главной. */
export function siteJsonLd() {
  return [
    {
      '@context': 'https://schema.org',
      ...organizer(),
      // Как бренд пишут и ищут (2026-11-10).
      alternateName: ['FIVE&FIVE', '5&5 RUN', '5и5', 'Файв энд файв'],
      description: 'Серия из пяти забегов на 5 км в парках Астаны: этапы с мая по сентябрь, медаль за каждый этап и рейтинг сезона.',
      areaServed: { '@type': 'City', name: 'Астана' },
      address: { '@type': 'PostalAddress', addressLocality: 'Астана', addressCountry: 'KZ' },
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', url: BOT_URL, availableLanguage: ['ru', 'kk'] },
      sameAs: [BOT_URL],
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_URL, inLanguage: 'ru' },
  ];
}

/**
 * Забег для поисковиков (SportsEvent): дата и место, цена, есть ли места.
 * Пока регистрация не открыта, «наличие» не указываем — ни «в продаже»,
 * ни «распродано» не было бы правдой. Пока цены не объявлены (PRICES_PUBLIC),
 * предложения с ценой нет вовсе.
 */
export function raceJsonLd(event: EventDto, description: string, path: string, open: boolean, registrationOpenedAt: string | null = null) {
  const url = `${SITE_URL}${path}`;
  const distances = event.distances?.length
    ? event.distances
    : [{ label: event.distance, price: event.price, slotsLeft: event.slotsLeft }];
  // «Показывать цены» из админки (2026-11-10): цена, валюта, наличие мест и
  // начало продаж — дата, когда в админке открыли регистрацию.
  const offerList = event.pricesPublic === true
    ? distances
        .filter((d) => d.price > 0)
        .map((d) => ({
          '@type': 'Offer',
          name: d.label,
          price: d.price,
          priceCurrency: 'KZT',
          url,
          ...(d.slotsLeft <= 0
            ? { availability: 'https://schema.org/SoldOut' }
            : open
              ? { availability: 'https://schema.org/InStock' }
              : {}),
          ...(registrationOpenedAt ? { validFrom: astanaIso(registrationOpenedAt) } : {}),
        }))
    : [];
  // Цены не объявлены — предложение без цены: только ссылка на регистрацию
  // (в Mini App на этом старте) и, если запись идёт, «в продаже».
  const registration = event.slug ? botRaceLink(event.slug) : url;
  if (offerList.length === 0) {
    offerList.push({
      '@type': 'Offer',
      name: 'Регистрация',
      url: registration,
      ...(open ? { availability: 'https://schema.org/InStock' } : {}),
    } as (typeof offerList)[number]);
  } else {
    for (const o of offerList) o.url = registration;
  }
  const offers = offerList.length === 1 ? offerList[0] : offerList;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.seriesStage === false ? event.title : `Забег 5 км в Астане — ${event.title}`,
    description,
    sport: 'Running',
    startDate: astanaIso(event.date),
    endDate: astanaIso(event.date, 120),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: placeOf(event),
    image: [`${SITE_URL}${event.slug ? raceOg(event.slug) : DEFAULT_OG}`],
    url,
    organizer: organizer(),
    // Отдельный старт в серию не входит (2026-11-11).
    ...(event.seriesStage === false ? {} : { superEvent: { '@type': 'EventSeries', name: 'Серия забегов 5&5 2027', url: `${SITE_URL}${HUB_PATH}` } }),
    offers,
  };
}

/** Хаб «Забеги в Астане 2027». */
export const HUB_PATH = '/zabegi-v-astane-2027';

/** Список этапов для хаба: ссылки на страницы стартов по порядку. */
export function hubJsonLd(events: EventDto[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Забеги в Астане 2027',
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: events.length,
    itemListElement: events.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/starty/${e.slug}`,
      name: `${parkName(e)} — забег 5 км`,
    })),
  };
}

/** JSON для <script type="application/ld+json">: «<» экранируем — не закрыть тег. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
