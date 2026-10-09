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
  deleteRegulations,
  REGULATIONS_MAX_BYTES,
  uploadRegulations,
} from './api';
import { formatDate, formatDateTime, priceFmt, toDateTimeLocal } from './helpers';

type FormState = {
  title: string;
  date: string; // datetime-local
  location: string;
  distance: string;
  price: string;
  slotsTotal: string;
  seasonId: string; // '' = без сезона
  closesAt: string; // datetime-local; '' = за 7 дней до старта
  slug: string; // '' = составит сервер
  program: string;
};

const EMPTY_FORM: FormState = {
  title: '',
  date: '',
  location: '',
  distance: '5 км',
  price: '5000',
  slotsTotal: '2000',
  seasonId: '',
  closesAt: '',
  slug: '',
  program: '',
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
  if (form.closesAt && new Date(form.closesAt) > new Date(form.date)) {
    return 'Регистрация должна закрываться не позже старта';
  }
  const slug = form.slug.trim().toLowerCase();
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'Адрес страницы — только латиница, цифры и дефис';
  }

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
    registrationClosesAt: form.closesAt ? new Date(form.closesAt).toISOString() : null,
    slug: form.slug.trim().toLowerCase() || null,
    program: form.program.trim() || null,
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
  // Положение (PDF) — так же отдельным запросом и так же по «Сохранить».
  const [regFile, setRegFile] = useState<File | null>(null);
  const [regSaved, setRegSaved] = useState<string | null>(null);
  const [regCleared, setRegCleared] = useState(false);
  const regInputRef = useRef<HTMLInputElement>(null);
  const resetRegs = (saved: string | null) => {
    setRegFile(null);
    setRegCleared(false);
    setRegSaved(saved);
    if (regInputRef.current) regInputRef.current.value = '';
  };
  const pickRegFile = (file: File | null) => {
    if (!file) {
      resetRegs(regSaved);
      return;
    }
    if (file.type && file.type !== 'application/pdf') {
      setError('Положение должно быть PDF-файлом');
      if (regInputRef.current) regInputRef.current.value = '';
      return;
    }
    if (file.size > REGULATIONS_MAX_BYTES) {
      setError('Файл Положения больше 7 МБ');
      if (regInputRef.current) regInputRef.current.value = '';
      return;
    }
    setError(null);
    setRegFile(file);
    setRegCleared(false);
  };

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
    resetRegs(null);
    setFormOpen(true);
    setError(null);
  };

  const openEdit = (event: AdminEvent) => {
    setEditingId(event.id);
    resetRoute(event.routeImageUrl);
    resetRegs(event.regulationsUrl);
    setForm({
      title: event.title,
      date: toDateTimeLocal(event.date),
      location: event.location,
      distance: event.distance,
      price: String(event.price),
      slotsTotal: String(event.slotsTotal),
      seasonId: event.season ? String(event.season.id) : '',
      closesAt: event.registrationClosesAtCustom
        ? toDateTimeLocal(event.registrationClosesAtCustom)
        : '',
      slug: event.slug ?? '',
      program: event.program ?? '',
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

    // Положение — тем же порядком и с тем же честным сообщением при сбое.
    try {
      if (regFile && eventId !== null) {
        await uploadRegulations(eventId, regFile);
        setNotice((prev) => `${prev ?? 'Сохранено'}, Положение загружено`);
      } else if (regCleared && regSaved && eventId !== null) {
        await deleteRegulations(eventId);
        setNotice((prev) => `${prev ?? 'Сохранено'}, Положение убрано`);
      }
    } catch (err) {
      setNotice(null);
      setError(
        `Старт сохранён, но Положение не удалось ${regFile ? 'загрузить' : 'убрать'}: ` +
          (err instanceof Error ? err.message : 'ошибка запроса'),
      );
      setSaving(false);
      await load();
      return;
    }

    resetRoute(null);
    resetRegs(null);
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
              <span>Адрес страницы на сайте</span>
              <input
                value={form.slug}
                onChange={(e) => field('slug', e.target.value)}
                placeholder="составится из названия и года"
              />
              <span className="ad-hint ad-hint--dim">
                fiveandfive.kz/starty/{form.slug.trim().toLowerCase() || '…'} — латиница, цифры, дефис
              </span>
            </label>
            <label>
              <span>Регистрация закрывается</span>
              <input
                type="datetime-local"
                value={form.closesAt}
                onChange={(e) => field('closesAt', e.target.value)}
              />
              <span className="ad-hint ad-hint--dim">
                {form.closesAt
                  ? 'Задано вручную. Очистите поле — вернётся «за 7 дней до старта»'
                  : 'Пусто — за 7 дней до старта (по Положению)'}
              </span>
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
            <label className="ad-form__wide">
              <span>Программа дня</span>
              <textarea
                rows={5}
                value={form.program}
                onChange={(e) => field('program', e.target.value)}
                placeholder={'По строке на пункт:\n07:00 — выдача стартовых пакетов\n08:00 — старт'}
              />
              <span className="ad-hint ad-hint--dim">Показывается на странице старта на сайте</span>
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

          <div className="ad-route">
            <span className="ad-route__label">Положение (PDF)</span>
            <div className="ad-route__body">
              <p className="ad-hint">
                {regFile ? (
                  `Выбран файл: ${regFile.name}`
                ) : regSaved && !regCleared ? (
                  <a href={assetUrl(regSaved)} target="_blank" rel="noreferrer">
                    Открыть загруженное Положение
                  </a>
                ) : regCleared ? (
                  'Положение уберётся после «Сохранить»'
                ) : (
                  'Положение не загружено'
                )}
              </p>
              <div className="ad-route__controls">
                <input
                  ref={regInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => pickRegFile(e.target.files?.[0] ?? null)}
                />
                {(regFile || (regSaved && !regCleared)) && (
                  <button
                    type="button"
                    className="ad-btn ad-btn--sm"
                    onClick={() => {
                      const hadSaved = regSaved;
                      resetRegs(hadSaved);
                      if (!regFile && hadSaved) setRegCleared(true);
                    }}
                  >
                    {regFile ? 'Отменить выбор' : 'Убрать Положение'}
                  </button>
                )}
              </div>
              <p className="ad-hint">
                PDF до 7 МБ. Появится на странице старта на сайте.
                {editingId === null && ' У нового старта загрузится сразу после создания.'}
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
                resetRegs(null);
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
                  <td>
                    {e.title}
                    {e.slug && <div className="ad-hint ad-hint--dim">/starty/{e.slug}</div>}
                  </td>
                  <td>
                    {formatDate(e.date)}
                    <div className="ad-hint ad-hint--dim">
                      рег. до {formatDateTime(e.registrationClosesAt)}
                    </div>
                  </td>
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
