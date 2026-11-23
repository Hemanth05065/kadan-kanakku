// Pure ledger maths. Balances are always computed from entries, never stored.
import { startOfDay } from './util.js';

export const isLive = (e) => e.status === 'confirmed' && !e.deleted_at;
const signed = (e) => (e.type === 'credit' ? Number(e.amount) : -Number(e.amount));

/** customer_id -> balance (positive = customer owes the shop). */
export function balances(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!isLive(e) || !e.customer_id) continue;
    m.set(e.customer_id, (m.get(e.customer_id) || 0) + signed(e));
  }
  return m;
}

export function balanceOf(entries, customerId) {
  let b = 0;
  for (const e of entries) if (isLive(e) && e.customer_id === customerId) b += signed(e);
  return b;
}

export function todayStats(entries, now = new Date()) {
  const since = startOfDay(now).getTime();
  let credit = 0, payment = 0, count = 0;
  for (const e of entries) {
    if (!isLive(e) || new Date(e.created_at).getTime() < since) continue;
    count++;
    if (e.type === 'credit') credit += Number(e.amount);
    else payment += Number(e.amount);
  }
  return { credit, payment, count };
}

export function totalPending(bal) {
  let t = 0;
  for (const v of bal.values()) if (v > 0) t += v;
  return t;
}

/** Customers sorted by pending amount, highest first. */
export function customersByPending(customers, bal) {
  return customers
    .filter((c) => !c.deleted_at)
    .map((c) => ({ ...c, balance: bal.get(c.id) || 0 }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

/** A customer's history, newest first, each row with the balance after it. */
export function historyWithRunningBalance(entries, customerId) {
  const rows = entries
    .filter((e) => e.customer_id === customerId && e.status === 'confirmed')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let run = 0;
  const out = rows.map((e) => {
    if (!e.deleted_at) run += signed(e);
    return { ...e, running: run };
  });
  return out.reverse();
}

export function recentEntries(entries, limit = 15) {
  return entries
    .filter((e) => e.status === 'confirmed' && !e.deleted_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

const DAY = 86400000;

/**
 * Customers who owe money and have not paid for `days` days (or never, if their first
 * credit is that old). Sorted by days unpaid, longest first.
 */
export function overdueCustomers(customers, entries, days = 30, now = new Date()) {
  const bal = balances(entries);
  const lastPay = new Map();
  const firstCredit = new Map();
  for (const e of entries) {
    if (!isLive(e) || !e.customer_id) continue;
    const t = new Date(e.created_at).getTime();
    if (e.type === 'payment') lastPay.set(e.customer_id, Math.max(lastPay.get(e.customer_id) || 0, t));
    else firstCredit.set(e.customer_id, Math.min(firstCredit.get(e.customer_id) ?? Infinity, t));
  }
  return customers
    .filter((c) => !c.deleted_at && (bal.get(c.id) || 0) > 0)
    .map((c) => {
      const since = lastPay.get(c.id) || firstCredit.get(c.id) || now.getTime();
      return { ...c, balance: bal.get(c.id), daysUnpaid: Math.floor((now.getTime() - since) / DAY), neverPaid: !lastPay.has(c.id) };
    })
    .filter((c) => c.daysUnpaid >= days)
    .sort((a, b) => b.daysUnpaid - a.daysUnpaid || b.balance - a.balance);
}

/** Month boundaries: offset 0 = this month, -1 = last month. */
export function monthRange(offset = 0, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { from, to };
}

/**
 * A customer's statement for [from, to): opening balance, every entry with the running
 * balance after it, totals and closing balance. from/to = null means all time.
 */
export function statement(entries, customerId, from = null, to = null) {
  const rows = entries
    .filter((e) => e.customer_id === customerId && isLive(e))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let opening = 0;
  let running = 0;
  let credit = 0;
  let payment = 0;
  const lines = [];
  for (const e of rows) {
    const t = new Date(e.created_at);
    if (from && t < from) {
      opening += signed(e);
      running = opening;
      continue;
    }
    if (to && t >= to) break;
    running += signed(e);
    if (e.type === 'credit') credit += Number(e.amount);
    else payment += Number(e.amount);
    lines.push({ ...e, running });
  }
  return { opening, lines, credit, payment, closing: opening + credit - payment };
}

export function reviewQueue(entries) {
  return entries
    .filter((e) => e.status === 'needs_review' && !e.deleted_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
