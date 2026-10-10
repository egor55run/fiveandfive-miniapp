import type { Metadata } from 'next';
import AnimPause from '../../components/site/home/AnimPause';
import Countdown from '../../components/site/home/Countdown';
import StagesStar, { type Stage } from '../../components/site/home/StagesStar';
import type { EventDto } from '../../lib/api';
import type { Lang } from '../../lib/legal';
import { anyRegistrationOpen, botChatLink, fetchEvents, fetchSeasonPrice } from '../../site/data';
import { sitePath, siteText } from '../../site/i18n';
import { jsonLdString, pageMeta, siteJsonLd } from '../../site/seo';

/**
 * Главная сайта — по утверждённому макету (glavnaya-maket-D, 2026-10-09).
 * Даты, места, время и цены — из базы; тексты — из src/site/i18n.ts.
 */

// Данные — с бэкенда на каждый запрос (см. src/site/data.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMeta({
  absoluteTitle: '5&5 — беговой сезон в Астане: пять забегов по 5 км в парках',
  description:
    'Серия любительских забегов на 5 км в парках Астаны с мая по сентябрь 2027: пять воскресений, медаль за каждый этап и звезда за все пять. Регистрация через Telegram, оплата Kaspi.',
  path: '/',
});

const lang: Lang = 'ru';
const TZ = 'Asia/Almaty';

/** Место без города: «Триатлон Парк, Астана» → «Триатлон Парк». */
const placeOf = (e: EventDto) => e.location.replace(/,\s*Астана\s*$/i, '');

/** Цена одного старта: одна на все — она; разные — «от»; нет — заглушка. */
function singlePrice(events: EventDto[], fmt: (n: number) => string, t: ReturnType<typeof siteText>) {
  const prices = events.map((e) => e.price).filter((p) => p > 0);
  if (prices.length === 0) return t.home.priceUnknown;
  const min = Math.min(...prices);
  return prices.every((p) => p === min) ? fmt(min) : t.home.priceFrom(fmt(min));
}

/** Номер ближайшего ещё не начавшегося старта (-1 — сезон прошёл). */
function upcomingIndex(events: EventDto[]): number {
  const now = Date.now();
  return events.findIndex((e) => Date.parse(e.date) > now);
}

export default async function HomePage() {
  const t = siteText(lang);
  const [events, seasonPrice] = await Promise.all([fetchEvents(), fetchSeasonPrice()]);
  const list = events ?? [];
  const open = anyRegistrationOpen(events);

  const dayFmt = new Intl.DateTimeFormat(t.locale, { day: 'numeric', month: 'long', timeZone: TZ });
  const timeFmt = new Intl.DateTimeFormat(t.locale, { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const yearFmt = new Intl.DateTimeFormat(t.locale, { year: 'numeric', timeZone: TZ });
  const money = new Intl.NumberFormat(t.locale);
  const fmt = (n: number) => money.format(n);

  const stages: Stage[] = list.map((e, i) => {
    const parts = dayFmt.formatToParts(new Date(e.date));
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const isFinal = list.length > 1 && i === list.length - 1;
    return {
      key: e.id,
      href: e.slug ? sitePath(`/starty/${e.slug}`, lang) : '#starty',
      label: isFinal ? t.home.finalLabel : t.home.stageLabel(i + 1),
      day,
      month,
      place: placeOf(e),
      time: timeFmt.format(new Date(e.date)),
      linkLabel: t.home.stageLink(placeOf(e), `${day} ${month}`),
    };
  });

  // Отсчёт — до ближайшего ещё не прошедшего старта.
  const nextIndex = upcomingIndex(list);
  const next = nextIndex >= 0 ? list[nextIndex] : null;
  const last = list.at(-1);
  const year = list[0] ? yearFmt.format(new Date(list[0].date)) : '';
  const marquee = t.home.marquee(year);
  const ctaHref = botChatLink(open ? undefined : 'notify');

  return (
    <main className="home">
      <AnimPause />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(siteJsonLd()) }} />

      <section className="site-wrap h-hero" id="top">
        <div className="h-hero__row">
          <h1 className="h-five" data-anim>
            <span className="h-metal" aria-hidden="true">
              5×5
            </span>
            <span className="visually-hidden">{t.home.heading}</span>
          </h1>
          <div className="h-hero__side">
            <p className="h-hero__lead">{t.home.lead}</p>
            {next && (
              <Countdown
                target={next.date}
                label={nextIndex === 0 ? t.home.countdownFirst : t.home.countdownNext}
                units={t.home.units}
              />
            )}
          </div>
        </div>
        <div className="h-hero__cta">
          <a className="site-btn site-btn--brand site-btn--lg" href={ctaHref}>
            {open ? t.home.registerCta : t.home.notifyCta}
          </a>
          <span className="h-hero__how">{t.home.howTo}</span>
        </div>
      </section>

      <div className="h-marquee" data-anim aria-hidden="true">
        <div className="h-marquee__track">
          {[0, 1].map((copy) =>
            marquee.map((word) => (
              <span className="h-marquee__item" key={`${copy}-${word}`}>
                <span>{word}</span>
                <span className="h-marquee__star">★</span>
              </span>
            )),
          )}
        </div>
      </div>

      {events === null ? (
        <p className="site-wrap h-stages__hint" id="starty">
          {t.home.calendarUnavailable}
        </p>
      ) : (
        <StagesStar
          stages={stages}
          t={{
            hint: t.home.stagesHint,
            distance: t.home.distance,
            rayGot: t.home.rayGot,
            rayAdd: t.home.rayAdd,
            starTitle: t.home.starTitle,
            starDone: t.home.starDone,
            starLabel: t.home.starLabel,
            // «5 сентября» — неразрывно, чтобы число не осталось в конце строки.
            starText: t.home.starText(last ? dayFmt.format(new Date(last.date)).replace(' ', '\u00a0') : ''),
            motto: t.home.motto,
          }}
        />
      )}

      <section className="site-wrap h-price" id="cena">
        <div className="h-price__intro">
          <h2 className="h-title">{t.home.priceTitle}</h2>
          <p className="h-price__text">{t.home.priceText}</p>
        </div>
        <div className="h-price__card h-lift">
          <span className="h-price__kind">{t.home.priceOne}</span>
          <span className="h-price__sum">{singlePrice(list, fmt, t)} ₸</span>
          <span className="h-price__note">{t.home.priceOneNote}</span>
        </div>
        <div className="h-price__card h-price__card--brand h-lift">
          <span className="h-price__kind">{t.home.priceSeason}</span>
          <span className="h-price__sum">{seasonPrice ? fmt(seasonPrice) : t.home.priceUnknown} ₸</span>
          <span className="h-price__note">{t.home.priceSeasonNote}</span>
        </div>
      </section>
    </main>
  );
}
