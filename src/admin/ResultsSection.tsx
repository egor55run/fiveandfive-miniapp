import { useEffect, useState } from 'react';
import {
  AdminApiError,
  deleteResult,
  getEvents,
  getParticipants,
  getResults,
  importResults,
  publishResults,
  putResult,
  unpublishResults,
  type AdminEvent,
  type ImportPreview,
  type Participant,
  type ResultRow,
  type ResultsEventInfo,
  type ResultStatus,
} from './api';
import { formatDate, formatDateTime, formatSeconds, fullName, parseTimeToSeconds } from './helpers';

/**
 * Результаты старта (решения пользователя 2026-10-23): одно время — от
 * выстрела, из файла хронометража; статус финиш / сошёл / не стартовал /
 * дисквалифицирован; места и баллы рейтинга считает сервер, отдельно М и Ж.
 * «Опубликовать» — результаты видны участникам, 48 часов окно протестов;
 * после него правки — с подтверждением.
 */

const STATUS_LABEL: Record<ResultStatus, string> = {
  FINISHED: 'Финиш',
  DNF: 'Сошёл',
  DNS: 'Не стартовал',
  DSQ: 'Дисквалифицирован',
};
const STATUS_SHORT: Record<ResultStatus, string> = { FINISHED: '', DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ' };

type Draft = { status: ResultStatus; time: string };

/** Момент уже прошёл (вне рендера — правило чистоты компонентов). */
const isPast = (iso: string) => Date.now() > Date.parse(iso);

export default function ResultsSection() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [info, setInfo] = useState<ResultsEventInfo | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  // Загрузка файла хронометража: текст файла и предпросмотр.
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [missingAsDns, setMissingAsDns] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getEvents()
      .then((list) => {
        setEvents(list);
        if (list.length > 0) setEventId(list[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить старты'));
  }, []);

  const load = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([getParticipants(id), getResults(id)]);
      // Отменённым результат вносить нельзя — сервер откажет, поэтому и не показываем.
      setParticipants(p.participants.filter((x) => x.paymentStatus !== 'CANCELLED'));
      setResults(r.results);
      setInfo(r.event);
      setDrafts({});
      setCsv(null);
      setPreview(null);
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

  const protestClosed = info?.protestUntil ? isPast(info.protestUntil) : false;
  /** После окна протестов — спросить и повторить с force. */
  const withForce = async <T,>(job: (force: boolean) => Promise<T>): Promise<T | null> => {
    try {
      return await job(false);
    } catch (err) {
      if (err instanceof AdminApiError && err.reason === 'protest_closed') {
        if (!window.confirm(err.message)) return null;
        return job(true);
      }
      throw err;
    }
  };

  const save = async (p: Participant) => {
    if (eventId === null) return;
    const d = drafts[p.userId] ?? { status: 'FINISHED', time: '' };
    let seconds: number | null = null;
    if (d.status === 'FINISHED') {
      seconds = parseTimeToSeconds(d.time);
      if (seconds === null) {
        setError(`Не разобрал время «${d.time}». Формат: 22:14 или 1:05:30`);
        return;
      }
    }
    setBusyUserId(p.userId);
    setError(null);
    setNotice(null);
    try {
      const res = await withForce((force) => putResult(eventId, { userId: p.userId, status: d.status, finishTime: seconds, force }));
      if (!res) return;
      setResults(res.results);
      setInfo(res.event);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[p.userId];
        return next;
      });
      const mine = res.results.find((r) => r.userId === p.userId);
      setNotice(
        `${fullName(p.lastName, p.firstName)}: ${d.status === 'FINISHED' ? formatSeconds(seconds!) : STATUS_LABEL[d.status]}` +
          (mine?.genderPlace ? `, место ${mine.genderPlace}` : '') +
          (mine ? `, ${mine.points} баллов` : ''),
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
      const res = await withForce((force) => deleteResult(row.id, force));
      if (!res) return;
      setResults(res.results);
      setInfo(res.event);
      setNotice(`Результат ${fullName(row.lastName, row.firstName)} снят, места пересчитаны`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось снять результат');
    } finally {
      setBusyUserId(null);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file || eventId === null) return;
    setError(null);
    setNotice(null);
    setPreview(null);
    const text = await file.text();
    setCsv({ name: file.name, text });
    setBusy(true);
    try {
      const res = await importResults(eventId, { csv: text, dryRun: true, missingAsDns });
      setPreview(res.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось прочитать файл');
      setCsv(null);
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!csv || eventId === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withForce((force) => importResults(eventId, { csv: csv.text, dryRun: false, missingAsDns, force }));
      if (!res) return;
      if (res.results) setResults(res.results);
      if (res.event) setInfo(res.event);
      setNotice(
        `Загружено из «${csv.name}»: ${res.preview.matched.length}` +
          (missingAsDns && res.preview.missing.length ? `, «не стартовал»: ${res.preview.missing.length}` : '') +
          '. Проверьте протокол и нажмите «Опубликовать».',
      );
      setCsv(null);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить результаты');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (eventId === null) return;
    const again = info?.resultsPublishedAt !== null;
    const ok = window.confirm(
      again
        ? 'Результаты уже опубликованы. Дослать сообщения тем, кому ещё не отправляли?'
        : 'Опубликовать результаты? Они появятся на сайте и в приложении, участникам придёт сообщение с местом и баллами. С этого момента — 48 часов на протесты.',
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await publishResults(eventId);
      setInfo(res.event);
      setNotice(again ? 'Сообщения досылаются в фоне.' : 'Результаты опубликованы, сообщения участникам уходят в фоне.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось опубликовать');
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (eventId === null || !window.confirm('Снять результаты с публикации? На сайте и в приложении они пропадут до повторной публикации.')) return;
    try {
      const res = await unpublishResults(eventId);
      setInfo(res.event);
      setNotice('Результаты сняты с публикации.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось снять публикацию');
    }
  };

  const resultByUser = new Map(results.map((r) => [r.userId, r]));
  const protocol = (g: 'MALE' | 'FEMALE') =>
    results
      .filter((r) => r.gender === g)
      .sort((a, b) => (a.genderPlace ?? Infinity) - (b.genderPlace ?? Infinity));
  const noGender = results.filter((r) => !r.gender);

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
          <button type="button" className="ad-btn" onClick={() => eventId !== null && void load(eventId)}>
            Обновить
          </button>
          <button type="button" className="ad-btn ad-btn--primary" disabled={busy || results.length === 0} onClick={() => void publish()}>
            {info?.resultsPublishedAt ? 'Дослать сообщения' : 'Опубликовать результаты'}
          </button>
          {info?.resultsPublishedAt && (
            <button type="button" className="ad-btn" disabled={busy} onClick={() => void unpublish()}>
              Снять с публикации
            </button>
          )}
        </div>
      </header>

      {info && (
        <p className={info.resultsPublishedAt ? 'ad-msg ad-msg--ok' : 'ad-hint'}>
          {info.resultsPublishedAt
            ? protestClosed
              ? `Опубликованы ${formatDateTime(info.resultsPublishedAt)}. Окно протестов закрыто — результаты итоговые; правки только с подтверждением.`
              : `Опубликованы ${formatDateTime(info.resultsPublishedAt)}. Предварительные: протесты до ${formatDateTime(info.protestUntil!)}.`
            : 'Не опубликованы — участники и сайт их не видят.'}
        </p>
      )}

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}

      <div className="ad-card">
        <h3>Файл хронометража</h3>
        <p className="ad-hint">
          CSV или TSV: колонки «Номер» и «Время» (от выстрела: 22:14, 1:02:30, 22:14.7 — доли округляются вверх),
          по желанию «Статус» (DNF, DNS, DSQ). Сначала покажем, что получится, — потом «Сохранить».
        </p>
        <div className="ad-actions">
          <input type="file" accept=".csv,.tsv,.txt,text/csv" disabled={busy} onChange={(e) => void pickFile(e.target.files?.[0])} />
          <label>
            <input type="checkbox" checked={missingAsDns} onChange={(e) => setMissingAsDns(e.target.checked)} /> Кого нет в
            файле — «не стартовал»
          </label>
        </div>
        {preview && csv && (
          <>
            <p className="ad-hint">
              В «{csv.name}»: сопоставлено по номеру — <b>{preview.matched.length}</b>
              {preview.matched.filter((m) => m.status !== 'FINISHED').length > 0 &&
                ` (из них без финиша: ${preview.matched.filter((m) => m.status !== 'FINISHED').length})`}
              ; номеров нет среди оплативших — <b>{preview.unknown.length}</b>
              {preview.unknown.length > 0 && ` (${preview.unknown.slice(0, 20).join(', ')}${preview.unknown.length > 20 ? '…' : ''})`}
              ; повторы — {preview.duplicates.length}; нет в файле — <b>{preview.missing.length}</b>
              {missingAsDns && preview.missing.length > 0 ? ' (станут «не стартовал»)' : ''}.
            </p>
            {preview.missing.length > 0 && (
              <p className="ad-hint ad-hint--dim">
                Нет в файле: {preview.missing.slice(0, 30).map((m) => `${m.bib ?? 'без номера'} ${m.name}`).join(', ')}
                {preview.missing.length > 30 ? '…' : ''}
              </p>
            )}
            {preview.warnings.map((w) => (
              <div key={w} className="ad-warn">
                ⚠ {w}
              </div>
            ))}
            <div className="ad-actions">
              <button type="button" className="ad-btn ad-btn--primary" disabled={busy || preview.matched.length === 0} onClick={() => void applyImport()}>
                Сохранить результаты
              </button>
              <button
                type="button"
                className="ad-btn"
                disabled={busy}
                onClick={() => {
                  setCsv(null);
                  setPreview(null);
                }}
              >
                Отмена
              </button>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <p className="ad-msg">Загружаем…</p>
      ) : participants.length === 0 ? (
        <p className="ad-msg">На этот старт нет активных регистраций</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th className="num">№</th>
                <th>ФИО</th>
                <th>Пол</th>
                <th>Внесено</th>
                <th className="num">Место М/Ж</th>
                <th className="num">Баллы</th>
                <th>Статус</th>
                <th>Время</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const row = resultByUser.get(p.userId);
                const d = drafts[p.userId] ?? { status: row?.status ?? 'FINISHED', time: '' };
                const rowBusy = busyUserId === p.userId;
                const set = (patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [p.userId]: { ...d, ...patch } }));
                return (
                  <tr key={p.userId}>
                    <td className="num">{p.bibNumber ?? '—'}</td>
                    <td>{fullName(p.lastName, p.firstName)}</td>
                    <td>{p.gender === 'MALE' ? 'М' : p.gender === 'FEMALE' ? 'Ж' : <span className="ad-warn">не указан</span>}</td>
                    <td className="num">
                      {row ? (row.status === 'FINISHED' && row.finishTime !== null ? formatSeconds(row.finishTime) : STATUS_SHORT[row.status]) : '—'}
                    </td>
                    <td className="num">{row?.genderPlace ?? '—'}</td>
                    <td className="num">{row ? row.points : '—'}</td>
                    <td>
                      <select value={d.status} disabled={rowBusy} onChange={(e) => set({ status: e.target.value as ResultStatus })}>
                        {(Object.keys(STATUS_LABEL) as ResultStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="ad-input--time"
                        value={d.time}
                        placeholder={row?.finishTime ? formatSeconds(row.finishTime) : '22:14'}
                        disabled={rowBusy || d.status !== 'FINISHED'}
                        onChange={(e) => set({ time: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void save(p);
                        }}
                      />
                    </td>
                    <td className="ad-nowrap">
                      <button
                        type="button"
                        className="ad-btn ad-btn--sm ad-btn--primary"
                        disabled={rowBusy || (d.status === 'FINISHED' ? !d.time.trim() : row?.status === d.status && !drafts[p.userId])}
                        onClick={() => void save(p)}
                      >
                        {row ? 'Изменить' : 'Внести'}
                      </button>
                      {row && (
                        <button type="button" className="ad-btn ad-btn--sm ad-btn--danger" disabled={rowBusy} onClick={() => void remove(row)}>
                          Снять
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="ad-hint">
            Места и баллы — отдельно у мужчин и женщин, равные времена делят место. Баллы: 1000 + 4340 × ((T0/T)^0,164 − 1),
            T0 = 15:00 (М), 17:15 (Ж); финиш позже 60:00 — 10, без финиша — 0. В рейтинг идёт только 5 км. Без пола участник
            не попадает в зачёт — укажите пол в «Участниках».
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="ad-card">
          <h3>Протокол</h3>
          {(['MALE', 'FEMALE'] as const).map((g) => (
            <div key={g}>
              <h4>{g === 'MALE' ? 'Мужчины' : 'Женщины'}</h4>
              <ol className="ad-protocol">
                {protocol(g).map((r) => (
                  <li key={r.id}>
                    <span className="num">{r.genderPlace ?? STATUS_SHORT[r.status]}</span>
                    <span>
                      {r.bib ? `${r.bib} · ` : ''}
                      {fullName(r.lastName, r.firstName)}
                    </span>
                    <span className="num">
                      {r.finishTime !== null && r.status === 'FINISHED' ? formatSeconds(r.finishTime) : '—'} · {r.points}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {noGender.length > 0 && (
            <p className="ad-warn">⚠ Без пола (вне зачёта): {noGender.map((r) => fullName(r.lastName, r.firstName)).join(', ')}</p>
          )}
        </div>
      )}
    </section>
  );
}
