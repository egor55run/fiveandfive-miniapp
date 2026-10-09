import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import RegistrationCta from '../../../../components/site/RegistrationCta';
import { apiAsset } from '../../../../lib/api';
import type { Lang } from '../../../../lib/legal';
import { fetchEventBySlug } from '../../../../site/data';
import { sitePath, siteText } from '../../../../site/i18n';

/**
 * Страница старта — ПРЕДВАРИТЕЛЬНАЯ: только данные из базы, чтобы карточкам
 * главной было куда вести. Оформление и тексты — этап 3 (ждём от пользователя).
 */

export const dynamic = 'force-dynamic';

const lang: Lang = 'ru';
const TZ = 'Asia/Almaty';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await fetchEventBySlug((await params).slug);
  if (!event) return {};
  const when = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
  return {
    title: event.title,
    description: `${event.distance}, ${when.format(new Date(event.date))} — ${event.location}.`,
  };
}

export default async function RacePage({ params }: Props) {
  const event = await fetchEventBySlug((await params).slug);
  if (!event) notFound();

  const t = siteText(lang);
  const date = new Date(event.date);
  const when = new Intl.DateTimeFormat(t.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
  const program = (event.program ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <main className="site-wrap race">
      <a className="race__back" href={`${sitePath('/', lang)}#starty`}>
        {t.race.back}
      </a>
      <h1 className="h-title race__title">{event.title}</h1>

      <dl className="race__facts">
        <div>
          <dt>{t.race.when}</dt>
          <dd>{when.format(date)}</dd>
        </div>
        <div>
          <dt>{t.race.place}</dt>
          <dd>{event.location}</dd>
        </div>
        <div>
          <dt>{t.race.distance}</dt>
          <dd>{event.distance}</dd>
        </div>
        <div>
          <dt>{t.race.cost}</dt>
          <dd>{event.price > 0 ? t.race.price(new Intl.NumberFormat(t.locale).format(event.price)) : t.home.priceUnknown}</dd>
        </div>
      </dl>

      <RegistrationCta event={event} lang={lang} />

      {program.length > 0 && (
        <section className="race__program">
          <h2>{t.race.program}</h2>
          <ul>
            {program.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {event.regulationsUrl && (
        <a className="race__doc" href={apiAsset(event.regulationsUrl)}>
          {t.race.regulations}
        </a>
      )}
    </main>
  );
}
