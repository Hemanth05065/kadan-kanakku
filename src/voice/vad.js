// Hands-free listening, the pure part: a stream of 32 ms audio frames, each with a
// "speech probability" (from the Silero voice detector, or from loudness when the model
// isn't available), is turned into whole sentences. The shopkeeper just talks; a short
// pause ends the sentence.

export const FRAME = 512; // samples at 16 kHz
export const FRAME_MS = (FRAME / 16000) * 1000; // 32 ms

/** How long a pause ends a sentence. People pause between "Murugan anna… 240… kadan". */
export const END_SILENCE = { short: 600, normal: 900, long: 1400 };

const concat = (frames) => {
  const out = new Float32Array(frames.reduce((s, f) => s + f.length, 0));
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
};

/**
 * push(frame, probability) returns null, or one event:
 *   { type: 'start' }                       speech began (the frames just before it are kept)
 *   { type: 'end', pcm, speechMs, cut }     a sentence, ready to transcribe (cut: hit maxMs)
 *   { type: 'misfire' }                     a cough, a door, a word too short to be a command
 * Probabilities between `negative` and `positive` neither extend the speech nor count as
 * silence, so a soft syllable in the middle of a word does not end the sentence.
 */
export function createSegmenter(opts = {}) {
  const o = { positive: 0.5, negative: 0.35, minSpeechMs: 250, endSilenceMs: END_SILENCE.normal, preRollMs: 320, tailMs: 200, maxMs: 15000, ...opts };
  const preN = Math.max(1, Math.round(o.preRollMs / FRAME_MS));
  const endN = Math.max(1, Math.round(o.endSilenceMs / FRAME_MS));
  const tailN = Math.round(o.tailMs / FRAME_MS);
  const minN = Math.max(1, Math.round(o.minSpeechMs / FRAME_MS));
  const maxN = Math.max(minN + 1, Math.round(o.maxMs / FRAME_MS));

  let pre = [];
  let seg = null;
  let speechN = 0;
  let silentN = 0;

  const clear = () => {
    pre = [];
    seg = null;
    speechN = 0;
    silentN = 0;
  };

  const finish = (cut) => {
    // Keep a short tail after the last word; drop the rest of the pause.
    const frames = seg.slice(0, seg.length - Math.max(0, silentN - tailN));
    const out = speechN >= minN ? { type: 'end', pcm: concat(frames), speechMs: Math.round(speechN * FRAME_MS), cut } : { type: 'misfire' };
    clear();
    return out;
  };

  return {
    get speaking() {
      return seg !== null;
    },
    push(frame, p) {
      if (!seg) {
        pre.push(frame);
        if (pre.length > preN) pre.shift();
        if (p < o.positive) return null;
        seg = pre;
        pre = [];
        speechN = 1;
        silentN = 0;
        return { type: 'start' };
      }
      seg.push(frame);
      if (p >= o.positive) {
        speechN++;
        silentN = 0;
      } else if (p < o.negative) {
        silentN++;
      }
      if (silentN >= endN) return finish(false);
      if (seg.length >= maxN) return finish(true);
      return null;
    },
    reset: clear,
  };
}

export function dbOf(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  const rms = Math.sqrt(s / Math.max(1, frame.length));
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

/**
 * Speech probability from loudness alone, for when the Silero model can't load. It follows
 * the room's noise floor (fast when the room gets quieter, slowly when it gets louder, so a
 * long sentence doesn't become the new "silence") and scores how far a frame rises above it.
 * Also used alongside Silero, to know how noisy the shop is.
 */
export function createLoudnessDetector() {
  let floor = null;
  return {
    get floorDb() {
      return floor ?? -60;
    },
    prob(frame) {
      const db = dbOf(frame);
      if (floor === null) floor = Math.min(db, -45);
      floor += (db < floor ? 0.25 : 0.002) * (db - floor);
      floor = Math.max(floor, -80);
      if (db < -55) return 0;
      return Math.max(0, Math.min(1, (db - floor - 6) / 12)); // 12 dB above the floor = 0.5
    },
  };
}

/**
 * Hands-free hears the whole shop, not just the owner. Outside a conversation it only acts
 * on something that is clearly a ledger command; customers' chatter ("illa", "seri", talk
 * about prices) is ignored instead of answered, and never undoes an entry.
 * Inside a conversation (the app asked a question, or a save is counting down) everything
 * is an answer.
 */
export function handsFreeShouldAct(parse, { engaged = false, justSaved = false } = {}) {
  if (engaged) return true;
  const named = Boolean(parse.customer_name || parse.customer_id);
  switch (parse.intent) {
    case 'credit':
    case 'payment':
      return named || parse.amount != null;
    case 'query_balance':
    case 'add_customer':
      return named;
    case 'query_top':
    case 'query_today':
    case 'query_collect':
      return true;
    case 'undo_last':
    case 'confirm_no':
      return Boolean(justSaved); // "venaam" right after the save chime: the owner taking it back
    default:
      return false;
  }
}
