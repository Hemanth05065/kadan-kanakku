import { describe, it, expect } from 'vitest';
import { analyse, encodeWav, resample } from './audio.js';

const RATE = 16000;
// Speech-like signal: syllable bursts of a voiced tone with gaps, 2 seconds.
function speech(gain = 0.3) {
  const x = new Float32Array(RATE * 2);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const syllable = Math.sin(Math.PI * ((t * 4) % 1)) ** 2; // 4 syllables / s
    x[i] = gain * syllable * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t));
  }
  // leading/trailing silence for the trimmer
  const out = new Float32Array(x.length + RATE);
  out.set(x, RATE / 2);
  return out;
}
const withNoise = (x, level) => x.map((v) => v + (Math.random() * 2 - 1) * level);

describe('audio quality gate', () => {
  it('accepts clear speech and trims silence', () => {
    const a = analyse(withNoise(speech(), 0.002));
    expect(a.verdict).toBe('ok');
    expect(a.trimmed.length).toBeLessThan(RATE * 3);
  });
  it('ignores an accidental tap / silence', () => {
    expect(analyse(new Float32Array(RATE)).verdict).toBe('short');
    expect(analyse(new Float32Array(3000)).verdict).toBe('short');
  });
  it('asks to come closer when speech is too quiet', () => {
    expect(analyse(withNoise(speech(0.002), 0.0002)).verdict).toBe('quiet');
  });
  it('re-asks when speech is buried in counter noise', () => {
    expect(analyse(withNoise(speech(0.3), 0.6)).verdict).toBe('noisy');
  });
});

describe('audio encoding', () => {
  it('writes a 16 kHz mono WAV', async () => {
    const wav = encodeWav(new Float32Array(1600));
    const head = new DataView(await wav.arrayBuffer());
    expect(head.getUint32(24, true)).toBe(16000);
    expect(head.getUint16(22, true)).toBe(1);
    expect(wav.size).toBe(44 + 3200);
  });
  it('resamples 48 kHz to 16 kHz', () => {
    expect(resample(new Float32Array(48000), 48000).length).toBe(16000);
  });
});
