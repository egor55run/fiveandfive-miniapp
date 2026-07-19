import { useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ArrowRight, AlertCircle } from 'lucide-react';
import {
  ApiError,
  createRegistration,
  type EventDto,
  type RegistrationResult,
} from '../lib/api';

type Props = {
  event: EventDto;
  onBack: () => void;
  onRegistered: (result: RegistrationResult) => void;
};

type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  age: string;
  phone: string;
};

const EMPTY: FormValues = {
  firstName: '',
  lastName: '',
  email: '',
  age: '',
  phone: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = [
  { name: 'firstName', label: 'Имя', type: 'text', placeholder: 'Иван' },
  { name: 'lastName', label: 'Фамилия', type: 'text', placeholder: 'Иванов' },
  { name: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com' },
  { name: 'age', label: 'Возраст', type: 'number', placeholder: '25' },
  { name: 'phone', label: 'Номер телефона', type: 'tel', placeholder: '+7 700 000 00 00' },
] as const;

type FieldErrors = Partial<Record<keyof FormValues, string>>;

function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.firstName.trim()) errors.firstName = 'Укажите имя';
  if (!values.lastName.trim()) errors.lastName = 'Укажите фамилию';
  if (!values.email.trim()) errors.email = 'Укажите email';
  else if (!EMAIL_RE.test(values.email.trim())) errors.email = 'Некорректный email';
  const age = Number(values.age);
  if (!values.age.trim()) errors.age = 'Укажите возраст';
  else if (!Number.isFinite(age) || age <= 0 || age > 120)
    errors.age = 'Возраст должен быть числом';
  if (!values.phone.trim()) errors.phone = 'Укажите номер телефона';
  return errors;
}

// Понятные сообщения об ошибках сервера.
function mapServerError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message; // сетевая ошибка
    if (err.status === 409 && /slot/i.test(err.message))
      return 'Мест на этот старт больше нет';
    if (err.status === 409 && /already/i.test(err.message))
      return 'Вы уже зарегистрированы на этот старт';
    if (err.status === 400) return 'Проверьте правильность заполнения полей';
    if (err.status === 404) return 'Старт не найден';
  }
  return 'Не удалось зарегистрироваться. Попробуйте ещё раз';
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Almaty',
});

function RegistrationScreen({ event, onBack, onRegistered }: Props) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  const handleChange = (name: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
    if (serverError) setServerError(null);
  };

  const handleSubmit = async (event_: FormEvent) => {
    event_.preventDefault();
    const nextErrors = validate(values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setServerError(null);
    try {
      const result = await createRegistration({
        eventId: event.id,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        age: Number(values.age),
        phone: values.phone.trim(),
      });
      onRegistered(result);
    } catch (err) {
      setServerError(mapServerError(err));
      setSubmitting(false);
    }
  };

  return (
    <motion.main
      className="screen"
      initial={reduceMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <button type="button" className="back-btn" onClick={onBack}>
        <ChevronLeft size={18} strokeWidth={2.4} />
        Назад
      </button>

      <div className="card reg__context">
        <span className="race__eyebrow">
          <span className="race__pulse" aria-hidden="true" />
          Регистрация на старт
        </span>
        <h2 className="race__title reg__context-title">{event.title}</h2>
        <p className="reg__context-distance">
          Дистанция {event.distance} · {dateFmt.format(new Date(event.date))}
        </p>
      </div>

      <form className="card reg__form" onSubmit={handleSubmit} noValidate>
        {FIELDS.map((field) => (
          <div className="field" key={field.name}>
            <label className="field__label" htmlFor={field.name}>
              {field.label}
            </label>
            <input
              id={field.name}
              name={field.name}
              type={field.type}
              placeholder={field.placeholder}
              disabled={submitting}
              className={`field__input${errors[field.name] ? ' field__input--error' : ''}`}
              value={values[field.name]}
              onChange={(e) => handleChange(field.name, e.target.value)}
              inputMode={
                field.type === 'number'
                  ? 'numeric'
                  : field.type === 'tel'
                    ? 'tel'
                    : undefined
              }
              aria-invalid={Boolean(errors[field.name])}
            />
            {errors[field.name] && (
              <span className="field__error">{errors[field.name]}</span>
            )}
          </div>
        ))}

        {serverError && (
          <div className="form-error" role="alert">
            <AlertCircle size={16} strokeWidth={2.2} />
            <span>{serverError}</span>
          </div>
        )}

        <motion.button
          type="submit"
          className="btn-register"
          disabled={submitting}
          whileTap={reduceMotion || submitting ? undefined : { scale: 0.985 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {submitting ? 'Отправляем…' : 'Зарегистрироваться'}
          {!submitting && <ArrowRight size={18} strokeWidth={2.4} />}
        </motion.button>
      </form>
    </motion.main>
  );
}

export default RegistrationScreen;
