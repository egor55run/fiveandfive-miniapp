import type { Metadata } from 'next';
import RegistrationCta from '../../components/site/RegistrationCta';
import type { Lang } from '../../lib/legal';
import { fetchEvents } from '../../site/data';
import { siteText } from '../../site/i18n';

/**
 * ВРЕМЕННАЯ главная — основа без оформления (этап 1). Макет пришлёт
 * пользователь; до него здесь только суть: что это, календарь, кнопки.
 */

// Данные — с бэкенда на каждый запрос (см. src/site/data.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: '5&5 — серия забегов по 5 км в Астане' },
  description: 'Пять забегов по 5 км в парках Астаны с мая по сентябрь 2027 года.',
};

const lang: Lang = 'ru';

export default async function HomePage() {
  const t = siteText(lang);
  const events = await fetchEvents();
  const when = new Intl.DateTimeFormat(t.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Almaty',
  });
  const price = new Intl.NumberFormat(t.locale);

  return (
    <main className="site-wrap home">
      <section className="home__intro">
        <h1 className="home__title">{t.home.title}</h1>
        <p className="home__lead">{t.home.lead}</p>
      </section>

      <section className="home__calendar" id="starty" aria-labelledby="starty-title">
        <h2 id="starty-title">{t.home.calendar}</h2>
        {events === null ? (
          <p>{t.home.calendarUnavailable}</p>
        ) : (
          <ul className="race-list">
            {events.map((e) => (
              <li className="race-row" key={e.id}>
                <div className="race-row__main">
                  <span className="race-row__when">{when.format(new Date(e.date))}</span>
                  <span className="race-row__title">{e.title}</span>
                  <span className="race-row__meta">
                    {e.location} · {e.distance} · {t.race.price(price.format(e.price))}
                  </span>
                </div>
                <RegistrationCta event={e} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
