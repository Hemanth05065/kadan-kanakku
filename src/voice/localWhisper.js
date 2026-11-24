// Main-thread handle for on-device speech recognition: general Whisper models, a Whisper
// retrained on Tamil, or Swanada (trained on Indian languages), each in its own worker.
import { useSyncExternalStore } from 'react';
import { getState } from '../lib/store.js';

export const DEVICE_MODELS = [
  { id: 'onnx-community/whisper-tiny', engine: 'whisper', label: 'Whisper tiny', sizeMb: 40, note: 'fastest, rough Tamil' },
  { id: 'onnx-community/whisper-base', engine: 'whisper', label: 'Whisper base', sizeMb: 73, note: 'balanced (recommended)' },
  { id: 'onnx-community/whisper-small', engine: 'whisper', label: 'Whisper small', sizeMb: 238, note: 'more accurate, needs a good phone' },
  // Trained on Tamil:
  { id: 'swanada-mobile', engine: 'swanada', label: 'Swanada', sizeMb: 27, tamil: true, note: 'trained on Indian languages; smallest and fastest; best for Tamil, Hindi, Telugu (a new project)' },
  { id: 'santhosh63/whisper-tamil-medium-web', engine: 'whisper', label: 'Tamil Whisper medium', sizeMb: 776, tamil: true, note: 'Whisper retrained on Tamil: most accurate Tamil; a laptop or a top phone, slow' },
];
export const DEFAULT_DEVICE_MODEL = 'onnx-community/whisper-base';

const engineOf = (model) => DEVICE_MODELS.find((m) => m.id === model)?.engine || 'whisper';
/** Short name of the loaded model, shown next to what was heard. */
export const deviceModelLabel = () => DEVICE_MODELS.find((m) => m.id === status.model)?.label || 'whisper';
const speechLang = () => (getState().settings.speechLang || 'ta-IN').slice(0, 2);

let worker = null;
let workerEngine = null;
let seq = 0;
const pending = new Map();
let status = { state: 'off', model: null, progress: 0, loadedMb: 0, totalMb: 0, error: null, lastMs: null };
const listeners = new Set();
const files = new Map(); // file -> {loaded,total}

function set(patch) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useWhisperStatus() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => status,
  );
}

export const whisperReady = () => status.state === 'ready';

function ensureWorker(engine) {
  if (worker && workerEngine === engine) return worker;
  if (worker) {
    worker.terminate();
    for (const p of pending.values()) p.reject(new Error('model changed'));
    pending.clear();
  }
  worker = engine === 'swanada'
    ? new Worker(new URL('./swanada.worker.js', import.meta.url), { type: 'module' })
    : new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
  workerEngine = engine;
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      if (data.status === 'progress' && data.file) {
        files.set(data.file, { loaded: data.loaded || 0, total: data.total || 0 });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        set({ progress: total ? loaded / total : 0, loadedMb: Math.round(loaded / 1e6), totalMb: Math.round(total / 1e6) });
      }
    } else if (data.type === 'ready') {
      set({ state: 'ready', model: data.model, progress: 1, error: null });
    } else if (data.type === 'result' || data.type === 'error') {
      if (data.type === 'error' && status.state !== 'ready') set({ state: 'error', error: data.error });
      const p = pending.get(data.id);
      if (p) {
        pending.delete(data.id);
        if (data.type === 'result') { set({ lastMs: data.ms }); p.resolve(data.text); } else p.reject(new Error(data.error));
      }
    }
  };
  worker.onerror = (e) => set({ state: 'error', error: e.message || 'worker failed' });
  return worker;
}

/** Download (first time) or load from cache. */
export function loadDeviceModel(model = DEFAULT_DEVICE_MODEL) {
  if (status.state === 'ready' && status.model === model) return;
  files.clear();
  set({ state: 'loading', model, progress: 0, error: null });
  ensureWorker(engineOf(model)).postMessage({ type: 'load', model, language: speechLang() });
}

export function unloadDeviceModel() {
  worker?.terminate();
  worker = null;
  workerEngine = null;
  for (const p of pending.values()) p.reject(new Error('unloaded'));
  pending.clear();
  set({ state: 'off', model: null, progress: 0 });
}

/** Transcribe 16 kHz mono PCM on the device. */
export function transcribeOnDevice(pcm, language = 'ta', timeoutMs = null) {
  // The big Tamil Whisper is slow on a phone: give it longer before giving up.
  timeoutMs ??= (DEVICE_MODELS.find((m) => m.id === status.model)?.sizeMb || 0) > 500 ? 90000 : 30000;
  if (status.state !== 'ready') return Promise.reject(new Error('on-device model not ready'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'transcribe', id, audio: pcm, language, model: status.model });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('on-device transcription timed out')); }
    }, timeoutMs);
  });
}
