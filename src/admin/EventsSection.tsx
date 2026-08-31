import { useEffect, useRef, useState } from 'react';
import {
  AdminApiError,
  ROUTE_IMAGE_ACCEPT,
  ROUTE_IMAGE_MAX_BYTES,
  assetUrl,
  createEvent,
  deleteEvent,
  deleteRouteImage,
  getEvents,
  getSeasons,
  updateEvent,
  uploadRouteImage,
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

  /**
   * Карта трассы живёт отдельно от остальных полей: она передаётся не в JSON, а
   * отдельным multipart-запросом (у нового старта — уже после того, как сервер
   * выдал id). Поэтому здесь три состояния: выбранный файл, уже сохранённая
   * карта и признак «убрать». Применяются они все в submit(), чтобы форма
   * оставалась одной операцией, а не набором мгновенных действий.
   */
  const [routeFile, setRouteFile] = useState<File | null>(null);
  const [routePreview, setRoutePreview] = useState<string | null>(null);
  const [routeSaved, setRouteSaved] = useState<string | null>(null);
  const [routeCleared, setRouteCleared] = useState(false);
  const routeInputRef = useRef<HTMLInputElement>(null);

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

  /**
   * Сбросить всё, что относится к карте. Object URL превью обязательно
   * отзываем: без этого каждый выбранный файл остаётся висеть в памяти
   * страницы до перезагрузки.
   */
  const resetRoute = (saved: string | null) => {
    if (routePreview) URL.revokeObjectURL(routePreview);
    setRoutePreview(null);
    setRouteFile(null);
    setRouteCleared(false);
    setRouteSaved(saved);
    // Без сброса значения input повторный выбор того же файла не даст события
    // change, и «Убрать карту» → выбрать ту же картинку не сработало бы.
    if (routeInputRef.current) routeInputRef.current.value = '';
  };

  /** Проверки до отправки: те же правила, что на сервере, но без ожидания сети. */
  const pickRouteFile = (file: File | null) => {
    if (!file) {
      resetRoute(routeSaved);
      return;
    }
    // Пустой type встречается, когда система не знает расширения; окончательное
    // слово всё равно за сервером, он смотрит в содержимое. Здесь отсекаем
    // только заведомо чужие форматы, чтобы не гонять файл по сети зря.
    if (file.type && !ROUTE_IMAGE_ACCEPT.split(',').includes(file.type)) {
      setError('Карта должна быть JPG, PNG или WebP');
      if (routeInputRef.current) routeInputRef.current.value = '';
      return;
    }
    if (file.size > ROUTE_IMAGE_MAX_BYTES) {
      setError(`Файл больше ${Math.round(ROUTE_IMAGE_MAX_BYTES / 1024 / 1024)} МБ`);
      if (routeInputRef.current) routeInputRef.current.value = '';
      return;
    }
    setError(null);
    if (routePreview) URL.revokeObjectURL(routePreview);
    setRoutePreview(URL.createObjectURL(file));
    setRouteFile(file);
    setRouteCleared(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    resetRoute(null);
    setFormOpen(true);
    setError(null);
  };

  const openEdit = (event: AdminEvent) => {
    setEditingId(event.id);
    resetRoute(event.routeImageUrl);
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

    // id известен либо сразу (правка), либо только после создания — карта
    // грузится отдельным запросом и потому всегда вторым шагом.
    let eventId = editingId;
    try {
      if (editingId === null) {
        const created = await createEvent(input);
        eventId = created.id;
        setNotice('Старт создан');
      } else {
        await updateEvent(editingId, input);
        setNotice('Изменения сохранены');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
      setSaving(false);
      return;
    }

    // Старт уже сохранён. Если карта не доедет, об этом надо сказать прямо, а не
    // общим «не удалось сохранить»: поля-то записались, повторять их незачем.
    try {
      if (routeFile && eventId !== null) {
        await uploadRouteImage(eventId, routeFile);
        setNotice((prev) => `${prev ?? 'Сохранено'}, карта трассы загружена`);
      } else if (routeCleared && routeSaved && eventId !== null) {
        await deleteRouteImage(eventId);
        setNotice((prev) => `${prev ?? 'Сохранено'}, карта трассы убрана`);
      }
    } catch (err) {
      const what = routeFile ? 'загрузить' : 'убрать';
      setNotice(null);
      setError(
        `Старт сохранён, но карту не удалось ${what}: ` +
          (err instanceof Error ? err.message : 'ошибка запроса'),
      );
      setSaving(false);
      await load();
      return;
    }

    resetRoute(null);
    setFormOpen(false);
    setSaving(false);
    await load();
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

  // Что показать в превью: выбранный файл важнее сохранённой карты, а помеченная
  // на удаление карта не показывается вовсе — форма показывает будущее состояние.
  const routePreviewSrc =
    routePreview ?? (!routeCleared && routeSaved ? assetUrl(routeSaved) : null);

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

          <div className="ad-route">
            <span className="ad-route__label">Карта трассы</span>
            <div className="ad-route__body">
              {routePreviewSrc ? (
                <img className="ad-route__preview" src={routePreviewSrc} alt="Карта трассы" />
              ) : (
                <div className="ad-route__preview ad-route__preview--empty">
                  Карты нет — в приложении будет плейсхолдер
                </div>
              )}

              <div className="ad-route__controls">
                <input
                  ref={routeInputRef}
                  type="file"
                  accept={ROUTE_IMAGE_ACCEPT}
                  onChange={(e) => pickRouteFile(e.target.files?.[0] ?? null)}
                />
                {(routeFile || (routeSaved && !routeCleared)) && (
                  <button
                    type="button"
                    className="ad-btn ad-btn--sm"
                    onClick={() => {
                      // Выбранный файл просто отменяем, сохранённую карту
                      // помечаем на удаление — оно уйдёт на сервер в «Сохранить».
                      const hadSaved = routeSaved;
                      resetRoute(hadSaved);
                      if (!routeFile && hadSaved) setRouteCleared(true);
                    }}
                  >
                    {routeFile ? 'Отменить выбор' : 'Убрать карту'}
                  </button>
                )}
              </div>

              <p className="ad-hint">
                JPG, PNG или WebP, до {Math.round(ROUTE_IMAGE_MAX_BYTES / 1024 / 1024)} МБ.
                Пропорции макета — 328×227; картинка вписывается в этот бокс целиком,
                поэтому сильно другое соотношение сторон оставит поля по краям.
                {editingId === null && ' У нового старта карта загрузится сразу после создания.'}
              </p>
            </div>
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
            <button
              type="button"
              className="ad-btn"
              onClick={() => {
                resetRoute(null);
                setFormOpen(false);
              }}
            >
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
                <th>Карта</th>
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
                  <td>
                    {e.routeImageUrl ? (
                      <a href={assetUrl(e.routeImageUrl)} target="_blank" rel="noreferrer">
                        есть
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
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
