import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRunTime } from '../../../../lib/rating';
import { fetchSeasonSummary, type SeasonSummaryPage, type SummaryPodium, type SummaryTopRow } from '../../../../site/data';
import { SITE_URL, jsonLdString, pageMeta } from '../../../../site/seo';

/**
 * /itogi/<год> — итоги сезона (2026-11-12): топ-10 М и Ж, победители этапов,
 * рекорды, сезон в цифрах. До кнопки «Подвести итоги» в админке — текущий
 * рейтинг с пометкой «Сезон идёт».
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ year: string }> };

const nf = new Intl.NumberFormat('ru-RU');
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Almaty' });

const yearOf = (raw: string) => (/^\d{4}$/.test(raw) ? Number(raw) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const year = yearOf((await params).year);
  const data = year ? await fetchSeasonSummary(year) : null;
  if (!year || !data) return { title: 'Итоги сезона', robots: { index: false } };
  return pageMeta({
    title: data.published ? `Итоги сезона ${year} — забеги 5&5 в Астане` : `Сезон ${year}: рейтинг забегов 5&5 в Астане`,
    description: data.published
      ? `Итоги серии забегов 5&5 ${year} в Астане: топ-10 мужчин и женщин, победители каждого этапа, рекорды сезона на 5 км, участники и километры.`
      : `Сезон ${year} серии забегов 5&5 в Астане идёт: текущий рейтинг, топ-10 мужчин и женщин. Итоги — после финального этапа.`,
    path: `/itogi/${year}`,
  });
}

function TopTable({ title, rows }: { title: string; rows: SummaryTopRow[] }) {
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
                <th className="num">Баллы</th>
                <th className="num">Этапов</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.place}:${r.name}`}>
                  <td className="num">{r.place}</td>
                  <td>{r.name}</td>
                  <td className="num">
                    <b>{nf.format(r.total)}</b>
                  </td>
                  <td className="num">{r.stages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Podium({ rows }: { rows: SummaryPodium[] }) {
  if (rows.length === 0) return <p className="rating-empty">—</p>;
  return (
    <ol className="itogi-podium">
      {rows.map((r) => (
        <li key={`${r.place}:${r.name}`}>
          <span className="itogi-podium__place">{r.place}</span> {r.name}
          {r.time !== null && <span className="itogi-podium__time"> {formatRunTime(r.time)}</span>}
        </li>
      ))}
    </ol>
  );
}

function jsonLd(year: number, data: SeasonSummaryPage) {
  const list = (rows: SummaryTopRow[], who: string) => ({
    '@type': 'ItemList',
    name: `Топ-10 сезона ${year}: ${who}`,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: rows.length,
    itemListElement: rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: `${r.place}. ${r.name} — ${r.total} баллов` })),
  });
  const rows = 'summary' in data ? data.summary.top : data.current;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}/itogi/${year}`,
        url: `${SITE_URL}/itogi/${year}`,
        name: data.published ? `Итоги сезона ${year}` : `Сезон ${year}: текущий рейтинг`,
        inLanguage: 'ru',
        about: { '@type': 'EventSeries', name: `Серия забегов 5&5 ${year}`, location: { '@type': 'City', name: 'Астана' } },
      },
      list(rows.men, 'мужчины'),
      list(rows.women, 'женщины'),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '5&5', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: `Итоги сезона ${year}`, item: `${SITE_URL}/itogi/${year}` },
        ],
      },
    ],
  };
}

export default async function SummaryPage({ params }: Props) {
  const year = yearOf((await params).year);
  const data = year ? await fetchSeasonSummary(year) : null;
  if (!year || !data) notFound();

  const ld = <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd(year, data)) }} />;

  if (!('summary' in data)) {
    const c = data.current;
    return (
      <main className="site-wrap rating itogi">
        {ld}
        <h1 className="h-title">Сезон {year}</h1>
        <p className="itogi-badge">Сезон идёт, итоги после {data.finalDate ? dayMonth.format(new Date(data.finalDate)) : 'финального этапа'}</p>
        <p className="rating-lead">
          Пройдено этапов: {c.stagesPublished} из {c.stagesTotal}. Ниже — текущий рейтинг сезона, полная таблица —{' '}
          <Link href="/reiting">на странице рейтинга</Link>.
        </p>
        <TopTable title="Мужчины · топ-10" rows={c.men} />
        <TopTable title="Женщины · топ-10" rows={c.women} />
      </main>
    );
  }

  const s = data.summary;
  return (
    <main className="site-wrap rating itogi">
      {ld}
      <h1 className="h-title">Итоги сезона {year}</h1>
      <p className="rating-lead">
        {s.title}: {s.stagesTotal} этапов в парках Астаны. Итоговый рейтинг зафиксирован {dayMonth.format(new Date(s.publishedAt))}.
      </p>

      <section className="itogi-stats" aria-label="Сезон в цифрах">
        <div>
          <b>{nf.format(s.stats.participants)}</b>
          <span>участников</span>
        </div>
        <div>
          <b>{nf.format(s.stats.finishes)}</b>
          <span>финишей</span>
        </div>
        <div>
          <b>{nf.format(s.stats.km)}</b>
          <span>километров</span>
        </div>
        <div>
          <b>{nf.format(s.stats.stars)}</b>
          <span>собрали звезду целиком</span>
        </div>
      </section>

      <TopTable title="Мужчины · топ-10 сезона" rows={s.top.men} />
      <TopTable title="Женщины · топ-10 сезона" rows={s.top.women} />

      <section className="rating-block">
        <h2 className="rating-block__title">Рекорды сезона на 5 км</h2>
        <ul className="itogi-records">
          {s.records.men && (
            <li>
              Мужчины: <b>{formatRunTime(s.records.men.time)}</b> — {s.records.men.name}, этап {s.records.men.stage} ({s.records.men.title})
            </li>
          )}
          {s.records.women && (
            <li>
              Женщины: <b>{formatRunTime(s.records.women.time)}</b> — {s.records.women.name}, этап {s.records.women.stage} ({s.records.women.title})
            </li>
          )}
        </ul>
      </section>

      <section className="rating-block">
        <h2 className="rating-block__title">Победители этапов</h2>
        <div className="itogi-stages">
          {s.stageWinners.map((w) => (
            <article key={w.stage} className="itogi-stage">
              <h3>
                Этап {w.stage}: {w.slug ? <a href={`/reiting/${w.slug}`}>{w.title}</a> : w.title}
                <span className="itogi-stage__date"> · {dayMonth.format(new Date(w.date))}</span>
              </h3>
              <div className="itogi-stage__cols">
                <div>
                  <h4>Мужчины</h4>
                  <Podium rows={w.men} />
                </div>
                <div>
                  <h4>Женщины</h4>
                  <Podium rows={w.women} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="rating-lead">
        Полная таблица — <Link href="/reiting">на странице рейтинга</Link>. Личные итоги каждого участника — в Telegram-приложении 5&5.
      </p>
    </main>
  );
}
