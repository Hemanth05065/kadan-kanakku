#!/usr/bin/env node
// Scores understanding on eval/cases.json: intent, customer and amount must all be right.
//
//   node scripts/eval-nlu.mjs                 on-device grammar only (no network)
//   node scripts/eval-nlu.mjs --llm           also the open LLM and LLM ⊕ grammar
//                                             (needs LLM_BASE_URL, LLM_MODEL, optional LLM_API_KEY)
//   node scripts/eval-nlu.mjs --min 0.9       exit 1 if the grammar scores below 90 % (CI gate)
//   node scripts/eval-nlu.mjs --verbose       print every case
import { readFileSync } from 'node:fs';
import { parseLocal } from '../src/lib/localParser.js';
import { buildNameIndex } from '../src/lib/names.js';
import { evalCustomers, scoreUnderstanding } from '../src/lib/evalScore.js';
import { mergeParses } from '../src/voice/nlu.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const minArg = args.includes('--min') ? Number(args[args.indexOf('--min') + 1]) : null;

const data = JSON.parse(readFileSync(new URL('../eval/cases.json', import.meta.url), 'utf8'));
const customers = evalCustomers(data);
const index = buildNameIndex(customers);
const score = (c, p) => scoreUnderstanding(c, null, customers, p);

async function llmParse(text) {
  const base = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
  const { SYSTEM, JSON_SCHEMA } = await import('../supabase/functions/_shared/nlu-prompt.ts');
  const body = {
    model: process.env.LLM_MODEL,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify({ utterance: text, customers: customers.map(({ id, name, name_ta }) => ({ id, name, name_ta })), context: null }) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'ledger_command', strict: true, schema: JSON_SCHEMA } },
  };
  const headers = { 'Content-Type': 'application/json', ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) };
  let res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status === 400 || res.status === 422) {
    body.response_format = { type: 'json_object' };
    res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  const content = String(out.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? content);
  if (parsed.customer_id && !customers.some((c) => c.id === parsed.customer_id)) parsed.customer_id = null;
  return parsed;
}

const engines = ['grammar'];
if (flag('--llm')) {
  if (!process.env.LLM_BASE_URL || !process.env.LLM_MODEL) {
    console.error('--llm needs LLM_BASE_URL and LLM_MODEL (see supabase/functions/.env.example)');
    process.exit(2);
  }
  engines.push('llm', 'llm+grammar');
}

const results = Object.fromEntries(engines.map((e) => [e, []]));
const t0 = Date.now();
for (const c of data.cases) {
  const local = parseLocal(c.text, { index, defaultLang: 'ta' });
  results.grammar.push({ c, s: score(c, local) });
  if (flag('--llm')) {
    let llm = null;
    try {
      llm = await llmParse(c.text);
    } catch (err) {
      console.warn(`LLM failed on "${c.text}": ${err.message}`);
    }
    results.llm.push({ c, s: llm ? score(c, llm) : { exact: false, intent: false, amount: false, customer: false, got: { error: true } } });
    results['llm+grammar'].push({ c, s: score(c, mergeParses(llm, local)) });
  }
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const langs = [...new Set(data.cases.map((c) => c.lang))];
console.log(`\n${data.cases.length} cases · ${langs.join(', ')} · ${Date.now() - t0} ms\n`);
const header = ['engine', 'all-3 right', 'intent', 'customer', 'amount', 'silent wrong saves', ...langs.map((l) => `${l} (all-3)`)];
const rows = engines.map((e) => {
  const r = results[e];
  const count = (k, filter = () => true) => r.filter((x) => filter(x) && x.s[k]).length;
  return [
    e,
    `${pct(count('exact'), r.length)} (${count('exact')}/${r.length})`,
    pct(count('intent'), r.length),
    pct(count('customer'), r.length),
    pct(count('amount'), r.length),
    `${count('silentWrong')}`,
    ...langs.map((l) => pct(count('exact', (x) => x.c.lang === l), r.filter((x) => x.c.lang === l).length)),
  ];
});
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
console.log(line(header));
console.log(widths.map((w) => '─'.repeat(w)).join('  '));
rows.forEach((r) => console.log(line(r)));

for (const e of engines) {
  const misses = results[e].filter((x) => !x.s.exact);
  if (!misses.length && !flag('--verbose')) continue;
  console.log(`\n${e}: ${misses.length} miss${misses.length === 1 ? '' : 'es'}`);
  for (const { c, s } of flag('--verbose') ? results[e] : misses) {
    const mark = s.exact ? '✓' : '✗';
    const exp = `${c.intent} / ${c.customer} / ${c.amount}`;
    const got = `${s.got.intent} / ${s.got.customer} / ${s.got.amount}  (confidence ${s.got.confidence ?? '–'}${s.silentWrong ? ', WOULD SAVE SILENTLY' : ', would ask first'})`;
    console.log(`  ${mark} [${c.lang}] "${c.text}"\n      expected ${exp}\n      got      ${got}`);
  }
}

if (minArg !== null) {
  const r = results.grammar;
  const acc = r.filter((x) => x.s.exact).length / r.length;
  if (acc < minArg) {
    console.error(`\ngrammar accuracy ${Math.round(acc * 100)}% is below --min ${Math.round(minArg * 100)}%`);
    process.exit(1);
  }
}
