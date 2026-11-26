import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pocket Agent',
    short_name: 'Pocket Agent',
    description: 'Your agents. Your machines. Your control.',
    start_url: '/chat',
    scope: '/',
    display: 'standalone',
    background_color: '#ee6a1b',
    theme_color: '#ee6a1b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
