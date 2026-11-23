import { describe, it, expect } from 'vitest';
import { numberClips, planReply, processClip, missingFor, scriptItems, nameKeyOf, nameClipKey, LEAD_MS, TAIL_MS } from './voicePack.js';
import { decide, afterCustomerAdded, EMPTY_CONVO } from './decide.js';
import { chooseVoice } from './tts.js';
import { reply, setReplyVariety } from '../i18n/index.js';
import { parseLocal } from '../lib/localParser.js';
import { buildNameIndex } from '../lib/names.js';

const SCRIPT = new Set(scriptItems('ta').map((i) => i.key));
const all = (k) => SCRIPT.has(k) || k.startsWith('name:');
const clipsOf = (segs) => segs.filter((s) => s.clip).map((s) => s.clip);

describe('Tamil numbers from recorded words', () => {
  it.each([
    [240, ['h200', 'n40']], // irunoothi naappadhu
    [1140, ['aayirathi', 'h100', 'n40']], // aayirathi noothi naappadhu
    [2500, ['n2', 'aayirathi', 'n500']], // rendu aayirathi ainooru
    [100, ['n100']],
    [105, ['h100', 'n5']],
    [1000, ['aayiram']],
    [2000, ['n2', 'aayiram']],
    [25000, ['t20', 'n5', 'aayiram']],
    [100000, ['oru', 'latcham']],
    [150000, ['oru', 'latchathi', 'n50', 'aayiram']],
    [0, ['n0']],
    [19, ['n19']],
    [99, ['t90', 'n9']],
    [999, ['h900', 't90', 'n9']],
  ])('%i', (n, keys) => expect(numberClips(n)).toEqual(keys));

  it('fractions, negatives and crores are left to the phone voice', () => {
    expect(numberClips(12.5)).toBeNull();
    expect(numberClips(-5)).toBeNull();
    expect(numberClips(1e7)).toBeNull();
  });

  it('every amount up to 10 lakh uses only words in the recording script', () => {
    const used = new Set();
    for (let n = 0; n < 1e6; n += n < 3000 ? 1 : 997) numberClips(n).forEach((k) => used.add(k));
    expect([...used].filter((k) => !SCRIPT.has(k))).toEqual([]);
  });
});

describe('replies stitched from clips', () => {
  const credit = reply('credit_saved', 'ta', { name: 'Murugan anna', nameKey: 'murugan anna', amt: '240', amtN: 240, total: '1,140', totalN: 1140 });

  it('"Murugan anna, 240 roobaai kadan. Mottham baaki 1,140."', () => {
    expect(clipsOf(planReply(credit, all))).toEqual(['name:murugan anna', 'h200', 'n40', 'roobaai_kadan', 'mottham_baaki', 'aayirathi', 'h100', 'n40']);
  });

  it('words of one number are pulled together, sentences get a pause', () => {
    const segs = planReply(credit, all);
    const n40 = segs.find((s) => s.clip === 'n40');
    expect(n40.join).toBeLessThan(0);
    expect(-n40.join).toBeLessThan(LEAD_MS + TAIL_MS);
    expect(segs.some((s) => s.gap >= 200)).toBe(true);
  });

  it('a name not recorded yet is left out, not read by a robot', () => {
    const has = (k) => all(k) && k !== 'name:murugan anna';
    expect(clipsOf(planReply(credit, has))[0]).toBe('h200');
  });

  it('a missing word means the whole reply falls back to another voice', () => {
    expect(planReply(credit, (k) => all(k) && k !== 'roobaai_kadan')).toBeNull();
    expect(missingFor(credit, (k) => k !== 'roobaai_kadan' && k !== 'n40')).toEqual(['n40', 'roobaai_kadan']);
  });

  it('"which one?" names both people, or asks for a tap when names are not recorded', () => {
    const r = reply('ask_which', 'ta', { a: 'Murugan anna', aKey: 'murugan anna', b: 'Murugesan', bKey: 'murugesan' });
    expect(clipsOf(planReply(r, all))).toEqual(['yaaru', 'name:murugan anna', 'illa_or', 'name:murugesan']);
    expect(clipsOf(planReply(r, (k) => SCRIPT.has(k)))).toEqual(['yaaru', 'tap_which']);
  });

  it('"who owes most" needs every name', () => {
    const r = reply('top', 'ta', { list: 'x', listSay: 'x', items: [{ nameKey: 'murugan anna', n: 900 }, { nameKey: 'ravi', n: 300 }] });
    expect(clipsOf(planReply(r, all))).toEqual(['adhiga_baaki', 'name:murugan anna', 'n900', 'name:ravi', 'n300']);
    expect(planReply(r, (k) => all(k) && k !== 'name:ravi')).toBeNull();
  });

  it('other languages are not recorded: falls back', () => {
    expect(planReply(reply('credit_saved', 'en', credit.params), all)).toBeNull();
  });

  it('a reply from the decision engine carries what the voice needs', () => {
    setReplyVariety(false);
    const customers = [{ id: 'c1', name: 'Murugan', name_ta: 'முருகன் அண்ணா', honorific: 'anna' }];
    const ctx = { customers, aliases: [], entries: [], index: buildNameIndex(customers, []), replyLang: 'auto', lastUndoable: () => null, justSaved: null };
    const text = 'Murugan anna 240 kadan';
    const a = decide({ ...parseLocal(text, { index: ctx.index }), transcript: text }, EMPTY_CONVO, ctx);
    expect(a.reply.params).toMatchObject({ nameKey: 'murugan anna', amtN: 240, totalN: 240 });
    expect(clipsOf(planReply(a.reply, all))).toEqual(['name:murugan anna', 'h200', 'n40', 'roobaai_kadan', 'mottham_baaki', 'h200', 'n40']);

    // New customer, then the entry: both sentences, one after the other.
    const p = { intent: 'credit', customer_name: 'ganesh', amount: 150, items: [], confidence: 0.9, lang: 'ta', transcripts: [], clarified: false, confirmed: false };
    const ganesh = { id: 'c9', name: 'Ganesh' };
    const added = afterCustomerAdded(p, ganesh, { ...ctx, customers: [...customers, ganesh] });
    expect(clipsOf(planReply(added.reply, all))).toEqual(['seri', 'name:ganesh', 'save_pannitten', 'name:ganesh', 'h100', 'n50', 'roobaai_kadan', 'mottham_baaki', 'h100', 'n50']);
    setReplyVariety(true);
  });
});

describe('wording variety', () => {
  it('short replies take turns between wordings, starting with the spec one', () => {
    setReplyVariety(true);
    const a = reply('undo_done', 'ta');
    const b = reply('undo_done', 'ta');
    expect(a.show).toBe('Seri, cancel pannitten.');
    expect(b.show).not.toBe(a.show);
    expect(clipsOf(planReply(a, all))).toEqual(['undo_done']);
    expect(clipsOf(planReply(b, all))).toEqual(['undo_done_2']);
    expect(reply('undo_done', 'ta').show).toBe(a.show);
  });

  it('can be turned off for tests that need the exact wording', () => {
    setReplyVariety(false);
    expect(reply('ok', 'ta').show).toBe(reply('ok', 'ta').show);
    setReplyVariety(true);
  });
});

describe('cleaning up a recorded word', () => {
  const RATE = 24000;
  const make = (parts) => {
    const len = parts.reduce((s, p) => s + Math.round((p.ms / 1000) * RATE), 0);
    const out = new Float32Array(len);
    let o = 0;
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0004;
    for (const p of parts) {
      const n = Math.round((p.ms / 1000) * RATE);
      for (let i = 0; i < n; i++) {
        const sine = Math.sin((2 * Math.PI * 220 * i) / RATE);
        out[o + i] = noise() + (p.amp ? (p.square ? Math.sign(sine) : sine) * p.amp : 0);
      }
      o += n;
    }
    return out;
  };

  it('trims silence, keeps a short lead and tail, brings it to a common level', () => {
    const out = processClip(make([{ ms: 500 }, { ms: 400, amp: 0.05 }, { ms: 600 }]), RATE);
    expect(out.verdict).toBe('ok');
    expect(out.ms).toBeGreaterThan(400 + LEAD_MS + TAIL_MS - 30);
    expect(out.ms).toBeLessThan(400 + LEAD_MS + TAIL_MS + 30);
    let peak = 0;
    for (const v of out.pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.12); // a -20 dBFS sine peaks at 0.14
    expect(peak).toBeLessThan(0.9);
    expect(Math.abs(out.pcm[0])).toBeLessThan(1e-6); // faded edges: no clicks when joined
    expect(Math.abs(out.pcm[out.pcm.length - 1])).toBeLessThan(1e-6);
  });

  it('refuses silence, whispers and distortion', () => {
    expect(processClip(make([{ ms: 800 }]), RATE).verdict).toBe('short');
    expect(processClip(make([{ ms: 300 }, { ms: 60, amp: 0.2 }, { ms: 300 }]), RATE).verdict).toBe('short');
    expect(processClip(make([{ ms: 300 }, { ms: 400, amp: 0.004 }, { ms: 300 }]), RATE).verdict).toBe('quiet');
    expect(processClip(make([{ ms: 300 }, { ms: 400, amp: 1, square: true }, { ms: 300 }]), RATE).verdict).toBe('loud');
  });
});

describe('names', () => {
  it('a name clip is keyed by how the shop says it', () => {
    expect(nameKeyOf({ name: 'Murugan', honorific: 'anna' })).toBe('murugan anna');
    expect(nameClipKey('  Selvi   Akka ')).toBe('name:selvi akka');
    expect(nameClipKey({ name: '' })).toBeNull();
  });
});

describe('choosing a phone voice', () => {
  const v = (name, lang) => ({ name, lang });
  const british = [v('Microsoft George - English (United Kingdom)', 'en-GB'), v('Microsoft Hazel - English (United Kingdom)', 'en-GB')];

  it('never reads Tamil with a British voice', () => {
    expect(chooseVoice(british, 'ta')).toBeNull();
    expect(chooseVoice(british, 'en', { indianOnly: true })).toBeNull();
    expect(chooseVoice(british, 'en').lang).toBe('en-GB'); // English replies are fine
  });

  it('prefers natural voices, and Indian English', () => {
    const list = [
      ...british,
      v('Microsoft Valluvar - Tamil (India)', 'ta-IN'),
      v('Microsoft Pallavi Online (Natural) - Tamil (India)', 'ta-IN'),
      v('Microsoft Heera - English (India)', 'en-IN'),
    ];
    expect(chooseVoice(list, 'ta').name).toContain('Pallavi');
    expect(chooseVoice(list, 'en').name).toContain('Heera');
  });

  it('understands Android language tags', () => {
    expect(chooseVoice([v('Tamil India', 'ta_IN')], 'ta').name).toBe('Tamil India');
  });
});
