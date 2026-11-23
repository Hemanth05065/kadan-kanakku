// Clips recorded with no speech engine available (offline, no on-device model) sit in
// "Needs review" with no transcript. When an engine becomes available, transcribe and
// understand them in the background and attach a suggestion the owner can confirm in one tap.
import { getState, updateEntry, audioBlob } from '../lib/store.js';
import { buildNameIndex, resolveName } from '../lib/names.js';
import { serverAvailable, callFunction } from './server.js';
import { whisperReady, transcribeOnDevice } from './localWhisper.js';
import { decodeToPcm16k } from './audio.js';
import { understand } from './nlu.js';
import { vocabulary, speechLangCode } from './stt.js';

let running = false;

async function transcribeClip(clip) {
  if (serverAvailable('transcribe')) {
    const form = new FormData();
    form.append('audio', clip.blob, `clip.${(clip.mime || 'audio/webm').split('/')[1]}`);
    form.append('lang', speechLangCode());
    form.append('keyterms', JSON.stringify(vocabulary()));
    const out = await callFunction('transcribe', form, 20000);
    return out.transcript || '';
  }
  if (whisperReady()) {
    const pcm = await decodeToPcm16k(clip.blob);
    return transcribeOnDevice(pcm, speechLangCode());
  }
  return null;
}

export async function reprocessReviews() {
  if (running) return;
  running = true;
  try {
    const todo = getState().entries.filter((e) => e.status === 'needs_review' && !e.deleted_at && !e.transcript);
    for (const e of todo) {
      const clip = await audioBlob(e.id);
      if (!clip) continue;
      const text = await transcribeClip(clip).catch(() => null);
      if (text === null) break; // no engine right now
      if (!text.trim()) {
        await updateEntry(e.id, { transcript: '', review_reason: 'unclear' });
        continue;
      }
      const parse = await understand(text);
      const s = getState();
      const res = parse.customer_name ? resolveName(parse.customer_name, buildNameIndex(s.customers, s.aliases), parse.customer_id) : null;
      await updateEntry(e.id, {
        transcript: text,
        lang: parse.language,
        confidence: parse.confidence,
        suggestion: {
          intent: parse.intent,
          customer_name: parse.customer_name,
          customer_id: res?.status === 'match' ? res.customer.id : null,
          amount: parse.amount,
          items: parse.items,
          confidence: parse.confidence,
        },
      });
    }
  } finally {
    running = false;
  }
}
