import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg', 'icon-maskable.svg'],
      manifest: {
        name: 'Tegnspråksøving – NTS',
        short_name: 'Tegnøving',
        description: 'Spaced repetition flashcards for Norwegian Sign Language (NTS)',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/www\.minetegn\.no\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'minetegn-media',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 800, maxAgeSeconds: 31536000 }
            }
          },
          {
            urlPattern: /\/data\.php\.xml$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nts-dataset',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxAgeSeconds: 604800 }
            }
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2020'
  }
});
