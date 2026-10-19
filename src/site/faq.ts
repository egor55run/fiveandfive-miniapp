import type { Lang } from '../lib/legal';
import faqJson from '../../content/faq.json';

/**
 * Страница «Вопросы» (/voprosy). Ответы — из оферты и политики; текст
 * утвердил пользователь 2026-10-09. Когда выйдет Положение — сверить.
 *
 * Тексты — в content/faq.json: оттуда же их берёт бот (кнопка «Задать
 * вопрос», backend/src/lib/support.ts), чтобы ответы не расходились.
 * Ответ — абзацы и списки. Ссылка внутри абзаца: [текст](/адрес).
 */
export type FaqBlock = string | { list: string[] };
export type FaqItem = { id: string; q: string; a: FaqBlock[] };

const ru: FaqItem[] = faqJson.ru;

const FAQ: Partial<Record<Lang, FaqItem[]>> = { ru };

export function faqItems(lang: Lang): FaqItem[] {
  return FAQ[lang] ?? ru;
}

/** Абзац без разметки ссылок — для schema.org (поисковикам — чистый текст). */
export function faqPlainText(blocks: FaqBlock[]): string {
  return blocks
    .map((b) => (typeof b === 'string' ? b : b.list.join(' ')))
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
