#!/usr/bin/env node
// Scores speech-to-text engines on real recordings, end to end: what was heard (word error
// rate) and whether the app then understood the command (intent, customer, amount).
//
// Recordings come from the in-app Accuracy lab (Settings → Accuracy lab → Export), or a
// folder of 16-bit WAV files with a manifest.csv (file,text,intent,customer,amount,lang).
//
//   node scripts/eval-stt.mjs bundle.json --engine server
//        uses STT_BASE_URL / STT_MODEL / STT_API_KEY (any OpenAI-compatible Whisper server)
//   node scripts/eval-stt.mjs bundle.json --engine local:onnx-community/whisper-base
//        runs Whisper on this machine with Transformers.js (same model the phone uses)
//   node scripts/eval-stt.mjs --dir eval/audio --engine local:onnx-community/whisper-small
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resample, encodeWav } from '../src/voice/audio.js';
import { wordErrorRate, evalCustomers, scoreUnderstanding } from '../src/lib/evalScore.js';
import { looksHallucinated } from '../src/voice/stt.js';

const args = process.argv.slice(2);
const opt = (name, def = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const engine = opt('--engine', 'server');
const dir = opt('--dir');
const bundlePath = args.find((a) => a.endsWith('.json'));
const LANGUAGE = { ta: 'tamil', en: 'english', hi: 'hindi', te: 'telugu' };

/** 16-bit PCM / 32-bit float WAV -> mono Float32 at 16 kHz. */
function decodeWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const size = v.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(p + 8, true), channels: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    if (id === 'data') data = { offset: p + 8, size };
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('not a WAV file');
  const frames = data.size / (fmt.bits / 8) / fmt.channels;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = data.offset + (i * fmt.channels + c) * (fmt.bits / 8);
      sum += fmt.bits === 16 ? v.getInt16(o, true) / 32768 : fmt.bits === 32 && fmt.format === 3 ? v.getFloat32(o, true) : 0;
    }
    out[i] = sum / fmt.channels;
  }
  return resample(out, fmt.rate, 16000);
}

function loadClips() {
  if (bundlePath) {
    const b = JSON.parse(readFileSync(bundlePath, 'utf8'));
    return {
      customers: b.customers,
      clips: b.clips.map((c) => ({ ...c, pcm: decodeWav(Buffer.from(c.wav_base64, 'base64')) })),
    };
  }
  if (dir && existsSync(join(dir, 'manifest.csv'))) {
    const cases = JSON.parse(readFileSync(new URL('../eval/cases.json', import.meta.url), 'utf8'));
    const rows = readFileSync(join(dir, 'manifest.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
    return {
      customers: cases.customers,
      clips: rows.map((line) => {
        const [file, text, intent, customer, amount, lang] = line.split(',').map((s) => s.trim());
        return {
          text, lang: lang || 'ta',
          expected: { intent, customer: customer || null, amount: amount ? Number(amount) : null },
          pcm: decodeWav(readFileSync(join(dir, file))),
        };
      }),
    };
  }
  console.error('Give an exported bundle.json, or --dir with WAV files and manifest.csv');
  process.exit(2);
}

async function makeTranscriber() {
  if (engine === 'server') {
    const base = (process.env.STT_BASE_URL || '').replace(/\/+$/, '');
    if (!base) { console.error('--engine server needs STT_BASE_URL (and STT_MODEL, STT_API_KEY)'); process.exit(2); }
    return async (pcm, lang) => {
      const form = new FormData();
      form.append('file', encodeWav(pcm), 'clip.wav');
      form.append('model', process.env.STT_MODEL || 'whisper-large-v3');
      form.append('language', lang);
      form.append('response_format', 'json');
      form.append('temperature', '0');
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: process.env.STT_API_KEY ? { Authorization: `Bearer ${process.env.STT_API_KEY}` } : {},
        body: form,
      });
      if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()).text?.trim() ?? '';
    };
  }
  if (engine.startsWith('local:')) {
    const { pipeline, env } = await import('@huggingface/transformers');
    // Short, shared cache path (also avoids Windows' 260-character path limit inside node_modules).
    env.cacheDir = process.env.KK_MODEL_CACHE || join(homedir(), '.cache', 'kadan-kanakku');
    const model = engine.slice(6);
    console.log(`loading ${model} (first run downloads it)…`);
    const asr = await pipeline('automatic-speech-recognition', model, { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
    return async (pcm, lang) => String((await asr(pcm, { language: LANGUAGE[lang] || 'tamil', task: 'transcribe', max_new_tokens: 64 })).text || '').trim();
  }
  console.error(`unknown engine "${engine}" (use server or local:<model id>)`);
  process.exit(2);
}

const { customers: raw, clips } = loadClips();
const customers = evalCustomers({ customers: raw });
const transcribe = await makeTranscriber();

const rows = [];
for (const c of clips) {
  const t0 = performance.now();
  let heard = '';
  try {
    heard = await transcribe(c.pcm, c.lang || 'ta');
  } catch (err) {
    console.warn(`failed on "${c.text}": ${err.message}`);
  }
  const ms = performance.now() - t0;
  if (looksHallucinated(heard, (c.pcm.length / 16000) * 1000)) heard = '';
  const s = scoreUnderstanding(c.expected, heard, customers);
  rows.push({ c, heard, ms, wer: wordErrorRate(c.text, heard), ...s });
  console.log(`${s.exact ? '✓' : '✗'} ${Math.round(ms)} ms  WER ${Math.round(wordErrorRate(c.text, heard) * 100)}%  "${c.text}"  →  "${heard}"`);
}

const n = rows.length || 1;
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
console.log(`\nengine ${engine} · ${rows.length} clips`);
console.log(`word error rate      ${Math.round((100 * sum((r) => r.wer)) / n)}%`);
console.log(`understood (all 3)   ${Math.round((100 * sum((r) => (r.exact ? 1 : 0))) / n)}%`);
console.log(`silent wrong saves   ${sum((r) => (r.silentWrong ? 1 : 0))}`);
console.log(`avg latency          ${Math.round(sum((r) => r.ms) / n)} ms`);
