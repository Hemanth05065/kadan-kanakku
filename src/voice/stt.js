// Speech-to-text router. Order of preference:
//   1. server Whisper large-v3 (open weights; best for Tamil + code-mixing) when online
//   2. on-device Whisper in the browser (works offline)
//   3. the browser's own speech recognition (captured live during the press)
// Returns { text, engine, ms } or null when nothing could transcribe (-> "Needs review").
import { getState } from '../lib/store.js';
import { pack } from '../i18n/index.js';
import { scriptOf } from '../lib/translit.js';
import { serverAvailable, callFunction, NotConfigured } from './server.js';
import { whisperReady, transcribeOnDevice } from './localWhisper.js';

/** Customer names plus a few ledger words of the speech language, as Whisper vocabulary hints. */
export function vocabulary() {
  const { customers, aliases } = getState();
  const lang = speechLangCode();
  const terms = [];
  for (const c of customers) {
    if (c.deleted_at) continue;
    terms.push(c.name);
    if (c.name_ta) terms.push(c.name_ta);
  }
  for (const a of aliases) if (!a.deleted_at) terms.push(a.alias);
  const lex = pack(lang).lexicon;
  const native = (w) => scriptOf(w) === lang;
  for (const cat of ['credit', 'payment', 'query', 'items']) {
    terms.push(...lex[cat].filter(native).slice(0, cat === 'items' ? 5 : 2));
  }
  return terms.slice(0, 60);
}

export const speechLangCode = () => (getState().settings.speechLang || 'ta-IN').slice(0, 2);

/** Can any engine transcribe right now? (decides whether to also run browser recognition live) */
export function engines() {
  return {
    server: serverAvailable('transcribe'),
    device: whisperReady(),
    browser: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) && navigator.onLine,
  };
}

/**
 * Whisper hallucinates on noise or silence ("thanks for watching", the same word fifty times).
 * A counter command is a few words; anything that loops or runs far longer than the audio
 * could hold is treated as "didn't hear you" rather than understood.
 */
export function looksHallucinated(text, durationMs = null) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 4) return true;
  }
  const distinct = new Set(words).size;
  if (words.length >= 8 && distinct / words.length < 0.35) return true;
  if (durationMs && words.length > Math.max(12, (durationMs / 1000) * 6)) return true;
  return false;
}

const clean = (out, durationMs) => (out && looksHallucinated(out.text, durationMs) ? { ...out, text: '', hallucinated: true } : out);

export async function transcribe(input) {
  const durationMs = input.pcm?.length ? (input.pcm.length / 16000) * 1000 : null;
  return clean(await transcribeRaw(input), durationMs);
}

async function transcribeRaw({ wav, archive, pcm, live }) {
  const lang = speechLangCode();
  const t0 = performance.now();
  if (serverAvailable('transcribe')) {
    try {
      const form = new FormData();
      form.append('audio', wav || archive.blob, wav ? 'clip.wav' : `clip.${(archive.mime || 'audio/webm').split('/')[1]}`);
      form.append('lang', lang);
      form.append('keyterms', JSON.stringify(vocabulary()));
      const out = await callFunction('transcribe', form, 15000);
      return { text: out.transcript || '', engine: `server · ${out.model || 'whisper'}`, ms: Math.round(performance.now() - t0) };
    } catch (err) {
      if (!(err instanceof NotConfigured)) console.warn('server STT failed, falling back', err);
    }
  }
  if (whisperReady() && pcm?.length) {
    try {
      const text = await transcribeOnDevice(pcm, lang);
      return { text, engine: 'on-device · whisper', ms: Math.round(performance.now() - t0) };
    } catch (err) {
      console.warn('on-device STT failed', err);
    }
  }
  if (live) {
    const text = await live.result();
    if (text) return { text, engine: 'browser', ms: Math.round(performance.now() - t0) };
  }
  return null;
}

/**
 * Browser speech recognition running alongside the recorder (used only when no Whisper
 * engine is available). start() on press, stop() on release, result() resolves the text.
 */
export function startLiveRecognition(lang) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = `${lang || 'ta'}-IN`;
  rec.interimResults = false;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  let text = '';
  let done;
  const finished = new Promise((r) => { done = r; });
  rec.onresult = (e) => {
    text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
  };
  rec.onerror = () => done();
  rec.onend = () => done();
  try { rec.start(); } catch { return null; }
  return {
    stop: () => { try { rec.stop(); } catch { done(); } },
    abort: () => { try { rec.abort(); } catch { /* ignore */ } done(); },
    result: () => Promise.race([finished, new Promise((r) => setTimeout(r, 2500))]).then(() => text),
  };
}
