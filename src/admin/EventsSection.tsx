import { useEffect, useState } from 'react';
import {
  AdminApiError,
  createEvent,
  deleteEvent,
  getEvents,
  getSeasons,
  updateEvent,
  type AdminEvent,
  type EventInput,
  type SeasonOption,
} from './api';
import { formatDate, priceFmt, toDateTimeLocal } from './helpers';

type FormState = {
  title: string;
  date: string; // datetime-local
  location: string;
  distance: string;
  price: string;
  slotsTotal: string;
  seasonId: string; // '' = без сезона
};

const EMPTY_FORM: FormState = {
  title: '',
  date: '',
  location: '',
  distance: '5 км',
  price: '5000',
  slotsTotal: '2000',
  seasonId: '',
};

function toInput(form: FormState): EventInput | string {
  if (!form.title.trim()) return 'Укажите название';
  if (!form.date) return 'Укажите дату и время';
  if (!form.location.trim()) return 'Укажите локацию';
  if (!form.distance.trim()) return 'Укажите дистанцию';

  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) return 'Некорректная цена';

  const slotsTotal = Number(form.slotsTotal);
  if (!Number.isInteger(slotsTotal) || slotsTotal < 1) return 'Некорректный лимит слотов';

  return {
    title: form.title.trim(),
    // datetime-local отдаёт время без зоны — new Date трактует его как местное,
    // toISOString переводит в UTC, бэкенд хранит в UTC.
    date: new Date(form.date).toISOString(),
    location: form.location.trim(),
    distance: form.distance.trim(),
    price,
    slotsTotal,
    seasonId: form.seasonId === '' ? null : Number(form.seasonId),
  };
}

export default function EventsSection() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s] = await Promise.all([getEvents(), getSeasons()]);
      setEvents(e);
      setSeasons(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить старты');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Загрузка при монтировании: setLoading(true) внутри load() срабатывает
    // синхронно, и правило считает это каскадным рендером. Здесь это ровно та
    // синхронизация с внешней системой (API), для которой эффект и нужен.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError(null);
  };

  const openEdit = (event: AdminEvent) => {
    setEditingId(event.id);
    setForm({
      title: event.title,
      date: toDateTimeLocal(event.date),
      location: event.location,
      distance: event.distance,
      price: String(event.price),
      slotsTotal: String(event.slotsTotal),
      seasonId: event.season ? String(event.season.id) : '',
    });
    setFormOpen(true);
    setError(null);
  };

  const submit = async () => {
    const input = toInput(form);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId === null) {
        await createEvent(input);
        setNotice('Старт создан');
      } else {
        await updateEvent(editingId, input);
        setNotice('Изменения сохранены');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (event: AdminEvent) => {
    setError(null);
    setNotice(null);
    try {
      await deleteEvent(event.id);
      setNotice(`Старт «${event.title}» удалён`);
      await load();
    } catch (err) {
      // Сервер отказывается удалять старт с регистрациями без ?force=1 —
      // спрашиваем подтверждение и повторяем осознанно.
      if (err instanceof AdminApiError && err.reason === 'has_registrations') {
        const ok = window.confirm(
          `${err.message}\n\nУдалить всё равно? Данные участников по этому старту будут потеряны.`,
        );
        if (!ok) return;
        try {
          const res = await deleteEvent(event.id, true);
          setNotice(
            `Старт удалён вместе с ${res.deleted.registrations} регистрациями и ${res.deleted.results} результатами`,
          );
          await load();
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : 'Не удалось удалить');
        }
        return;
      }
      setError(err instanceof Error ? err.message : 'Не удалось удалить');
    }
  };

  const field = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <section className="ad-section">
      <header className="ad-section__head">
        <h2>Старты</h2>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => void load()}>
            Обновить
          </button>
          <button type="button" className="ad-btn ad-btn--primary" onClick={openCreate}>
            + Новый старт
          </button>
        </div>
      </header>

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}

      {formOpen && (
        <div className="ad-card">
          <h3>{editingId === null ? 'Новый старт' : `Правка старта #${editingId}`}</h3>
          <div className="ad-form">
            <label>
              <span>Название</span>
              <input
                value={form.title}
                onChange={(e) => field('title', e.target.value)}
                placeholder="Триатлон Парк Астана"
              />
            </label>
            <label>
              <span>Дата и время</span>
              <input
                type="datetime-local"
                value={form.date}
                onChange={(e) => field('date', e.target.value)}
              />
            </label>
            <label>
              <span>Локация</span>
              <input
                value={form.location}
                onChange={(e) => field('location', e.target.value)}
                placeholder="Парк Астана, Астана"
              />
            </label>
            <label>
              <span>Дистанция</span>
              <input
                value={form.distance}
                onChange={(e) => field('distance', e.target.value)}
                placeholder="5 км"
              />
            </label>
            <label>
              <span>Цена, ₸</span>
              <input
                type="number"
                min="0"
                value={form.price}
                onChange={(e) => field('price', e.target.value)}
              />
            </label>
            <label>
              <span>Лимит слотов</span>
              <input
                type="number"
                min="1"
                value={form.slotsTotal}
                onChange={(e) => field('slotsTotal', e.target.value)}
              />
            </label>
            <label>
              <span>Сезон</span>
              <select
                value={form.seasonId}
                onChange={(e) => field('seasonId', e.target.value)}
              >
                <option value="">Без сезона</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.year}){s.isActive ? ' — активный' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ad-actions">
            <button
              type="button"
              className="ad-btn ad-btn--primary"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
            <button type="button" className="ad-btn" onClick={() => setFormOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="ad-msg">Загружаем…</p>
      ) : events.length === 0 ? (
        <p className="ad-msg">Стартов пока нет</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Название</th>
                <th>Дата</th>
                <th>Локация</th>
                <th>Дист.</th>
                <th className="num">Цена</th>
                <th className="num">Занято</th>
                <th>Оплаты</th>
                <th>Сезон</th>
                <th className="num">Рез-ты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.id}</td>
                  <td>{e.title}</td>
                  <td>{formatDate(e.date)}</td>
                  <td>{e.location}</td>
                  <td>{e.distance}</td>
                  <td className="num">{priceFmt.format(e.price)} ₸</td>
                  <td className="num">
                    {e.slotsTaken} / {e.slotsTotal}
                  </td>
                  <td className="ad-nowrap">
                    <span title="Оплачено">{e.registrations.paid}</span>
                    {' / '}
                    <span title="Ожидает">{e.registrations.pending}</span>
                    {' / '}
                    <span title="Отменено">{e.registrations.cancelled}</span>
                  </td>
                  <td>{e.season ? `${e.season.title}` : '—'}</td>
                  <td className="num">{e.resultsCount}</td>
                  <td className="ad-nowrap">
                    <button type="button" className="ad-btn ad-btn--sm" onClick={() => openEdit(e)}>
                      Правка
                    </button>
                    <button
                      type="button"
                      className="ad-btn ad-btn--sm ad-btn--danger"
                      onClick={() => void remove(e)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ad-hint">Столбец «Оплаты» — оплачено / ожидает / отменено.</p>
        </div>
      )}
    </section>
  );
}
