import { prisma } from '../prisma';

/**
 * Адреса страниц стартов на сайте: /starty/<slug>.
 *
 * Латиницей, через дефис, с годом старта: «Триатлон Парк Астана», 2027 →
 * «triatlon-park-astana-2027». Год нужен, чтобы старты следующих сезонов в тех
 * же парках получили свои адреса, а ссылки на прошлые не сломались.
 */

// Простая транслитерация, как в адресах сайтов и загранпаспортах; казахские
// буквы — по ближайшему звучанию.
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(text: string): string {
  return [...text.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Адрес для старта: название + год старта (по Астане). */
export function eventSlug(title: string, date: Date): string {
  const year = new Date(date.getTime() + 5 * 60 * 60 * 1000).getUTCFullYear();
  const base = slugify(title);
  return base.endsWith(`-${year}`) ? base : `${base}-${year}`;
}

/** Свободный адрес: при совпадении с чужим — «-2», «-3»… */
export async function uniqueEventSlug(base: string, exceptId?: number): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken || taken.id === exceptId) return candidate;
  }
}

/**
 * Заполнить пустые адреса при запуске сервера — так старты, заведённые до
 * появления адресов (и на проде тоже), получают их без ручной работы.
 * Уже заданные адреса не трогаем: на них могут вести ссылки.
 */
export async function ensureEventSlugs(): Promise<number> {
  const missing = await prisma.event.findMany({ where: { slug: null }, orderBy: { id: 'asc' } });
  for (const e of missing) {
    const slug = await uniqueEventSlug(eventSlug(e.title, e.date), e.id);
    await prisma.event.update({ where: { id: e.id }, data: { slug } });
  }
  return missing.length;
}
