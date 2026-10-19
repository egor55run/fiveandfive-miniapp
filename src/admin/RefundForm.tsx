import { useEffect, useState } from 'react';
import { applyRefund, getRefundPreview, type RefundPercent, type RefundPreview } from './api';
import { formatDate } from './helpers';

/**
 * «Оформить возврат» (оферта, п. 5.1 и 5.3). Деньги владелец возвращает сам в
 * ApiPay или Kaspi Pay; здесь — процент, статус «Возврат», место и журнал.
 * Абонемент: один этап (цена / число стартов) или все оставшиеся, у каждого
 * свой процент по его дате.
 */
const PERCENTS: RefundPercent[] = [100, 50, 0];

const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n)} ₸`;

type Props = {
  registrationId: number;
  onDone: (message: string) => void;
  onCancel: () => void;
};

export default function RefundForm({ registrationId, onDone, onCancel }: Props) {
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [wholePass, setWholePass] = useState(false);
  const [percents, setPercents] = useState<Record<number, RefundPercent>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getRefundPreview(registrationId)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        setPercents(Object.fromEntries(p.stages.map((s) => [s.registrationId, s.suggested])));
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Не удалось загрузить данные возврата'));
    return () => {
      alive = false;
    };
  }, [registrationId]);

  if (!preview) {
    return (
      <div className="ad-card">
        <h3>Оформить возврат</h3>
        {error ? <p className="ad-msg ad-msg--error">{error}</p> : <p className="ad-msg">Загружаем…</p>}
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={onCancel}>
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  const isPass = preview.kind === 'pass';
  // Один этап — та регистрация, с которой открыли форму; весь абонемент — все оставшиеся.
  const chosen = preview.stages.filter((s) =>
    s.refundable && (isPass && wholePass ? true : s.registrationId === registrationId),
  );
  const amountOf = (base: number, p: RefundPercent) => Math.round((base * p) / 100);
  const total = chosen.reduce((sum, s) => sum + amountOf(s.base, percents[s.registrationId] ?? s.suggested), 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await applyRefund(registrationId, {
        stages: chosen.map((s) => ({ registrationId: s.registrationId, percent: percents[s.registrationId] ?? s.suggested })),
        wholePass: isPass && wholePass,
      });
      onDone(
        `${preview.subject}: возврат оформлен — ${res.totalText}` +
          (res.stages > 1 ? ` за ${res.stages} старта(ов)` : '') +
          '. Место освобождено, запись в журнале. Деньги верните в ApiPay или Kaspi Pay.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось оформить возврат');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-card">
      <h3>Оформить возврат: {preview.subject}</h3>
      <p className="ad-hint">
        {isPass ? 'Абонемент' : 'Старт'}: оплачено {money(preview.paid)}
        {preview.alreadyRefunded > 0 && ` · уже оформлено возвратов на ${money(preview.alreadyRefunded)}`}
        {preview.providerRefunded > 0 && ` · ApiPay вернул ${money(preview.providerRefunded)}`}.
        {isPass && ` Один этап — ${money(preview.stages[0]?.base ?? 0)} (цена абонемента / ${preview.stages.length}).`}
      </p>
      <p className="ad-hint ad-hint--dim">
        По оферте (п. 5.1): за 30 дней и более до старта — 100%, за 7–29 дней — 50%, меньше 7 дней или неявка — без
        возврата. Процент подставлен по дате, его можно поменять.
      </p>

      {isPass && (
        <div className="ad-actions">
          <label>
            <input type="radio" checked={!wholePass} onChange={() => setWholePass(false)} disabled={busy} /> Один этап
          </label>
          <label>
            <input type="radio" checked={wholePass} onChange={() => setWholePass(true)} disabled={busy} /> Весь абонемент
            (все оставшиеся старты)
          </label>
        </div>
      )}

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Старт</th>
              <th>Дата</th>
              <th>Подсказка</th>
              <th>Возврат</th>
              <th className="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {preview.stages
              .filter((s) => !isPass || wholePass || s.registrationId === registrationId)
              .map((s) => {
                const on = chosen.includes(s);
                const p = percents[s.registrationId] ?? s.suggested;
                return (
                  <tr key={s.registrationId} className={on ? undefined : 'ad-row--muted'}>
                    <td>{s.eventTitle}</td>
                    <td className="ad-nowrap">{formatDate(s.eventDate)}</td>
                    <td>{s.note ?? `${s.daysLeft >= 0 ? `за ${s.daysLeft} дн.` : 'прошёл'}: ${s.rule}`}</td>
                    <td>
                      {on ? (
                        <select
                          value={p}
                          disabled={busy}
                          onChange={(e) =>
                            setPercents((prev) => ({ ...prev, [s.registrationId]: Number(e.target.value) as RefundPercent }))
                          }
                        >
                          {PERCENTS.map((v) => (
                            <option key={v} value={v}>
                              {v}%
                            </option>
                          ))}
                        </select>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num ad-nowrap">{on ? money(amountOf(s.base, p)) : '—'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <p className="ad-hint">
        Итого к возврату: <b>{money(total)}</b>. Запись станет «Возврат», место освободится
        {isPass && wholePass ? ', абонемент будет отменён' : ''}.
      </p>
      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      <div className="ad-actions">
        <button
          type="button"
          className="ad-btn ad-btn--primary"
          disabled={busy || chosen.length === 0}
          onClick={() => void submit()}
        >
          {busy ? 'Оформляем…' : 'Оформить возврат'}
        </button>
        <button type="button" className="ad-btn" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
