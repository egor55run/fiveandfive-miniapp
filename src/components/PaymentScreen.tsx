import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Smartphone } from 'lucide-react';
import Header from './Header';
import { getPayment, isPaymentOpen, type PaymentDto } from '../lib/api';

type Props = {
  payment: PaymentDto;
  /** Что оплачивается — для подписи («старт» или «абонемент»). */
  title: string;
  seasonPass: boolean;
  /** Счёт оплачен — показать экран успеха. */
  onPaid: (payment: PaymentDto) => void;
  /** Вернуться к форме: поменять номер или попробовать ещё раз. */
  onBack: () => void;
};

/** Как часто спрашиваем сервер, оплачен ли счёт. */
const POLL_MS = 3000;

const priceFmt = new Intl.NumberFormat('ru-RU');

/** 87001234567 → +7 700 123 45 67 */
function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length !== 11) return phone;
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`;
}

/** Сколько осталось: «24:05». Ноль не уходит в минус. */
function formatLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * «Оплатите счёт в Kaspi». Счёт уже выставлен сервером и пришёл участнику
 * уведомлением в приложение Kaspi.kz. Здесь только ждём: опрашиваем статус и,
 * как только оплата прошла, переходим к экрану успеха.
 */
function PaymentScreen({ payment: initial, title, seasonPass, onPaid, onBack }: Props) {
  const reduceMotion = useReducedMotion();
  const [payment, setPayment] = useState<PaymentDto>(initial);
  const [now, setNow] = useState(() => Date.now());
  const paidHandled = useRef(false);

  // Опрос статуса, пока счёт открыт. Сетевые сбои молча пропускаем —
  // следующая попытка через POLL_MS.
  useEffect(() => {
    if (!isPaymentOpen(payment)) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const fresh = await getPayment(payment.id);
        if (alive) setPayment(fresh);
      } catch {
        if (alive) setPayment((p) => ({ ...p })); // перезапустить таймер
      }
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [payment]);

  // Секундомер для «место держим ещё …».
  useEffect(() => {
    if (!isPaymentOpen(payment)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payment]);

  // Оплачено — сразу дальше, один раз.
  useEffect(() => {
    if (payment.state === 'PAID' && !paidHandled.current) {
      paidHandled.current = true;
      onPaid(payment);
    }
  }, [payment, onPaid]);

  const open = isPaymentOpen(payment);
  const left = new Date(payment.expiresAt).getTime() - now;

  return (
    <motion.main
      className="screen pay"
      initial={reduceMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Header onBack={onBack} />

      <section className="hero-card pay-hero">
        <span className="pay-hero__badge" aria-hidden="true">
          {open || payment.state === 'PAID' ? (
            <Smartphone size={34} strokeWidth={2.2} />
          ) : (
            <AlertCircle size={34} strokeWidth={2.2} />
          )}
        </span>

        <h2 className="pay-hero__title u-display">
          {open || payment.state === 'PAID' ? 'Оплатите в Kaspi' : 'Оплата не прошла'}
        </h2>

        <p className="pay-hero__amount">{priceFmt.format(payment.amount)} ₸</p>
        <p className="pay-hero__text">
          {seasonPass ? 'Абонемент 5&5' : 'Регистрация'} · {title}
        </p>
      </section>

      {open || payment.state === 'PAID' ? (
        <>
          <section className="glass-card pay-card">
            <ol className="pay-steps">
              <li>
                Счёт отправлен на номер <b>{formatPhone(payment.phone)}</b>
              </li>
              <li>Откройте приложение Kaspi.kz — счёт придёт уведомлением</li>
              <li>Подтвердите оплату. Это окно обновится само</li>
            </ol>
          </section>

          <div className="pay-wait" role="status" aria-live="polite">
            <span className="pay-wait__dot" aria-hidden="true" />
            {payment.state === 'PAID'
              ? 'Оплата получена'
              : left > 0
                ? `Ждём оплату · место держим ещё ${formatLeft(left)}`
                : 'Проверяем оплату…'}
          </div>

          <button type="button" className="btn-secondary" onClick={onBack}>
            <ArrowLeft size={18} strokeWidth={2.2} />
            Изменить номер телефона
          </button>
        </>
      ) : (
        <>
          <div className="form-error" role="alert">
            <AlertCircle size={16} strokeWidth={2.2} />
            <span>{payment.message ?? 'Оплата не прошла. Попробуйте ещё раз'}</span>
          </div>
          <motion.button
            type="button"
            className="btn-register btn-register--gradient"
            onClick={onBack}
            whileTap={reduceMotion ? undefined : { scale: 0.985 }}
          >
            Попробовать ещё раз
          </motion.button>
        </>
      )}
    </motion.main>
  );
}

export default PaymentScreen;
