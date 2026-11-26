/**
 * The site's public address, for canonical links, the sitemap and social cards. Set
 * NEXT_PUBLIC_SITE_URL for a custom domain; on Vercel the production *.vercel.app address is used.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')
).replace(/\/+$/, '');

export const SITE_NAME = 'Pocket Agent';
export const SITE_TITLE = 'Pocket Agent: Claude Code on your phone';
export const SITE_DESCRIPTION =
  'Follow and steer Claude Code on your PC from your phone. Get a notification when Claude needs you, approve commands in one tap, and send the next task from anywhere.';
