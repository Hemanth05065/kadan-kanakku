import { describe, it, expect } from 'vitest';
import { collectionList } from './collect.js';
import { parseLocal } from './localParser.js';
import { buildNameIndex } from './names.js';
import { generateDemo } from './seed.js';
import { collectAnswer, decide, EMPTY_CONVO } from '../voice/decide.js';
import { planReply, scriptItems } from '../voice/voicePack.js';
import { handsFreeShouldAct } from '../voice/vad.js';
import { setReplyVariety } from '../i18n/index.js';

const NOW = new Date('2026-11-23T10:00:00');
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();
let n = 0;
const entry = (customer_id, type, amount, days) => ({ id: `e${++n}`, customer_id, type, amount, status: 'confirmed', deleted_at: null, created_at: ago(days) });
const cust = (id, name, extra = {}) => ({ id, name, honorific: null, deleted_at: null, last_reminded_at: null, ...extra });

describe('who to collect from today', () => {
  const customers = [
    cust('selvi', 'Selvi', { honorific: 'akka' }),
    cust('ravi', 'Ravi'),
    cust('kumar', 'Kumar'),
    cust('ganesh', 'Ganesh'),
    cust('tiny', 'Tiny'),
  ];
  const entries = [
    entry('selvi', 'credit', 3000, 40), entry('selvi', 'payment', 850, 20), entry('selvi', 'credit', 200, 2), // 2,350, 20 days, still buying
    entry('ravi', 'credit', 600, 50), // never paid, 50 days
    entry('kumar', 'credit', 5000, 30), entry('kumar', 'payment', 1000, 3), // paid this week: left alone
    entry('ganesh', 'credit', 900, 15), entry('ganesh', 'payment', 100, 12),
    entry('tiny', 'credit', 60, 40), // too small to chase
  ];

  it('ranks by how much and how long, and says why', () => {
    const list = collectionList(customers, entries, NOW);
    expect(list.map((c) => c.id)).toEqual(['selvi', 'ravi', 'ganesh']);
    expect(list[0]).toMatchObject({ balance: 2350, daysUnpaid: 20, neverPaid: false, boughtThisWeek: 200 });
    expect(list[0].reasons).toEqual([{ k: 'r_no_payment', n: 20 }, { k: 'r_still_buying', n: 200 }]);
    expect(list[1].reasons).toEqual([{ k: 'r_never_paid', n: 50 }]);
  });

  it('leaves alone anyone paying this week, tiny balances and people reminded today or yesterday', () => {
    const reminded = customers.map((c) => (c.id === 'selvi' ? { ...c, last_reminded_at: ago(1) } : c));
    const ids = collectionList(reminded, entries, NOW).map((c) => c.id);
    expect(ids).not.toContain('kumar');
    expect(ids).not.toContain('tiny');
    expect(ids).not.toContain('selvi');
  });

  it('someone reminded 3 days ago counts half, but stays on the list', () => {
    const before = collectionList(customers, entries, NOW).find((c) => c.id === 'selvi');
    const reminded = customers.map((c) => (c.id === 'selvi' ? { ...c, last_reminded_at: ago(3) } : c));
    const after = collectionList(reminded, entries, NOW).find((c) => c.id === 'selvi');
    expect(after.score).toBe(Math.round(before.score / 2));
    expect(after.reasons).toContainEqual({ k: 'r_reminded', n: 3 });
    // reminded long ago: said, but no longer softened
    const old = customers.map((c) => (c.id === 'selvi' ? { ...c, last_reminded_at: ago(10) } : c));
    expect(collectionList(old, entries, NOW).find((c) => c.id === 'selvi').score).toBe(before.score);
  });

  it('deleted entries and customers do not count', () => {
    const del = entries.map((e) => (e.customer_id === 'ravi' ? { ...e, deleted_at: ago(1) } : e));
    expect(collectionList(customers, del, NOW).map((c) => c.id)).not.toContain('ravi');
    const gone = customers.map((c) => (c.id === 'selvi' ? { ...c, deleted_at: ago(1) } : c));
    expect(collectionList(gone, entries, NOW).map((c) => c.id)).not.toContain('selvi');
  });

  it('in the demo shop, the weekly payers are left alone and the notebook carry-over is chased', () => {
    const demo = generateDemo('shop', NOW);
    const list = collectionList(demo.customers, demo.entries, NOW);
    expect(list.map((c) => c.name)).toEqual(['Murugesan']);
    expect(list[0]).toMatchObject({ neverPaid: true });
    expect(list[0].daysUnpaid).toBeGreaterThan(40);
  });
});

describe('asking for it by voice', () => {
  const customers = [cust('m', 'Murugan', { honorific: 'anna', name_ta: 'முருகன் அண்ணா' }), cust('s', 'Selvi', { honorific: 'akka' })];
  const index = buildNameIndex(customers, []);
  const parse = (text) => parseLocal(text, { index });

  it.each([
    ['Indru yaar kitta vasool pannanum?', 'query_collect'],
    ['இன்னைக்கு யார் கிட்ட வசூல்?', 'query_collect'],
    ['vasool list sollu', 'query_collect'],
    ['Who should I collect from today?', 'query_collect'],
    ['Aaj kisse vasooli karni hai?', 'query_collect'],
    ['Ee roju evari daggara vasool cheyyali?', 'query_collect'],
    ['Murugan anna kitta vasool pannanum', 'query_balance'], // one person: their balance
    ['Murugan anna kitta 500 vasool aachu', 'payment'], // money collected
  ])('"%s" -> %s', (text, intent) => expect(parse(text).intent).toBe(intent));

  it('"500 vasool aachu" is a payment, and "aachu" is not taken for a name', () => {
    expect(parse('Murugan anna kitta 500 vasool aachu')).toMatchObject({ intent: 'payment', amount: 500, customer_id: 'm' });
  });

  it('the answer names who to ask, most urgent first, in the shop voice too', () => {
    setReplyVariety(false);
    const entries = [entry('s', 'credit', 2150, 30), entry('m', 'credit', 900, 10)];
    const ctx = { customers, entries, aliases: [], index, replyLang: 'auto', lastUndoable: () => null, justSaved: null };
    const a = decide({ ...parse('Indru yaar kitta vasool pannanum'), transcript: 'x' }, EMPTY_CONVO, ctx);
    expect(a.kind).toBe('answer');
    expect(a.reply.show).toBe('Indru vasool: Selvi akka 2,150, Murugan anna 900.');
    const script = new Set(scriptItems('ta').map((i) => i.key));
    const segs = planReply(a.reply, (k) => script.has(k) || k.startsWith('name:'));
    expect(segs.filter((s) => s.clip).map((s) => s.clip)).toEqual(['innaikku_vasool', 'name:selvi akka', 'n2', 'aayirathi', 'h100', 'n50', 'name:murugan anna', 'n900']);
    expect(collectAnswer({ ...ctx, entries: [] }, 'en').reply.show).toBe('Nobody to collect from today.');
    setReplyVariety(true);
  });

  it('hands-free answers it even outside a conversation', () => {
    expect(handsFreeShouldAct({ intent: 'query_collect' })).toBe(true);
  });
});
