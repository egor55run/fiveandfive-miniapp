import type { Metadata } from 'next';
import PointsCalculator from '../../../components/site/PointsCalculator';
import { fetchSeasonRating } from '../../../site/data';
import { pageMeta } from '../../../site/seo';
import type { SeasonRow } from '../../../lib/rating';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMeta({
  title: 'Рейтинг серии',
  description:
    'Рейтинг серии забегов 5&5: баллы за каждый этап по времени на 5 км, сумма за сезон, отдельно мужчины и женщины. Калькулятор баллов.',
  path: '/reiting',
});

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' });

function Table({ title, rows, events }: { title: string; rows: SeasonRow[]; events: { id: number; title: string }[] }) {
  return (
    <section className="rating-block">
      <h2 className="rating-block__title">{title}</h2>
      {rows.length === 0 ? (
        <p className="rating-empty">Пока нет результатов.</p>
      ) : (
        <div className="rating-table-wrap">
          <table className="rating-table">
            <thead>
              <tr>
                <th className="num">Место</th>
                <th>Участник</th>
                {events.map((e, i) => (
                  <th key={e.id} className="num" title={e.title}>
                    {i + 1}
                  </th>
                ))}
                <th className="num">Баллы</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="num">{r.place}</td>
                  <td>{r.name}</td>
                  {r.stages.map((p, i) => (
                    <td key={i} className="num">
                      {p ?? '—'}
                    </td>
                  ))}
                  <td className="num">
                    <b>{r.total}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function RatingPage() {
  const data = await fetchSeasonRating();
  return (
    <main className="site-wrap rating">
      <h1 className="h-title">Рейтинг серии</h1>
      {data && (
        <p className="rating-lead">
          {data.season.title}. Этапы:{' '}
          {data.events.map((e, i) => (
            <span key={e.id}>
              {i > 0 ? ' · ' : ''}
              {i + 1}.{' '}
              {e.published && e.slug ? <a href={`/reiting/${e.slug}`}>{e.title}</a> : e.title}, {dateFmt.format(new Date(e.date))}
            </span>
          ))}
        </p>
      )}
      {!data ? (
        <p className="rating-empty">Рейтинг появится после первого этапа.</p>
      ) : (
        <>
          <Table title="Мужчины" rows={data.men} events={data.events} />
          <Table title="Женщины" rows={data.women} events={data.events} />
        </>
      )}

      <section className="rating-block" id="formula">
        <h2 className="rating-block__title">Как считаются баллы</h2>
        <p>Баллы за этап зависят от времени на 5 км. Итог сезона — сумма за все этапы, отдельно у мужчин и женщин.</p>
        <PointsCalculator />
      </section>
    </main>
  );
}
