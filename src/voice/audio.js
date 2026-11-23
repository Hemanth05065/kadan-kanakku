// Pure audio helpers: resampling, quality analysis / silence trimming, WAV encoding.

export const TARGET_RATE = 16000;

/** Resample mono Float32 PCM to 16 kHz (box-filtered linear interpolation). */
export function resample(pcm, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  const half = Math.max(0, Math.floor(ratio / 2));
  for (let i = 0; i < out.length; i++) {
    const center = i * ratio;
    const lo = Math.max(0, Math.floor(center) - half);
    const hi = Math.min(pcm.length - 1, Math.floor(center) + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += pcm[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

const dbfs = (rms) => (rms > 0 ? 20 * Math.log10(rms) : -120);

/** RMS level of a chunk mapped to 0..1 for the level bar (-60 dBFS..-10 dBFS). */
export function levelOf(chunk) {
  let s = 0;
  for (let i = 0; i < chunk.length; i++) s += chunk[i] * chunk[i];
  const db = dbfs(Math.sqrt(s / Math.max(1, chunk.length)));
  return Math.max(0, Math.min(1, (db + 60) / 50));
}

/**
 * Speech/noise analysis on 16 kHz PCM. Returns the trimmed clip and a verdict:
 *   ok | short (nothing said / accidental tap) | quiet (too far from the mic) | noisy (speech buried in noise)
 */
export function analyse(pcm, rate = TARGET_RATE) {
  const frame = Math.round(rate * 0.02); // 20 ms
  const n = Math.floor(pcm.length / frame);
  const totalMs = (pcm.length / rate) * 1000;
  if (n < 5) return { verdict: 'short', totalMs, speechMs: 0, trimmed: pcm, snr: 0, speechDb: -120, noiseDb: -120 };

  const energies = new Float32Array(n);
  let clipped = 0;
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) {
      const v = pcm[i];
      s += v * v;
      if (v > 0.98 || v < -0.98) clipped++;
    }
    energies[f] = dbfs(Math.sqrt(s / frame));
  }
  const sorted = Array.from(energies).sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const noiseDb = pct(0.15);
  const speechDb = pct(0.9);
  const threshold = Math.max(noiseDb + 8, -50);

  let first = -1, last = -1, speechFrames = 0;
  for (let f = 0; f < n; f++) {
    if (energies[f] > threshold) {
      speechFrames++;
      if (first < 0) first = f;
      last = f;
    }
  }
  const speechMs = speechFrames * 20;
  const snr = speechDb - noiseDb;
  const pad = Math.round(0.25 * rate);
  const trimmed = first < 0 ? pcm : pcm.slice(Math.max(0, first * frame - pad), Math.min(pcm.length, (last + 1) * frame + pad));

  // Order matters: an accidental tap or dead silence is ignored, but audio with
  // something in it that we can't hear properly must be re-asked, never guessed.
  let verdict = 'ok';
  if (totalMs < 350 || speechDb < -62) verdict = 'short';
  else if (speechDb < -46) verdict = 'quiet';
  else if (snr < 9 || clipped / pcm.length > 0.02) verdict = 'noisy';
  else if (speechMs < 240) verdict = 'short';
  return { verdict, totalMs, speechMs, trimmed, snr: Math.round(snr), speechDb: Math.round(speechDb), noiseDb: Math.round(noiseDb) };
}

/** 16-bit mono WAV. */
export function encodeWav(pcm, rate = TARGET_RATE) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Decode any stored clip (webm/ogg/wav) back to 16 kHz PCM, for re-transcription. */
export async function decodeToPcm16k(blob) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const data = await blob.arrayBuffer();
  const tmp = new Ctx(1, 1, TARGET_RATE);
  const decoded = await tmp.decodeAudioData(data);
  const ch = decoded.getChannelData(0);
  return resample(ch, decoded.sampleRate, TARGET_RATE);
}
