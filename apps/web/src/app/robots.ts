import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // The dashboard is behind sign-in; there is nothing there for a crawler.
    rules: { userAgent: '*', allow: ['/$', '/login', '/register'], disallow: ['/api/'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
