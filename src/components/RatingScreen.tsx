import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Header from './Header';
import { fetchSeasonRating, matchesSearch, type RatingGender, type SeasonRating } from '../lib/rating';
import { openExternalPage } from '../lib/telegram';

/**
 * «Рейтинг» в Mini App: таблица сезона, отдельно мужчины и женщины. Своя
 * строка подсвечена. Нажатие на строку — баллы по этапам. Поиск по фамилии,
 * имени или номеру фильтрует список; «Найти меня» прокручивает к своей
 * строке и подсвечивает её (2026-10-28).
 */
type Props = { myGender?: RatingGender | null };

function RatingScreen({ myGender }: Props) {
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<SeasonRating | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [gender, setGender] = useState<RatingGender>(myGender ?? 'MALE');
  const [open, setOpen] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  // Строка, к которой прокрутили «Найти меня», — подсвечивается на пару секунд.
  const [found, setFound] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let alive = true;
    fetchSeasonRating()
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Не удалось загрузить рейтинг'));
    return () => {
      alive = false;
    };
  }, []);

  const all = data ? (gender === 'MALE' ? data.men : data.women) : [];
  const rows = all.filter((r) => matchesSearch(query, r.name, r.bibs ?? []));

  const findMe = () => {
    setNotice(null);
    const mine = data ? [...data.men, ...data.women].find((r) => r.me) : null;
    if (!mine) {
      setNotice('Вас пока нет в рейтинге — он появится после первого этапа с вашим результатом.');
      return;
    }
    setQuery('');
    setGender(mine.gender);
    setFound(mine.userId);
    // После перерисовки — прокрутить к своей строке.
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-user="${mine.userId}"]`);
      el?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
    window.setTimeout(() => setFound((v) => (v === mine.userId ? null : v)), 2500);
  };
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

      {data && all.length > 0 && (
        <div className="rt-search">
          <input
            type="search"
            className="rt-search__input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotice(null);
            }}
            placeholder="Фамилия, имя или номер"
            aria-label="Поиск по фамилии, имени или номеру"
            autoComplete="off"
            enterKeyHint="search"
          />
          <button type="button" className="rt-search__me" onClick={findMe}>
            Найти меня
          </button>
        </div>
      )}
      {notice && <p className="rt__empty">{notice}</p>}

      {error ? (
        <p className="rt__empty">{error}</p>
      ) : data === undefined ? (
        <p className="rt__empty">Загружаем…</p>
      ) : !data || all.length === 0 ? (
        <p className="rt__empty">Рейтинг появится после первого этапа</p>
      ) : rows.length === 0 ? (
        <p className="rt__empty">Никого не нашли. Проверьте написание или номер.</p>
      ) : (
        <ol className="rt-list" ref={listRef}>
          {rows.map((r) => (
            <li
              key={r.userId}
              data-user={r.userId}
              className={`rt-row${r.me ? ' rt-row--me' : ''}${found === r.userId ? ' rt-row--found' : ''}`}
            >
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
