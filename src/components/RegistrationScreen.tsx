import { useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ArrowRight } from 'lucide-react';
import { RACE } from '../data/race';

export type Participant = {
  firstName: string;
  lastName: string;
  email: string;
  age: string;
  phone: string;
};

type Props = {
  onSubmit: (participant: Participant) => void;
  onBack: () => void;
};

const EMPTY: Participant = {
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

type FieldErrors = Partial<Record<keyof Participant, string>>;

function validate(values: Participant): FieldErrors {
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

function RegistrationScreen({ onSubmit, onBack }: Props) {
  const [values, setValues] = useState<Participant>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const reduceMotion = useReducedMotion();

  const handleChange = (name: keyof Participant, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Сбрасываем ошибку поля, как только пользователь его правит
    setErrors((prev) => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(values);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onSubmit(values);
  };

  return (
    <motion.main
      className="screen"
      initial={{ opacity: 0, x: 24 }}
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
        <h2 className="race__title reg__context-title">{RACE.title}</h2>
        <p className="reg__context-distance">
          Дистанция {RACE.distance} · {RACE.dateLabel}, {RACE.timeLabel}
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

        <motion.button
          type="submit"
          className="btn-register"
          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          Зарегистрироваться
          <ArrowRight size={18} strokeWidth={2.4} />
        </motion.button>
      </form>
    </motion.main>
  );
}

export default RegistrationScreen;
