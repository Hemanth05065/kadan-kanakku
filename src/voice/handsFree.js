// Hands-free listening: the microphone stays open, every 32 ms frame is scored by the Silero
// voice detector (or by loudness until / unless it loads), and each finished sentence is
// handed to the voice flow. Listening pauses while the app itself is thinking or speaking,
// so it never answers its own voice.
import { createSegmenter, createLoudnessDetector, FRAME, END_SILENCE } from './vad.js';

// ── the Silero worker (shared, loaded once) ─────────────────────────────────

let worker = null;
let workerReady = null;
let owner = null; // the HandsFree instance receiving probabilities

function silero() {
  if (workerReady) return workerReady;
  workerReady = new Promise((resolve, reject) => {
    try {
      worker = new Worker(new URL('./vad.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => reject(new Error('voice detector took too long to load')), 20000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        clearTimeout(timer);
        resolve(worker);
      } else if (data.type === 'error') {
        clearTimeout(timer);
        reject(new Error(data.error));
      } else if (data.type === 'prob') {
        owner?.onProb(data.id, data.p);
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(e.message || 'voice detector failed'));
    };
    worker.postMessage({ type: 'load' });
  }).catch((err) => {
    worker?.terminate();
    worker = null;
    workerReady = null; // try again next time hands-free is turned on
    throw err;
  });
  return workerReady;
}

// ── the listener ─────────────────────────────────────────────────────────────

export class HandsFree {
  /**
   * recorder: the shared Recorder (its listen() / endListen()).
   * events: onStart(), onUtterance({ pcm, speechMs, noiseDb }), onMisfire(), onLevel(0..1),
   *         onDetector('silero' | 'loudness').
   */
  constructor(recorder, events = {}) {
    this.recorder = recorder;
    this.ev = events;
    this.on = false;
    this.depth = 0; // pause() / resume() nest: listening only at depth 0
    this.deafUntil = 0;
    this.detector = 'loudness';
    this.epoch = 0; // bumps on every pause / reset; late answers from the worker are dropped
    this.seq = 0;
    this.waiting = new Map(); // frame id -> { frame, epoch }
    this.carry = new Float32Array(0);
  }

  get listening() {
    return this.on && this.depth === 0;
  }

  /** Room noise level (dBFS), used to judge each sentence's clarity. */
  get noiseDb() {
    return this.loud?.floorDb ?? -60;
  }

  async start({ wait = 'normal' } = {}) {
    this.seg = createSegmenter({ endSilenceMs: END_SILENCE[wait] || END_SILENCE.normal });
    this.loud = createLoudnessDetector();
    this.on = true;
    this.depth = 0;
    this.deafUntil = performance.now() + 300;
    owner = this;
    await this.recorder.listen((level) => this.ev.onLevel?.(level), (pcm) => this.#onAudio(pcm));
    silero()
      .then((w) => {
        if (!this.on) return;
        this.worker = w;
        w.postMessage({ type: 'reset' });
        this.#restart();
        this.detector = 'silero';
        this.ev.onDetector?.('silero');
      })
      .catch((err) => {
        console.warn('Silero voice detector unavailable, using loudness', err);
        this.ev.onDetector?.('loudness');
      });
  }

  stop() {
    this.on = false;
    if (owner === this) owner = null;
    this.waiting.clear();
    this.recorder.endListen();
  }

  /** Stop hearing (the app is thinking or speaking). Nests with resume(). */
  pause() {
    this.depth++;
    this.#restart();
  }

  /** Start hearing again, after a short deaf moment for the tail of the app's own voice. */
  resume(deafMs = 300) {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      this.#restart();
      this.deafen(deafMs);
    }
  }

  /** Ignore the microphone for a moment (the save chime), unless someone is mid-sentence. */
  deafen(ms) {
    if (!this.seg?.speaking) this.deafUntil = Math.max(this.deafUntil, performance.now() + ms);
  }

  #restart() {
    this.epoch++;
    this.waiting.clear();
    this.seg?.reset();
    this.worker?.postMessage({ type: 'reset' });
  }

  #onAudio(chunk) {
    const buf = new Float32Array(this.carry.length + chunk.length);
    buf.set(this.carry);
    buf.set(chunk, this.carry.length);
    let i = 0;
    for (; i + FRAME <= buf.length; i += FRAME) this.#onFrame(buf.slice(i, i + FRAME));
    this.carry = buf.slice(i);
  }

  #onFrame(frame) {
    const loudP = this.loud.prob(frame); // always: it also tracks how noisy the shop is
    if (!this.listening || performance.now() < this.deafUntil) return;
    if (this.worker) {
      const id = ++this.seq;
      this.waiting.set(id, { frame, epoch: this.epoch });
      this.worker.postMessage({ type: 'frame', id, frame: frame.slice() });
    } else {
      this.#feed(frame, loudP);
    }
  }

  onProb(id, p) {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    if (w.epoch === this.epoch) this.#feed(w.frame, p);
  }

  #feed(frame, p) {
    if (!this.listening) return;
    const ev = this.seg.push(frame, p);
    if (!ev) return;
    if (ev.type === 'start') this.ev.onStart?.();
    else if (ev.type === 'end') this.ev.onUtterance?.({ ...ev, noiseDb: this.noiseDb });
    else this.ev.onMisfire?.();
  }
}
