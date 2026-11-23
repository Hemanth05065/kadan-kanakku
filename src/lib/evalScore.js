// Scoring shared by the in-app Accuracy lab and scripts/eval-*.mjs.
import { tokenize } from './numbers.js';
import { parseLocal } from './localParser.js';
import { buildNameIndex, resolveName, displayName } from './names.js';

/**
 * Word error rate between what was said and what was heard, compared by sound skeleton so
 * script and spelling differences don't count as errors (முருகன் = Murugan, 240 = 240).
 */
export function wordErrorRate(reference, hypothesis) {
  const ref = tokenize(reference).map((t) => t.sk).filter(Boolean);
  const hyp = tokenize(hypothesis).map((t) => t.sk).filter(Boolean);
  if (!ref.length) return hyp.length ? 1 : 0;
  let prev = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

/** Customers of the evaluation set, with stable ids. */
export function evalCustomers(data) {
  return data.customers.map((c, i) => ({ id: `c${i + 1}`, ...c }));
}

/** Understand a transcript against the evaluation customers and compare with the expected command. */
export function scoreUnderstanding(expected, transcript, customers, parse = null) {
  const index = buildNameIndex(customers);
  const p = parse || parseLocal(transcript, { index, defaultLang: 'ta' });
  let who = null;
  if (p.customer_id) who = customers.find((c) => c.id === p.customer_id)?.name ?? null;
  else if (p.customer_name) {
    const r = resolveName(p.customer_name, index);
    who = r.status === 'match' ? r.customer.name : r.status === 'none' ? `new:${displayName(p.customer_name)}` : 'ambiguous';
  }
  const intent = p.intent === expected.intent;
  const amount = (p.amount ?? null) === (expected.amount ?? null) || Number(p.amount) === Number(expected.amount);
  const customer = String(who ?? '').toLowerCase() === String(expected.customer ?? '').toLowerCase();
  const exact = intent && amount && customer;
  const silentWrong = !exact && ['credit', 'payment'].includes(p.intent) && (p.confidence ?? 0) >= 0.8 && Number(p.amount) <= 2000;
  return { intent, amount, customer, exact, silentWrong, got: { intent: p.intent, customer: who, amount: p.amount ?? null, confidence: p.confidence } };
}
