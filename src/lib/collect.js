// "Who should I collect from today?" A short list the owner can act on, with the reasons
// in plain words, so it never feels like the app is guessing.
import { balances, isLive } from './ledger.js';

const DAY = 86400000;

export const COLLECT_RULES = {
  minBalance: 100, // not worth a reminder below this
  minDaysUnpaid: 7, // paid something this week: they are paying, leave them be
  restAfterReminderDays: 2, // reminded today or yesterday: give them a chance
  ageCapDays: 60, // beyond two months, waiting longer adds no urgency
};

/**
 * Customers worth asking for money today, best first:
 *   score = balance × (1 + days without a payment / 10), days capped at 60
 *           × 1.2 if they kept buying on credit this week without paying
 *           × 0.5 if they were reminded 2–3 days ago
 * Each comes with `reasons` ({ k: label key, n: number }) to show on screen.
 */
export function collectionList(customers, entries, now = new Date(), opts = {}) {
  const o = { limit: 5, ...COLLECT_RULES, ...opts };
  const nowT = now.getTime();
  const bal = balances(entries);
  const lastPay = new Map();
  const firstCredit = new Map();
  const boughtThisWeek = new Map();
  for (const e of entries) {
    if (!isLive(e) || !e.customer_id) continue;
    const t = new Date(e.created_at).getTime();
    if (e.type === 'payment') {
      lastPay.set(e.customer_id, Math.max(lastPay.get(e.customer_id) || 0, t));
    } else {
      firstCredit.set(e.customer_id, Math.min(firstCredit.get(e.customer_id) ?? Infinity, t));
      if (nowT - t < 7 * DAY) boughtThisWeek.set(e.customer_id, (boughtThisWeek.get(e.customer_id) || 0) + Number(e.amount));
    }
  }
  const daysSince = (t) => Math.max(0, Math.floor((nowT - t) / DAY));

  const out = [];
  for (const c of customers) {
    if (c.deleted_at) continue;
    const balance = bal.get(c.id) || 0;
    if (balance < o.minBalance) continue;
    const neverPaid = !lastPay.has(c.id);
    const daysUnpaid = daysSince(lastPay.get(c.id) ?? firstCredit.get(c.id) ?? nowT);
    if (daysUnpaid < o.minDaysUnpaid) continue;
    const remindedDays = c.last_reminded_at ? daysSince(new Date(c.last_reminded_at).getTime()) : null;
    if (remindedDays !== null && remindedDays < o.restAfterReminderDays) continue;

    const bought = boughtThisWeek.get(c.id) || 0;
    let score = balance * (1 + Math.min(daysUnpaid, o.ageCapDays) / 10);
    const reasons = [{ k: neverPaid ? 'r_never_paid' : 'r_no_payment', n: daysUnpaid }];
    if (bought > 0) {
      score *= 1.2;
      reasons.push({ k: 'r_still_buying', n: bought });
    }
    if (remindedDays !== null) {
      if (remindedDays <= 3) score *= 0.5;
      reasons.push({ k: 'r_reminded', n: remindedDays });
    }
    out.push({ ...c, balance, daysUnpaid, neverPaid, remindedDays, boughtThisWeek: bought, score: Math.round(score), reasons });
  }
  return out.sort((a, b) => b.score - a.score || b.balance - a.balance).slice(0, o.limit);
}
