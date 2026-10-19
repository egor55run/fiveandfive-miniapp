import { useEffect, useState } from 'react';
import { getAudit, type AuditEntry } from './api';
import { formatDateTime, PAYMENT_LABEL } from './helpers';

const FIELD_LABEL: Record<string, string> = {
  lastName: 'Фамилия',
  firstName: 'Имя',
  birthDate: 'Дата рождения',
  gender: 'Пол',
  phone: 'Телефон',
  email: 'Email',
  distance: 'Дистанция',
  note: 'Кто это',
  paymentStatus: 'Оплата',
  refund: 'Возврат',
  pass: 'Абонемент',
};

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  'participant.update': 'Правка',
  'participant.create': 'Добавлен вручную',
  'registration.status': 'Статус',
  'registration.refund': 'Возврат',
};

/** Значение поля — по-человечески: пол, статус оплаты, дата. */
function show(field: string, value: string | null): string {
  if (value === null || value === '') return '—';
  if (field === 'gender') return value === 'MALE' ? 'Мужской' : value === 'FEMALE' ? 'Женский' : value;
  if (field === 'paymentStatus') return PAYMENT_LABEL[value as keyof typeof PAYMENT_LABEL] ?? value;
  if (field === 'birthDate') return value.split('-').reverse().join('.');
  return value;
}

/** Журнал изменений по старту: кто, когда, что было → что стало. */
export default function AuditLog({ eventId, refreshKey }: { eventId: number; refreshKey: number }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAudit(eventId)
      .then((list) => alive && setEntries(list))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал'));
    return () => {
      alive = false;
    };
  }, [eventId, refreshKey]);

  if (error) return <p className="ad-msg ad-msg--error">{error}</p>;
  if (!entries) return <p className="ad-msg">Загружаем журнал…</p>;
  if (entries.length === 0) return <p className="ad-hint">Изменений по этому старту пока не было.</p>;

  return (
    <div className="ad-table-wrap">
      <table className="ad-table ad-audit">
        <thead>
          <tr>
            <th>Когда</th>
            <th>Кто</th>
            <th>Что</th>
            <th>Участник</th>
            <th>Было → стало</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="ad-nowrap">{formatDateTime(e.at)}</td>
              <td className="ad-nowrap">{e.admin}</td>
              <td className="ad-nowrap">{ACTION_LABEL[e.action] ?? e.action}</td>
              <td>{e.subject}</td>
              <td>
                {Object.entries(e.changes).map(([field, [from, to]]) => (
                  <div key={field}>
                    <b>{FIELD_LABEL[field] ?? field}:</b>{' '}
                    {e.action === 'participant.create' ? show(field, to) : `${show(field, from)} → ${show(field, to)}`}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
