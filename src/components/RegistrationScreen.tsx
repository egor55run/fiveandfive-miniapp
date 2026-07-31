import { useEffect, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import Header from './Header';
import {
  ApiError,
  createRegistration,
  createSeasonPass,
  getCurrentSeason,
  type EventDto,
  type SeasonDto,
  type UserDto,
} from '../lib/api';

export type RegistrationOutcome = {
  user: UserDto;
  events: EventDto[]; // один — одиночная регистрация; несколько — абонемент
  seasonPass: boolean;
  // Бэкенд хранит только age, поэтому дату рождения несём в состоянии сессии —
  // профиль показывает её как введённую. См. registration-backend-gaps.
  birthDate: string;
};

type Props = {
  event: EventDto;
  onBack: () => void;
  onRegistered: (outcome: RegistrationOutcome) => void;
};

type FormValues = {
  fio: string;
  birthDate: string; // yyyy-mm-dd (input[type=date])
  gender: string;
  phone: string;
  email: string;
  finishTime: string;
  promocode: string;
};

const EMPTY: FormValues = {
  fio: '',
  birthDate: '',
  gender: '',
  phone: '',
  email: '',
  finishTime: '',
  promocode: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENDERS = ['Мужской', 'Женский'];
const FINISH_TIMES = ['~20 минут', '~25 минут', '~30 минут', '~40 минут', '~50 минут', '60+ минут'];

type FieldErrors = Partial<Record<keyof FormValues | 'consents', string>>;

// Возраст из даты рождения (бэкенд хранит age:int, поля даты нет).
function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// «Фамилия Имя Отчество» → бэкенд принимает только firstName/lastName.
function splitFio(fio: string): { firstName: string; lastName: string } {
  const parts = fio.trim().split(/\s+/);
  return { lastName: parts[0] ?? '', firstName: parts.slice(1).join(' ') };
}

const priceFmt = new Intl.NumberFormat('ru-RU');
const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Almaty',
});

function mapServerError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message;
    // Сервер уже прислал локализованное сообщение (напр. отказ по абонементу).
    if (/[а-яё]/i.test(err.message)) return err.message;
    if (err.status === 409 && /slot/i.test(err.message)) return 'Мест на этот старт больше нет';
    if (err.status === 409 && /already/i.test(err.message))
      return 'Вы уже зарегистрированы на этот старт';
    if (err.status === 400) return 'Проверьте правильность заполнения полей';
    if (err.status === 404) return 'Старт не найден';
  }
  return 'Не удалось зарегистрироваться. Попробуйте ещё раз';
}

function RegistrationScreen({ event, onBack, onRegistered }: Props) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [season, setSeason] = useState<SeasonDto | null>(null);
  const [seasonChecked, setSeasonChecked] = useState(false);
  const [consentRules, setConsentRules] = useState(false);
  const [consentData, setConsentData] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Активный сезон (для опции абонемента). Ошибку/отсутствие тихо игнорируем —
  // тогда просто нет апсейла, одиночная регистрация работает как обычно.
  useEffect(() => {
    let alive = true;
    getCurrentSeason()
      .then((s) => {
        if (alive) setSeason(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Абонемент предлагаем, только если старт входит в активный сезон.
  const seasonAvailable = Boolean(season?.events.some((e) => e.id === event.id));
  const useSeason = seasonAvailable && seasonChecked;
  const total = useSeason && season ? season.price : event.price;
  const date = new Date(event.date);

  const setField = (name: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    if (serverError) setServerError(null);
  };

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    const { firstName, lastName } = splitFio(values.fio);
    if (!lastName || !firstName) e.fio = 'Укажите фамилию и имя';
    if (!values.birthDate) e.birthDate = 'Укажите дату рождения';
    else {
      const age = ageFromDob(values.birthDate);
      if (!Number.isFinite(age) || age < 1 || age > 120) e.birthDate = 'Проверьте дату';
    }
    if (!values.gender) e.gender = 'Выберите пол';
    if (!values.phone.trim()) e.phone = 'Укажите телефон';
    if (!values.email.trim()) e.email = 'Укажите email';
    else if (!EMAIL_RE.test(values.email.trim())) e.email = 'Некорректный email';
    if (!consentRules || !consentData) e.consents = 'Подтвердите оба согласия';
    return e;
  };

  const handleSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    const next = validate();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    const { firstName, lastName } = splitFio(values.fio);
    const participant = {
      firstName,
      lastName,
      email: values.email.trim(),
      age: ageFromDob(values.birthDate),
      phone: values.phone.trim(),
    };

    setSubmitting(true);
    setServerError(null);
    try {
      if (useSeason && season) {
        const result = await createSeasonPass({ seasonId: season.id, ...participant });
        onRegistered({
          user: result.user,
          events: season.events,
          seasonPass: true,
          birthDate: values.birthDate,
        });
      } else {
        const result = await createRegistration({ eventId: event.id, ...participant });
        onRegistered({
          user: result.user,
          events: [event],
          seasonPass: false,
          birthDate: values.birthDate,
        });
      }
    } catch (err) {
      setServerError(mapServerError(err));
      setSubmitting(false);
    }
  };

  return (
    <motion.main
      className="screen reg"
      initial={reduceMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Header onBack={onBack} />

      <section className="reg-hero">
        <span className="reg-hero__eyebrow">Регистрация на</span>
        <h2 className="reg-hero__title u-display">{event.title}</h2>
        <div className="reg-hero__meta">
          <span>{dateFmt.format(date)}</span>
          <span className="dot">•</span>
          <span>{event.distance}</span>
          <span className="dot">•</span>
          <span>{priceFmt.format(event.price)} ₸</span>
        </div>
      </section>

      <form onSubmit={handleSubmit} noValidate className="reg-fields">
        <p className="reg-group-label">Ваши данные:</p>

        <label className={`rfield${errors.fio ? ' rfield--error' : ''}`}>
          <span className="rfield__label">ФИО</span>
          <input
            className="rfield__input"
            type="text"
            placeholder="Иванов Иван Иванович"
            value={values.fio}
            disabled={submitting}
            onChange={(e) => setField('fio', e.target.value)}
          />
          {errors.fio && <span className="rfield__err">{errors.fio}</span>}
        </label>

        <div className="reg-row">
          <label className={`rfield${errors.birthDate ? ' rfield--error' : ''}`}>
            <span className="rfield__label">Дата рождения</span>
            <input
              className="rfield__input"
              type="date"
              value={values.birthDate}
              disabled={submitting}
              onChange={(e) => setField('birthDate', e.target.value)}
            />
            {errors.birthDate && <span className="rfield__err">{errors.birthDate}</span>}
          </label>

          <div className={`rfield rfield--select${errors.gender ? ' rfield--error' : ''}`}>
            <span className="rfield__label">Пол</span>
            <select
              className="rfield__input"
              value={values.gender}
              disabled={submitting}
              onChange={(e) => setField('gender', e.target.value)}
            >
              <option value="" disabled>
                Выбрать
              </option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <ChevronDown className="rfield__chevron" size={18} strokeWidth={2} />
            {errors.gender && <span className="rfield__err">{errors.gender}</span>}
          </div>
        </div>

        <label className={`rfield${errors.phone ? ' rfield--error' : ''}`}>
          <span className="rfield__label">Телефон</span>
          <input
            className="rfield__input"
            type="tel"
            inputMode="tel"
            placeholder="+7 700 000 00 00"
            value={values.phone}
            disabled={submitting}
            onChange={(e) => setField('phone', e.target.value)}
          />
          {errors.phone && <span className="rfield__err">{errors.phone}</span>}
        </label>

        <label className={`rfield${errors.email ? ' rfield--error' : ''}`}>
          <span className="rfield__label">Email</span>
          <input
            className="rfield__input"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={values.email}
            disabled={submitting}
            onChange={(e) => setField('email', e.target.value)}
          />
          {errors.email && <span className="rfield__err">{errors.email}</span>}
        </label>

        <p className="reg-group-label">Детали забега:</p>

        <div className="rfield rfield--select">
          <span className="rfield__label">Ожидаемое время финиша</span>
          <select
            className="rfield__input"
            value={values.finishTime}
            disabled={submitting}
            onChange={(e) => setField('finishTime', e.target.value)}
          >
            <option value="">Не знаю</option>
            {FINISH_TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <ChevronDown className="rfield__chevron" size={18} strokeWidth={2} />
        </div>

        <label className="rfield">
          <span className="rfield__label">Промокод</span>
          <input
            className="rfield__input"
            type="text"
            placeholder="необязательно"
            value={values.promocode}
            disabled={submitting}
            onChange={(e) => setField('promocode', e.target.value)}
          />
        </label>

        {seasonAvailable && season && (
          <button
            type="button"
            className="upsell"
            aria-pressed={seasonChecked}
            onClick={() => setSeasonChecked((s) => !s)}
          >
            <span
              className={`checkbox${seasonChecked ? ' checkbox--on' : ''}`}
              aria-hidden="true"
            >
              {seasonChecked && <Check size={16} strokeWidth={3} />}
            </span>
            <span className="upsell__body">
              <span className="upsell__title u-display">
                Взять весь сезон 5&5 за {priceFmt.format(season.price)} ₸
              </span>
              <span className="upsell__desc">
                Оплати все {season.events.length} стартов сезона одним платежом
                {season.savings > 0 ? ` и сэкономь ${priceFmt.format(season.savings)} ₸.` : '.'}
              </span>
            </span>
          </button>
        )}

        <div className="consents">
          <button
            type="button"
            role="checkbox"
            aria-checked={consentRules}
            className={`consent${errors.consents && !consentRules ? ' consent--error' : ''}`}
            onClick={() => {
              setConsentRules((v) => !v);
              setErrors((p) => ({ ...p, consents: undefined }));
            }}
          >
            <span
              className={`checkbox${consentRules ? ' checkbox--on' : ''}`}
              aria-hidden="true"
            >
              {consentRules && <Check size={16} strokeWidth={3} />}
            </span>
            <span className="consent__text">Принимаю правила участия и оферту</span>
          </button>

          <button
            type="button"
            role="checkbox"
            aria-checked={consentData}
            className={`consent${errors.consents && !consentData ? ' consent--error' : ''}`}
            onClick={() => {
              setConsentData((v) => !v);
              setErrors((p) => ({ ...p, consents: undefined }));
            }}
          >
            <span
              className={`checkbox${consentData ? ' checkbox--on' : ''}`}
              aria-hidden="true"
            >
              {consentData && <Check size={16} strokeWidth={3} />}
            </span>
            <span className="consent__text">Согласен на обработку персональных данных</span>
          </button>
        </div>

        {errors.consents && <span className="rfield__err">{errors.consents}</span>}

        {serverError && (
          <div className="form-error" role="alert">
            <AlertCircle size={16} strokeWidth={2.2} />
            <span>{serverError}</span>
          </div>
        )}

        <div className="reg-pay">
          <span className="reg-pay__label">К оплате</span>
          <span className="reg-pay__amount">{priceFmt.format(total)} ₸</span>
        </div>

        <motion.button
          type="submit"
          className="btn-register btn-register--gradient btn-pay"
          disabled={submitting}
          whileTap={reduceMotion || submitting ? undefined : { scale: 0.985 }}
        >
          {submitting ? 'Отправляем…' : 'Оплатить и зарегистрироваться'}
        </motion.button>
      </form>
    </motion.main>
  );
}

export default RegistrationScreen;
