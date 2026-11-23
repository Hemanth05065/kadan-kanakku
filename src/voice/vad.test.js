import { describe, it, expect, vi } from 'vitest';
import { createSegmenter, createLoudnessDetector, handsFreeShouldAct, FRAME, FRAME_MS, END_SILENCE } from './vad.js';
import { HandsFree } from './handsFree.js';
import { analyse } from './audio.js';

const RATE = 16000;
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const frameOf = (amp) => Float32Array.from({ length: FRAME }, (_, i) => rnd() * 0.004 + amp * Math.sin((2 * Math.PI * 180 * i) / RATE));
const ms = (n) => Math.round(n / FRAME_MS); // frames in n ms

/** Feed [probability, howManyMs] runs; return the events with the frame index they came at. */
function run(seg, runs) {
  const out = [];
  let i = 0;
  for (const [p, dur] of runs) {
    for (let k = 0; k < ms(dur); k++, i++) {
      const ev = seg.push(frameOf(p > 0.4 ? 0.1 : 0), p);
      if (ev) out.push({ ...ev, at: i });
    }
  }
  return out;
}

describe('cutting the stream into sentences', () => {
  it('one sentence: starts on speech, ends after the pause, keeps the moment before it', () => {
    const ev = run(createSegmenter(), [[0.02, 1000], [0.9, 1500], [0.05, 1200]]);
    expect(ev.map((e) => e.type)).toEqual(['start', 'end']);
    const end = ev[1];
    expect(end.at - ms(1000) - ms(1500)).toBe(ms(END_SILENCE.normal) - 1); // ended after the normal pause
    const clipMs = (end.pcm.length / RATE) * 1000;
    expect(clipMs).toBeGreaterThan(1500 + 250); // speech + the 320 ms before it + a short tail
    expect(clipMs).toBeLessThan(1500 + 320 + 200 + 2 * FRAME_MS);
    expect(end.speechMs).toBeGreaterThan(1400);
    expect(end.cut).toBe(false);
  });

  it('a pause shorter than the setting does not split "Murugan anna… 240… kadan"', () => {
    const ev = run(createSegmenter(), [[0.9, 600], [0.05, 600], [0.9, 500], [0.05, 700], [0.9, 400], [0.05, 1000]]);
    expect(ev.map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('the short setting answers sooner, the long one waits for slow speakers', () => {
    const runs = [[0.9, 600], [0.05, 1000], [0.9, 600], [0.05, 1600]];
    expect(run(createSegmenter({ endSilenceMs: END_SILENCE.short }), runs).filter((e) => e.type === 'end')).toHaveLength(2);
    expect(run(createSegmenter({ endSilenceMs: END_SILENCE.long }), runs).filter((e) => e.type === 'end')).toHaveLength(1);
  });

  it('a soft, uncertain stretch inside a word neither ends the sentence nor counts as speech', () => {
    const ev = run(createSegmenter(), [[0.9, 500], [0.42, 1500], [0.9, 300], [0.05, 1000]]);
    expect(ev.map((e) => e.type)).toEqual(['start', 'end']);
    expect(ev[1].speechMs).toBeLessThan(900);
  });

  it('a cough or a knock is a misfire, not a sentence', () => {
    expect(run(createSegmenter(), [[0.05, 500], [0.9, 130], [0.05, 1200]]).map((e) => e.type)).toEqual(['start', 'misfire']);
  });

  it('someone who never stops is cut at 15 s', () => {
    const ev = run(createSegmenter(), [[0.9, 16000]]);
    expect(ev[1]).toMatchObject({ type: 'end', cut: true });
  });

  it('reset forgets a half-heard sentence', () => {
    const seg = createSegmenter();
    run(seg, [[0.9, 500]]);
    expect(seg.speaking).toBe(true);
    seg.reset();
    expect(seg.speaking).toBe(false);
    expect(run(seg, [[0.05, 1500]])).toEqual([]);
  });
});

describe('loudness detector (when the AI detector cannot load)', () => {
  it('silence scores 0, a voice well above the room scores high', () => {
    const d = createLoudnessDetector();
    for (let i = 0; i < 30; i++) expect(d.prob(frameOf(0))).toBe(0);
    expect(d.prob(frameOf(0.1))).toBeGreaterThan(0.9);
  });

  it('a long sentence does not become the new silence', () => {
    const d = createLoudnessDetector();
    for (let i = 0; i < 30; i++) d.prob(frameOf(0.002));
    let p = 1;
    for (let i = 0; i < ms(4000); i++) p = d.prob(frameOf(0.05));
    expect(p).toBeGreaterThan(0.5);
  });
});

describe('hands-free ignores the shop\'s chatter', () => {
  const act = (parse, opts) => handsFreeShouldAct({ customer_name: null, amount: null, ...parse }, opts);
  it.each([
    [{ intent: 'credit', customer_name: 'murugan', amount: 240 }, true],
    [{ intent: 'payment', amount: 500 }, true], // asks "who?"
    [{ intent: 'credit' }, false], // "kadan" in passing
    [{ intent: 'query_balance', customer_name: 'selvi' }, true],
    [{ intent: 'query_balance' }, false],
    [{ intent: 'query_today' }, true],
    [{ intent: 'query_top' }, true],
    [{ intent: 'confirm_yes' }, false], // "seri"
    [{ intent: 'confirm_no' }, false], // a customer's "illa" must never undo an entry
    [{ intent: 'undo_last' }, false],
    [{ intent: 'unclear' }, false],
  ])('%o -> %s', (parse, expected) => expect(act(parse)).toBe(expected));

  it('"venaam" right after the save chime is the owner taking it back', () => {
    expect(act({ intent: 'confirm_no' }, { justSaved: true })).toBe(true);
    expect(act({ intent: 'undo_last' }, { justSaved: true })).toBe(true);
  });

  it('mid-conversation every answer counts', () => {
    expect(act({ intent: 'unclear' }, { engaged: true })).toBe(true);
    expect(act({ intent: 'confirm_yes' }, { engaged: true })).toBe(true);
  });
});

describe('the hands-free listener', () => {
  // A stand-in for the Recorder: hands over 16 kHz chunks like the microphone would.
  const fakeRecorder = () => {
    const r = { onChunk: null, listen: vi.fn(async (onLevel, onChunk) => { r.onChunk = onChunk; }), endListen: vi.fn(() => { r.onChunk = null; }) };
    r.play = (runs) => {
      for (const [amp, dur] of runs) {
        const n = Math.round((dur / 1000) * RATE);
        const pcm = Float32Array.from({ length: n }, (_, i) => rnd() * 0.004 + amp * Math.sin((2 * Math.PI * 180 * i) / RATE));
        for (let i = 0; i < n; i += 2048) r.onChunk?.(pcm.slice(i, i + 2048)); // the capture worklet's chunk size
      }
    };
    return r;
  };
  const listener = async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // no Silero worker in tests: loudness is used
    const rec = fakeRecorder();
    const got = [];
    const hf = new HandsFree(rec, {
      onStart: () => got.push('start'),
      onUtterance: (u) => got.push(u),
      onMisfire: () => got.push('misfire'),
    });
    await hf.start();
    hf.deafUntil = 0;
    return { hf, rec, got };
  };

  it('hears a sentence in a stream of microphone chunks', async () => {
    const { rec, got } = await listener();
    rec.play([[0, 1000], [0.1, 1200], [0, 1500]]);
    expect(got[0]).toBe('start');
    expect(got[1].pcm.length / RATE).toBeGreaterThan(1.2);
    expect(got[1].noiseDb).toBeLessThan(-50);
  });

  it('is deaf while the app speaks, and for a moment after', async () => {
    const { hf, rec, got } = await listener();
    hf.pause(); // the reply is playing
    rec.play([[0.1, 1500], [0, 1200]]);
    expect(got).toEqual([]);
    hf.resume(5000);
    rec.play([[0.1, 1000], [0, 1200]]);
    expect(got).toEqual([]); // the tail of its own voice
    hf.deafUntil = 0;
    rec.play([[0.1, 1000], [0, 1200]]);
    expect(got[0]).toBe('start');
  });

  it('pauses nest: thinking, then speaking, then listening again', async () => {
    const { hf } = await listener();
    hf.pause();
    hf.pause();
    hf.resume();
    expect(hf.listening).toBe(false);
    hf.resume();
    expect(hf.listening).toBe(true);
  });

  it('stop closes the microphone', async () => {
    const { hf, rec } = await listener();
    hf.stop();
    expect(rec.endListen).toHaveBeenCalled();
    expect(hf.listening).toBe(false);
  });
});

describe('judging a hands-free clip', () => {
  it('uses the room\'s noise level, since the clip is cut close to the words', () => {
    // 2 s of steady speech with almost no pause: its own quietest moment is still speech.
    const pcm = Float32Array.from({ length: 2 * RATE }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 180 * i) / RATE) * (0.8 + 0.2 * Math.sin(i / 900)));
    expect(analyse(pcm).verdict).toBe('noisy');
    expect(analyse(pcm, RATE, { noiseDb: -62 }).verdict).toBe('ok');
  });
});
