import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.jsx';
import { initStore, getState, subscribe } from './lib/store.js';
import { startSync } from './lib/sync.js';
import { loadDeviceModel } from './voice/localWhisper.js';
import { reprocessReviews } from './voice/reprocess.js';
import { CLOUD } from './lib/config.js';
import { initAuth } from './lib/auth.js';

registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

(async () => {
  await initStore();
  if (CLOUD) await initAuth().catch((err) => console.warn('auth init failed', err));
  startSync();

  // Warm the on-device Whisper model if the owner downloaded one (served from cache, works offline).
  const model = getState().settings.onDeviceModel;
  if (model) {
    const warm = () => loadDeviceModel(model);
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 1500);
  }

  // Offline clips get transcribed as soon as any engine is available again.
  window.addEventListener('online', () => setTimeout(reprocessReviews, 2000));
  setTimeout(reprocessReviews, 5000);
  let lastServer = '';
  subscribe(() => {
    const s = getState();
    const key = `${s.online}${s.session ? 1 : 0}`;
    if (key !== lastServer) {
      lastServer = key;
      if (s.online && s.session) setTimeout(reprocessReviews, 3000);
    }
  });
})();
