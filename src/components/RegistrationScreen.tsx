import { useEffect, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import Header from './Header';
import DocLink from './legal/DocLink';
import {
  ApiError,
  createRegistration,
  createSeasonPass,
  getCurrentSeason,
  REGISTRATION_CLOSED_TEXT,
  REGISTRATION_ENDED_TEXT,
  registrationState,
  type EventDto,
  type Gender,
  type PaymentDto,
  type SeasonDto,
  type UserDto,
} from '../lib/api';
import { hasLatin, normalizePersonName, personNameError } from '../lib/personName';
import {
  ADULT_AGE,
  ageOnStartDay,
  MIN_AGE,
  PARENTAL_CONSENT_LINK_WORDS,
  PARENTAL_CONSENT_TEXT,
  underageMessage,
} from '../lib/eligibility';

export type RegistrationOutcome = {
  user: UserDto;
  events: EventDto[]; // один — одиночная регистрация; несколько — абонемент
  seasonPass: boolean;
};

type Props = {
  event: EventDto;
  onBack: () => void;
  onRegistered: (outcome: RegistrationOutcome) => void;
  /** Счёт выставлен в Kaspi — дальше экран ожидания оплаты. */
  onPaymentStarted: (outcome: RegistrationOutcome, payment: PaymentDto) => void;
  /** Что уже известно об участнике: имя из профиля или Telegram, контакты из профиля в БД. */
  prefill?: RegistrationPrefill;
  /** Администратор может записаться и при закрытой регистрации. */
  registrationOpenForMe?: boolean;
};

type FormValues = {
  lastName: string;
  firstName: string;
  birthDate: string; // yyyy-mm-dd (input[type=date])
  gender: Gender | '';
  phone: string;
  email: string;
  finishTime: string;
  promocode: string;
};

const EMPTY: FormValues = {
  lastName: '',
  firstName: '',
  birthDate: '',
  gender: '',
  phone: '',
  email: '',
  finishTime: '',
  promocode: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Поля, которые можно подставить заранее — из Telegram и из профиля в БД. */
export type RegistrationPrefill = Partial<
  Pick<FormValues, 'lastName' | 'firstName' | 'birthDate' | 'gender' | 'phone' | 'email'>
>;

/** Пустые и отсутствующие значения не должны затирать EMPTY. */
function withPrefill(prefill?: RegistrationPrefill): FormValues {
  if (!prefill) return EMPTY;
  const filled = Object.fromEntries(
    Object.entries(prefill).filter(([, v]) => typeof v === 'string' && v !== ''),
  ) as Partial<FormValues>;
  return { ...EMPTY, ...filled };
}

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'MALE', label: 'Мужской' },
  { value: 'FEMALE', label: 'Женский' },
];
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

type NameField = 'lastName' | 'firstName';

const priceFmt = new Intl.NumberFormat('ru-RU');
const [parentConsentBefore, parentConsentAfter] = PARENTAL_CONSENT_TEXT.split(
  PARENTAL_CONSENT_LINK_WORDS,
);
const deadlineFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Almaty',
});
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

function RegistrationScreen({
  event,
  onBack,
  onRegistered,
  onPaymentStarted,
  prefill,
  registrationOpenForMe = false,
}: Props) {
  // Формы входа пользователь не видит: имя приходит из Telegram, а контакты —
  // из профиля, если он уже регистрировался раньше.
  const [values, setValues] = useState<FormValues>(() => withPrefill(prefill));
  const [season, setSeason] = useState<SeasonDto | null>(null);
  const [seasonChecked, setSeasonChecked] = useState(false);
  const [consentRules, setConsentRules] = useState(false);
  const [consentData, setConsentData] = useState(false);
  const toggleRules = () => {
    setConsentRules((v) => !v);
    setErrors((p) => ({ ...p, consents: undefined }));
  };
  const toggleData = () => {
    setConsentData((v) => !v);
    setErrors((p) => ({ ...p, consents: undefined }));
  };
  // Третья галочка — только для 16–17 лет на день старта.
  const [consentParent, setConsentParent] = useState(false);
  const toggleParent = () => {
    setConsentParent((v) => !v);
    setErrors((p) => ({ ...p, consents: undefined }));
  };
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

  // Абонемент предлагаем, только если старт входит в активный сезон и
  // регистрация открыта на все его старты (абонемент — всё или ничего).
  const seasonAvailable = Boolean(
    season?.events.some((e) => e.id === event.id) &&
      season.events.every((e) => !e.registrationDeadlinePassed),
  );
  const useSeason = seasonAvailable && seasonChecked;
  const total = useSeason && season ? season.price : event.price;
  const date = new Date(event.date);
  const state = registrationState(event, registrationOpenForMe);

  // Возраст — на день старта; для абонемента — на день первого старта сезона.
  const ageStart = useSeason && season?.events[0] ? season.events[0].date : event.date;
  const ageAtStart = values.birthDate ? ageOnStartDay(values.birthDate, ageStart) : null;
  const underageText =
    ageAtStart !== null && ageAtStart < MIN_AGE ? underageMessage(ageAtStart) : null;
  const minor = ageAtStart !== null && ageAtStart >= MIN_AGE && ageAtStart < ADULT_AGE;

  const setField = (name: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    if (serverError) setServerError(null);
  };

  // Имя и фамилия. Про латиницу говорим сразу, пока человек печатает, —
  // иначе он заполнит всю форму и узнает об этом только на отправке.
  // Остальные ошибки — при уходе с поля и на отправке.
  const setNameField = (name: NameField, value: string) => {
    setField(name, value);
    if (hasLatin(value)) {
      setErrors((prev) => ({ ...prev, [name]: personNameError(value, name) ?? undefined }));
    }
  };

  // Уходя с поля — привести к виду «Анна-Мария» (заглавные, без лишних
  // пробелов). Не на каждый символ: правка значения под курсором сбивает ввод.
  const finishNameField = (name: NameField) => {
    const normalized = normalizePersonName(values[name]);
    if (normalized !== values[name]) setValues((prev) => ({ ...prev, [name]: normalized }));
    if (normalized) {
      setErrors((prev) => ({ ...prev, [name]: personNameError(normalized, name) ?? undefined }));
    }
  };

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    for (const name of ['lastName', 'firstName'] as const) {
      const error = personNameError(normalizePersonName(values[name]), name);
      if (error) e[name] = error;
    }
    if (!values.birthDate) e.birthDate = 'Укажите дату рождения';
    else {
      const age = ageFromDob(values.birthDate);
      if (!Number.isFinite(age) || age < 1 || age > 120) e.birthDate = 'Проверьте дату';
      else if (underageText) e.birthDate = underageText;
    }
    if (!values.gender) e.gender = 'Выберите пол';
    if (!values.phone.trim()) e.phone = 'Укажите телефон';
    if (!values.email.trim()) e.email = 'Укажите email';
    else if (!EMAIL_RE.test(values.email.trim())) e.email = 'Некорректный email';
    if (!consentRules || !consentData) e.consents = 'Подтвердите оба согласия';
    else if (minor && !consentParent) e.consents = 'Подтвердите согласие родителя';
    return e;
  };

  const handleSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    const next = validate();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    const participant = {
      firstName: normalizePersonName(values.firstName),
      lastName: normalizePersonName(values.lastName),
      email: values.email.trim(),
      // Возраст шлём для совместимости, но решает дата: из неё сервер считает
      // age сам и сохраняет саму дату в профиль.
      age: ageFromDob(values.birthDate),
      birthDate: values.birthDate,
      phone: values.phone.trim(),
      // validate() уже не пустит пустое значение.
      gender: values.gender as Gender,
      // validate() не пускает без обеих галочек; сервер проверяет ещё раз и
      // записывает, с какой редакцией документов человек согласился.
      consents: minor
        ? ({ oferta: true, privacy: true, parent: true } as const)
        : ({ oferta: true, privacy: true } as const),
    };

    setSubmitting(true);
    setServerError(null);
    try {
      const { result, outcome } =
        useSeason && season
          ? {
              result: await createSeasonPass({ seasonId: season.id, ...participant }),
              outcome: { events: season.events, seasonPass: true },
            }
          : {
              result: await createRegistration({ eventId: event.id, ...participant }),
              outcome: { events: [event], seasonPass: false },
            };
      const full: RegistrationOutcome = { user: result.user, ...outcome };
      // Счёт ещё не оплачен — ждём оплату в Kaspi. Без счёта (бесплатный старт
      // или оплата не настроена) — сразу экран успеха.
      if (result.payment && result.payment.state !== 'PAID') {
        onPaymentStarted(full, result.payment);
      } else {
        onRegistered(full);
      }
    } catch (err) {
      // Ошибка про конкретное поле (номер без Kaspi, имя латиницей) — под это поле.
      const fieldErrors =
        err instanceof ApiError
          ? Object.fromEntries(
              Object.entries(err.fields).filter(([name]) => name in EMPTY || name === 'consents'),
            )
          : {};
      if (Object.keys(fieldErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...fieldErrors }));
      } else {
        setServerError(mapServerError(err));
      }
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
        {state !== 'ended' && event.registrationClosesAt && (
          <span className="reg-hero__deadline">
            Регистрация до {deadlineFmt.format(new Date(event.registrationClosesAt))}
          </span>
        )}
      </section>

      {state !== 'open' ? (
        // Регистрация ещё не открыта (нет оплаты) или срок на этот старт прошёл:
        // дата, дистанция и цена видны в шапке выше, а формы нет.
        <section className="reg-closed">
          <p className="reg-closed__title">
            {state === 'ended' ? REGISTRATION_ENDED_TEXT : REGISTRATION_CLOSED_TEXT}
          </p>
          <p className="reg-closed__text">
            {state === 'ended'
              ? `Регистрация на этот старт закрылась ${deadlineFmt.format(
                  new Date(event.registrationClosesAt ?? event.date),
                )}.`
              : 'Записаться можно будет прямо здесь, как только откроем регистрацию.'}
          </p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            Вернуться к стартам
          </button>
        </section>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="reg-fields">
          {registrationState(event) === 'soon' && (
            // Админ записывается до открытия — например, ради тестового платежа.
            <p className="reg-admin-note">
              Регистрация закрыта для участников — вы записываетесь как администратор
            </p>
          )}
          <p className="reg-group-label">Ваши данные:</p>

          <label className={`rfield${errors.lastName ? ' rfield--error' : ''}`}>
            <span className="rfield__label">Фамилия</span>
            <input
              className="rfield__input"
              type="text"
              placeholder="Иванова"
              autoComplete="family-name"
              autoCapitalize="words"
              maxLength={50}
              value={values.lastName}
              disabled={submitting}
              onChange={(e) => setNameField('lastName', e.target.value)}
              onBlur={() => finishNameField('lastName')}
            />
            {errors.lastName && <span className="rfield__err">{errors.lastName}</span>}
          </label>

          <label className={`rfield${errors.firstName ? ' rfield--error' : ''}`}>
            <span className="rfield__label">Имя</span>
            <input
              className="rfield__input"
              type="text"
              placeholder="Анна"
              autoComplete="given-name"
              autoCapitalize="words"
              maxLength={50}
              value={values.firstName}
              disabled={submitting}
              onChange={(e) => setNameField('firstName', e.target.value)}
              onBlur={() => finishNameField('firstName')}
            />
            {errors.firstName && <span className="rfield__err">{errors.firstName}</span>}
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
              {/* Младше 16 на день старта — говорим сразу, как дата введена. */}
              {(errors.birthDate ?? underageText) && (
                <span className="rfield__err">{errors.birthDate ?? underageText}</span>
              )}
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
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="rfield__chevron" size={18} strokeWidth={2} />
              {errors.gender && <span className="rfield__err">{errors.gender}</span>}
            </div>
          </div>

          <label className={`rfield${errors.phone ? ' rfield--error' : ''}`}>
            <span className="rfield__label">Телефон (Kaspi)</span>
            <input
              className="rfield__input"
              type="tel"
              inputMode="tel"
              placeholder="+7 700 000 00 00"
              value={values.phone}
              disabled={submitting}
              onChange={(e) => setField('phone', e.target.value)}
            />
            {errors.phone ? (
              <span className="rfield__err">{errors.phone}</span>
            ) : (
              <span className="rfield__hint">На этот номер придёт счёт в Kaspi</span>
            )}
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
            {/* Квадратик — кнопка-галочка, текст рядом тоже её переключает, а
                ссылка в тексте открывает документ (внутри <button> ссылке быть
                нельзя — поэтому строка разделена). */}
            <div className={`consent${errors.consents && !consentRules ? ' consent--error' : ''}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={consentRules}
                aria-labelledby="consent-rules"
                className={`checkbox${consentRules ? ' checkbox--on' : ''}`}
                onClick={toggleRules}
              >
                {consentRules && <Check size={16} strokeWidth={3} />}
              </button>
              <span id="consent-rules" className="consent__text" onClick={toggleRules}>
                Принимаю <DocLink doc="oferta">правила участия и оферту</DocLink>
              </span>
            </div>

            <div className={`consent${errors.consents && !consentData ? ' consent--error' : ''}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={consentData}
                aria-labelledby="consent-data"
                className={`checkbox${consentData ? ' checkbox--on' : ''}`}
                onClick={toggleData}
              >
                {consentData && <Check size={16} strokeWidth={3} />}
              </button>
              <span id="consent-data" className="consent__text" onClick={toggleData}>
                Согласен на{' '}
                <DocLink doc="privacy">обработку персональных данных</DocLink>
              </span>
            </div>

            {minor && (
              // 16–17 лет на день старта: по Положению стартовый пакет выдают
              // только с письменным согласием родителя. Сервер запишет и это.
              <div
                className={`consent${errors.consents && !consentParent ? ' consent--error' : ''}`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={consentParent}
                  aria-labelledby="consent-parent"
                  className={`checkbox${consentParent ? ' checkbox--on' : ''}`}
                  onClick={toggleParent}
                >
                  {consentParent && <Check size={16} strokeWidth={3} />}
                </button>
                <span id="consent-parent" className="consent__text" onClick={toggleParent}>
                  {/* Текст режем по самой константе: видимые слова не могут
                      разойтись с текстом, который записывает сервер. */}
                  {parentConsentBefore}
                  <DocLink doc="parentConsent">{PARENTAL_CONSENT_LINK_WORDS}</DocLink>
                  {parentConsentAfter}
                </span>
              </div>
            )}
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
            {submitting ? 'Выставляем счёт…' : 'Оплатить через Kaspi'}
          </motion.button>
        </form>
      )}
    </motion.main>
  );
}

export default RegistrationScreen;
