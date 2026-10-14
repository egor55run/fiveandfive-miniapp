import { useState } from 'react';
import { AdminApiError, type AdminDistance, type ParticipantInput } from './api';

/**
 * Данные участника для админки: правка существующего или добавление вручную.
 * Проверки — на сервере, те же, что в форме приложения (кириллица, телефон,
 * email, 16+); ошибки сервера подсвечиваются у своих полей.
 */
export type ParticipantFormValues = {
  lastName: string;
  firstName: string;
  birthDate: string; // yyyy-mm-dd
  gender: '' | 'MALE' | 'FEMALE';
  phone: string;
  email: string;
  distanceId: number | null;
  note: string;
};

type Props = {
  title: string;
  initial: ParticipantFormValues;
  distances: AdminDistance[];
  /** Добавление вручную — с полем «Кто это». */
  withNote?: boolean;
  submitLabel: string;
  hint?: string;
  onSubmit: (input: ParticipantInput) => Promise<void>;
  onCancel: () => void;
};

export default function ParticipantForm({ title, initial, distances, withNote, submitLabel, hint, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof ParticipantFormValues>(key: K, value: ParticipantFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFields((prev) => (prev[key] ? { ...prev, [key]: '' } : prev));
  };

  const submit = async () => {
    if (!values.gender) {
      setFields({ gender: 'Выберите пол' });
      return;
    }
    if (values.distanceId === null) {
      setFields({ distanceId: 'Выберите дистанцию' });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await onSubmit({
        lastName: values.lastName,
        firstName: values.firstName,
        birthDate: values.birthDate,
        gender: values.gender,
        phone: values.phone,
        email: values.email,
        distanceId: values.distanceId,
        ...(withNote ? { note: values.note.trim() } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
      if (err instanceof AdminApiError && err.fields) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof ParticipantFormValues) => (fields[key] ? <span className="ad-field-err">{fields[key]}</span> : null);

  return (
    <div className="ad-card">
      <h3>{title}</h3>
      {hint && <p className="ad-hint">{hint}</p>}
      <div className="ad-form">
        <label>
          <span>Фамилия</span>
          <input value={values.lastName} onChange={(e) => set('lastName', e.target.value)} disabled={busy} />
          {field('lastName')}
        </label>
        <label>
          <span>Имя</span>
          <input value={values.firstName} onChange={(e) => set('firstName', e.target.value)} disabled={busy} />
          {field('firstName')}
        </label>
        <label>
          <span>Дата рождения</span>
          <input type="date" value={values.birthDate} onChange={(e) => set('birthDate', e.target.value)} disabled={busy} />
          {field('birthDate')}
        </label>
        <label>
          <span>Пол</span>
          <select value={values.gender} onChange={(e) => set('gender', e.target.value as ParticipantFormValues['gender'])} disabled={busy}>
            <option value="">—</option>
            <option value="MALE">Мужской</option>
            <option value="FEMALE">Женский</option>
          </select>
          {field('gender')}
        </label>
        <label>
          <span>Телефон</span>
          <input type="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} disabled={busy} placeholder="+7 7xx xxx xx xx" />
          {field('phone')}
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} disabled={busy} />
          {field('email')}
        </label>
        <label>
          <span>Дистанция</span>
          <select
            value={values.distanceId ?? ''}
            onChange={(e) => set('distanceId', e.target.value === '' ? null : Number(e.target.value))}
            disabled={busy}
          >
            <option value="">—</option>
            {distances.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} (свободно {d.slotsLeft})
              </option>
            ))}
          </select>
          {field('distanceId')}
        </label>
        {withNote && (
          <label>
            <span>Кто это</span>
            <input
              value={values.note}
              onChange={(e) => set('note', e.target.value)}
              disabled={busy}
              placeholder="партнёр, волонтёр…"
              maxLength={100}
            />
          </label>
        )}
      </div>
      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      <div className="ad-actions">
        <button type="button" className="ad-btn ad-btn--primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Сохраняем…' : submitLabel}
        </button>
        <button type="button" className="ad-btn" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
