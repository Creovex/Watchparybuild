import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/lib/env';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Watch together in sync, with voice, chat and reactions.',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0f0d0c',
    theme_color: '#0f0d0c',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/maskable-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
