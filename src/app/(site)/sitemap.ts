import type { MetadataRoute } from 'next';
import { docPath, KK_ENABLED } from '../../lib/legal';
import { fetchEvents } from '../../site/data';
import { SITE_URL } from '../../site/seo';

/**
 * /sitemap.xml — страницы сайта для поисковиков. Старты — из базы при запросе
 * (новый старт появится в карте сам). Mini App (/app), админка и статистика
 * сюда не входят — они закрыты в robots.txt. Казахские документы — только там,
 * где они включены (пока staging).
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = (await fetchEvents()) ?? [];
  const page = (path: string, priority: number, changeFrequency: 'weekly' | 'monthly' | 'yearly') => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });

  const docs = (['oferta', 'privacy', 'parentConsent'] as const).flatMap((doc) => [
    page(docPath(doc, 'ru'), 0.3, 'yearly'),
    ...(KK_ENABLED ? [page(docPath(doc, 'kk'), 0.3, 'yearly')] : []),
  ]);

  return [
    page('/', 1, 'weekly'),
    ...events.filter((e) => e.slug).map((e) => page(`/starty/${e.slug}`, 0.9, 'weekly')),
    page('/voprosy', 0.6, 'monthly'),
    ...docs,
  ];
}
