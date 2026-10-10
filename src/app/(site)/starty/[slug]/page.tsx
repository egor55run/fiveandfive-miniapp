import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import RegistrationCta from '../../../../components/site/RegistrationCta';
import { apiAsset, registrationState, type EventDto } from '../../../../lib/api';
import { docPath, type Lang } from '../../../../lib/legal';
import { fetchEventBySlug, fetchEvents } from '../../../../site/data';
import { sitePath, siteText } from '../../../../site/i18n';
import { jsonLdString, pageMeta, raceJsonLd, raceOg } from '../../../../site/seo';

/**
 * Страница старта (этап 3). Дата, время, парк, цена, карта трассы и Положение —
 * из базы; общее для всех стартов (программа дня, награды, возраст) — из
 * src/site/i18n.ts. Чего ещё нет — помечено «Уточняется».
 */

export const dynamic = 'force-dynamic';

const lang: Lang = 'ru';
const TZ = 'Asia/Almaty';

type Props = { params: Promise<{ slug: string }> };

/** Парк без города: «Триатлон Парк, Астана» → «Триатлон Парк». */
const parkOf = (e: EventDto) => e.location.replace(/,\s*Астана\s*$/i, '');

/** «23 мая 2027» — для заголовка и описания в поиске. */
const dayLong = (e: EventDto) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
    .format(new Date(e.date))
    .replace(/\s*г\.$/, '');

/** Описание для поиска и превью — одно и то же в meta и в разметке события. */
function raceDescription(e: EventDto): string {
  const time = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(e.date));
  return `Забег на 5 км в Астане: ${dayLong(e)}, старт в ${time}, ${parkOf(e)}. Программа дня, трасса, награды и регистрация через Telegram.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await fetchEventBySlug((await params).slug);
  if (!event?.slug) return {};
  return pageMeta({
    title: `${event.title}: забег 5 км, ${dayLong(event)}`,
    description: raceDescription(event),
    path: `/starty/${event.slug}`,
    image: raceOg(event.slug),
    imageAlt: `${event.title}: ${dayLong(event)}, 5 км`,
  });
}

function Block({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`race-block${wide ? ' race-block--wide' : ''}`}>
      <h2 className="race-block__title">{title}</h2>
      {children}
    </section>
  );
}

export default async function RacePage({ params }: Props) {
  const [event, events] = await Promise.all([fetchEventBySlug((await params).slug), fetchEvents()]);
  if (!event) notFound();

  const t = siteText(lang);
  const r = t.race;
  const start = Date.parse(event.date);
  const dateFmt = new Intl.DateTimeFormat(t.locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  const timeFmt = new Intl.DateTimeFormat(t.locale, { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const at = (minutes: number) => timeFmt.format(new Date(start + minutes * 60_000));

  // «ЭТАП 2» / «ФИНАЛ» — по месту в календаре сезона.
  const list = events ?? [];
  const index = list.findIndex((e) => e.id === event.id);
  const label =
    index < 0 ? null : list.length > 1 && index === list.length - 1 ? t.home.finalLabel : t.home.stageLabel(index + 1);

  // Своя программа из админки (по строке на пункт) важнее общей.
  const ownProgram = (event.program ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const program =
    ownProgram.length > 0
      ? ownProgram.map((line) => ({ time: null as string | null, text: line }))
      : r.programSteps.map((s) => ({
          time: s.to === undefined ? at(s.from) : `${at(s.from)}–${at(s.to)}`,
          text: s.text,
        }));

  const price = event.price > 0 ? r.price(new Intl.NumberFormat(t.locale).format(event.price)) : t.home.priceUnknown;
  const tbd = <p className="race-tbd">{r.tbd}</p>;

  const jsonLd = raceJsonLd(event, raceDescription(event), `/starty/${event.slug}`, registrationState(event) === 'open');

  return (
    <main className="site-wrap race">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />
      <a className="race__back" href={`${sitePath('/', lang)}#starty`}>
        {r.back}
      </a>

      <header className="race__head">
        {label && <span className="race__label">{label}</span>}
        <h1 className="h-title race__title">{event.title}</h1>
      </header>

      <dl className="race__facts">
        <div>
          <dt>{r.facts.date}</dt>
          <dd>{dateFmt.format(new Date(start))}</dd>
        </div>
        <div>
          <dt>{r.facts.start}</dt>
          <dd>{at(0)}</dd>
        </div>
        <div>
          <dt>{r.facts.park}</dt>
          <dd>{parkOf(event)}</dd>
        </div>
        <div>
          <dt>{r.facts.distance}</dt>
          <dd>{event.distance}</dd>
        </div>
        <div>
          <dt>{r.facts.cutoff}</dt>
          <dd>{r.facts.cutoffValue}</dd>
        </div>
        <div>
          <dt>{r.facts.cost}</dt>
          <dd>{price}</dd>
        </div>
      </dl>

      <RegistrationCta event={event} lang={lang} />

      <div className="race__blocks">
        <Block title={r.program} wide>
          <ol className="race-program">
            {program.map((step) => (
              <li key={`${step.time}-${step.text}`}>
                {step.time && <span className="race-program__time">{step.time}</span>}
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </Block>

        <Block title={r.route} wide>
          {event.routeImageUrl ? (
            // Карта — файл из админки (webp/png/jpg до 5 МБ); next/image не нужен.
            // Она внизу страницы: грузится, когда до неё долистают.
            <img className="race-map" src={apiAsset(event.routeImageUrl)} alt={r.routeAlt(event.title)} loading="lazy" decoding="async" />
          ) : (
            <p className="race-tbd">{r.routeLater}</p>
          )}
        </Block>

        <Block title={r.venue}>{tbd}</Block>

        <Block title={r.pack}>
          <p className="race-tbd">{r.packText}</p>
        </Block>

        <Block title={r.storage}>
          <p>{r.storageText}</p>
        </Block>

        <Block title={r.awards}>
          <ul className="race-list">
            {r.awardsList.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Block>

        <Block title={r.age}>
          <p>{r.ageText}</p>
          <p>
            {r.ageMinor} <a href={docPath('parentConsent', lang)}>{r.ageMinorLink}</a>.
          </p>
        </Block>

        <Block title={r.regulations}>
          {event.regulationsUrl ? (
            <a className="race__doc" href={apiAsset(event.regulationsUrl)}>
              {r.regulationsLink}
            </a>
          ) : (
            <p className="race-tbd">{r.regulationsLater}</p>
          )}
        </Block>
      </div>
    </main>
  );
}
