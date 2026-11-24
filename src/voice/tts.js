// Spoken replies, most human first:
//   1. the shop voice: words recorded by a real person, stitched together (voicePack.js)
//   2. the phone's own voice for the reply language, preferring natural / neural voices
//   3. the server voice (open Indic Parler-TTS)
//   4. the romanised line read by an Indian-English voice
// A Tamil sentence is never read out by a British or American voice: it sounds like a robot
// and helps nobody. With no suitable voice the reply stays on screen (and the save chime plays).
import { getState } from '../lib/store.js';
import { serverAvailable, callFunction } from './server.js';
import { playReply, stopVoice } from './voiceClips.js';

let voices = [];
function refreshVoices() {
  if (typeof speechSynthesis !== 'undefined') voices = speechSynthesis.getVoices();
}
if (typeof speechSynthesis !== 'undefined') {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

const norm = (l) => String(l || '').replace(/_/g, '-').toLowerCase();
const NATURAL = /natural|neural|wavenet|studio|premium|enhanced/i;
const NETWORK = /online|google/i;

/**
 * Best voice for a reply language from a voice list. English replies take any English voice,
 * Indian English first; `indianOnly` is for reading romanised Tamil, where only an Indian accent
 * will do. Natural / neural voices beat the old robotic ones.
 */
export function chooseVoice(list, lang, { indianOnly = false } = {}) {
  let best = null;
  let bestScore = -1;
  for (const v of list || []) {
    const l = norm(v.lang);
    let s = 0;
    if (lang === 'en') {
      if (l === 'en-in') s += 10;
      else if (indianOnly || !l.startsWith('en')) continue;
    } else {
      if (l !== lang && !l.startsWith(`${lang}-`)) continue;
      if (l === `${lang}-in`) s += 1;
    }
    if (NATURAL.test(v.name)) s += 4;
    if (NETWORK.test(v.name)) s += 2;
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

export const voiceFor = (lang) => chooseVoice(voices, lang);
export const hasPhoneVoice = (lang) => Boolean(voiceFor(lang));

let currentAudio = null;

export function stopSpeaking() {
  stopVoice();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function speakPhone(text, voice, rate) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate; // a touch slower than default: unhurried, like a person at the counter
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

/** Which voice a reply in `lang` will use on this device (for Settings). */
export function voicePlanFor(lang) {
  const native = voiceFor(lang);
  if (native) return { kind: 'phone', name: native.name };
  if (lang !== 'en') {
    const indian = chooseVoice(voices, 'en', { indianOnly: true });
    if (indian) return { kind: 'indian-english', name: indian.name };
  }
  return { kind: 'none', name: null };
}

/** Speak a reply ({ key, lang, params, say, show }). Resolves when finished. */
export async function speak(reply) {
  if (!reply) return;
  stopSpeaking();
  const { voice: mode, shopVoice } = getState().settings;
  const lang = reply.lang || 'ta';

  if (shopVoice !== false && (await playReply(reply))) return;

  const canPhone = typeof speechSynthesis !== 'undefined';
  const native = canPhone ? voiceFor(lang) : null;
  const rate = lang === 'en' ? 1 : 0.95;
  if (mode !== 'server' && native) return speakPhone(reply.say, native, rate);
  if (mode !== 'phone' && serverAvailable('speak')) {
    try {
      return await speakServer(reply.say, lang);
    } catch (err) {
      console.warn('server voice failed', err);
    }
  }
  if (native) return speakPhone(reply.say, native, rate);
  if (!canPhone || lang === 'en') return;
  const indian = chooseVoice(voices, 'en', { indianOnly: true });
  if (indian) return speakPhone(reply.show, indian, 0.92);
  // No voice here can say this naturally: the reply stays on screen.
}
