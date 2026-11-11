import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Header from './Header';
import { fetchEventResults, formatRunTime, matchesSearch, STATUS_SHORT, type EventResults, type ProtocolRow } from '../lib/rating';

/**
 * Протокол старта в Mini App (2026-11-11): по каждой дистанции, мужчины и
 * женщины, место и время, поиск по фамилии, имени или номеру. Своя строка
 * подсвечена. Без баллов — для любого старта.
 */
type Props = { slug: string; onBack: () => void };

export default function ResultsScreen({ slug, onBack }: Props) {
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<EventResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [distanceId, setDistanceId] = useState<number | null>(null);
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('MALE');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetchEventResults(slug)
      .then((r) => {
        if (!alive) return;
        if (!r) return setError('Результаты ещё не опубликованы');
        setData(r);
        // Сразу своя дистанция и свой пол, если человек есть в протоколе.
        const mine = r.distances.find((d) => [...d.men, ...d.women].some((x) => x.me));
        if (mine) {
          setDistanceId(mine.distanceId);
          setGender(mine.women.some((x) => x.me) ? 'FEMALE' : 'MALE');
        }
      })
      .catch(() => alive && setError('Не удалось загрузить результаты'));
    return () => {
      alive = false;
    };
  }, [slug]);

  const d = data?.distances.find((x) => x.distanceId === distanceId) ?? data?.distances[0] ?? null;
  const rows: ProtocolRow[] = d ? (gender === 'MALE' ? d.men : d.women).filter((r) => matchesSearch(query, r.name, [r.bib])) : [];

  return (
    <motion.main
      className="screen screen--tabbar rt"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header onBack={onBack} />
      <h1 className="rt__title u-display">{data?.event.title ?? 'Результаты'}</h1>
      {error && <p className="rt__empty">{error}</p>}
      {data && d && (
        <>
          {data.distances.length > 1 && (
            <div className="an-dist" role="tablist" aria-label="Дистанция">
              {data.distances.map((x) => (
                <button
                  key={x.distanceId}
                  type="button"
                  role="tab"
                  aria-selected={x.distanceId === d.distanceId}
                  className={`an-dist__btn${x.distanceId === d.distanceId ? ' an-dist__btn--on' : ''}`}
                  onClick={() => setDistanceId(x.distanceId)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
          <div className="rt-tabs" role="tablist">
            {(['MALE', 'FEMALE'] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={gender === g}
                className={`rt-tab${gender === g ? ' rt-tab--on' : ''}`}
                onClick={() => setGender(g)}
              >
                {g === 'MALE' ? 'Мужчины' : 'Женщины'}
              </button>
            ))}
          </div>
          <div className="rt-search">
            <input
              type="search"
              className="rt-search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Фамилия или номер"
              aria-label="Поиск по фамилии, имени или номеру"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          {rows.length === 0 ? (
            <p className="rt__empty">{query.trim() ? 'Никого не нашли. Проверьте написание или номер.' : 'Нет результатов.'}</p>
          ) : (
            <ol className="rt-list">
              {rows.map((r) => (
                <li key={`${r.place ?? r.status}:${r.name}:${r.bib ?? ''}`} className={`rt-row${r.me ? ' rt-row--me' : ''}`}>
                  <div className="rt-row__main">
                    <span className="rt-row__place">{r.place ?? '—'}</span>
                    <span className="rt-row__name">
                      {r.name}
                      {r.bib ? <span className="rt-row__bib"> · №{r.bib}</span> : null}
                      {r.me && <span className="rt-row__you"> · ты</span>}
                    </span>
                    <span className="rt-row__total num">
                      {r.status === 'FINISHED' && r.time !== null ? formatRunTime(r.time) : STATUS_SHORT[r.status]}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </motion.main>
  );
}
