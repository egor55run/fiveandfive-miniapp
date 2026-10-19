import { useEffect, useState } from 'react';
import {
  getEvents,
  addParticipant,
  getParticipants,
  setPaymentStatus,
  updateParticipant,
  type AdminDistance,
  type AdminEvent,
  type Participant,
  type PaymentStatus,
} from './api';
import { downloadParticipantsCsv } from './exportCsv';
import AuditLog from './AuditLog';
import ParticipantForm, { type ParticipantFormValues } from './ParticipantForm';
import RefundForm from './RefundForm';
import { formatDate, formatDateTime, formatSeconds, fullName, PAYMENT_LABEL } from './helpers';

const STATUSES: PaymentStatus[] = ['PENDING', 'PAID', 'CANCELLED'];

export default function ParticipantsSection() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [distances, setDistances] = useState<AdminDistance[]>([]);
  // Фильтр по дистанции: null — все.
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null);
  // Форма участника: правка (registrationId) или добавление вручную ('new').
  const [editing, setEditing] = useState<Participant | 'new' | null>(null);
  // «Оформить возврат» — по какой регистрации открыта форма.
  const [refunding, setRefunding] = useState<number | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  // Счётчик для перезагрузки журнала после правок.
  const [auditKey, setAuditKey] = useState(0);
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
      setDistances(res.distances);
      setDistanceFilter(null);
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
          (res.event ? ` На старте занято ${res.event.slotsTaken} из ${res.event.slotsTotal}.` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setBusyId(null);
    }
  };

  const selected = events.find((e) => e.id === eventId) ?? null;
  const shown =
    distanceFilter === null ? participants : participants.filter((p) => p.distanceId === distanceFilter);

  const formValues = (p: Participant | null): ParticipantFormValues => ({
    lastName: p?.lastName ?? '',
    firstName: p?.firstName ?? '',
    birthDate: p?.birthDate ?? '',
    gender: p?.gender ?? '',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    distanceId: p?.distanceId ?? (distances.length === 1 ? distances[0].id : null),
    note: '',
  });

  const afterSave = async (message: string) => {
    setEditing(null);
    setRefunding(null);
    setNotice(message);
    setAuditKey((k) => k + 1);
    if (eventId !== null) await loadParticipants(eventId);
    // Счётчики мест в шапке — из списка стартов.
    setEvents(await getEvents());
  };

  const exportCsv = () => {
    if (!selected) return;
    const dist = distances.find((d) => d.id === distanceFilter);
    const name = `uchastniki-${selected.slug ?? selected.id}${dist ? `-${dist.label.replace(/\s+/g, '')}` : ''}.csv`;
    downloadParticipantsCsv(shown, name);
  };

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
          {distances.length > 1 && (
            <select
              value={distanceFilter ?? ''}
              onChange={(e) => setDistanceFilter(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="Дистанция"
            >
              <option value="">Все дистанции</option>
              {distances.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="ad-btn"
            onClick={() => eventId !== null && void loadParticipants(eventId)}
          >
            Обновить
          </button>
          <button type="button" className="ad-btn" disabled={shown.length === 0} onClick={exportCsv}>
            Выгрузить в Excel (CSV)
          </button>
          <button type="button" className="ad-btn" disabled={eventId === null} onClick={() => setEditing('new')}>
            + Добавить участника
          </button>
          <button type="button" className="ad-btn" disabled={eventId === null} onClick={() => setShowAudit((v) => !v)}>
            {showAudit ? 'Скрыть журнал' : 'Журнал изменений'}
          </button>
        </div>
      </header>

      {selected && (
        <p className="ad-hint">
          {distances.length > 1
            ? distances.map((d) => `${d.label}: занято ${d.slotsTaken} из ${d.slotsTotal}`).join(' · ')
            : `Занято ${selected.slotsTaken} из ${selected.slotsTotal}`}{' '}
          · записалось {selected.registrations.total}
        </p>
      )}

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}

      {editing === 'new' && eventId !== null && (
        <ParticipantForm
          key="new"
          title="Добавить участника вручную"
          hint="Без оплаты — например, партнёр или волонтёр. Займёт место на дистанции, в списке будет с пометкой «вручную» и в деньги не попадёт."
          initial={formValues(null)}
          distances={distances}
          withNote
          submitLabel="Добавить"
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            await addParticipant(eventId, input);
            await afterSave(`${input.lastName} ${input.firstName} добавлен(а) вручную.`);
          }}
        />
      )}
      {editing && editing !== 'new' && (
        <ParticipantForm
          key={editing.registrationId}
          title={`Правка участника: ${fullName(editing.lastName, editing.firstName)}`}
          hint={
            editing.telegramId
              ? 'Данные человека общие для всех его стартов. Смена дистанции переносит его место.'
              : 'Смена дистанции переносит его место.'
          }
          initial={formValues(editing)}
          distances={distances}
          submitLabel="Сохранить"
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            const res = await updateParticipant(editing.registrationId, input);
            await afterSave(res.changed ? 'Изменения сохранены и записаны в журнал.' : 'Ничего не изменилось.');
          }}
        />
      )}

      {refunding !== null && (
        <RefundForm
          key={refunding}
          registrationId={refunding}
          onCancel={() => setRefunding(null)}
          onDone={(message) => void afterSave(message)}
        />
      )}

      {showAudit && eventId !== null && (
        <div className="ad-card">
          <h3>Журнал изменений</h3>
          <AuditLog eventId={eventId} refreshKey={auditKey} />
        </div>
      )}

      {loading ? (
        <p className="ad-msg">Загружаем…</p>
      ) : shown.length === 0 ? (
        <p className="ad-msg">
          {participants.length === 0 ? 'На этот старт пока никто не записан' : 'На эту дистанцию пока никто не записан'}
        </p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Дистанция</th>
                <th>Телефон</th>
                <th>Email</th>
                <th className="num" title="Полных лет на день старта">Возр.</th>
                <th>Telegram</th>
                <th>Записался</th>
                <th>Результат</th>
                <th>Оплата</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr
                  key={p.registrationId}
                  className={p.paymentStatus === 'CANCELLED' ? 'ad-row--muted' : undefined}
                >
                  <td>
                    {fullName(p.lastName, p.firstName)}
                    {p.ageOnStart !== null && p.ageOnStart >= 16 && p.ageOnStart < 18 && (
                      <span
                        className="ad-tag ad-tag--minor"
                        title="16–17 лет на день старта: при выдаче стартового пакета — письменное согласие родителя или законного представителя"
                      >
                        16–17
                      </span>
                    )}
                    {p.seasonPassId !== null && (
                      <span className="ad-tag" title={`Абонемент #${p.seasonPassId}`}>
                        абонемент
                      </span>
                    )}
                    {p.manual && (
                      <span className="ad-tag ad-tag--manual" title="Добавлен администратором без оплаты">
                        вручную{p.manualNote ? ` · ${p.manualNote}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="ad-nowrap">{p.distance ?? '—'}</td>
                  <td className="ad-nowrap">{p.phone ?? '—'}</td>
                  <td>{p.email ?? '—'}</td>
                  <td className="num">{p.ageOnStart ?? p.age ?? '—'}</td>
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
                    {p.refund ? (
                      <span
                        className="ad-tag ad-tag--refund"
                        title={`Оформлен ${formatDateTime(p.refund.at)}${p.refund.confirmed ? ', ApiPay подтвердил' : ', ApiPay пока не подтвердил'}`}
                      >
                        {PAYMENT_LABEL.REFUNDED}
                        {p.refund.percent !== null ? ` ${p.refund.percent}%` : ''} · {p.refund.amount.toLocaleString('ru-RU')} ₸
                        {p.refund.confirmed ? ' ✓' : ''}
                      </span>
                    ) : (
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
                    )}
                  </td>
                  <td className="ad-nowrap">
                    <button type="button" className="ad-btn ad-btn--sm" onClick={() => setEditing(p)}>
                      Правка
                    </button>
                    {p.paymentStatus === 'PAID' && !p.manual && !p.refund && (
                      <button
                        type="button"
                        className="ad-btn ad-btn--sm"
                        onClick={() => {
                          setEditing(null);
                          setRefunding(p.registrationId);
                        }}
                      >
                        Оформить возврат
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ad-hint">
            «Отменено» освобождает слот на старте, возврат из отмены — снова занимает. «Оформить возврат» — по оферте
            (100 / 50 / 0%): запись станет «Возврат», место освободится; деньги возвращаются вручную в ApiPay или Kaspi Pay.
          </p>
        </div>
      )}
    </section>
  );
}
