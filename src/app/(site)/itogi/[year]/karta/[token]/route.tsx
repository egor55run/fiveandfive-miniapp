import { ImageResponse } from 'next/og';
import { formatRunTime } from '../../../../../../lib/rating';
import { fetchSummaryCard } from '../../../../../../site/data';
import { assets } from '../../../../../../site/og';

/**
 * Картинка «Поделиться» личных итогов (2026-11-12): ?f=story — 1080×1920 для
 * сторис, ?f=post — 1080×1080 для поста. Цифры — с бэкенда по токену
 * (без фамилии и внутренних id). Ссылку участник получает только в Mini App.
 */
export const dynamic = 'force-dynamic';

const INK = '#15130F';
const PAPER = '#F2EEE7';
const ORANGE = '#FF6A13';
const ORANGE_TEXT = '#C4470A';
const MUTED = '#5E574D';
const UNBOUNDED = 'Unbounded Cyr, Unbounded';
const MONTSERRAT = 'Montserrat Cyr, Montserrat';

/** Луч i — этап i+1: верхний — первый, дальше по часовой; пустой — пропущенный этап. */
function Star({ done, size }: { done: boolean[]; size: number }) {
  const c = 50;
  const pt = (ang: number, rad: number) => `${(c + rad * Math.cos(ang)).toFixed(2)},${(c + rad * Math.sin(ang)).toFixed(2)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {[0, 1, 2, 3, 4].map((i) => {
        const a = ((-90 + i * 72) * Math.PI) / 180;
        const l = ((-90 + i * 72 - 36) * Math.PI) / 180;
        const r = ((-90 + i * 72 + 36) * Math.PI) / 180;
        return <polygon key={i} points={`${c},${c} ${pt(l, 19)} ${pt(a, 48)} ${pt(r, 19)}`} fill={done[i] ? ORANGE : '#DDD5C8'} stroke={PAPER} strokeWidth={1.2} />;
      })}
    </svg>
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ year: string; token: string }> }) {
  const { year: rawYear, token } = await params;
  const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
  const card = year ? await fetchSummaryCard(year, token) : null;
  if (!card) return new Response('Not found', { status: 404 });
  const q = new URL(req.url).searchParams;
  const story = q.get('f') !== 'post';
  const download = q.get('download') === '1';
  const done = card.stagesDone ?? [0, 1, 2, 3, 4].map((i) => i < card.rays);
  const W = 1080;
  const H = story ? 1920 : 1080;
  const { logo, fonts } = await assets();

  const stats: [string, string][] = [
    ['этапов', `${card.stagesRun} из ${card.stagesTotal}`],
    ['километров', String(card.km)],
    ...(card.record ? ([['личный рекорд', formatRunTime(card.record.time)]] as [string, string][]) : []),
    ...(card.final ? ([['место в рейтинге', `${card.final.place} из ${card.final.of}`]] as [string, string][]) : []),
    ...(story && card.fasterThan !== null && card.fasterThan > 0 ? ([['быстрее участников', `${card.fasterThan}%`]] as [string, string][]) : []),
    ...(story && card.improvement ? ([['улучшение за сезон', `−${formatRunTime(card.improvement)}`]] as [string, string][]) : []),
  ];
  const shown = story ? stats : stats.slice(0, 4);

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: PAPER, fontFamily: MONTSERRAT, padding: story ? '110px 90px 0' : '64px 72px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <img src={logo} width={story ? 246 : 185} height={story ? 160 : 120} alt="" />
          <Star done={done} size={story ? 220 : 170} />
        </div>
        <div style={{ display: 'flex', marginTop: story ? 70 : 34, fontFamily: UNBOUNDED, fontSize: story ? 40 : 30, letterSpacing: 3, color: ORANGE_TEXT }}>
          МОЙ СЕЗОН {card.year}
        </div>
        <div style={{ display: 'flex', marginTop: 14, fontFamily: UNBOUNDED, fontSize: story ? 92 : 64, lineHeight: 1.05, color: INK }}>
          {card.firstName || 'Мой сезон'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: story ? 70 : 36, gap: story ? 34 : 22 }}>
          {shown.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: story ? 430 : 440,
                padding: story ? '34px 36px' : '24px 30px',
                background: '#FFFFFF',
                borderRadius: 28,
              }}
            >
              <div style={{ display: 'flex', fontFamily: UNBOUNDED, fontSize: story ? 64 : 50, color: INK }}>{value}</div>
              <div style={{ display: 'flex', marginTop: 8, fontSize: story ? 30 : 26, color: MUTED }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex' }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            margin: story ? '0 -90px' : '0 -72px',
            height: story ? 170 : 110,
            padding: story ? '0 90px' : '0 72px',
            background: INK,
            color: '#FF8A3D',
            fontFamily: UNBOUNDED,
            fontSize: story ? 40 : 30,
          }}
        >
          <div style={{ width: 24, height: 24, borderRadius: 12, background: ORANGE, marginRight: 26 }} />
          {`fiveandfive.kz/itogi/${card.year}`}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts,
      headers: {
        'Cache-Control': 'public, max-age=3600',
        // downloadFile (Bot API 8.0): attachment — чтобы все клиенты сохраняли файл,
        // а не открывали; CORS — для Telegram Web.
        'Access-Control-Allow-Origin': 'https://web.telegram.org',
        ...(download ? { 'Content-Disposition': `attachment; filename="5and5-${card.year}-${story ? 'story' : 'post'}.png"` } : {}),
      },
    },
  );
}
