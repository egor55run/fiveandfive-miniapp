import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  CalendarX2,
  FileText,
  Map,
  Pencil,
  PersonStanding,
  ShoppingBag,
  Ticket,
} from 'lucide-react';
import Header from './Header';
import { ApiError, patchMe, type EventDto, type UserDto } from '../lib/api';
import type { RaceResult } from '../data/results';
import { useSeasonProgress } from '../hooks/useSeasonProgress';
// TODO: номер участника бэкенд пока не отдаёт — см. комментарий в файле.
import { profileMock } from '../data/profile';

type Props = {
  participant: UserDto | null;
  // Старты, на которые участник зарегистрировался в этой сессии.
  registeredEvents: EventDto[];
  // Пройденные старты с внесённым результатом, от старых к новым.
  results: RaceResult[];
  // Ближайший старт вообще — запасной вариант, если регистраций нет.
  nearest: EventDto | null;
  // Профиль сохранён на сервере — поднять свежего пользователя в состояние приложения.
  onUserUpdated: (user: UserDto) => void;
  onViewRaces: () => void;
};

type EditKey = 'birthDate' | 'phone' | 'email';

const TZ = 'Asia/Almaty';
const dateShort = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TZ,
});

// «31 день / 2 дня / 5 дней» — русское склонение.
function pluralDays(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

function daysUntil(target: Date, now: number): number {
  const diff = target.getTime() - now;
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000);
}

// yyyy-mm-dd (input[type=date]) → 14.12.1999
function formatDob(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return y && m && d ? `${d}.${m}.${y}` : value;
}

function ProfileScreen({
  participant,
  registeredEvents,
  results,
  nearest,
  onUserUpdated,
  onViewRaces,
}: Props) {
  const reduceMotion = useReducedMotion();
  // Правки уходят в PATCH /me сразу по «применить», поэтому локальной копии
  // полей больше нет: единственный источник правды — participant с сервера.
  const [editing, setEditing] = useState<EditKey | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Ошибка последнего сохранения, привязана к полю: {email: 'Некорректный email'}.
  const [saveError, setSaveError] = useState<{ key: EditKey; message: string } | null>(
    null,
  );
  // Текущее время фиксируем на монтировании — рендер должен оставаться чистым.
  const [now] = useState(() => Date.now());
  const { done, total: seasonTotal } = useSeasonProgress(results);

  // Предстоящий старт: ближайший будущий из своих регистраций, иначе общий ближайший.
  const upcoming = useMemo(() => {
    const mine = registeredEvents
      .filter((e) => new Date(e.date).getTime() >= now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return mine[0] ?? nearest;
  }, [registeredEvents, nearest, now]);

  if (!participant) {
    return (
      <motion.main
        className="screen screen--tabbar pf"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Header />
        <div className="glass-card empty">
          <CalendarX2 className="empty__icon" size={44} strokeWidth={1.6} />
          <p className="empty__text">Вы ещё не зарегистрированы ни на один старт</p>
          <button type="button" className="btn-register" onClick={onViewRaces}>
            Посмотреть старты
            <ArrowRight size={18} strokeWidth={2.4} />
          </button>
        </div>
      </motion.main>
    );
  }

  const fullName = [participant.lastName, participant.firstName]
    .filter(Boolean)
    .join(" ")
    .trim();

  // Сохранённое значение поля — то, что лежит в профиле на сервере.
  const stored = (key: EditKey): string =>
    (key === 'birthDate'
      ? participant.birthDate
      : key === 'phone'
        ? participant.phone
        : participant.email) ?? '';

  const fields: { key: EditKey; label: string; value: string; type: string }[] = [
    {
      key: 'birthDate',
      label: 'Дата рождения',
      value: formatDob(participant.birthDate) || 'не указана',
      type: 'date',
    },
    { key: 'phone', label: 'Телефон', value: participant.phone ?? 'не указан', type: 'tel' },
    { key: 'email', label: 'Email', value: participant.email ?? 'не указан', type: 'email' },
  ];

  const startEdit = (key: EditKey) => {
    setDraft(stored(key));
    setSaveError(null);
    setEditing(key);
  };

  const cancelEdit = () => {
    setEditing(null);
    setSaveError(null);
  };

  /**
   * Проверки, которые видно без сервера: пустое поле и дата из будущего.
   * Остальное (формат email, длина телефона, возраст больше 120) решает
   * бэкенд — дублировать его правила здесь значит держать их в двух местах.
   */
  const localError = (key: EditKey, value: string): string | null => {
    if (value === '') {
      return key === 'birthDate'
        ? 'Укажите дату рождения'
        : key === 'phone'
          ? 'Укажите телефон'
          : 'Укажите email';
    }
    // now зафиксирован на монтировании (см. выше) — для проверки даты рождения
    // этой точности с запасом, а рендер остаётся чистым.
    if (key === 'birthDate' && new Date(value).getTime() > now) {
      return 'Дата рождения не может быть в будущем';
    }
    return null;
  };

  const commitEdit = async () => {
    if (!editing || saving) return;
    const key = editing;
    const value = draft.trim();

    // Ничего не поменялось — незачем ходить на сервер.
    if (value === stored(key)) {
      cancelEdit();
      return;
    }

    const local = localError(key, value);
    if (local) {
      setSaveError({ key, message: local });
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const { user } = await patchMe({ [key]: value });
      onUserUpdated(user);
      setEditing(null);
    } catch (err) {
      // У 400 от валидации есть текст под конкретное поле, у прочих ошибок
      // (сеть, 401, 500) — только общий; показываем то, что есть.
      const message =
        err instanceof ApiError
          ? (err.fields[key] ?? err.message)
          : 'Не удалось сохранить';
      setSaveError({ key, message });
    } finally {
      setSaving(false);
    }
  };

  const upcomingDate = upcoming ? new Date(upcoming.date) : null;
  const left = upcomingDate ? daysUntil(upcomingDate, now) : 0;
  const past = [...results].reverse(); // новые сверху

  return (
    <motion.main
      className="screen screen--tabbar pf"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Header onBack={onViewRaces} />

      {/* Аватар-иконка + имя */}
      <section className="pf-id">
        <span className="pf-id__avatar" aria-hidden="true">
          <PersonStanding size={52} strokeWidth={1.8} />
        </span>
        <h2 className="pf-id__name">{fullName}</h2>
      </section>

      {/* Редактируемые поля */}
      <section className="glass-card pf-fields">
        {fields.map((field) => {
          const error = saveError?.key === field.key ? saveError.message : null;
          const errorId = `pf-err-${field.key}`;
          return (
            <div className="pf-field" key={field.key}>
              <span className="pf-field__label">{field.label}</span>
              {editing === field.key ? (
                <input
                  className={`pf-field__input${error ? ' pf-field__input--error' : ''}`}
                  type={field.type}
                  value={draft}
                  autoFocus
                  disabled={saving}
                  aria-invalid={error !== null}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => setDraft(e.target.value)}
                  // Уход фокуса — то же «применить». Запрос уйдёт только если
                  // значение изменилось, поэтому лишних PATCH нет.
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="pf-field__row"
                  onClick={() => startEdit(field.key)}
                  aria-label={`Изменить: ${field.label}`}
                >
                  <span className="pf-field__value">{field.value}</span>
                  <Pencil size={16} strokeWidth={2} />
                </button>
              )}
              {error && (
                <span className="pf-field__err" id={errorId} role="alert">
                  {error}
                </span>
              )}
              {saving && editing === field.key && (
                <span className="pf-field__hint">Сохраняем…</span>
              )}
            </div>
          );
        })}
      </section>

      {/* Ближайший старт участника */}
      {upcoming && upcomingDate && (
        <section className="hero-card pf-next">
          <span className="pf-next__label">Тебе предстоит:</span>
          <h3 className="pf-next__title u-display">{upcoming.title}</h3>
          <div className="pf-next__meta">
            <span>{dateShort.format(upcomingDate)}</span>
            <span className="dot">•</span>
            <span>{upcoming.distance}</span>
            <span className="dot">•</span>
            <span>{timeFmt.format(upcomingDate)}</span>
          </div>

          <div className="pf-next__stats">
            <div className="pf-stat">
              <span className="pf-stat__label">Номер:</span>
              <span className="pf-stat__value u-display">{profileMock.bibNumber}</span>
            </div>
            <div className="pf-stat">
              <span className="pf-stat__label">До старта:</span>
              <span className="pf-stat__value u-display">
                {left} {pluralDays(left)}
              </span>
            </div>
          </div>

          {/* TODO: ссылки-заглушки — на Event нет ни карты трассы, ни точки выдачи. */}
          <div className="pf-next__links">
            <button type="button" className="pf-link">
              <Map size={18} strokeWidth={2} />
              Карта старта
            </button>
            <button type="button" className="pf-link">
              <ShoppingBag size={18} strokeWidth={2} />
              Выдача старт. набора
            </button>
          </div>
        </section>
      )}

      {/* Трекер серии */}
      <section className="glass-card pf-series">
        <div className="pf-series__head">
          <h3 className="pf-series__title u-display">Серия 5&5</h3>
          <span className="pf-series__count">
            {done} из {seasonTotal}
          </span>
        </div>
        <div
          className="pf-progress"
          role="img"
          aria-label={`Пройдено ${done} из ${seasonTotal} стартов сезона`}
        >
          {Array.from({ length: seasonTotal }, (_, i) => (
            <span
              key={i}
              className={`pf-progress__seg${i < done ? ' pf-progress__seg--on' : ''}`}
            />
          ))}
        </div>
        <p className="pf-series__text">
          Закрой все {seasonTotal} и получи финишёрский мерч сезона
        </p>
      </section>

      {/* Пройденные старты — только те, кому организатор внёс результат.
          Пока таких нет, секции нет вовсе: пустой заголовок ни о чём. */}
      {past.length > 0 && (
        <>
          <p className="pf-section-label">Пройдено:</p>
          <section className="pf-past">
            {past.map((race) => (
              <article className="glass-card pf-past__item" key={race.eventId}>
                <div className="pf-past__main">
                  <h4 className="pf-past__title u-display">{race.title}</h4>
                  <span className="pf-past__date">{race.date}</span>
                </div>
                <div className="pf-past__result">
                  <span className="pf-past__time num">{race.time}</span>
                  <span className="pf-past__place">{race.place} место</span>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {/* TODO: ссылки-заглушки — истории платежей и документов на бэкенде нет. */}
      <div className="pf-links">
        <button type="button" className="pf-link pf-link--ink">
          <Ticket size={20} strokeWidth={2} />
          История платежей
        </button>
        <button type="button" className="pf-link pf-link--ink">
          <FileText size={20} strokeWidth={2} />
          Оферта и правила
        </button>
      </div>
    </motion.main>
  );
}

export default ProfileScreen;
