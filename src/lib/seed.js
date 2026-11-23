// Demo shop: 6 regular credit customers and 3 weeks of entries, deterministic.
// Murugan anna ends at exactly 900 pending, so the spec walkthrough reads naturally:
// "Murugan anna, 240 roobaai kadan. Mottham baaki 1,140."
import { uuid } from './util.js';

const CUSTOMERS = [
  { name: 'Murugan', name_ta: 'முருகன் அண்ணா', honorific: 'anna', target: 900, freq: 0.75 },
  { name: 'Lakshmi', name_ta: 'லட்சுமி அக்கா', honorific: 'akka', target: 1360, freq: 0.6 },
  { name: 'Ravi', name_ta: 'ரவி', honorific: null, target: 620, freq: 0.5 },
  { name: 'Selvi', name_ta: 'செல்வி அக்கா', honorific: 'akka', target: 2150, freq: 0.55 },
  // Carried over from the paper notebook 45 days ago and never paid: shows up as overdue.
  { name: 'Murugesan', name_ta: 'முருகேசன்', honorific: null, target: 380, freq: 0.35, noPayments: true, carriedDaysAgo: 45 },
  { name: 'Fathima', name_ta: 'பாத்திமா அக்கா', honorific: 'akka', target: 0, freq: 0.4 },
];

const ITEMS = [
  ['arisi', 60, 240], ['ennai', 90, 180], ['paruppu', 70, 160], ['sakkarai', 45, 90], ['paal', 25, 60],
  ['soap', 30, 60], ['maavu', 40, 90], ['ravai', 30, 60], ['muttai', 36, 72], ['vengayam', 30, 80],
  ['thakkali', 20, 60], ['biscuit', 10, 40], ['tea thool', 50, 120], ['bread', 35, 45],
];

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round10 = (n) => Math.max(10, Math.round(n / 10) * 10);

export function generateDemo(shopId, now = new Date()) {
  const rnd = mulberry32(20261122);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const stamp = (daysAgo, hour, minute) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, Math.floor(rnd() * 60), 0);
    return d > now ? new Date(now.getTime() - (daysAgo + 1) * 60000) : d;
  };

  const created = new Date(now);
  created.setDate(created.getDate() - 46);
  const customers = CUSTOMERS.map((c) => ({
    id: uuid(),
    shop_id: shopId,
    name: c.name,
    name_ta: c.name_ta,
    honorific: c.honorific,
    phone: null,
    last_reminded_at: null,
    created_at: created.toISOString(),
    updated_at: created.toISOString(),
    deleted_at: null,
  }));

  const entries = [];
  const add = (cust, type, amount, items, at) => {
    const who = cust.honorific ? `${cust.name} ${cust.honorific}` : cust.name;
    entries.push({
      id: uuid(),
      shop_id: shopId,
      customer_id: cust.id,
      type,
      amount,
      items,
      transcript: type === 'credit'
        ? `${who}, ${amount} rupees${items.length ? ', ' + items.join(' and ') : ''}, kadan`
        : `${who} ${amount} kuduthaar`,
      audio_path: null,
      confidence: 1,
      lang: 'ta',
      source: 'seed',
      status: 'confirmed',
      review_reason: null,
      suggestion: null,
      created_at: at.toISOString(),
      updated_at: at.toISOString(),
      deleted_at: null,
    });
  };

  CUSTOMERS.forEach((spec, i) => {
    const cust = customers[i];
    let balance = 0;
    if (spec.carriedDaysAgo) {
      add(cust, 'credit', 150, [], stamp(spec.carriedDaysAgo, 10, 0));
      entries[entries.length - 1].transcript = 'Opening balance from the old notebook';
      entries[entries.length - 1].source = 'manual';
      balance += 150;
    }
    for (let day = 20; day >= 1; day--) {
      if (rnd() < spec.freq) {
        const n = 1 + Math.floor(rnd() * 3);
        const items = [];
        let amount = 0;
        for (let k = 0; k < n; k++) {
          const [item, lo, hi] = pick(ITEMS);
          if (!items.includes(item)) items.push(item);
          amount += lo + rnd() * (hi - lo);
        }
        amount = round10(amount);
        add(cust, 'credit', amount, items, stamp(day, 8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60)));
        balance += amount;
      }
      // Weekly-ish payments of part of the balance.
      if (!spec.noPayments && day % 7 === (i % 7) && balance > 300) {
        const paid = round10(balance * (0.4 + rnd() * 0.4));
        add(cust, 'payment', paid, [], stamp(day, 18 + Math.floor(rnd() * 3), Math.floor(rnd() * 60)));
        balance -= paid;
      }
    }
    // A couple of entries today so the home screen has numbers.
    if (i < 3) {
      const [item, lo, hi] = pick(ITEMS);
      const amount = round10(lo + rnd() * (hi - lo));
      add(cust, 'credit', amount, [item], stamp(0, 8 + i, 10 + i * 7));
      balance += amount;
    }
    // Land on the target balance with a final settling entry earlier today / yesterday.
    const diff = spec.target - balance;
    if (diff !== 0 && !(spec.noPayments && diff < 0)) add(cust, diff > 0 ? 'credit' : 'payment', Math.abs(diff), diff > 0 ? [pick(ITEMS)[0]] : [], stamp(1, 20, 30 + i));
  });

  entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { customers, entries };
}
