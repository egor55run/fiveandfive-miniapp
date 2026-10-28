'use client';

import { useState } from 'react';
import { formatRunTime, matchesSearch, STATUS_SHORT, type StageRow } from '../../lib/rating';

/**
 * Протокол этапа на сайте (/reiting/<старт>) с поиском себя: по фамилии/имени
 * или стартовому номеру, список фильтруется на лету (2026-10-28).
 */
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

export default function StageProtocol({ men, women }: { men: StageRow[]; women: StageRow[] }) {
  const [query, setQuery] = useState('');
  const filter = (rows: StageRow[]) => rows.filter((r) => matchesSearch(query, r.name, [r.bib]));
  const m = filter(men);
  const w = filter(women);
  const searching = query.trim() !== '';
  return (
    <>
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
      {searching && m.length === 0 && w.length === 0 ? (
        <p className="rating-empty">Никого не нашли. Проверьте написание или номер.</p>
      ) : (
        <>
          {(!searching || m.length > 0) && <Protocol title="Мужчины" rows={m} />}
          {(!searching || w.length > 0) && <Protocol title="Женщины" rows={w} />}
        </>
      )}
    </>
  );
}
