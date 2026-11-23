// Language registry. Add a pack here (e.g. kn.js, ml.js) and every screen, reply and the
// on-device parser picks it up.
import ta from './ta.js';
import en from './en.js';
import hi from './hi.js';
import te from './te.js';
import { skeleton, transliterate } from '../lib/translit.js';

export const PACKS = { ta, en, hi, te };
export const LANGS = Object.keys(PACKS);
export const DEFAULT_LANG = 'ta';

export function pack(lang) {
  return PACKS[lang] || PACKS[DEFAULT_LANG];
}

/** Label in one language, falling back to English then the key. */
export function t(key, lang = DEFAULT_LANG) {
  return pack(lang).labels[key] ?? PACKS.en.labels[key] ?? key;
}

/** Spoken + shown reply text in a language (falls back to English). */
export function reply(key, lang, params = {}) {
  const code = PACKS[lang] ? lang : DEFAULT_LANG;
  const fn = PACKS[code].replies[key] || PACKS.en.replies[key];
  return { key, lang: PACKS[code].replies[key] ? code : 'en', ...fn(params) };
}

// ── Parser vocabulary, indexed by sound skeleton ─────────────────────────────

/** skeleton -> { categories:Set, langs:Set } */
export const LEXICON = new Map();
/** Exact Latin spellings of every vocabulary word ("kg" is a unit even though it sounds like "k"). */
export const LEXICON_EXACT = new Set();
for (const p of Object.values(PACKS)) {
  for (const [cat, words] of Object.entries(p.lexicon)) {
    for (const w of words) {
      LEXICON_EXACT.add(transliterate(w).toLowerCase());
      const sk = skeleton(w);
      if (!sk) continue;
      if (!LEXICON.has(sk)) LEXICON.set(sk, { categories: new Set(), langs: new Set() });
      const e = LEXICON.get(sk);
      e.categories.add(cat);
      e.langs.add(p.code);
    }
  }
}

/** Item words in their display form, keyed by skeleton ("arisi", "அரிசி" -> "arisi"). */
export const ITEM_DISPLAY = new Map();
for (const p of Object.values(PACKS)) {
  for (const w of p.lexicon.items) {
    const sk = skeleton(w);
    if (!ITEM_DISPLAY.has(sk) || /^[a-z]+$/.test(w)) ITEM_DISPLAY.set(sk, w);
  }
}

/**
 * Number words.
 *   NUMBER_EXACT[lang]   exact Latin spelling -> entry   (keeps Hindi saat=7 apart from saath=60)
 *   NUMBER_BY_LANG[lang] sound skeleton -> entry          (keeps Telugu edu=7 apart from Tamil ettu=8)
 *   NUMBER_WORDS         skeleton -> entry across languages, for mixed speech; words that are also
 *                        ordinary words in another language ("do", "to") are left out
 *   NUMBER_PREFIXES      prefix forms used inside compounds (irubath-anju = 25, nootri-... = 120)
 * entry = { value, kind: 'add' | 'mult' | 'mod', weak, lang }
 */
export const NUMBER_EXACT = {};
export const NUMBER_BY_LANG = {};
export const NUMBER_WORDS = new Map();
export const NUMBER_PREFIXES = new Map();

for (const p of Object.values(PACKS)) {
  const weak = new Set((p.weakNumbers || []).map((w) => transliterate(w).toLowerCase()));
  const exact = (NUMBER_EXACT[p.code] = new Map());
  const bySk = (NUMBER_BY_LANG[p.code] = new Map());
  for (const [value, kind, ...spellings] of p.numbers) {
    for (const s of spellings) {
      const latin = transliterate(s).toLowerCase();
      const entry = { value, kind, weak: weak.has(latin), lang: p.code };
      if (!exact.has(latin)) exact.set(latin, entry);
      const sk = skeleton(s);
      const prev = bySk.get(sk);
      // A word that is both "hundred" (mult) and "one hundred" (add) behaves as mult.
      if (!prev || (prev.value === value && kind === 'mult')) bySk.set(sk, entry);
      const lex = LEXICON.get(sk);
      const otherLanguageWord = lex && [...lex.langs].some((l) => l !== p.code);
      if (!entry.weak && !otherLanguageWord) {
        const g = NUMBER_WORDS.get(sk);
        if (!g || (g.value === value && kind === 'mult')) NUMBER_WORDS.set(sk, entry);
      }
      if (kind !== 'mod' && p.code !== 'en' && sk.length >= 4) {
        const bare = sk.replace(/[aeiou]$/, '');
        for (const form of [bare, bare + 'i', bare + 'a']) {
          if (form.length >= 3 && !NUMBER_PREFIXES.has(form)) NUMBER_PREFIXES.set(form, { value, kind });
        }
      }
    }
  }
}

export function lexiconOf(word) {
  return LEXICON.get(skeleton(word)) || null;
}
