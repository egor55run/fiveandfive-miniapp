/**
 * Логотип 5&5 RUN (файлы — public/brand, сделаны из исходника пользователя
 * 2026-10-09: белый фон снят, для тёмного фона чёрное перекрашено в светлое).
 * Высоту задаёт CSS (.site-logo img), ширина — по пропорциям.
 */
export default function SiteLogo({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  const name = variant === 'light' ? 'logo-light' : 'logo';
  return (
    <picture>
      <source srcSet={`/brand/${name}.webp`} type="image/webp" />
      <img src={`/brand/${name}.png`} width={296} height={192} alt="5&5 Run" />
    </picture>
  );
}
