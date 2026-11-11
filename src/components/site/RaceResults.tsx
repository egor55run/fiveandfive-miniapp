'use client';

import { useState } from 'react';
import { formatRunTime, matchesSearch, STATUS_SHORT, type DistanceProtocol, type ProtocolRow } from '../../lib/rating';

/**
 * Протокол старта на сайте (/starty/<старт>/rezultaty, 2026-11-11): по каждой
 * дистанции отдельно, мужчины и женщины, место и время, поиск по фамилии,
 * имени или номеру. Без баллов — их у отдельных стартов нет.
 */
function Table({ title, rows }: { title: string; rows: ProtocolRow[] }) {
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.place ?? r.status}:${r.name}:${r.bib ?? ''}`}>
                  <td className="num">{r.place ?? '—'}</td>
                  <td className="num">{r.bib ?? '—'}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.status === 'FINISHED' && r.time !== null ? formatRunTime(r.time) : STATUS_SHORT[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function RaceResults({ distances }: { distances: DistanceProtocol[] }) {
  const [active, setActive] = useState(distances[0]?.distanceId ?? 0);
  const [query, setQuery] = useState('');
  const d = distances.find((x) => x.distanceId === active) ?? distances[0];
  if (!d) return <p className="rating-empty">Результаты ещё не опубликованы.</p>;
  const filter = (rows: ProtocolRow[]) => rows.filter((r) => matchesSearch(query, r.name, [r.bib]));
  const men = filter(d.men);
  const women = filter(d.women);
  const searching = query.trim() !== '';
  return (
    <>
      {distances.length > 1 && (
        <div className="race-results__tabs" role="tablist" aria-label="Дистанция">
          {distances.map((x) => (
            <button
              key={x.distanceId}
              type="button"
              role="tab"
              aria-selected={x.distanceId === d.distanceId}
              className={`race-results__tab${x.distanceId === d.distanceId ? ' race-results__tab--on' : ''}`}
              onClick={() => setActive(x.distanceId)}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      <label className="rating-search">
        <span className="visually-hidden">Поиск по фамилии, имени или номеру</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти себя: фамилия, имя или номер"
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      {searching && men.length === 0 && women.length === 0 ? (
        <p className="rating-empty">Никого не нашли. Проверьте написание или номер.</p>
      ) : (
        <>
          {(!searching || men.length > 0) && <Table title={`Мужчины · ${d.label}`} rows={men} />}
          {(!searching || women.length > 0) && <Table title={`Женщины · ${d.label}`} rows={women} />}
        </>
      )}
    </>
  );
}
