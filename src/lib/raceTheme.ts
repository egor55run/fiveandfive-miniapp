import type { CSSProperties } from 'react';
import { apiAsset, type EventDto } from './api';

/**
 * Оформление старта из админки (фон, логотип, акцентный цвет) — для карточки
 * и страницы старта в Mini App. Без оформления — обычный вид (null).
 *
 * Текст на кнопках с акцентным цветом подбирается по яркости цвета: на
 * светлом — тёмный, на тёмном — белый, чтобы читалось при любом выборе.
 * Фон всегда затемняется градиентом — белый текст поверх картинки читается.
 */

export type RaceTheme = { className: string; style: CSSProperties; logoUrl: string | null };

/** Относительная яркость по WCAG (0 — чёрный, 1 — белый). */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Цвет текста на акценте: контраст с белым и с почти-чёрным — что больше. */
export function onAccent(hex: string): string {
  const l = luminance(hex);
  const withWhite = 1.05 / (l + 0.05);
  const withDark = (l + 0.05) / 0.058; // #141414
  return withWhite >= withDark ? '#ffffff' : '#141414';
}

export function raceTheme(event: EventDto): RaceTheme | null {
  const t = event.theme;
  if (!t || (!t.bgUrl && !t.logoUrl && !t.accent)) return null;
  const accent = t.accent && /^#[0-9a-fA-F]{6}$/.test(t.accent) ? t.accent : null;
  const style: Record<string, string> = {};
  if (accent) {
    style['--race-accent'] = accent;
    style['--race-on-accent'] = onAccent(accent);
  }
  if (t.bgUrl) style['--race-bg'] = `url("${apiAsset(t.bgUrl)}")`;
  const classes = ['race-themed', accent ? 'race-themed--accent' : '', t.bgUrl ? 'race-themed--bg' : ''];
  return {
    className: classes.filter(Boolean).join(' '),
    style: style as CSSProperties,
    logoUrl: t.logoUrl ? apiAsset(t.logoUrl) : null,
  };
}
