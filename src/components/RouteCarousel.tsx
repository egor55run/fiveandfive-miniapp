'use client';

import { useRef, useState } from 'react';
import { apiAsset } from '../lib/api';

import type { RouteMapItem } from '../lib/routeMaps';

export type { RouteMapItem };

/**
 * Карты трасс, листаются свайпом (прокрутка с привязкой к слайду — нативный
 * жест в Telegram и в браузере телефона), точки снизу показывают, какая
 * открыта, и переключают по нажатию. Одна карта — без точек. Общая для Mini
 * App и страницы старта на сайте; стили — .route-carousel в App.css и site.css.
 */
export default function RouteCarousel({ maps, title }: { maps: RouteMapItem[]; title: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = () => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    // Точку подсвечиваем сразу, не дожидаясь конца плавной прокрутки.
    setActive(i);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <div className="route-carousel">
      <div
        className="route-carousel__track"
        ref={track}
        onScroll={onScroll}
        tabIndex={0}
        aria-roledescription="карусель"
        aria-label={`Карты трассы: ${title}`}
      >
        {maps.map((m, i) => (
          <figure
            className="route-carousel__slide"
            key={m.id}
            aria-roledescription="слайд"
            aria-label={`${i + 1} из ${maps.length}${m.caption ? `: ${m.caption}` : ''}`}
          >
            {/* Карты — файлы из админки; грузим сразу: блок раскрывается по
                нажатию, и пустое место вместо карты выглядит поломкой. */}
            <img
              src={apiAsset(m.url)}
              alt={`Схема трассы${m.caption ? ` ${m.caption}` : ''} — ${title}`}
              decoding="async"
              draggable={false}
            />
            {m.caption && <figcaption>{m.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {maps.length > 1 && (
        <div className="route-carousel__dots" role="tablist" aria-label="Выбор карты">
          {maps.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={m.caption || `Карта ${i + 1}`}
              className={`route-carousel__dot${i === active ? ' is-active' : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

