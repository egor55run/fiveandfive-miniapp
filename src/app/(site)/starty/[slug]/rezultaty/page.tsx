import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import RaceResults from '../../../../../components/site/RaceResults';
import { fetchEventResults } from '../../../../../site/data';
import { fitDescription, pageMeta } from '../../../../../site/seo';

/**
 * Результаты старта по дистанциям (2026-11-11): любой старт; у этапа серии
 * протокол с баллами рейтинга — на /reiting/<старт>.
 */

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
/** Окно протестов ещё идёт (страница собирается на каждый запрос). */
const stillOpen = (iso: string) => Date.parse(iso) > Date.now();
const day = (iso: string) => dateFmt.format(new Date(iso)).replace(/\s*г\.$/, '');

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchEventResults(slug);
  if (!data || data.distances.length === 0) return { robots: { index: false } };
  const labels = data.distances.map((d) => d.label).join(', ');
  return pageMeta({
    title: `Результаты: ${data.event.title}, ${day(data.event.date)}`,
    description: fitDescription([
      `Протокол забега «${data.event.title}», ${day(data.event.date)}, ${data.event.location}: места и время на дистанциях ${labels}, отдельно у мужчин и у женщин.`,
      'Найдите себя по фамилии или стартовому номеру.',
    ]),
    path: `/starty/${slug}/rezultaty`,
  });
}

export default async function EventResultsPage({ params }: Params) {
  const { slug } = await params;
  const data = await fetchEventResults(slug);
  if (!data) notFound();
  const until = data.distances.map((d) => d.protestUntil).filter(Boolean) as string[];
  const open = until.some(stillOpen);
  return (
    <main className="site-wrap rating">
      <p className="rating-back">
        <a href={`/starty/${slug}`}>← Страница старта</a>
      </p>
      <h1 className="h-title">Результаты: {data.event.title}</h1>
      <p className="rating-lead">
        {day(data.event.date)} · {data.event.location}
      </p>
      {data.distances.length === 0 ? (
        <p className="rating-empty">Результаты ещё не опубликованы.</p>
      ) : (
        <>
          {open && (
            <p className="rating-lead">
              Результаты предварительные: протесты принимаются до {dateTimeFmt.format(new Date(until.sort().at(-1)!))}.
            </p>
          )}
          <RaceResults distances={data.distances} />
        </>
      )}
      <p className="rating-note">Время — от выстрела.</p>
    </main>
  );
}
