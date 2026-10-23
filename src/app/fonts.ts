import { Montserrat, Unbounded } from 'next/font/google';

/**
 * Шрифты бренда — один источник для сайта, Mini App и админки (2026-10-24).
 *
 * Раньше Mini App и админка брали Montserrat и Unbounded с Google Fonts, а
 * сайт — через next/font; в Mini App попадали оба набора под одним именем
 * «Montserrat», и браузер мог брать буквы из разных файлов — пользователь
 * заметил неровную «е» в «Рейтинг». Теперь только next/font: файлы скачиваются
 * при сборке и отдаются с нашего сервера, без запросов к Google.
 *
 * Наборы букв: латиница, кириллица и расширенная кириллица — в ней казахские
 * ә, ғ, қ, ң, ө, ү (казахские документы на проде с 19.10). Без weight —
 * вариативные шрифты: один файл на все начертания.
 */
export const uiFont = Montserrat({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-face-ui',
  display: 'swap',
});

export const displayFont = Unbounded({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-face-display',
  display: 'swap',
});

/** Классы для <html>: CSS-переменные со шрифтами (см. --font-ui в index.css). */
export const fontVariables = `${uiFont.variable} ${displayFont.variable}`;
