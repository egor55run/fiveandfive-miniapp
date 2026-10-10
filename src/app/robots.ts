import type { MetadataRoute } from 'next';
import { SITE_INDEXABLE, SITE_URL } from '../site/seo';

/**
 * /robots.txt (только в корне app — в группе (site) Next его не видит).
 * Прод: сайт открыт, кроме Mini App, админки, API и статистики.
 * Staging (и локально): закрыто всё — копия сайта не должна попасть в поиск
 * и спорить с настоящим.
 */
export default function robots(): MetadataRoute.Robots {
  if (!SITE_INDEXABLE) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/app', '/admin', '/api/', '/stats'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
