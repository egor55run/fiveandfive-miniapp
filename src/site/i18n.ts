import type { Lang } from '../lib/legal';

/**
 * Тексты интерфейса сайта по языкам. Пока сайт только на русском (решение
 * пользователя 2026-10-09), но всё видимое берётся отсюда, а страницы получают
 * язык параметром: чтобы добавить казахский, достаточно заполнить `kk` здесь и
 * завести страницы под /kk/... — так уже сделаны документы (src/lib/legal.ts).
 */

const ru = {
  locale: 'ru-RU',
  brand: '5&5',
  nav: {
    label: 'Разделы сайта',
    races: 'Старты',
    medal: 'Медаль',
    price: 'Цена',
    notify: 'Узнать об открытии',
    register: 'Зарегистрироваться',
  },
  home: {
    /** Заголовок страницы для поиска и экранных чтецов; видно — «5×5». */
    heading: '5&5 — беговой сезон в Астане: пять парков по 5 км',
    lead: 'Беговой сезон в Астане. Пять воскресений, пять парков, по 5\u00a0км. Медаль за каждый этап — и звезда за все пять.',
    countdownFirst: 'До первого старта',
    countdownNext: 'До следующего старта',
    units: { days: 'дней', hours: 'часов', mins: 'минут', secs: 'секунд' },
    notifyCta: 'Узнать об открытии регистрации',
    registerCta: 'Зарегистрироваться',
    howTo: 'Регистрация через Telegram · оплата Kaspi',
    marquee: (year: string) => [
      '5 ЭТАПОВ',
      '5 КИЛОМЕТРОВ',
      `АСТАНА ${year}`,
      'СОБЕРИ ВСЕ 5',
      'ГЛАВНОЕ — ПРОДОЛЖАТЬ',
    ],
    stagesHint: 'Нажмите «Собрать луч» на этапе — и посмотрите, как собирается звезда',
    stageLabel: (n: number) => `ЭТАП ${n}`,
    finalLabel: 'ФИНАЛ',
    distance: '5 км',
    rayGot: '★ Луч собран',
    rayAdd: '+ Собрать луч',
    stageLink: (place: string, date: string) => `${place}, ${date} — подробнее о старте`,
    calendarUnavailable: 'Календарь сейчас не загрузился — обновите страницу чуть позже.',
    starTitle: 'Собери все пять',
    starDone: 'Звезда собрана!',
    /** {n} подставляет страница (в браузере, по нажатию). */
    starLabel: 'Звезда из пяти лучей, собрано {n} из 5',
    starText: (finalDate: string) =>
      `За каждый этап — медаль-луч. Лучи соединяются, и после финала ${finalDate} у вас целая звезда. Её не купить: только пробежать.`,
    motto: 'Не обязательно быть самым быстрым. Главное — продолжать.',
    priceTitle: 'Цена',
    priceText:
      'В стоимость входят стартовый пакет, номер, хронометраж, медаль финишёра и медицинская поддержка на трассе.',
    priceOne: 'ОДИН СТАРТ',
    priceOneNote: 'Любой этап на выбор',
    priceSeason: 'АБОНЕМЕНТ НА СЕЗОН',
    priceSeasonNote: 'Все 5 стартов — и звезда целиком',
    priceUnknown: '[ЦЕНА]',
    priceFrom: (amount: string) => `от ${amount}`,
  },
  race: {
    price: (amount: string) => `${amount} ₸`,
    registrationUntil: (date: string) => `Регистрация до ${date}`,
    back: '← Все старты',
    program: 'Программа дня',
    regulations: 'Положение о забеге (PDF)',
    distance: 'Дистанция',
    place: 'Место',
    when: 'Старт',
    cost: 'Стоимость',
  },
  cta: {
    register: 'Зарегистрироваться',
    soon: 'Регистрация скоро откроется',
    notify: 'Узнать об открытии в Telegram',
    ended: 'Регистрация закрыта',
    soldOut: 'Мест нет',
  },
  footer: {
    documents: 'Документы',
    telegram: 'Telegram',
    oferta: 'Оферта',
    privacy: 'Политика данных',
    parentConsent: 'Согласие родителя',
    organizer: (year: string) => `ИП «5&5» · Астана · ${year}`,
  },
};

export type SiteText = typeof ru;

const SITE_TEXT: Partial<Record<Lang, SiteText>> = { ru };

/** Тексты для языка; чего нет — по-русски. */
export function siteText(lang: Lang): SiteText {
  return SITE_TEXT[lang] ?? ru;
}

/** Адрес страницы на языке: русский — без префикса, остальные — /<lang>/… */
export function sitePath(path: string, lang: Lang): string {
  return lang === 'ru' ? path : `/${lang}${path === '/' ? '' : path}`;
}
