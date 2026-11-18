import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: 'Service Ops CRM', short_name: 'Service Ops', lang: 'ru',
    start_url: '/dashboard', scope: '/', display: 'standalone',
    icons: [{ src: '/push-app-192.png', sizes: '192x192', type: 'image/png' }, { src: '/push-app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}
