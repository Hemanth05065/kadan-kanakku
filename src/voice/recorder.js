// Microphone capture: hold-to-talk clips, or a continuous stream for hands-free listening.
//  • getUserMedia with noise suppression + echo cancellation + auto gain
//  • raw PCM through an AudioWorklet -> 16 kHz, level meter, silence trim, quality verdict
//  • a small Opus clip (MediaRecorder) kept with each entry to settle disputes
// The mic stream stays warm between presses so the first syllable is never cut off.
import { TARGET_RATE, resample, levelOf, analyse, encodeWav } from './audio.js';

const WORKLET_SRC = `
class KKCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.on = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; }
      else if (e.data === 'stop') {
        this.on = false;
        this.port.postMessage({ type: 'end', data: this.buf.slice(0, this.n) });
        this.n = 0;
      }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.on && ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage({ type: 'chunk', data: this.buf.slice(0) }); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('kk-capture', KKCapture);
`;

const ARCHIVE_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

export class Recorder {
  /**
   * rate: capture rate (16 kHz for speech recognition; the shop-voice studio uses 24 kHz).
   * studio: plain capture for recording the shop voice (no auto gain or echo cancelling,
   * which make recorded words pump in level).
   */
  constructor({ rate = TARGET_RATE, studio = false } = {}) {
    this.rate = rate;
    this.studio = studio;
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.chunks = [];
    this.onLevel = null;
    this.media = null;
    this.mediaChunks = [];
    this.ending = null;
    this.startedAt = 0;
  }

  get warm() {
    return Boolean(this.stream && this.stream.active && this.ctx && this.ctx.state !== 'closed');
  }

  async warmUp() {
    if (this.warm) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: !this.studio,
        autoGainControl: !this.studio,
        sampleRate: this.rate,
      },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let source;
    try {
      this.ctx = new Ctx({ sampleRate: this.rate, latencyHint: 'interactive' });
      source = this.ctx.createMediaStreamSource(this.stream);
    } catch {
      // Some browsers refuse a context whose rate differs from the mic: use the default and resample.
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      source = this.ctx.createMediaStreamSource(this.stream);
    }
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    sink.connect(this.ctx.destination);

    if (this.ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, 'kk-capture');
      this.node.port.onmessage = (e) => this.#onPcm(e.data);
    } else {
      // Older WebViews: ScriptProcessor fallback.
      const sp = this.ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => {
        if (this.capturing) this.#onPcm({ type: 'chunk', data: new Float32Array(e.inputBuffer.getChannelData(0)) });
      };
      this.node = sp;
      this.node.port = { postMessage: (m) => { if (m === 'stop') this.#onPcm({ type: 'end', data: new Float32Array(0) }); } };
    }
    source.connect(this.node);
    this.node.connect(sink);
  }

  #onPcm(msg) {
    if (msg.data?.length) {
      if (this.onChunk) {
        // Hands-free: hand the audio on at 16 kHz instead of collecting it.
        const rate = this.ctx?.sampleRate || TARGET_RATE;
        this.onChunk(rate === TARGET_RATE ? msg.data : resample(msg.data, rate, TARGET_RATE));
      } else {
        this.chunks.push(msg.data);
      }
      this.onLevel?.(levelOf(msg.data));
    }
    if (msg.type === 'end') this.ending?.();
  }

  /** Hands-free: keep the microphone open and pass every chunk (16 kHz) to onChunk. */
  async listen(onLevel, onChunk) {
    await this.warmUp();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.chunks = [];
    this.onLevel = onLevel;
    this.onChunk = onChunk;
    this.capturing = true;
    this.node.port.postMessage('start');
  }

  endListen() {
    if (!this.onChunk) return;
    this.onChunk = null;
    this.capturing = false;
    this.node?.port.postMessage('stop');
    this.onLevel?.(0);
    this.onLevel = null;
  }

  async start(onLevel) {
    await this.warmUp();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.chunks = [];
    this.onLevel = onLevel;
    this.capturing = true;
    this.startedAt = performance.now();
    this.node.port.postMessage('start');

    this.mediaChunks = [];
    const type = !this.studio && typeof MediaRecorder !== 'undefined' ? ARCHIVE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null;
    if (type) {
      this.media = new MediaRecorder(this.stream, { mimeType: type, audioBitsPerSecond: 24000 });
      this.media.ondataavailable = (e) => e.data.size && this.mediaChunks.push(e.data);
      this.media.start();
    } else {
      this.media = null;
    }
  }

  /** Stop and return { pcm (16 kHz, trimmed), wav, archive, quality, durationMs, raw, rawRate }. */
  async stop() {
    if (!this.capturing) return null;
    this.capturing = false;
    const ended = new Promise((resolve) => { this.ending = resolve; });
    this.node.port.postMessage('stop');
    await Promise.race([ended, new Promise((r) => setTimeout(r, 300))]);
    this.ending = null;
    this.onLevel?.(0);

    const archive = this.studio ? null : await this.#stopArchive();
    const len = this.chunks.reduce((s, c) => s + c.length, 0);
    const raw = new Float32Array(len);
    let o = 0;
    for (const c of this.chunks) { raw.set(c, o); o += c.length; }
    this.chunks = [];
    const pcm16 = resample(raw, this.ctx.sampleRate, TARGET_RATE);
    const quality = analyse(pcm16);
    const wav = encodeWav(quality.trimmed);
    return {
      pcm: quality.trimmed,
      wav,
      archive: archive || { blob: wav, mime: 'audio/wav' },
      quality,
      durationMs: Math.round(performance.now() - this.startedAt),
      raw,
      rawRate: this.ctx.sampleRate,
    };
  }

  #stopArchive() {
    const m = this.media;
    this.media = null;
    if (!m || m.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      m.onstop = () => {
        const blob = new Blob(this.mediaChunks, { type: m.mimeType });
        resolve(blob.size ? { blob, mime: m.mimeType.split(';')[0] } : null);
      };
      m.stop();
    });
  }

  cancel() {
    this.onChunk = null;
    this.capturing = false;
    this.node?.port.postMessage('stop');
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    this.media = null;
    this.chunks = [];
    this.onLevel?.(0);
  }

  /** Release the microphone (app hidden). */
  release() {
    this.cancel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.node = null;
  }
}
