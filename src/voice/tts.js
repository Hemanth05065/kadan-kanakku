// Spoken replies. Prefers the phone's own voice for the reply language (instant, offline);
// falls back to the server voice (open Indic Parler-TTS) and finally reads the Tanglish
// text with an Indian-English voice, which Tamil listeners still understand.
import { getState } from '../lib/store.js';
import { serverAvailable, callFunction } from './server.js';

let voices = [];
function refreshVoices() {
  if (typeof speechSynthesis !== 'undefined') voices = speechSynthesis.getVoices();
}
if (typeof speechSynthesis !== 'undefined') {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

const norm = (l) => String(l || '').replace('_', '-').toLowerCase();
export function voiceFor(lang) {
  const want = lang === 'en' ? ['en-in', 'en-gb', 'en-us', 'en'] : [`${lang}-in`, lang];
  for (const w of want) {
    const v = voices.find((x) => norm(x.lang) === w) || voices.find((x) => norm(x.lang).startsWith(w));
    if (v) return v;
  }
  return null;
}
export const hasPhoneVoice = (lang) => Boolean(voiceFor(lang));

let currentAudio = null;

export function stopSpeaking() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function speakPhone(text, voice, lang) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || (lang === 'en' ? 'en-IN' : 'ta-IN');
    u.rate = 1.05;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
    setTimeout(resolve, 9000); // never hang the flow on a stuck engine
  });
}

async function speakServer(text, lang) {
  const out = await callFunction('speak', { text, lang }, 8000);
  const audio = new Audio(`data:${out.mime || 'audio/mpeg'};base64,${out.audio}`);
  currentAudio = audio;
  await new Promise((resolve) => {
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
    setTimeout(resolve, 9000);
  });
  currentAudio = null;
}

/** Speak a reply ({ say, show, lang }). Resolves when finished. */
export async function speak(reply) {
  if (!reply) return;
  stopSpeaking();
  const { voice: mode } = getState().settings;
  const lang = reply.lang || 'ta';
  const phoneVoice = voiceFor(lang);
  const canPhone = typeof speechSynthesis !== 'undefined';

  if (mode !== 'server' && phoneVoice && canPhone) return speakPhone(reply.say, phoneVoice, lang);
  if (mode !== 'phone' && serverAvailable('speak')) {
    try {
      return await speakServer(reply.say, lang);
    } catch (err) {
      console.warn('server voice failed', err);
    }
  }
  if (!canPhone) return;
  // No voice for this language on the phone: read the romanised line with an Indian-English voice.
  if (lang !== 'en') return speakPhone(reply.show, voiceFor('en'), 'en');
  return speakPhone(reply.say, phoneVoice, lang);
}
