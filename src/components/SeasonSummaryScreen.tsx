import { useEffect, useState, type ReactNode } from 'react';
import { getSeasonSummary, type SeasonSummaryDto } from '../lib/api';
import { formatRunTime } from '../lib/rating';
import { saveImage, shareStory } from '../lib/telegram';

/**
 * Личные итоги сезона (2026-11-12) — серия экранов в духе «итогов года»:
 * этапы и звезда, километры, лучший забег, личный рекорд и улучшение, итоговое
 * место и его путь по этапам, «быстрее X%», и в конце — «Поделиться»
 * (картинка для сторис 9:16 и для поста 1:1 с сайта /itogi/<год>/karta/…).
 * Касание справа — дальше, слева — назад.
 */

const nf = new Intl.NumberFormat('ru-RU');

/** Звезда из пяти лучей: собранные — оранжевые. */
export function SummaryStar({ rays, size = 180 }: { rays: number; size?: number }) {
  const c = 50;
  const ray = (i: number) => {
    const a = (-90 + i * 72) * (Math.PI / 180);
    const l = (-90 + i * 72 - 36) * (Math.PI / 180);
    const r = (-90 + i * 72 + 36) * (Math.PI / 180);
    const pt = (ang: number, rad: number) => `${(c + rad * Math.cos(ang)).toFixed(2)},${(c + rad * Math.sin(ang)).toFixed(2)}`;
    return `${c},${c} ${pt(l, 19)} ${pt(a, 48)} ${pt(r, 19)}`;
  };
  return (
    <svg className="ss-star" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Собрано лучей: ${rays} из 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <polygon key={i} points={ray(i)} className={i < rays ? 'ss-star__ray ss-star__ray--on' : 'ss-star__ray'} />
      ))}
    </svg>
  );
}

/** Путь по рейтингу: место после каждого этапа (1-е — вверху). */
function PlacePath({ h }: { h: SeasonSummaryDto['history'] }) {
  const pts = h.filter((x) => x.place !== null) as (SeasonSummaryDto['history'][number] & { place: number })[];
  if (pts.length < 2) return null;
  const W = 280, H = 110, pad = 18;
  const max = Math.max(...pts.map((p) => p.place));
  const min = Math.min(...pts.map((p) => p.place));
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (p: number) => (max === min ? H / 2 : pad + ((p - min) * (H - 2 * pad)) / (max - min));
  return (
    <svg className="ss-path" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Места по этапам: ${pts.map((p) => p.place).join(', ')}`}>
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.place)}`).join(' ')} className="ss-path__line" />
      {pts.map((p, i) => (
        <g key={p.stage}>
          <circle cx={x(i)} cy={y(p.place)} r={5} className="ss-path__dot" />
          <text x={x(i)} y={y(p.place) - 10} textAnchor="middle" className="ss-path__val">
            {p.place}
          </text>
          <text x={x(i)} y={H + 14} textAnchor="middle" className="ss-path__stage">
            {`Э${p.stage}`}
          </text>
        </g>
      ))}
    </svg>
  );
}

function stagesWord(n: number): string {
  const m100 = n % 100, m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return 'этапов';
  if (m10 === 1) return 'этап';
  if (m10 >= 2 && m10 <= 4) return 'этапа';
  return 'этапов';
}

type Slide = { key: string; body: ReactNode };

function slides(s: SeasonSummaryDto, cards: { story: string; post: string }, onClose: () => void): Slide[] {
  const out: Slide[] = [
    {
      key: 'intro',
      body: (
        <>
          <p className="ss-kicker">Сезон {s.year}</p>
          <h1 className="ss-big">{s.firstName ? `${s.firstName}, вот ваш сезон` : 'Вот ваш сезон'}</h1>
          <p className="ss-text">Пять парков Астаны, пять воскресений. Смотрим, каким он получился.</p>
          <p className="ss-hint">Касание справа — дальше</p>
        </>
      ),
    },
    {
      key: 'stages',
      body: (
        <>
          <p className="ss-kicker">Этапы</p>
          <h1 className="ss-big">
            {s.stagesRun} из {s.stagesTotal}
          </h1>
          <SummaryStar rays={s.rays} />
          <p className="ss-text">
            {s.rays >= 5
              ? 'Звезда собрана целиком: все пять лучей ваши.'
              : `Вы пробежали ${s.stagesRun} ${stagesWord(s.stagesRun)} и собрали ${s.rays} из 5 лучей звезды.`}
          </p>
        </>
      ),
    },
    {
      key: 'km',
      body: (
        <>
          <p className="ss-kicker">Километры</p>
          <h1 className="ss-huge">{nf.format(s.km)}</h1>
          <p className="ss-text">километров вы пробежали на этапах сезона.</p>
        </>
      ),
    },
  ];
  if (s.bestRace) {
    out.push({
      key: 'best',
      body: (
        <>
          <p className="ss-kicker">Лучший забег</p>
          <h1 className="ss-big">
            Этап {s.bestRace.stage}
            <span className="ss-sub">{s.bestRace.title}</span>
          </h1>
          {s.bestRace.place !== null && (
            <p className="ss-stat">
              <b>{s.bestRace.place}-е место</b> из {s.bestRace.of}
            </p>
          )}
          <p className="ss-stat">{formatRunTime(s.bestRace.time)}</p>
        </>
      ),
    });
  }
  if (s.record) {
    out.push({
      key: 'record',
      body: (
        <>
          <p className="ss-kicker">Личный рекорд</p>
          <h1 className="ss-huge">{formatRunTime(s.record.time)}</h1>
          <p className="ss-text">
            Этап {s.record.stage} · {s.record.title}
          </p>
          <p className="ss-text ss-text--accent">
            {s.improvement !== null
              ? `За сезон вы стали быстрее на ${formatRunTime(s.improvement)} по сравнению с первым финишем.`
              : s.stagesRun > 1
                ? 'Самый быстрый забег — первый. Есть что улучшать в следующем сезоне.'
                : 'Первый финиш — и сразу личный рекорд.'}
          </p>
        </>
      ),
    });
  }
  if (s.final) {
    out.push({
      key: 'place',
      body: (
        <>
          <p className="ss-kicker">Рейтинг сезона</p>
          <h1 className="ss-big">
            {s.final.place}-е место
            <span className="ss-sub">из {s.final.of} · {nf.format(s.final.total)} баллов</span>
          </h1>
          <PlacePath h={s.history} />
          <p className="ss-text">Так менялось ваше место после каждого этапа.</p>
        </>
      ),
    });
  }
  if (s.fasterThan !== null) {
    out.push({
      key: 'faster',
      body: (
        <>
          <p className="ss-kicker">Скорость</p>
          <h1 className="ss-huge">{s.fasterThan}%</h1>
          <p className="ss-text">
            {s.fasterThan > 0
              ? `Ваш лучший забег быстрее, чем у ${s.fasterThan}% участников сезона.`
              : 'Медаль ваша, а в следующем сезоне — обгоните себя.'}
          </p>
        </>
      ),
    });
  }
  out.push({
    key: 'share',
    body: (
      <>
        <p className="ss-kicker">Поделиться</p>
        <img className="ss-card" src={cards.post} alt="Карточка итогов сезона" width={260} height={260} />
        <div className="ss-actions" onClick={(e) => e.stopPropagation()}>
          <button
              type="button"
              className="btn-register btn-register--gradient"
              onClick={() => {
                const ok = shareStory(cards.story, `Мой сезон 5&5 ${s.year}`, { url: `${window.location.origin}/itogi/${s.year}`, name: 'Итоги 5&5' });
                if (!ok) saveImage(cards.story, `5and5-${s.year}-story.png`);
              }}
            >
              Поделиться в сторис
            </button>
          <button type="button" className="btn-secondary" onClick={() => saveImage(cards.story, `5and5-${s.year}-story.png`)}>
            Сохранить для сторис (9:16)
          </button>
          <button type="button" className="btn-secondary" onClick={() => saveImage(cards.post, `5and5-${s.year}-post.png`)}>
            Сохранить для поста (1:1)
          </button>
          <button type="button" className="ss-link" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </>
    ),
  });
  return out;
}

export default function SeasonSummaryScreen({ year, onClose }: { year?: number; onClose: () => void }) {
  const [data, setData] = useState<SeasonSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    getSeasonSummary(year)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Не удалось загрузить итоги'));
    return () => {
      alive = false;
    };
  }, [year]);

  if (error || !data) {
    return (
      <div className="ss" role="dialog" aria-label="Итоги сезона">
        <button type="button" className="ss-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <div className="ss-slide">
          <p className="ss-text">{error ?? 'Собираем ваш сезон…'}</p>
        </div>
      </div>
    );
  }

  const base = `${window.location.origin}/itogi/${data.year}/karta/${data.shareToken}`;
  const list = slides(data, { story: `${base}?f=story`, post: `${base}?f=post` }, onClose);
  const cur = Math.min(i, list.length - 1);
  const go = (d: number) => setI((v) => Math.max(0, Math.min(list.length - 1, v + d)));

  return (
    <div className="ss" role="dialog" aria-label={`Итоги сезона ${data.year}`}>
      <div className="ss-progress" aria-hidden="true">
        {list.map((s, k) => (
          <span key={s.key} className={`ss-progress__seg${k <= cur ? ' ss-progress__seg--on' : ''}`} />
        ))}
      </div>
      <button type="button" className="ss-close" aria-label="Закрыть" onClick={onClose}>
        ×
      </button>
      <div
        className="ss-slide"
        key={list[cur].key}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          go(e.clientX - rect.left < rect.width / 3 ? -1 : 1);
        }}
      >
        {list[cur].body}
      </div>
      <div className="ss-nav">
        <button type="button" className="ss-link" disabled={cur === 0} onClick={() => go(-1)}>
          ← Назад
        </button>
        <span className="ss-count">
          {cur + 1} / {list.length}
        </span>
        <button type="button" className="ss-link" disabled={cur === list.length - 1} onClick={() => go(1)}>
          Дальше →
        </button>
      </div>
    </div>
  );
}
