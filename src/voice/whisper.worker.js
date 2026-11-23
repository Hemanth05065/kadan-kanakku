// On-device speech recognition: open-weight Whisper running in the browser through
// Transformers.js (ONNX Runtime Web). Runs in a worker so the UI never stutters.
// Model files are cached by the browser after the first download, so it works offline.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
if ('useWasmCache' in env) env.useWasmCache = true;

let asr = null;
let loadedModel = null;
let loading = null;

async function load(model) {
  if (asr && loadedModel === model) return asr;
  if (loading) return loading;
  loading = (async () => {
    const progress_callback = (p) => self.postMessage({ type: 'progress', ...p });
    // 8-bit weights keep the download small (~73 MB for whisper-base) and run well on WASM.
    asr = await pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback,
    });
    loadedModel = model;
    return asr;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.model);
      self.postMessage({ type: 'ready', model: data.model });
    } else if (data.type === 'transcribe') {
      const t0 = performance.now();
      const model = await load(data.model);
      const LANGUAGE = { ta: 'tamil', en: 'english', hi: 'hindi', te: 'telugu' };
      const out = await model(data.audio, {
        language: LANGUAGE[data.language] || 'tamil',
        task: 'transcribe',
        return_timestamps: false,
      });
      self.postMessage({ type: 'result', id: data.id, text: String(out?.text || '').trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, error: String(err?.message || err) });
  }
};
