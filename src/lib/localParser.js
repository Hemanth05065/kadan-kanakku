// On-device understanding of a counter utterance. Used when the server LLM is not
// configured or the phone is offline, and as a cross-check of the LLM's amount.
// Returns the same shape as the `understand` edge function.
import { tokenize, extractNumbers } from './numbers.js';
import { scriptOf } from './translit.js';
import { rankCustomers } from './names.js';
import { LEXICON, ITEM_DISPLAY, LANGS, NUMBER_EXACT } from '../i18n/index.js';

const NAME_STOP = /^\d/;

// Command words say more about the language than fillers or item names do.
const CATEGORY_WEIGHT = { credit: 2, payment: 2, query: 2, top: 2, today: 2, collect: 2, undo: 2, add: 1.5, yes: 1.5, no: 1.5, honorific: 1, rupee: 1, interjection: 0 };

/** Which language an utterance is in: its script, then its words (shared words split their vote). */
export function detectLanguage(text, tokens, defaultLang = 'ta') {
  const hits = Object.fromEntries(LANGS.map((l) => [l, 0]));
  const script = scriptOf(text);
  if (script) hits[script] += 4;
  for (const t of tokens) {
    const e = LEXICON.get(t.sk);
    if (e) {
      const w = Math.max(...[...e.categories].map((c) => CATEGORY_WEIGHT[c] ?? 0.5));
      if (w > 0) for (const l of e.langs) hits[l] += w / e.langs.size;
    }
    const numLangs = LANGS.filter((l) => NUMBER_EXACT[l].has(t.latin));
    for (const l of numLangs) hits[l] += 1 / numLangs.length;
  }
  const best = Math.max(...Object.values(hits));
  if (best === 0) return defaultLang;
  const tied = LANGS.filter((l) => hits[l] === best);
  return tied.includes(defaultLang) ? defaultLang : tied[0];
}

export function parseLocal(text, { index = [], defaultLang = 'ta' } = {}) {
  const tokens = tokenize(text);
  const language = detectLanguage(text, tokens, defaultLang);
  const nums = extractNumbers(tokens, language);
  const numericIdx = new Set();
  for (const n of nums) for (let i = n.start; i <= n.end; i++) numericIdx.add(i);

  const cats = tokens.map((t, i) => (numericIdx.has(i) ? null : LEXICON.get(t.sk)?.categories || null));
  const has = (c) => cats.some((s) => s?.has(c));

  // ── items ──
  const items = [];
  tokens.forEach((t, i) => {
    if (cats[i]?.has('items')) {
      const d = ITEM_DISPLAY.get(t.sk) || t.raw;
      if (!items.includes(d)) items.push(d);
    }
  });

  // ── amount ──
  const priced = nums.filter((n) => !n.unit && n.value > 0);
  let amount = null;
  let amountNote = null;
  const rupeeMarked = priced.filter((n) => n.rupee);
  if (rupeeMarked.length === 1) amount = rupeeMarked[0].value;
  else if (priced.length === 1) amount = priced[0].value;
  else if (priced.length > 1) {
    amount = priced.reduce((s, n) => s + n.value, 0);
    amountNote = 'summed';
  }
  const amountFromWords = amount !== null && priced.some((n) => n.words);

  // ── customer name ──
  const candidateIdx = tokens
    .map((t, i) => i)
    .filter((i) => !numericIdx.has(i) && !cats[i] && tokens[i].raw.length >= 2 && !NAME_STOP.test(tokens[i].raw));
  let customer_name = null;
  let customer_id = null;
  let nameScore = 0;
  if (candidateIdx.length) {
    const spans = [];
    for (const i of candidateIdx) {
      spans.push(tokens[i].raw);
      if (candidateIdx.includes(i + 1)) spans.push(`${tokens[i].raw} ${tokens[i + 1].raw}`);
    }
    let best = null;
    for (const s of spans) {
      const top = rankCustomers(s, index)[0];
      if (top && (!best || top.score > best.score)) best = { span: s, score: top.score, id: top.customer.id };
    }
    if (best && best.score >= 0.7) {
      customer_name = best.span;
      nameScore = best.score;
      if (best.score >= 0.97) customer_id = best.id;
    } else {
      customer_name = tokens[candidateIdx[0]].raw; // unknown person: first unrecognised word
    }
  }

  // ── intent ──
  const amountOk = amount !== null;
  let intent = 'unclear';
  let explicit = true;
  const yes = has('yes'), no = has('no');
  const todayAsk = has('today') && !amountOk && !customer_name &&
    (has('query') || has('credit') || has('payment') || has('top') || tokens.length <= 3);
  // "vasool": "yaar kitta vasool pannanum?" asks who to collect from; with a name and an
  // amount ("Murugan kitta 500 vasool aachu") it records money collected.
  const knownName = Boolean(customer_name) && nameScore >= 0.7;
  if (has('undo') && !amountOk && !has('payment')) intent = 'undo_last';
  else if (has('collect') && !amountOk && !knownName) intent = 'query_collect';
  else if (has('collect') && !amountOk) intent = 'query_balance';
  else if (todayAsk) intent = 'query_today';
  else if (has('payment') || (has('collect') && amountOk)) intent = 'payment';
  else if (has('credit') && (amountOk || customer_name)) intent = 'credit';
  else if (has('add') && !amountOk && customer_name) intent = 'add_customer';
  else if (has('add') && amountOk) intent = 'credit';
  else if (has('top') && !customer_name) intent = 'query_top';
  else if (has('query') && !amountOk) intent = customer_name ? 'query_balance' : 'query_top';
  else if (no && tokens.length <= 4) intent = 'confirm_no';
  else if (yes && tokens.length <= 4 && !amountOk) intent = 'confirm_yes';
  else if (amountOk && customer_name) { intent = 'credit'; explicit = false; }
  else if (has('credit')) intent = 'credit';

  // "Who to collect from" is about the whole shop, not the stray word taken for a name.
  if (intent === 'query_collect') {
    customer_name = null;
    customer_id = null;
  }

  // ── confidence ──
  let confidence = 0.92;
  if (!explicit) confidence = 0.6;
  if (intent === 'unclear') confidence = amountOk || customer_name ? 0.4 : 0.2;
  if (['credit', 'payment', 'query_balance'].includes(intent) && customer_name) {
    if (nameScore >= 0.97) confidence -= 0;
    else if (nameScore >= 0.84) confidence -= 0.08;
    else if (nameScore > 0) confidence -= 0.2;
  }
  if (amountFromWords) confidence -= 0.04;
  if (amountNote === 'summed') confidence = Math.min(confidence, 0.7);
  if (tokens.length > 16) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

  return {
    intent,
    customer_name,
    customer_id,
    amount,
    items,
    yes_no: no ? 'no' : yes ? 'yes' : null,
    language,
    confidence,
    source: 'local',
    amountFromDigits: amountOk && !amountFromWords,
  };
}
