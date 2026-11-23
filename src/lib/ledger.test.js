import { describe, it, expect } from 'vitest';
import { statement, overdueCustomers, monthRange, balances, historyWithRunningBalance } from './ledger.js';
import { generateDemo } from './seed.js';
import { statementText } from './whatsapp.js';

const e = (id, customer_id, type, amount, created_at, extra = {}) =>
  ({ id, customer_id, type, amount, created_at, status: 'confirmed', deleted_at: null, items: [], ...extra });

const entries = [
  e('1', 'a', 'credit', 500, '2026-10-05T10:00:00'),
  e('2', 'a', 'payment', 200, '2026-10-20T10:00:00'),
  e('3', 'a', 'credit', 240, '2026-11-03T10:00:00', { items: ['arisi', 'oil'] }),
  e('4', 'a', 'payment', 100, '2026-11-10T10:00:00'),
  e('5', 'a', 'credit', 999, '2026-11-11T10:00:00', { deleted_at: '2026-11-11T10:01:00' }),
  e('6', 'a', 'credit', 50, '2026-11-12T10:00:00', { status: 'needs_review' }),
  e('7', 'b', 'credit', 80, '2026-09-01T10:00:00'),
];

describe('statement', () => {
  it('carries the opening balance into the month and ignores deleted / review rows', () => {
    const s = statement(entries, 'a', new Date('2026-11-01T00:00:00'), new Date('2026-12-01T00:00:00'));
    expect(s.opening).toBe(300);
    expect(s.lines.map((l) => [l.amount, l.running])).toEqual([[240, 540], [100, 440]]);
    expect(s).toMatchObject({ credit: 240, payment: 100, closing: 440 });
  });
  it('all time', () => {
    const s = statement(entries, 'a');
    expect(s.opening).toBe(0);
    expect(s.closing).toBe(440);
    expect(s.lines).toHaveLength(4);
  });
  it('month ranges', () => {
    const { from, to } = monthRange(-1, new Date('2026-11-22T12:00:00'));
    expect([from.getMonth(), to.getMonth()]).toEqual([9, 10]);
  });
  it('WhatsApp statement text has the totals', () => {
    const s = statement(entries, 'a', new Date('2026-11-01T00:00:00'), new Date('2026-12-01T00:00:00'));
    const text = statementText({ name: 'Murugan', honorific: 'anna' }, s, 'Demo Kadai', 'en', 'November 2026');
    expect(text).toContain('Opening balance: ₹300');
    expect(text).toContain('Closing balance: ₹440');
    expect(text).toContain('arisi, oil');
  });
});

describe('overdue customers', () => {
  const customers = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  it('finds people who owe and have not paid for 30 days', () => {
    const now = new Date('2026-11-22T12:00:00');
    const list = overdueCustomers(customers, entries, 30, now);
    expect(list.map((c) => [c.id, c.daysUnpaid, c.neverPaid])).toEqual([['b', 82, true]]);
    expect(overdueCustomers(customers, entries, 10, now).map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('demo seed', () => {
  const { customers, entries: seeded } = generateDemo('shop', new Date('2026-11-22T18:00:00'));
  const bal = balances(seeded);
  it('has 6 customers and about 3 weeks of entries', () => {
    expect(customers).toHaveLength(6);
    expect(seeded.length).toBeGreaterThan(30);
  });
  it('Murugan anna ends at exactly 900 (so the spec walkthrough reads 1,140)', () => {
    expect(bal.get(customers.find((c) => c.name === 'Murugan').id)).toBe(900);
  });
  it('balances never go negative along the way', () => {
    for (const c of customers) {
      for (const row of historyWithRunningBalance(seeded, c.id)) expect(row.running).toBeGreaterThanOrEqual(0);
    }
  });
  it('one customer is overdue', () => {
    const list = overdueCustomers(customers, seeded, 30, new Date('2026-11-22T18:00:00'));
    expect(list.map((c) => c.name)).toEqual(['Murugesan']);
  });
});
