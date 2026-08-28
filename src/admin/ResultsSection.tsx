import { useEffect, useState } from 'react';
import {
  deleteResult,
  getEvents,
  getParticipants,
  getResults,
  putResult,
  type AdminEvent,
  type Participant,
  type ResultRow,
} from './api';
import { formatDate, formatSeconds, fullName, parseTimeToSeconds } from './helpers';

export default function ResultsSection() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  useEffect(() => {
    getEvents()
      .then((list) => {
        setEvents(list);
        if (list.length > 0) setEventId(list[0].id);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Не удалось загрузить старты'),
      );
  }, []);

  const load = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([getParticipants(id), getResults(id)]);
      // Отменённым результат вносить нельзя — сервер откажет, поэтому и не показываем.
      setParticipants(p.participants.filter((x) => x.paymentStatus !== 'CANCELLED'));
      setResults(r.results);
      setDrafts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
      setParticipants([]);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Как и в разделе участников: загрузка данных по выбранному старту.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (eventId !== null) void load(eventId);
  }, [eventId]);

  const save = async (p: Participant) => {
    if (eventId === null) return;
    const raw = drafts[p.userId] ?? '';
    const seconds = parseTimeToSeconds(raw);
    if (seconds === null) {
      setError(`Не разобрал время «${raw}». Формат: 22:14 или 1:05:30`);
      return;
    }

    setBusyUserId(p.userId);
    setError(null);
    setNotice(null);
    try {
      const res = await putResult(eventId, p.userId, seconds);
      setResults(res.results);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.userId];
        return next;
      });
      const mine = res.results.find((r) => r.userId === p.userId);
      setNotice(
        `${fullName(p.lastName, p.firstName)}: ${formatSeconds(seconds)}` +
          (mine ? `, место ${mine.place}` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить результат');
    } finally {
      setBusyUserId(null);
    }
  };

  const remove = async (row: ResultRow) => {
    setBusyUserId(row.userId);
    setError(null);
    setNotice(null);
    try {
      const res = await deleteResult(row.id);
      setResults(res.results);
      setNotice(`Результат ${fullName(row.lastName, row.firstName)} снят, места пересчитаны`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось снять результат');
    } finally {
      setBusyUserId(null);
    }
  };

  const resultByUser = new Map(results.map((r) => [r.userId, r]));

  return (
    <section className="ad-section">
      <header className="ad-section__head">
        <h2>Результаты</h2>
        <div className="ad-actions">
          <select value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))}>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} — {formatDate(e.date)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ad-btn"
            onClick={() => eventId !== null && void load(eventId)}
          >
            Обновить
          </button>
        </div>
      </header>

      <p className="ad-hint">
        Вводится только время — место сервер считает сам, сортировкой по всему старту.
        Равные времена делят место (1, 2, 2, 4).
      </p>

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}

      {loading ? (
        <p className="ad-msg">Загружаем…</p>
      ) : participants.length === 0 ? (
        <p className="ad-msg">На этот старт нет активных регистраций</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th className="num">Место</th>
                <th>ФИО</th>
                <th>Внесённое время</th>
                <th>Новое время</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const row = resultByUser.get(p.userId);
                const busy = busyUserId === p.userId;
                return (
                  <tr key={p.userId}>
                    <td className="num">{row ? row.place : '—'}</td>
                    <td>{fullName(p.lastName, p.firstName)}</td>
                    <td className="num">{row ? formatSeconds(row.finishTime) : '—'}</td>
                    <td>
                      <input
                        className="ad-input--time"
                        value={drafts[p.userId] ?? ''}
                        placeholder={row ? formatSeconds(row.finishTime) : '22:14'}
                        disabled={busy}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [p.userId]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void save(p);
                        }}
                      />
                    </td>
                    <td className="ad-nowrap">
                      <button
                        type="button"
                        className="ad-btn ad-btn--sm ad-btn--primary"
                        disabled={busy || !(drafts[p.userId] ?? '').trim()}
                        onClick={() => void save(p)}
                      >
                        {row ? 'Изменить' : 'Внести'}
                      </button>
                      {row && (
                        <button
                          type="button"
                          className="ad-btn ad-btn--sm ad-btn--danger"
                          disabled={busy}
                          onClick={() => void remove(row)}
                        >
                          Снять
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {results.length > 0 && (
        <div className="ad-card">
          <h3>Протокол ({results.length})</h3>
          <ol className="ad-protocol">
            {results.map((r) => (
              <li key={r.id}>
                <span className="num">{r.place}</span>
                <span>{fullName(r.lastName, r.firstName)}</span>
                <span className="num">{formatSeconds(r.finishTime)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
