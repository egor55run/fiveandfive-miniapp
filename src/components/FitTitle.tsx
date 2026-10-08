import { useLayoutEffect, useRef } from 'react';

type Props = {
  as?: 'h2' | 'h3' | 'h4' | 'span' | 'b';
  className?: string;
  children: string;
  /** Меньше этой доли от размера из CSS не уменьшаем. */
  minScale?: number;
};

/**
 * Заголовок, в котором любое слово помещается в ширину блока.
 *
 * Названия стартов набраны крупным дисплейным шрифтом в апперкейсе, и одно
 * длинное слово («ПРЕЗИДЕНТСКИЙ») шире карточки на узком телефоне: оно либо
 * вылезало за край, либо рвалось посередине. Здесь каждое слово — неразрывный
 * блок; после отрисовки меряем самое широкое настоящим шрифтом (апперкейс,
 * межбуквенный интервал — всё как на экране) и уменьшаем font-size ровно
 * настолько, чтобы оно влезло. Короткие названия остаются в размере из CSS.
 * Переносы между словами — как обычно.
 */
export default function FitTitle({ as: Tag = 'h2', className, children, minScale = 0.5 }: Props) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = ''; // начать с размера из CSS
      const style = getComputedStyle(el);
      const base = parseFloat(style.fontSize);
      const available =
        el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const words = Array.from(el.querySelectorAll<HTMLElement>('[data-fit-word]'));
      const widest = () => Math.max(0, ...words.map((w) => w.getBoundingClientRect().width));
      if (available <= 0 || widest() <= available) return;

      // Ширина слова почти пропорциональна размеру шрифта; кернинг и округление
      // дают погрешность — поэтому пара уточняющих шагов.
      const min = base * minScale;
      let size = base;
      for (let i = 0; i < 4; i++) {
        const w = widest();
        if (w <= available || size <= min) break;
        size = Math.max(min, size * (available / w) * 0.99);
        el.style.fontSize = `${size}px`;
      }
    };

    fit();

    // Пересчитываем при смене ширины (поворот, другое окно) — но не на любое
    // изменение размера: уменьшая шрифт, мы меняем высоту, и наблюдение за
    // самим заголовком зациклилось бы.
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    observer.observe(el);
    // Дисплейный шрифт грузится с Google Fonts: до этого меряется запасной.
    document.fonts?.ready.then(fit).catch(() => {});

    return () => observer.disconnect();
  }, [children, minScale]);

  return (
    <Tag ref={ref as never} className={className}>
      {children.split(/(\s+)/).map((part, i) =>
        /^\s+$/.test(part) || part === '' ? (
          part
        ) : (
          <span key={i} data-fit-word="" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
            {part}
          </span>
        ),
      )}
    </Tag>
  );
}
