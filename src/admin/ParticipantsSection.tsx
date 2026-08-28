import { useEffect, useState } from 'react';
import {
  getEvents,
  getParticipants,
  setPaymentStatus,
  type AdminEvent,
  type Participant,
  type PaymentStatus,
} from './api';
import { formatDate, formatDateTime, formatSeconds, fullName, PAYMENT_LABEL } from './helpers';

const STATUSES: PaymentStatus[] = ['PENDING', 'PAID', 'CANCELLED'];

export default function ParticipantsSection() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

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

  const loadParticipants = async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getParticipants(id);
      setParticipants(res.participants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить участников');
      setParticipants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Перезагрузка при смене старта. setLoading(true) внутри срабатывает
    // синхронно — правило видит каскадный рендер, но это обычная загрузка
    // данных по внешнему ключу.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (eventId !== null) void loadParticipants(eventId);
  }, [eventId]);

  const changeStatus = async (p: Participant, next: PaymentStatus) => {
    if (next === p.paymentStatus) return;

    // Регистрации из абонемента созданы оптом: отмена одной рвёт «всё или
    // ничего», за которое участник заплатил. Предупреждаем явно.
    if (p.seasonPassId !== null && next === 'CANCELLED') {
      const ok = window.confirm(
        `Регистрация входит в абонемент #${p.seasonPassId}. Отмена освободит слот, ` +
          'но остальные старты абонемента останутся. Продолжить?',
      );
      if (!ok) return;
    }

    setBusyId(p.registrationId);
    setError(null);
    setNotice(null);
    try {
      const res = await setPaymentStatus(p.registrationId, next);
      setParticipants((prev) =>
        prev.map((x) =>
          x.registrationId === p.registrationId ? { ...x, paymentStatus: next } : x,
        ),
      );
      const slotNote =
        res.slotsChanged === -1
          ? ' Слот освобождён.'
          : res.slotsChanged === 1
            ? ' Слот снова занят.'
            : '';
      setNotice(
        `${fullName(p.lastName, p.firstName)}: ${PAYMENT_LABEL[next]}.${slotNote}` +
          (res.event ? ` Занято ${res.event.slotsTaken} из ${res.event.slotsTotal}.` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setBusyId(null);
    }
  };

  const selected = events.find((e) => e.id === eventId) ?? null;

  return (
    <section className="ad-section">
      <header className="ad-section__head">
        <h2>Участники</h2>
        <div className="ad-actions">
          <select
            value={eventId ?? ''}
            onChange={(e) => setEventId(Number(e.target.value))}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} — {formatDate(e.date)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ad-btn"
            onClick={() => eventId !== null && void loadParticipants(eventId)}
          >
            Обновить
          </button>
        </div>
      </header>

      {selected && (
        <p className="ad-hint">
          Занято {selected.slotsTaken} из {selected.slotsTotal} · записалось{' '}
          {selected.registrations.total}
        </p>
      )}

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}

      {loading ? (
        <p className="ad-msg">Загружаем…</p>
      ) : participants.length === 0 ? (
        <p className="ad-msg">На этот старт пока никто не записан</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Телефон</th>
                <th>Email</th>
                <th className="num">Возр.</th>
                <th>Telegram</th>
                <th>Записался</th>
                <th>Результат</th>
                <th>Оплата</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr
                  key={p.registrationId}
                  className={p.paymentStatus === 'CANCELLED' ? 'ad-row--muted' : undefined}
                >
                  <td>
                    {fullName(p.lastName, p.firstName)}
                    {p.seasonPassId !== null && (
                      <span className="ad-tag" title={`Абонемент #${p.seasonPassId}`}>
                        абонемент
                      </span>
                    )}
                  </td>
                  <td className="ad-nowrap">{p.phone ?? '—'}</td>
                  <td>{p.email ?? '—'}</td>
                  <td className="num">{p.age ?? '—'}</td>
                  <td className="ad-nowrap">
                    {p.username ? `@${p.username}` : (p.telegramId ?? '—')}
                  </td>
                  <td className="ad-nowrap">{formatDateTime(p.registeredAt)}</td>
                  <td className="ad-nowrap">
                    {p.result
                      ? `${formatSeconds(p.result.finishTime)} · ${p.result.place} место`
                      : '—'}
                  </td>
                  <td>
                    <select
                      value={p.paymentStatus}
                      disabled={busyId === p.registrationId}
                      onChange={(e) => void changeStatus(p, e.target.value as PaymentStatus)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {PAYMENT_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ad-hint">
            «Отменено» освобождает слот на старте, возврат из отмены — снова занимает.
          </p>
        </div>
      )}
    </section>
  );
}
