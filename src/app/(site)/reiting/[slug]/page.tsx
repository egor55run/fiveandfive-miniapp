import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchStageRating } from '../../../../site/data';
import { fitDescription, pageMeta } from '../../../../site/seo';
import { formatRunTime, STATUS_SHORT, type StageRow } from '../../../../lib/rating';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Almaty' });
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchStageRating(slug);
  const title = data ? `Результаты: ${data.event.title}` : 'Результаты этапа';
  return pageMeta({
    title,
    // 120–160 знаков при любом названии старта (fitDescription).
    description: fitDescription(
      data
        ? [
            `Протокол забега «${data.event.title}», ${dateFmt.format(new Date(data.event.date))}: места, время и баллы рейтинга серии 5&5, отдельно у мужчин и у женщин.`,
            'Забег на 5 км в Астане.',
            'Итоги этапа и рейтинг сезона.',
          ]
        : ['Протокол этапа серии забегов 5&5 в Астане: места, время и баллы рейтинга сезона, отдельно у мужчин и у женщин. Забег на 5 км.']
    ),
    path: `/reiting/${slug}`,
  });
}

function Protocol({ title, rows }: { title: string; rows: StageRow[] }) {
  return (
    <section className="rating-block">
      <h2 className="rating-block__title">{title}</h2>
      {rows.length === 0 ? (
        <p className="rating-empty">Нет результатов.</p>
      ) : (
        <div className="rating-table-wrap">
          <table className="rating-table">
            <thead>
              <tr>
                <th className="num">Место</th>
                <th className="num">Номер</th>
                <th>Участник</th>
                <th className="num">Время</th>
                <th className="num">Баллы</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="num">{r.place ?? '—'}</td>
                  <td className="num">{r.bib ?? '—'}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.status === 'FINISHED' && r.time !== null ? formatRunTime(r.time) : STATUS_SHORT[r.status]}</td>
                  <td className="num">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function StageResultsPage({ params }: Params) {
  const { slug } = await params;
  const data = await fetchStageRating(slug);
  if (!data) notFound();
  const final = data.protestUntil ? Date.parse(data.protestUntil) < Date.parse(new Date().toISOString()) : false;
  return (
    <main className="site-wrap rating">
      <p className="rating-back">
        <Link href="/reiting">← Рейтинг серии</Link> · <a href={`/starty/${slug}`}>Страница старта</a>
      </p>
      <h1 className="h-title">{data.event.title}</h1>
      <p className="rating-lead">
        {dateFmt.format(new Date(data.event.date))} · {data.event.location} · 5 км
      </p>
      {!data.published ? (
        <p className="rating-empty">Результаты ещё не опубликованы.</p>
      ) : (
        <>
          <p className="rating-lead">
            {final
              ? 'Результаты итоговые.'
              : `Результаты предварительные: протесты принимаем до ${dateTimeFmt.format(new Date(data.protestUntil!))} — напишите в Telegram-бот.`}
          </p>
          <Protocol title="Мужчины" rows={data.men} />
          <Protocol title="Женщины" rows={data.women} />
          <p className="rating-lead">
            Время — от выстрела. <Link href="/reiting#formula">Как считаются баллы</Link>
          </p>
        </>
      )}
    </main>
  );
}
