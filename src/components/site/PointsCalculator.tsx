'use client';

import { useState } from 'react';
import { CUTOFF_SECONDS, parseRunTime, pointsFor, type RatingGender } from '../../lib/rating';

/** Калькулятор на /reiting: «сколько баллов за моё время». */
export default function PointsCalculator() {
  const [time, setTime] = useState('25:00');
  const [gender, setGender] = useState<RatingGender>('MALE');
  const seconds = parseRunTime(time);

  return (
    <div className="calc">
      <label className="calc__field">
        <span>Время на 5 км</span>
        <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="25:00" inputMode="numeric" />
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
        {seconds === null ? (
          'Введите время в виде 25:00 или 1:02:30'
        ) : (
          <>
            <b>{pointsFor(seconds, gender)}</b> баллов
            {seconds > CUTOFF_SECONDS ? ' — финиш позже 60 минут' : ''}
          </>
        )}
      </p>
    </div>
  );
}
