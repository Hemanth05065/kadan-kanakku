import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Kadan Kanakku – கடன் கணக்கு',
        short_name: 'Kadan Kanakku',
        description: 'Voice credit ledger for kirana shops',
        lang: 'ta',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fffaf0',
        theme_color: '#0f5132',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The on-device AI worker bundles are large; they are cached on first use instead.
        globIgnores: ['**/whisper.worker*.js', '**/swanada.worker*.js', '**/vad.worker*.js', '**/*.wasm'],
        navigateFallback: '/index.html',
        // Never cache Supabase API / function calls; the app has its own offline queue.
        navigateFallbackDenylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//, /^\/storage\//],
        runtimeCaching: [
          {
            // On-device AI: worker bundle + ONNX Runtime WebAssembly, so offline speech keeps working.
            urlPattern: ({ url }) =>
              /(whisper|swanada|vad)\.worker.*\.js$/.test(url.pathname) || /\.wasm$/.test(url.pathname) ||
              (url.hostname === 'cdn.jsdelivr.net' && /onnxruntime-web|@huggingface\/transformers/.test(url.pathname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'kk-ai-runtime',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
    // Swanada can also run under Node; that branch never runs in the browser (the worker hands
    // it ONNX Runtime Web), so its Node runtime is left out of the bundle.
    rollupOptions: { external: ['onnxruntime-node'] },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'supabase/tests/**/*.test.js'],
  },
});
