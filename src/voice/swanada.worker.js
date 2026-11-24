// On-device speech recognition with Swanada (MIT): a small CTC model trained on Indian
// languages, run by ONNX Runtime Web. The "mobile" build is 27 MB per language and writes
// native script (Tamil words come back in Tamil letters, which the parser reads).
// Same messages as whisper.worker.js, so localWhisper.js can drive either one.
import * as ort from 'onnxruntime-web/wasm';
import { Swanada } from 'swanada';

globalThis.ort = ort; // Swanada uses this runtime instead of looking for its own copy
// The runtime's WebAssembly comes from the CDN (cached for offline use by the service worker).
const WASM_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
const HF = 'https://huggingface.co/gnumanth/swanada/resolve/main';
const CACHE = 'kk-swanada-v1';
const LANGS = new Set(['ta', 'hi', 'te', 'en']);

const modelUrl = (lang) => `${HF}/onnx_mobile/swanada_mobile_${lang}_ctc_int8.onnx`;
const vocabUrl = (lang) => `${HF}/vocabularies/${lang}_vocab.json`;

/** Download once, with progress, into the cache Swanada reads from (works offline after). */
async function prefetch(url) {
  const cache = await caches.open(CACHE);
  if (await cache.match(url)) return cache;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    self.postMessage({ type: 'progress', status: 'progress', file: url, loaded, total: total || loaded });
  }
  await cache.put(url, new Response(new Blob(parts), { headers: { 'Content-Type': 'application/octet-stream' } }));
  return cache;
}

let engine = null;
let engineLang = null;
let loading = null;

async function load(lang) {
  if (engine && engineLang === lang) return engine;
  if (loading) await loading.catch(() => {});
  if (engine && engineLang === lang) return engine;
  loading = (async () => {
    await prefetch(modelUrl(lang));
    const vocab = await (await prefetch(vocabUrl(lang))).match(vocabUrl(lang));
    const next = await Swanada.create({
      language: lang,
      modelPath: modelUrl(lang),
      vocabPath: URL.createObjectURL(await vocab.blob()), // from the cache, so it loads offline
      executionProvider: 'wasm',
      wasmPaths: WASM_PATHS,
      cacheStorageName: CACHE,
    });
    if (engine) await engine.release().catch(() => {});
    engine = next;
    engineLang = lang;
    return engine;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

const langOf = (l) => (LANGS.has(l) ? l : 'ta');

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(langOf(data.language));
      self.postMessage({ type: 'ready', model: data.model });
    } else if (data.type === 'transcribe') {
      const t0 = performance.now();
      const s = await load(langOf(data.language));
      const out = await s.transcribe(data.audio);
      self.postMessage({ type: 'result', id: data.id, text: String(out?.text || '').trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, error: String(err?.message || err) });
  }
};
