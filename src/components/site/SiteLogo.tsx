/**
 * Логотип 5&5 RUN (файлы — public/brand, сделаны из исходника пользователя
 * 2026-10-09: белый фон снят, для тёмного фона чёрное перекрашено в светлое).
 * Высоту задаёт CSS (.site-logo img), ширина — по пропорциям. Файлы — ровно
 * вдвое больше показа (шапка 52 px, подвал 44 px): чётко на телефонах и без
 * лишних килобайт. Крупный logo.png — для превью и разметки для поиска.
 */
export default function SiteLogo({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  const name = variant === 'light' ? 'logo-light-h44' : 'logo-h52';
  const [w, h] = variant === 'light' ? [136, 88] : [160, 104];
  return (
    <picture>
      <source srcSet={`/brand/${name}.webp`} type="image/webp" />
      <img src={`/brand/${name}.png`} width={w} height={h} alt="5&5 Run" />
    </picture>
  );
}
