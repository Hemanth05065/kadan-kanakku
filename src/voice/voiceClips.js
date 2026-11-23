// The recorded shop voice on this device: storage (IndexedDB), playback (Web Audio, clips
// scheduled back to back), export / import as one file (to move the voice to another phone),
// and the little "saved" chime.
import { useSyncExternalStore } from 'react';
import { db } from '../lib/db.js';
import { encodeWav, resample } from './audio.js';
import { planReply, processClip, scriptItems, VOICE_LANGS } from './voicePack.js';

export const STUDIO_RATE = 24000;
const FILE_KIND = 'kadan-kanakku-voice';

// ── Which clips exist (reactive) ─────────────────────────────────────────────

let keys = new Set();
let version = 0;
const listeners = new Set();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export async function loadVoiceClips() {
  try {
    keys = new Set(await (await db()).getAllKeys('voice'));
  } catch (err) {
    console.warn('voice clips unavailable', err);
    keys = new Set();
  }
  emit();
}

export const hasClip = (key) => keys.has(key);

/** Re-renders when clips are recorded or removed. */
export function useVoiceClips() {
  useSyncExternalStore(subscribe, () => version);
  return { has: hasClip, count: keys.size };
}

/** Recorded / total for a language's script (customer names not counted). */
export function packProgress(lang = 'ta') {
  const items = scriptItems(lang);
  const done = items.filter((i) => keys.has(i.key)).length;
  return { done, total: items.length, ready: items.length > 0 && done === items.length, started: done > 0 };
}

// ── Saving ───────────────────────────────────────────────────────────────────

/** Resample with the browser's own filter when possible (clean), else the simple one. */
async function toStudioRate(raw, rate) {
  if (rate === STUDIO_RATE) return raw;
  const Off = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (Off) {
    try {
      const off = new Off(1, Math.ceil((raw.length * STUDIO_RATE) / rate), STUDIO_RATE);
      const buf = off.createBuffer(1, raw.length, rate);
      buf.copyToChannel(raw, 0);
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(off.destination);
      src.start();
      return (await off.startRendering()).getChannelData(0);
    } catch { /* fall through */ }
  }
  return resample(raw, rate, STUDIO_RATE);
}

/**
 * Clean up a fresh recording and keep it as `key`. Returns processClip's result
 * ({ verdict: ok | short | quiet | loud, ms }); nothing is stored unless it is ok.
 */
export async function storeRecording(key, raw, rate) {
  const pcm = await toStudioRate(raw, rate);
  const out = processClip(pcm, STUDIO_RATE);
  if (out.verdict !== 'ok') return out;
  await (await db()).put('voice', { key, wav: encodeWav(out.pcm, STUDIO_RATE), ms: out.ms, rate: STUDIO_RATE, at: new Date().toISOString() });
  buffers.delete(key);
  keys.add(key);
  emit();
  return out;
}

export async function deleteClip(key) {
  await (await db()).delete('voice', key);
  buffers.delete(key);
  keys.delete(key);
  emit();
}

export async function clearVoice() {
  await (await db()).clear('voice');
  buffers.clear();
  keys = new Set();
  emit();
}

// ── Playback ─────────────────────────────────────────────────────────────────

let ctx = null;
export function outputContext() {
  if (!ctx) {
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    ctx = new C({ latencyHint: 'interactive' });
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

const buffers = new Map(); // key -> Promise<AudioBuffer>
async function bufferFor(key) {
  if (!buffers.has(key)) {
    buffers.set(key, (async () => {
      const row = await (await db()).get('voice', key);
      if (!row) throw new Error(`no clip ${key}`);
      return outputContext().decodeAudioData(await row.wav.arrayBuffer());
    })());
  }
  try {
    return await buffers.get(key);
  } catch (err) {
    buffers.delete(key);
    throw err;
  }
}

let playing = null;
let generation = 0;

export function stopVoice() {
  generation++;
  if (!playing) return;
  for (const s of playing.sources) {
    try { s.stop(); } catch { /* already ended */ }
  }
  clearTimeout(playing.timer);
  playing.resolve();
  playing = null;
}

/** Play [{ clip, join }, { gap }] back to back. `join` < 0 pulls a clip into the previous one's tail. */
export async function playSegments(segs) {
  stopVoice();
  const mine = generation;
  const c = outputContext();
  const bufs = await Promise.all(segs.map((s) => (s.clip ? bufferFor(s.clip) : null)));
  if (mine !== generation) return; // stopped while loading
  let t = c.currentTime + 0.04;
  const sources = [];
  segs.forEach((s, i) => {
    if (!s.clip) {
      t += (s.gap || 0) / 1000;
      return;
    }
    t += (s.join || 0) / 1000;
    const src = c.createBufferSource();
    src.buffer = bufs[i];
    src.connect(c.destination);
    src.start(Math.max(c.currentTime, t));
    sources.push(src);
    t += bufs[i].duration;
  });
  await new Promise((resolve) => {
    playing = {
      sources,
      resolve,
      timer: setTimeout(() => {
        playing = null;
        resolve();
      }, Math.max(0, (t - c.currentTime) * 1000) + 60),
    };
  });
}

export const playClip = (key) => playSegments([{ clip: key }]);

/** True while the shop voice is speaking. */
export const isPlaying = () => Boolean(playing);

/** Say a reply in the shop voice. Resolves true when it was spoken, false when it can't be. */
export async function playReply(reply) {
  const segs = planReply(reply, hasClip);
  if (!segs) return false;
  try {
    await playSegments(segs);
    return true;
  } catch (err) {
    console.warn('shop voice failed', err);
    return false;
  }
}

/** A soft two-note sound: 'saved' rises, 'cancelled' falls. */
export function chime(kind = 'saved') {
  try {
    const c = outputContext();
    const notes = kind === 'saved' ? [659.25, 987.77] : [523.25, 392.0];
    let t = c.currentTime + 0.02;
    for (const f of notes) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.26);
      t += 0.11;
    }
  } catch { /* no audio output */ }
}

// ── Moving the voice to another phone ───────────────────────────────────────

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
}

const VALID_KEY = /^(name:[^\n]{1,80}|[a-z0-9_]{1,40})$/;

/** Every recorded clip in one JSON file. */
export async function exportVoice() {
  const rows = await (await db()).getAll('voice');
  const clips = await Promise.all(rows.map(async (r) => ({ key: r.key, ms: r.ms, rate: r.rate, at: r.at, wav_base64: await blobToBase64(r.wav) })));
  const file = { kind: FILE_KIND, version: 1, langs: VOICE_LANGS, created_at: new Date().toISOString(), clips };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** Add the clips from an exported file (replacing clips with the same name). Returns how many. */
export async function importVoice(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a voice file.');
  }
  if (data?.kind !== FILE_KIND || !Array.isArray(data.clips)) throw new Error('This is not a Kadan Kanakku voice file.');
  const valid = data.clips.filter((c) => typeof c?.key === 'string' && VALID_KEY.test(c.key) && typeof c.wav_base64 === 'string');
  const d = await db();
  const tx = d.transaction('voice', 'readwrite');
  for (const c of valid) {
    tx.store.put({ key: c.key, wav: base64ToBlob(c.wav_base64, 'audio/wav'), ms: Number(c.ms) || 0, rate: Number(c.rate) || STUDIO_RATE, at: c.at || null });
  }
  await tx.done;
  buffers.clear();
  await loadVoiceClips();
  return valid.length;
}
