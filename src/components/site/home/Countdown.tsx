'use client';

import { useEffect, useState } from 'react';

type Units = { days: string; hours: string; mins: string; secs: string };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Обратный отсчёт до старта. Сервер рисует значения на момент запроса, браузер
 * подхватывает и тикает раз в секунду — цифры между ними расходятся на пару
 * секунд, отсюда suppressHydrationWarning.
 */
export default function Countdown({ target, label, units }: { target: string; label: string; units: Units }) {
  const end = Date.parse(target);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  let left = Math.max(0, Math.floor((end - now) / 1000));
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const mins = Math.floor(left / 60);
  const secs = left - mins * 60;

  const cells = [
    { value: String(days), unit: units.days },
    { value: pad(hours), unit: units.hours },
    { value: pad(mins), unit: units.mins },
    { value: pad(secs), unit: units.secs, accent: true },
  ];

  return (
    <div className="h-count">
      <p className="h-count__label">
        <span className="h-dot" aria-hidden="true" />
        {label}
      </p>
      {/* Экранным чтецам — без посекундных изменений: только дата в подписи. */}
      <div className="h-count__cells" role="timer" aria-live="off">
        {cells.map((c) => (
          <div className={`h-count__cell${c.accent ? ' h-count__cell--accent' : ''}`} key={c.unit}>
            <span className="h-count__value" suppressHydrationWarning>
              {c.value}
            </span>
            <span className="h-count__unit">{c.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
