// Indic script (Tamil, Devanagari, Telugu) -> Latin letters, plus a "sound skeleton" used to
// compare words by how they sound rather than how they are spelled
// (Murugan / Muruga / முருகன், naarpadhu / நாற்பது, Ravi / रवि / రవి).

const digitMap = (zero) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String.fromCharCode(zero + i), String(i)]));

const SCRIPTS = {
  ta: {
    re: /[஀-௿]/,
    vowels: { 'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ii', 'உ': 'u', 'ஊ': 'uu', 'எ': 'e', 'ஏ': 'ee', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'oo', 'ஔ': 'au' },
    signs: { 'ா': 'aa', 'ி': 'i', 'ீ': 'ii', 'ு': 'u', 'ூ': 'uu', 'ெ': 'e', 'ே': 'ee', 'ை': 'ai', 'ொ': 'o', 'ோ': 'oo', 'ௌ': 'au', 'ௗ': 'au' },
    virama: '்',
    consonants: {
      'க': 'k', 'ங': 'ng', 'ச': 's', 'ஞ': 'nj', 'ட': 'd', 'ண': 'n', 'த': 'th', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y',
      'ர': 'r', 'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l', 'ற': 'r', 'ன': 'n', 'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h',
    },
    marks: {},
    digits: digitMap(0x0be6),
    silent: ['ஃ'],
    schwaFinal: false,
  },
  hi: {
    re: /[ऀ-ॿ]/,
    vowels: { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' },
    signs: { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o' },
    virama: '्',
    consonants: {
      'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
      'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
      'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
      'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
    },
    marks: { 'ं': 'n', 'ँ': 'n', 'ः': 'h' },
    digits: digitMap(0x0966),
    silent: ['़', '।'],
    schwaFinal: true, // Hindi drops the inherent vowel at the end of a word: राम = ram
  },
  te: {
    re: /[ఀ-౿]/,
    vowels: { 'అ': 'a', 'ఆ': 'aa', 'ఇ': 'i', 'ఈ': 'ii', 'ఉ': 'u', 'ఊ': 'uu', 'ఋ': 'ru', 'ఎ': 'e', 'ఏ': 'ee', 'ఐ': 'ai', 'ఒ': 'o', 'ఓ': 'oo', 'ఔ': 'au' },
    signs: { 'ా': 'aa', 'ి': 'i', 'ీ': 'ii', 'ు': 'u', 'ూ': 'uu', 'ృ': 'ru', 'ె': 'e', 'ే': 'ee', 'ై': 'ai', 'ొ': 'o', 'ో': 'oo', 'ౌ': 'au' },
    virama: '్',
    consonants: {
      'క': 'k', 'ఖ': 'kh', 'గ': 'g', 'ఘ': 'gh', 'ఙ': 'ng', 'చ': 'ch', 'ఛ': 'chh', 'జ': 'j', 'ఝ': 'jh', 'ఞ': 'ny',
      'ట': 't', 'ఠ': 'th', 'డ': 'd', 'ఢ': 'dh', 'ణ': 'n', 'త': 't', 'థ': 'th', 'ద': 'd', 'ధ': 'dh', 'న': 'n',
      'ప': 'p', 'ఫ': 'ph', 'బ': 'b', 'భ': 'bh', 'మ': 'm', 'య': 'y', 'ర': 'r', 'ల': 'l', 'వ': 'v', 'శ': 'sh',
      'ష': 'sh', 'స': 's', 'హ': 'h', 'ళ': 'l', 'ఱ': 'r',
    },
    marks: { 'ం': 'm', 'ఁ': 'n', 'ః': 'h' },
    digits: digitMap(0x0c66),
    silent: [],
    schwaFinal: false,
  },
};

// Keys are NFC-normalised so composed and decomposed input (both common from keyboards and
// speech-to-text) map the same way. NFC keeps Devanagari nukta letters decomposed (base + ़),
// which the pair lookup below handles.
for (const sc of Object.values(SCRIPTS)) {
  for (const k of ['vowels', 'signs', 'consonants', 'marks']) {
    sc[k] = Object.fromEntries(Object.entries(sc[k]).map(([ch, v]) => [ch.normalize('NFC'), v]));
  }
}

const ANY_INDIC = /[ऀ-ॿ஀-௿ఀ-౿]/;

/** Which Indic script a string is written in ('ta' | 'hi' | 'te'), or null for Latin. */
export function scriptOf(s) {
  const str = String(s || '');
  for (const [code, sc] of Object.entries(SCRIPTS)) if (sc.re.test(str)) return code;
  return null;
}
export const hasIndic = (s) => ANY_INDIC.test(s || '');
export const hasTamil = (s) => SCRIPTS.ta.re.test(s || '');

const isLetterLatin = (ch) => /[a-z]/i.test(ch || '');

/** Transliterate Tamil / Devanagari / Telugu to simple Latin. Other characters pass through. */
export function transliterate(input) {
  const s = String(input || '').normalize('NFC');
  if (!hasIndic(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = scriptOf(ch);
    if (!code) { out += ch; continue; }
    const sc = SCRIPTS[code];
    // Devanagari nukta letters are two code points; try the pair first.
    const pair = ch + (s[i + 1] || '');
    const consonant = sc.consonants[pair] !== undefined ? pair : sc.consonants[ch] !== undefined ? ch : null;
    if (consonant) {
      if (consonant.length === 2) i++;
      const base = sc.consonants[consonant];
      const next = s[i + 1];
      if (next === sc.virama) { out += base; i++; }
      else if (sc.signs[next] !== undefined) { out += base + sc.signs[next]; i++; }
      else {
        const wordEnds = !next || !scriptOf(next) || /\s/.test(next);
        out += sc.schwaFinal && wordEnds && out.length && isLetterLatin(out[out.length - 1]) ? base : base + 'a';
      }
    } else if (sc.vowels[ch] !== undefined) out += sc.vowels[ch];
    else if (sc.marks[ch] !== undefined) out += sc.marks[ch];
    else if (sc.digits[ch] !== undefined) out += sc.digits[ch];
    else if (ch === sc.virama || sc.silent.includes(ch) || sc.signs[ch] !== undefined) continue;
    else out += ch;
  }
  return out;
}

const SKELETON_RULES = [
  [/ksh/g, 'ks'], [/zh/g, 'l'], [/sh/g, 's'], [/ch/g, 's'], [/th/g, 't'], [/dh/g, 't'],
  [/bh/g, 'p'], [/ph/g, 'p'], [/gh/g, 'k'], [/kh/g, 'k'],
  [/ee|ii/g, 'i'], [/oo|uu/g, 'u'], [/aa/g, 'a'], [/ae/g, 'e'],
  [/d/g, 't'], [/b/g, 'p'], [/g/g, 'k'], [/w/g, 'v'], [/f/g, 'p'], [/q/g, 'k'],
  [/x/g, 'ks'], [/c/g, 'k'], [/j/g, 's'], [/z/g, 's'],
  [/(?!^)h/g, ''],
];
const collapse = (w) => w.replace(/(.)\1+/g, '$1');

/**
 * Sound skeleton of a word: lower-case Latin with aspiration, voicing, vowel length and
 * doubled letters folded together. Equal skeletons ~ "sounds the same" to a Tamil ear.
 */
export function skeleton(word) {
  let w = transliterate(String(word || '')).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  w = w.replace(/[^a-z0-9]/g, '');
  for (const [re, rep] of SKELETON_RULES) w = w.replace(re, rep);
  // Tamil ற்ற / ன்ற are said "tr"/"ndr" or "rr"/"nr": fold both (nootru = nooru, ondru = onru).
  return collapse(collapse(w).replace(/tr/g, 'r'));
}

/** Drop a final nasal and trailing vowels: Murugan/Muruga -> muruk. */
export function stem(sk) {
  return String(sk || '').replace(/[nm]$/, '').replace(/[aeiou]+$/, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const levSim = (a, b) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0);

/** 0..1 similarity of two skeletons, tolerant to vocative / case endings. */
export function soundScore(skA, skB) {
  if (!skA || !skB) return 0;
  if (skA === skB) return 1;
  let score = levSim(skA, skB);
  const sa = stem(skA), sb = stem(skB);
  if (sa.length >= 2 && sa === sb) score = Math.max(score, 0.95);
  else if (sa.length >= 3 && sb.length >= 3) score = Math.max(score, levSim(sa, sb) * 0.93);
  // Very short names (Ravi, Raja) need near-exact matches.
  if (Math.min(skA.length, skB.length) <= 3 && score < 1) score *= 0.9;
  return score;
}
