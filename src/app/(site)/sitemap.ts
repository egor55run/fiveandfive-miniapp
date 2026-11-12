import type { MetadataRoute } from 'next';
import { docPath, KK_ENABLED } from '../../lib/legal';
import { fetchEvents, fetchSummarySeasons } from '../../site/data';
import { HUB_PATH, SITE_URL } from '../../site/seo';

/**
 * /sitemap.xml — страницы сайта для поисковиков. Старты — из базы при запросе
 * (новый старт появится в карте сам). Mini App (/app), админка и статистика
 * сюда не входят — они закрыты в robots.txt. Казахские документы — только там,
 * где они включены (пока staging).
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = (await fetchEvents()) ?? [];
  const seasons = (await fetchSummarySeasons()) ?? [];
  // Адрес — ровно как canonical страницы: у главной Next пишет его без слеша
  // («https://fiveandfive.kz»), поэтому и здесь так (Google Search Console, 2026-10-27).
  const page = (path: string, priority: number, changeFrequency: 'weekly' | 'monthly' | 'yearly') => ({
    url: path === '/' ? SITE_URL : `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });

  const docs = (['oferta', 'privacy', 'parentConsent'] as const).flatMap((doc) => [
    page(docPath(doc, 'ru'), 0.3, 'yearly'),
    ...(KK_ENABLED ? [page(docPath(doc, 'kk'), 0.3, 'yearly')] : []),
  ]);

  return [
    page('/', 1, 'weekly'),
    page(HUB_PATH, 0.9, 'weekly'),
    ...events.filter((e) => e.slug).map((e) => page(`/starty/${e.slug}`, 0.9, 'weekly')),
    // Результаты отдельных стартов по дистанциям (у этапов — /reiting/<старт>).
    ...events
      .filter((e) => e.slug && e.resultsPublished && e.seriesStage === false)
      .map((e) => page(`/starty/${e.slug}/rezultaty`, 0.6, 'monthly')),
    page('/reiting', 0.7, 'weekly'),
    // Итоги сезонов (2026-11-12): до итогов — текущий рейтинг, после — итоги.
    ...seasons.map((s) => page(`/itogi/${s.year}`, s.published ? 0.7 : 0.5, s.published ? 'yearly' : 'weekly')),
    page('/voprosy', 0.6, 'monthly'),
    ...docs,
  ];
}
