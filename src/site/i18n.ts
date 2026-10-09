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
    races: 'Старты',
    documents: 'Документы',
    openBot: 'Открыть в Telegram',
  },
  home: {
    title: 'Серия забегов по 5 км в Астане',
    lead: 'Пять забегов по 5 км в парках Астаны с мая по сентябрь 2027 года.',
    calendar: 'Календарь стартов',
    calendarUnavailable: 'Календарь сейчас не загрузился — обновите страницу чуть позже.',
  },
  race: {
    price: (amount: string) => `${amount} ₸`,
    registrationUntil: (date: string) => `Регистрация до ${date}`,
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
    oferta: 'Публичная оферта',
    privacy: 'Политика обработки персональных данных',
    parentConsent: 'Согласие родителя',
    organizer: 'Организатор — ИП «5&5»',
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
