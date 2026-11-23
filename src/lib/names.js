// Customer name matching by sound. Honorifics (anna, akka...) and Tamil case endings
// (-kku, -oda, -kitta) are ignored; saved aliases from past corrections count as exact.
import { skeleton, soundScore, transliterate, hasIndic, scriptOf } from './translit.js';
import { LEXICON } from '../i18n/index.js';

// Case endings, in skeleton form, longest first: Murugan-ukku, Ravi-kku, Selvi-kita, Lakshmi-yota.
const SUFFIXES = ['ukita', 'kita', 'ukuk', 'uku', 'kuk', 'ku', 'yota', 'ota', 'otu', 'yai', 'ai', 'kum', 'um', 'ta', 'te', 'e'];

export function suffixVariants(sk) {
  const out = [sk];
  for (const suf of SUFFIXES) {
    if (sk.length - suf.length >= 3 && sk.endsWith(suf)) out.push(sk.slice(0, -suf.length));
  }
  return out;
}

const isHonorific = (sk) => LEXICON.get(sk)?.categories.has('honorific');

/** Words of a name with honorifics removed. */
export function nameWords(name) {
  return String(name || '')
    .split(/[\s,.\-]+/)
    .filter(Boolean)
    .filter((w) => !isHonorific(skeleton(w)));
}

/** Matching keys for one customer: full name, first name, Tamil name and aliases. */
function customerKeys(c, aliases) {
  const keys = [];
  const add = (text, via) => {
    const words = nameWords(text);
    if (!words.length) return;
    keys.push({ sk: skeleton(words.join('')), via });
    if (words.length > 1) keys.push({ sk: skeleton(words[0]), via: via + '_first', weight: 0.97 });
  };
  add(c.name, 'name');
  if (c.name_ta) add(c.name_ta, 'name_ta');
  for (const a of aliases) add(a.alias, 'alias');
  return keys.filter((k) => k.sk);
}

/** Precompute matching keys for all active customers. */
export function buildNameIndex(customers, aliases = []) {
  const byCustomer = new Map();
  for (const a of aliases) {
    if (a.deleted_at) continue;
    if (!byCustomer.has(a.customer_id)) byCustomer.set(a.customer_id, []);
    byCustomer.get(a.customer_id).push(a);
  }
  return customers
    .filter((c) => !c.deleted_at)
    .map((c) => ({ customer: c, keys: customerKeys(c, byCustomer.get(c.id) || []) }));
}

/** Score a spoken name (any script, may include honorifics / case endings) against one indexed customer. */
export function scoreEntry(spoken, entry) {
  const words = nameWords(spoken);
  if (!words.length) return { score: 0, via: null };
  const variants = new Set();
  for (const sk of suffixVariants(skeleton(words.join('')))) variants.add(sk);
  for (const sk of suffixVariants(skeleton(words[0]))) variants.add(sk);
  let best = { score: 0, via: null };
  for (const v of variants) {
    for (const k of entry.keys) {
      let s = soundScore(v, k.sk) * (k.weight || 1);
      if (k.via === 'alias' && s >= 0.97) s = 1;
      if (s > best.score) best = { score: s, via: k.via };
    }
  }
  return best;
}

export function rankCustomers(spoken, index) {
  return index
    .map((e) => ({ customer: e.customer, ...scoreEntry(spoken, e) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

export const MATCH = { STRONG: 0.97, ACCEPT: 0.84, CANDIDATE: 0.7, CLOSE_GAP: 0.12 };

/**
 * Decide who a spoken name refers to.
 * -> { status: 'match' | 'ambiguous' | 'weak' | 'none', customer?, candidates?, score }
 * `preferredId` is the LLM's pick; it wins when it is phonetically plausible.
 */
export function resolveName(spoken, index, preferredId = null) {
  const ranked = rankCustomers(spoken, index);
  if (preferredId) {
    const i = ranked.findIndex((r) => r.customer.id === preferredId);
    if (i > 0 && ranked[i].score >= MATCH.CANDIDATE && ranked[i].score >= ranked[0].score - 0.06) {
      ranked.unshift(ranked.splice(i, 1)[0]);
    }
  }
  const [top, second] = ranked;
  if (!top || top.score < MATCH.CANDIDATE) return { status: 'none', score: top?.score || 0, ranked };
  const secondClose = second && second.score >= MATCH.CANDIDATE && top.score - second.score < MATCH.CLOSE_GAP;
  if (top.score >= MATCH.STRONG && !(second && second.score >= MATCH.STRONG)) {
    return { status: 'match', customer: top.customer, score: top.score, via: top.via, ranked };
  }
  if (secondClose) return { status: 'ambiguous', candidates: [top.customer, second.customer], score: top.score, ranked };
  if (top.score >= MATCH.ACCEPT) return { status: 'match', customer: top.customer, score: top.score, via: top.via, ranked };
  return { status: 'weak', candidates: [top.customer], score: top.score, ranked };
}

/** Title-case Latin form of a spoken name (for saving a new customer). */
export function displayName(spoken) {
  const words = nameWords(spoken);
  const latin = words.map((w) => transliterate(w));
  return latin
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

/** Native-script form (Tamil, Devanagari, Telugu) if the spoken name was written in one. */
export function tamilName(spoken) {
  const words = nameWords(spoken).filter(hasIndic);
  return words.length ? words.join(' ') : null;
}

/** The native-script name, but only if it is in the script of `lang` (so a TTS voice can read it). */
export function nativeNameFor(text, lang) {
  return text && scriptOf(text) === lang ? text : null;
}
