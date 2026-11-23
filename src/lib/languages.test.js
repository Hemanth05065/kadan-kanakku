import { describe, it, expect } from 'vitest';
import { parseNumber } from './numbers.js';
import { transliterate, skeleton, scriptOf } from './translit.js';
import { buildNameIndex, resolveName } from './names.js';
import { parseLocal } from './localParser.js';
import { PACKS, NUMBER_BY_LANG } from '../i18n/index.js';
import { decide, EMPTY_CONVO } from '../voice/decide.js';

const customers = [
  { id: 'c1', name: 'Murugan', name_ta: 'முருகன் அண்ணா', honorific: 'anna' },
  { id: 'c3', name: 'Ravi', name_ta: 'ரவி' },
  { id: 'c7', name: 'Ramesh', name_ta: 'रमेश' },
  { id: 'c8', name: 'Srinivas', name_ta: 'శ్రీనివాస్', honorific: 'garu' },
];
const index = buildNameIndex(customers);

describe('scripts', () => {
  it('detects and transliterates Devanagari and Telugu', () => {
    expect(scriptOf('रवि')).toBe('hi');
    expect(scriptOf('రవి')).toBe('te');
    expect(transliterate('रवि')).toBe('ravi');
    expect(transliterate('राम')).toBe('raam'); // Hindi drops the final inherent vowel
    expect(transliterate('రవి')).toBe('ravi');
    expect(skeleton('रमेश')).toBe(skeleton('Ramesh'));
    expect(skeleton('శ్రీనివాస్')).toBe(skeleton('Srinivas'));
  });
  it('treats composed and decomposed Tamil the same', () => {
    expect(transliterate('கொடு')).toBe(transliterate('கொடு'.normalize('NFD')));
  });
  it('matches names across scripts', () => {
    expect(resolveName('रमेश भैया', index)).toMatchObject({ status: 'match', customer: { id: 'c7' } });
    expect(resolveName('శ్రీనివాస్ గారు', index)).toMatchObject({ status: 'match', customer: { id: 'c8' } });
  });
});

describe('Hindi numbers', () => {
  it.each([
    ['do sau', 200], ['दो सौ पचास', 250], ['dedh sau', 150], ['dhai sau', 250], ['saade teen sau', 350],
    ['paune do sau', 175], ['sawa sau', 125], ['dedh hazaar', 1500], ['pachchis', 25], ['saath', 60], ['saat sau', 700],
    ['ek hazaar paanch sau', 1500], ['चालीस', 40], ['ढाई हज़ार', 2500],
  ])('%s -> %d', (text, value) => expect(parseNumber(text, 'hi')).toBe(value));

  it('"do" (give) is not a number unless next to one', () => {
    const r = parseLocal('Ravi ka 300 udhaar likh do', { index });
    expect(r).toMatchObject({ intent: 'credit', customer_id: 'c3', amount: 300, language: 'hi' });
  });
});

describe('Telugu numbers', () => {
  it.each([
    ['rendu vandala yabhai', 250], ['vanda iravai', 120], ['iravai aidu', 25], ['edu', 7], ['ఐదు వందలు', 500],
    ['రెండు వేలు', 2000], ['muppai', 30],
  ])('%s -> %d', (text, value) => expect(parseNumber(text, 'te')).toBe(value));

  it('the same sound can mean different numbers per language', () => {
    expect(parseNumber('edu', 'te')).toBe(7);
    expect(parseNumber('ettu', 'ta')).toBe(8);
  });
});

describe('parsing in Hindi and Telugu', () => {
  const p = (text) => parseLocal(text, { index });
  it('Hindi', () => {
    expect(p('Ramesh bhaiya ne 200 diye')).toMatchObject({ intent: 'payment', customer_id: 'c7', amount: 200, language: 'hi' });
    expect(p('Ravi ka kitna baaki hai')).toMatchObject({ intent: 'query_balance', customer_id: 'c3', language: 'hi' });
    expect(p('रमेश दो सौ उधार')).toMatchObject({ intent: 'credit', customer_id: 'c7', amount: 200 });
  });
  it('Telugu', () => {
    expect(p('Srinivas garu 100 ichcharu')).toMatchObject({ intent: 'payment', customer_id: 'c8', amount: 100, language: 'te' });
    expect(p('Ravi rendu vandala appu')).toMatchObject({ intent: 'credit', customer_id: 'c3', amount: 200, language: 'te' });
    expect(p('శ్రీనివాస్ గారు బాకీ ఎంత')).toMatchObject({ intent: 'query_balance', customer_id: 'c8' });
  });
  it('replies in the language spoken', () => {
    const ctx = { customers, aliases: [], entries: [], index, replyLang: 'auto', lastUndoable: () => null };
    const hi = decide({ ...p('Ramesh 200 udhaar'), transcript: 'x' }, EMPTY_CONVO, ctx);
    expect(hi.reply.show).toBe('Ramesh, 200 rupaye udhaar. Kul baaki 200.');
    expect(hi.reply.say).toContain('रमेश');
    const te = decide({ ...p('Srinivas garu 100 appu'), transcript: 'x' }, EMPTY_CONVO, ctx);
    expect(te.reply.show).toBe('Srinivas garu, 100 rupayalu appu. Motham baaki 100.');
    expect(te.reply.say).toContain('శ్రీనివాస్');
  });
});

describe("today's summary", () => {
  const now = new Date().toISOString();
  const entries = [
    { id: 'e1', customer_id: 'c1', type: 'credit', amount: 300, status: 'confirmed', created_at: now },
    { id: 'e2', customer_id: 'c3', type: 'payment', amount: 100, status: 'confirmed', created_at: now },
    { id: 'e3', customer_id: 'c3', type: 'credit', amount: 500, status: 'confirmed', created_at: '2020-01-01T10:00:00Z' },
  ];
  const ctx = { customers, aliases: [], entries, index, replyLang: 'auto', lastUndoable: () => null };
  it.each([
    ['Indru kanakku evlo?', 'Indru 300 kadan, 100 varavu. Mottham baaki 700.'],
    ["What's today's summary", 'Today 300 credit, 100 received. Total pending 700.'],
    ['aaj ka hisaab', 'Aaj 300 udhaar, 100 jama. Kul baaki 700.'],
    ['ee roju lekka entha', 'Ee roju 300 appu, 100 vachindi. Motham baaki 700.'],
  ])('%s', (text, expected) => {
    const parse = parseLocal(text, { index });
    expect(parse.intent).toBe('query_today');
    expect(decide({ ...parse, transcript: text }, EMPTY_CONVO, ctx).reply.show).toBe(expected);
  });
});

describe('language packs are complete', () => {
  const keys = Object.keys(PACKS.en.replies);
  it.each(Object.keys(PACKS))('%s has every spoken reply', (code) => {
    expect(keys.filter((k) => !PACKS[code].replies[k])).toEqual([]);
  });
  it.each(Object.keys(PACKS))('%s number words do not collide inside the language', (code) => {
    const seen = new Map();
    const clashes = [];
    for (const [value, kind, ...spellings] of PACKS[code].numbers) {
      for (const s of spellings) {
        const sk = skeleton(s);
        if (seen.has(sk) && seen.get(sk) !== value) clashes.push(`${s} (${value}) vs ${seen.get(sk)}`);
        else seen.set(sk, value);
      }
    }
    // Clashes are allowed only where the exact spelling still tells them apart (saat / saath).
    const unresolved = clashes.filter((c) => !/saath|साठ|saat|सात/.test(c));
    expect(unresolved).toEqual([]);
    expect(NUMBER_BY_LANG[code].size).toBeGreaterThan(0);
  });
});
