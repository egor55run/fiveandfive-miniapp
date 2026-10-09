'use client';

import { useState } from 'react';

export type Stage = {
  key: number;
  href: string;
  label: string;
  day: string;
  month: string;
  place: string;
  time: string;
  /** Подпись ссылки для экранных чтецов: «Триатлон Парк, 23 мая — подробнее…». */
  linkLabel: string;
};

type Texts = {
  hint: string;
  distance: string;
  rayGot: string;
  rayAdd: string;
  starTitle: string;
  starDone: string;
  /** «…собрано {n} из 5» — {n} подставляется. */
  starLabel: string;
  starText: string;
  motto: string;
};

// Лучи звезды (viewBox -170…170): сверху по часовой стрелке.
const RAYS = [
  '0,0 -35.3,-48.5 0,-150 35.3,-48.5',
  '0,0 35.3,-48.5 142.7,-46.4 57.1,18.5',
  '0,0 57.1,18.5 88.2,121.4 0,60',
  '0,0 0,60 -88.2,121.4 -57.1,18.5',
  '0,0 -57.1,18.5 -142.7,-46.4 -35.3,-48.5',
];
const SHADES = ['#FF6A13', '#FF7E2E', '#FF9250', '#FFA66F', '#FFBA8E'];

/**
 * Этапы сезона и звезда из пяти лучей (макет главной). Карточка ведёт на
 * страницу старта, кнопка «Собрать луч» на ней — зажигает луч звезды. Для
 * примера два луча собраны сразу, как в макете.
 */
export default function StagesStar({ stages, t }: { stages: Stage[]; t: Texts }) {
  const [got, setGot] = useState<boolean[]>(() => RAYS.map((_, i) => i < 2));
  const count = got.filter(Boolean).length;
  const toggle = (i: number) => setGot((prev) => prev.map((v, j) => (j === i ? !v : v)));

  return (
    <>
      <section id="starty" className="site-wrap h-stages" aria-label="Этапы сезона">
        <p className="h-stages__hint">{t.hint}</p>
        <div className="h-stages__grid">
          {stages.map((s, i) => {
            const on = i < RAYS.length && got[i];
            return (
              <article className={`h-stage h-lift${on ? ' is-got' : ''}`} key={s.key}>
                <span className="h-stage__label">{s.label}</span>
                <span className="h-stage__date">
                  <span className="h-stage__day">{s.day}</span>
                  <span className="h-stage__month">{s.month}</span>
                </span>
                <span className="h-stage__info">
                  <a className="h-stage__link" href={s.href} aria-label={s.linkLabel}>
                    {s.place}
                  </a>
                  <span className="h-stage__time">
                    {s.time} · {t.distance}
                  </span>
                </span>
                {i < RAYS.length && (
                  <button
                    type="button"
                    className="h-stage__ray"
                    aria-pressed={on}
                    onClick={() => toggle(i)}
                  >
                    {on ? t.rayGot : t.rayAdd}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section id="zvezda" className="h-star" data-anim>
        <div className="site-wrap h-star__row">
          <div className="h-star__art h-float">
            <svg viewBox="-170 -170 340 340" role="img" aria-label={t.starLabel.replace('{n}', String(count))}>
              {RAYS.map((points, i) => (
                <polygon
                  key={points}
                  points={points}
                  className={got[i] ? 'h-ray is-lit' : 'h-ray'}
                  fill={got[i] ? SHADES[i] : 'rgba(255, 106, 19, 0)'}
                />
              ))}
            </svg>
          </div>
          <div className="h-star__text">
            <span className="h-star__count" aria-live="polite">
              {count} / 5
            </span>
            <h2 className="h-title">{count === 5 ? t.starDone : t.starTitle}</h2>
            <p className="h-star__lead">{t.starText}</p>
            <p className="h-star__motto">{t.motto}</p>
          </div>
        </div>
      </section>
    </>
  );
}
