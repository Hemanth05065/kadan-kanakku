// Spoken-number parsing for Tamil, English, Hindi, Telugu and mixed speech:
//   "240", "₹1,500", "2k", "two-forty", "two hundred and forty", "fifteen hundred",
//   "irunooru naarpadhu", "இருநூற்று நாற்பது", "aayirathu ainooru", "rendu thousand",
//   "dedh sau", "saade teen sau", "do sau pachaas", "rendu vandala yabhai", ...
import { skeleton, transliterate } from './translit.js';
import { NUMBER_WORDS, NUMBER_BY_LANG, NUMBER_EXACT, NUMBER_PREFIXES, LEXICON, LEXICON_EXACT, LANGS } from '../i18n/index.js';

const LETTER = 'a-z\\u0900-\\u097F\\u0B80-\\u0BFF\\u0C00-\\u0C7F';
const DIGIT_LETTER = new RegExp(`(\\d)([${LETTER}])`, 'g');
const LETTER_DIGIT = new RegExp(`([${LETTER}])(\\d)`, 'g');

/** Split an utterance into tokens with their sound skeletons. */
export function tokenize(text) {
  let s = String(text || '').normalize('NFC').toLowerCase();
  s = s.replace(/₹/g, ' rs ');
  s = s.replace(/(\d),(?=\d)/g, '$1');
  s = s.replace(/\/-/g, ' ');
  s = s.replace(DIGIT_LETTER, '$1 $2');
  s = s.replace(LETTER_DIGIT, '$1 $2');
  s = s.replace(/[^\p{L}\p{M}\p{N}.\s]/gu, ' ');
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, sk: skeleton(raw), latin: transliterate(raw).toLowerCase() }));
}

const isDigits = (raw) => /^\d+(\.\d+)?$/.test(raw);

function lookup(sk, lang) {
  return (lang && NUMBER_BY_LANG[lang]?.get(sk)) || NUMBER_WORDS.get(sk);
}

/** Split a glued compound like irubathiyanju / இருபத்தைந்து into number parts. */
function splitCompound(sk, lang, depth = 0) {
  if (depth > 3 || sk.length < 4) return null;
  const direct = lookup(sk, lang);
  if (direct) return [direct];
  for (let i = sk.length - 2; i >= 3; i--) {
    const left = sk.slice(0, i);
    const head = lookup(left, lang) || NUMBER_PREFIXES.get(left);
    if (!head || head.kind === 'mod') continue;
    let rest = sk.slice(i);
    if (/^[yv]/.test(rest)) rest = rest.slice(1); // glide: irubathi-y-anju
    const tail = lookup(rest, lang) ? [lookup(rest, lang)] : splitCompound(rest, lang, depth + 1);
    if (tail) return [head, ...tail];
  }
  return null;
}

const part = (e) => ({ value: e.value, kind: e.kind, weak: Boolean(e.weak) });

/**
 * Number meaning of one token: [{value, kind, weak}] or null.
 * kind: digits | add | mult | mod. The utterance language is tried first, so the same
 * sound can mean different numbers in different languages (Telugu edu = 7, Tamil ettu = 8).
 */
export function numberParts(token, lang = null) {
  if (isDigits(token.raw)) return [{ value: parseFloat(token.raw), kind: 'digits', weak: false }];
  const latin = token.latin ?? transliterate(token.raw).toLowerCase();
  // 1. exact spelling in the utterance's language (may be a weak word like Hindi "do")
  const exact = lang && NUMBER_EXACT[lang]?.get(latin);
  if (exact) return [part(exact)];
  // 2. an exact ordinary word ("kg", "to", "saar") is never a number
  if (LEXICON_EXACT.has(latin)) return null;
  // 3. exact spelling in another language ("two" in Tanglish, "pathu" in English speech)
  for (const l of LANGS) {
    const e = l !== lang && NUMBER_EXACT[l].get(latin);
    if (e && !e.weak) return [part(e)];
  }
  // 4. sounds like a number word of the utterance's language, then of any language
  const own = lang && NUMBER_BY_LANG[lang]?.get(token.sk);
  if (own) return [part(own)];
  if (LEXICON.has(token.sk)) return null;
  const any = NUMBER_WORDS.get(token.sk);
  if (any) return [part(any)];
  const parts = splitCompound(token.sk, lang);
  return parts ? parts.map(part) : null;
}

const lowestPlace = (v) => {
  if (!Number.isInteger(v) || v === 0) return 1;
  let p = 1;
  while (v % (p * 10) === 0) p *= 10;
  return p;
};
const highestPlace = (v) => (v < 1 ? 1 : 10 ** Math.floor(Math.log10(v)));

/** Combine the parts of one run of number tokens into one or more numbers. */
function combine(parts) {
  const out = [];
  let total = 0, cur = 0, lowest = Infinity, start = null, end = null, words = false, lastKind = null, usedMult = false;
  const flush = () => {
    if (start !== null) out.push({ value: total + cur, start, end, words });
    total = 0; cur = 0; lowest = Infinity; start = null; end = null; words = false; lastKind = null; usedMult = false;
  };
  const begin = (p) => { start = p.idx; end = p.idx; words = p.kind !== 'digits'; };
  let delta = 0; // Hindi saade (+½), sawa (+¼), paune (−¼) modify the next number

  for (const p of parts) {
    if (p.kind === 'mod') {
      if (start === null) begin(p);
      delta += p.value;
      end = p.idx;
      lastKind = p.kind;
      continue;
    }
    if (p.kind === 'mult') {
      if (start === null) begin(p);
      const m = p.value;
      const base = (cur || (delta ? 1 : 0)) + delta;
      delta = 0;
      if (m === 100) {
        if (cur >= 100) { flush(); begin(p); }
        cur = (base || 1) * 100;
        lowest = 100;
      } else {
        if (cur === 0 && total !== 0 && !base) { flush(); begin(p); }
        total += (base || 1) * m;
        cur = 0;
        lowest = m;
      }
      usedMult = true;
    } else {
      const v = p.value + delta;
      delta = 0;
      if (start === null) {
        begin(p);
        cur = v;
        lowest = lowestPlace(v);
      } else if (lastKind === 'digits' && p.kind === 'digits') {
        flush(); begin(p); cur = v; lowest = lowestPlace(v);
      } else if (highestPlace(v) < lowest && (total + cur) > 0) {
        cur += v;
        lowest = lowestPlace(v);
      } else if (!usedMult && total === 0 && cur >= 1 && cur <= 99 && v >= 10 && v <= 99) {
        // Colloquial prices: "two forty" = 240, "one fifty" = 150, "twelve fifty" = 1250.
        cur = cur * 100 + v;
        lowest = lowestPlace(v);
      } else {
        flush(); begin(p); cur = v; lowest = lowestPlace(v);
      }
    }
    if (p.kind !== 'digits') words = true;
    end = p.idx;
    lastKind = p.kind;
  }
  flush();
  // A dangling modifier (e.g. "saade" alone) is not a number.
  return out.filter((n) => n.value > 0);
}

const CONNECTORS = new Set(['and', 'um', 'mattrum', 'aur'].map(skeleton));

/**
 * All numbers in a token list, with context:
 *   { value, start, end, words, unit (next token is kilo/litre/...), rupee (next to rs/roobaai) }
 * `lang` (optional) is the utterance language, tried first for ambiguous number words.
 */
export function extractNumbers(tokens, lang = null) {
  const cat = (tok) => (tok ? LEXICON.get(tok.sk)?.categories : null);
  const partsAt = tokens.map((tok) => numberParts(tok, lang));
  // Weak number words ("do" = two / give) count only next to a number, unit or rupee word.
  const strong = (i) => partsAt[i] && !partsAt[i].every((p) => p.weak);
  partsAt.forEach((parts, i) => {
    if (!parts || !parts.every((p) => p.weak)) return;
    const next = cat(tokens[i + 1]);
    const prev = cat(tokens[i - 1]);
    const ok = strong(i + 1) || strong(i - 1) || next?.has('unit') || next?.has('rupee') || prev?.has('rupee');
    if (!ok) partsAt[i] = null;
  });

  const results = [];
  let run = [];
  const closeRun = () => {
    if (run.length) results.push(...combine(run));
    run = [];
  };
  tokens.forEach((tok, idx) => {
    const parts = partsAt[idx];
    if (parts) {
      for (const p of parts) run.push({ ...p, idx });
    } else if (run.length && CONNECTORS.has(tok.sk) && partsAt[idx + 1]) {
      // "two hundred and forty": keep the run going
    } else {
      closeRun();
    }
  });
  closeRun();

  return results.map((n) => {
    const after = cat(tokens[n.end + 1]);
    const before = cat(tokens[n.start - 1]);
    return {
      ...n,
      unit: after?.has('unit') ? tokens[n.end + 1].raw : null,
      rupee: Boolean(after?.has('rupee') || before?.has('rupee')),
    };
  });
}

/** Convenience: the first number in a piece of text, or null. */
export function parseNumber(text, lang = null) {
  const nums = extractNumbers(tokenize(text), lang);
  return nums.length ? nums[0].value : null;
}
