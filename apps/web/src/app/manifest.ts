import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgentDock',
    short_name: 'AgentDock',
    description: 'Your agents. Your machines. Your control.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#16161a',
    theme_color: '#16161a',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
