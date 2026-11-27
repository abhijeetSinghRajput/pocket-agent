import type { NextConfig } from 'next';

/**
 * Optional same-origin proxy to the API (e.g. https://pocket-agent-api.onrender.com). With it, the
 * dashboard calls /api/* on its own domain, so the login cookie is first-party — needed when the
 * web app and API live on different sites (Safari/iOS block third-party cookies).
 */
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/+$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The floating dev-tools button sat on top of the chat's Send button.
  devIndicators: false,
  // Old addresses. The homepage used to live at /home. Chats used to live at /agents/<id> (old
  // notifications and the app still link there): the Agents page is /agents, a chat /chat/<id>,
  // one of its sub-agents /chat/<id>/agents/<toolUseId>.
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
      {
        source: '/agents/:id/sub/:tool/transcript',
        destination: '/chat/:id/agents/:tool/transcript',
        permanent: false,
      },
      { source: '/agents/:id/sub/:tool', destination: '/chat/:id/agents/:tool', permanent: false },
      { source: '/agents/:id', destination: '/chat/:id', permanent: false },
    ];
  },
  async rewrites() {
    return apiProxyTarget ? [{ source: '/api/:path*', destination: `${apiProxyTarget}/:path*` }] : [];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
