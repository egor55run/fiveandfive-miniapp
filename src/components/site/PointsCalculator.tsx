'use client';

import { useState } from 'react';
import { CUTOFF_SECONDS, parseRunTime, pointsCaption, pointsFor, type RatingGender } from '../../lib/rating';

/**
 * Цифры → время с двоеточиями, считая справа: последние две — секунды, перед
 * ними две — минуты, остальное — часы. «2500» → «25:00», «10512» → «1:05:12».
 * На телефоне с цифровой клавиатурой двоеточия не набрать — их ставим сами
 * (просьба пользователя, 2026-10-25).
 */
export function formatTimeDigits(digits: string): string {
  if (digits.length <= 2) return digits;
  const ss = digits.slice(-2);
  const rest = digits.slice(0, -2);
  if (rest.length <= 2) return `${rest}:${ss}`;
  return `${rest.slice(0, -2)}:${rest.slice(-2)}:${ss}`;
}

const MAX_DIGITS = 6; // ч:мм:сс

/** Калькулятор на /reiting: «сколько баллов за моё время». */
export default function PointsCalculator() {
  // Храним только цифры — так стирание работает как обычно.
  const [digits, setDigits] = useState('2500');
  const [gender, setGender] = useState<RatingGender>('MALE');
  const time = formatTimeDigits(digits);
  const seconds = parseRunTime(time);
  const points = seconds === null ? null : pointsFor(seconds, gender);

  const onChange = (value: string) => {
    let next = value.replace(/\D/g, '').slice(0, MAX_DIGITS);
    // Стёрли только двоеточие (цифры те же, строка короче) — стираем цифру перед ним.
    if (next === digits && value.length < time.length) next = digits.slice(0, -1);
    setDigits(next);
  };

  return (
    <div className="calc">
      <label className="calc__field">
        <span>Время на 5 км</span>
        <input
          value={time}
          onChange={(e) => onChange(e.target.value)}
          placeholder="25:00"
          inputMode="numeric"
          pattern="[0-9:]*"
          autoComplete="off"
          maxLength={8}
        />
      </label>
      <div className="calc__gender" role="radiogroup" aria-label="Пол">
        {(['MALE', 'FEMALE'] as const).map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={gender === g}
            className={gender === g ? 'calc__on' : undefined}
            onClick={() => setGender(g)}
          >
            {g === 'MALE' ? 'Мужчина' : 'Женщина'}
          </button>
        ))}
      </div>
      <p className="calc__result" aria-live="polite">
        {seconds === null || points === null ? (
          'Наберите время цифрами: 2500 — это 25:00, 10512 — 1:05:12'
        ) : (
          <>
            <b>{points}</b>
            <span className="calc__caption">
              {pointsCaption(points)}
              {seconds > CUTOFF_SECONDS ? ' — финиш позже 60 минут' : ''}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
