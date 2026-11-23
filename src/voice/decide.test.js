import { describe, it, expect } from 'vitest';
import { decide, afterCustomerAdded, EMPTY_CONVO } from './decide.js';
import { parseLocal } from '../lib/localParser.js';
import { buildNameIndex } from '../lib/names.js';
import { mergeParses } from './nlu.js';

const customers = [
  { id: 'c1', name: 'Murugan', name_ta: 'முருகன் அண்ணா', honorific: 'anna' },
  { id: 'c3', name: 'Ravi', name_ta: 'ரவி' },
  { id: 'c5', name: 'Murugesan', name_ta: 'முருகேசன்' },
];
const e = (id, customer_id, type, amount) => ({ id, customer_id, type, amount, status: 'confirmed', deleted_at: null, created_at: new Date().toISOString() });
const entries = [e('e1', 'c1', 'credit', 1000), e('e2', 'c1', 'payment', 100), e('e3', 'c3', 'credit', 300)];

const ctx = (extra = {}) => ({
  customers,
  aliases: [],
  entries,
  index: buildNameIndex(customers, []),
  replyLang: 'auto',
  lastUndoable: () => entries[2],
  justSaved: null,
  ...extra,
});
const say = (text, convo = EMPTY_CONVO, c = ctx()) =>
  decide({ ...parseLocal(text, { index: c.index }), transcript: text }, convo, c);
const tap = (value, convo, c = ctx()) =>
  decide(value.startsWith('id:') ? { intent: 'unclear', choiceId: value.slice(3) }
    : value === 'new' ? { intent: 'unclear', choiceId: 'new' }
    : { intent: value === 'yes' ? 'confirm_yes' : 'confirm_no', yes_no: value }, convo, c);

describe('spoken replies from the spec', () => {
  it('credit: confirms aloud with the new total, then auto-saves', () => {
    const a = say('Murugan anna, 240 rupees, arisi and oil, kadan');
    expect(a.kind).toBe('pending_save');
    expect(a.reply.show).toBe('Murugan anna, 240 roobaai kadan. Mottham baaki 1,140.');
    expect(a.reply.say).toContain('முருகன் அண்ணா');
    expect(a.entry).toMatchObject({ customer_id: 'c1', type: 'credit', amount: 240, items: ['arisi', 'oil'] });
  });
  it('payment', () => {
    expect(say('Murugan anna 100 kuduthaar').reply.show).toBe('Murugan anna 100 kuduthaar. Innum baaki 800.');
  });
  it('balance query', () => {
    expect(say('Murugan evlo baaki?').reply.show).toBe('Murugan anna-kku baaki 900.');
  });
  it('English in -> English out', () => {
    expect(say('Ravi paid 100').reply.show).toBe('Ravi paid 100. Still pending 200.');
  });
  it('amount unclear -> asks, then completes from a Tamil number answer', () => {
    const a = say('Ravi kadan');
    expect(a.reply.show).toBe('Evlo roobaai? Thirumba sollunga.');
    const b = say('nootri irubathu', a.convo);
    expect(b.kind).toBe('pending_save');
    expect(b.entry).toMatchObject({ customer_id: 'c3', amount: 120 });
  });
  it('similar names -> asks which, learns the alias from the answer', () => {
    const a = say('Murugasan 300 kadan');
    expect(a.kind).toBe('ask');
    expect(a.reply.show).toBe('Murugesan-va, Murugan anna-a?');
    const b = tap('id:c1', a.convo);
    expect(b.kind).toBe('pending_save');
    expect(b.entry.customer_id).toBe('c1');
    expect(b.aliases).toEqual([{ customerId: 'c1', spoken: 'murugasan' }]);
  });
  it('new customer -> offers to save, then continues the entry', () => {
    const a = say('Ganesh 300 kadan');
    expect(a.reply.show).toBe('Ganesh pudhu customer-a? Save pannattuma?');
    const b = say('aamaa', a.convo);
    expect(b.kind).toBe('add_customer');
    expect(b.customer.name).toBe('Ganesh');
    const ganesh = { id: 'c9', name: 'Ganesh' };
    const c = afterCustomerAdded(b.pending, ganesh, ctx({ customers: [...customers, ganesh] }));
    expect(c.kind).toBe('pending_save');
    expect(c.reply.show).toBe('Seri, Ganesh save pannitten. Ganesh, 300 roobaai kadan. Mottham baaki 300.');
  });
  it('undo', () => {
    const a = say('Last-a pottadha cancel pannu');
    expect(a).toMatchObject({ kind: 'undo', entryId: 'e3' });
    expect(a.reply.show).toBe('Seri, cancel pannitten.');
  });
  it('large amount -> confirm first, yes saves', () => {
    const a = say('Ravi 2500 kadan');
    expect(a.reply.show).toBe('Ravi, 2,500-nu sonneenga, sariya?');
    const b = say('sari', a.convo);
    expect(b.kind).toBe('save');
    expect(b.entry.amount).toBe(2500);
  });
  it('large amount -> "no" asks for the amount again', () => {
    const a = say('Ravi 2500 kadan');
    const b = say('illa', a.convo);
    expect(b.reply.show).toBe('Evlo roobaai? Thirumba sollunga.');
    const c = say('150', b.convo);
    expect(c.kind).toBe('pending_save');
    expect(c.entry.amount).toBe(150);
  });
  it('low confidence (no keyword) -> confirm aloud', () => {
    expect(say('Ravi 150').reply.show).toBe('Ravi, 150-nu sonneenga, sariya?');
  });
  it('two failures -> type it + manual form', () => {
    const a = say('hmm blah');
    expect(a.reply.show).toBe('Puriyala, thirumba sollunga.');
    const b = say('mmm', a.convo);
    expect(b.kind).toBe('manual');
    expect(b.reply.show).toBe('Puriyala. Screen-la type pannunga.');
  });
  it('venaam while confirming cancels', () => {
    const a = say('Ravi 2500 kadan');
    expect(say('venaam cancel', a.convo).reply.show).toBe('Seri, save pannala.');
  });
  it('who owes most', () => {
    expect(say('yaaru adhigam baaki').reply.show).toBe('Adhiga baaki: Murugan anna 900, Ravi 300.');
  });
});

describe('LLM + grammar merge', () => {
  it('digits disagreeing with the LLM force a confirmation', () => {
    const local = parseLocal('Ravi 240 kadan', { index: buildNameIndex(customers) });
    const merged = mergeParses({ intent: 'credit', customer_name: 'Ravi', customer_id: 'c3', amount: 2400, items: [], yes_no: null, language: 'ta', confidence: 0.95 }, local);
    expect(merged.confidence).toBeLessThan(0.8);
  });
  it('falls back to the grammar when the LLM is unsure', () => {
    const local = parseLocal('Ravi 240 kadan', { index: buildNameIndex(customers) });
    const merged = mergeParses({ intent: 'unclear', customer_name: null, customer_id: null, amount: null, items: [], yes_no: null, language: 'ta', confidence: 0.2 }, local);
    expect(merged).toMatchObject({ intent: 'credit', amount: 240, source: 'local' });
  });
});
