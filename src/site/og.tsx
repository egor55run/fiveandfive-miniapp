import { readFile } from 'node:fs/promises';
import { ImageResponse } from 'next/og';

/**
 * Картинки-превью 1200×630 для соцсетей и мессенджеров — в стиле главной:
 * светлый фон, логотип, крупный заголовок, внизу чёрная полоса как бегущая
 * лента. Шрифты — статические woff из src/site/og-fonts (генератор не читает
 * woff2 и вариативные шрифты), по два файла: латиница и кириллица.
 */

const INK = '#15130F';
const PAPER = '#F2EEE7';
const ORANGE = '#FF6A13';
const ORANGE_SOFT = '#FF8A3D';
const ORANGE_TEXT = '#C4470A';
const MUTED = '#5E574D';

// Один файл шрифта — один набор букв (латиница или кириллица); с одинаковым
// именем генератор берёт только первый, поэтому имена разные, а семейство —
// списком: сначала кириллица, недостающие знаки — из латиницы.
const UNBOUNDED = 'Unbounded Cyr, Unbounded';
const MONTSERRAT = 'Montserrat Cyr, Montserrat';

// Пути — буквально в new URL(…, import.meta.url): только так сборщик видит
// файлы и кладёт их в сборку (через переменную — не найдёт).
async function assets() {
  const [unbLat, unbCyr, monLat, monCyr, logo] = await Promise.all([
    readFile(new URL('./og-fonts/unbounded-latin-900-normal.woff', import.meta.url)),
    readFile(new URL('./og-fonts/unbounded-cyrillic-900-normal.woff', import.meta.url)),
    readFile(new URL('./og-fonts/montserrat-latin-600-normal.woff', import.meta.url)),
    readFile(new URL('./og-fonts/montserrat-cyrillic-600-normal.woff', import.meta.url)),
    readFile(new URL('../../public/brand/logo.png', import.meta.url)),
  ]);
  return {
    logo: `data:image/png;base64,${logo.toString('base64')}`,
    fonts: [
      { name: 'Unbounded', data: unbLat, weight: 900 as const, style: 'normal' as const },
      { name: 'Unbounded Cyr', data: unbCyr, weight: 900 as const, style: 'normal' as const },
      { name: 'Montserrat', data: monLat, weight: 600 as const, style: 'normal' as const },
      { name: 'Montserrat Cyr', data: monCyr, weight: 600 as const, style: 'normal' as const },
    ],
  };
}

type OgInput = {
  /** Надпись над заголовком (оранжевая): «ЭТАП 2». */
  kicker?: string;
  title: string;
  lines: string[];
  /** Текст в чёрной полосе внизу. */
  band: string;
  /** Сколько браузерам и мессенджерам хранить картинку, секунд. */
  maxAge: number;
};

export async function ogImage({ kicker, title, lines, band, maxAge }: OgInput) {
  const { logo, fonts } = await assets();
  // Длинные названия — мельче, чтобы влезали в две-три строки.
  const titleSize = title.length > 26 ? 52 : title.length > 16 ? 62 : 72;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: PAPER, fontFamily: MONTSERRAT }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 56, padding: '0 72px' }}>
          <img src={logo} width={308} height={200} alt="" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {kicker && (
              <div style={{ display: 'flex', fontSize: 30, letterSpacing: 3, color: ORANGE_TEXT, fontFamily: UNBOUNDED }}>
                {kicker}
              </div>
            )}
            <div style={{ display: 'flex', fontFamily: UNBOUNDED, fontSize: titleSize, lineHeight: 1.05, color: INK }}>
              {title}
            </div>
            {lines.map((line) => (
              <div key={line} style={{ display: 'flex', fontSize: 34, lineHeight: 1.25, color: MUTED }}>
                {line}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            height: 112,
            display: 'flex',
            alignItems: 'center',
            padding: '0 72px',
            background: INK,
            color: ORANGE_SOFT,
            fontFamily: UNBOUNDED,
            fontSize: 34,
            letterSpacing: 1,
          }}
        >
          <div style={{ width: 22, height: 22, borderRadius: 11, background: ORANGE, marginRight: 24 }} />
          {band}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
      headers: { 'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}` },
    },
  );
}
