import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Header from './Header';
import { fetchSeasonRating, type RatingGender, type SeasonRating } from '../lib/rating';
import { openExternalPage } from '../lib/telegram';

/**
 * «Рейтинг» в Mini App: таблица сезона, отдельно мужчины и женщины. Своя
 * строка подсвечена и видна с именем, даже если скрыта из публичного
 * рейтинга. Нажатие на строку — баллы по этапам.
 */
type Props = { myGender?: RatingGender | null };

function RatingScreen({ myGender }: Props) {
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<SeasonRating | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [gender, setGender] = useState<RatingGender>(myGender ?? 'MALE');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSeasonRating()
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Не удалось загрузить рейтинг'));
    return () => {
      alive = false;
    };
  }, []);

  const rows = data ? (gender === 'MALE' ? data.men : data.women) : [];
  const published = data?.events.filter((e) => e.published).length ?? 0;

  return (
    <motion.main
      className="screen screen--tabbar rt"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header />
      <h2 className="rt__title u-display">Рейтинг серии</h2>
      {data && (
        <p className="rt__sub">
          {data.season.title} · этапов с результатами: {published} из {data.events.length}
        </p>
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

      {error ? (
        <p className="rt__empty">{error}</p>
      ) : data === undefined ? (
        <p className="rt__empty">Загружаем…</p>
      ) : !data || rows.length === 0 ? (
        <p className="rt__empty">Рейтинг появится после первого этапа</p>
      ) : (
        <ol className="rt-list">
          {rows.map((r) => (
            <li key={r.userId} className={`rt-row${r.me ? ' rt-row--me' : ''}`}>
              <button type="button" className="rt-row__main" onClick={() => setOpen(open === r.userId ? null : r.userId)}>
                <span className="rt-row__place">{r.place}</span>
                <span className="rt-row__name">
                  {r.name}
                  {r.me && <span className="rt-row__you"> · вы</span>}
                </span>
                <span className="rt-row__total">{r.total}</span>
              </button>
              {open === r.userId && data && (
                <div className="rt-row__stages">
                  {data.events.map((e, i) => (
                    <span key={e.id}>
                      {i + 1}. {e.title}: <b>{r.stages[i] ?? '—'}</b>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="rt__note">
        Каждый этап приносит баллы. Лучшие по итогам сезона получат главные призы. Калькулятор —{' '}
        <a
          href="https://fiveandfive.kz/reiting"
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (openExternalPage('/reiting')) e.preventDefault();
          }}
        >
          fiveandfive.kz/reiting
        </a>
      </p>
    </motion.main>
  );
}

export default RatingScreen;
