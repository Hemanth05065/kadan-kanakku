// The shop voice: a real person records short phrases, number words and customer names once,
// and every reply is stitched together from those clips (the way station announcements are).
// No synthetic voice, no network, no delay.
//
// This module is pure (no browser APIs) so it can be unit-tested:
//   VOICE_SCRIPT      what to record, per language
//   numberClips(n)    1,140 -> ['aayirathi', 'h100', 'n40']  ("aayirathi noothi naappadhu")
//   planReply(r, has) a reply -> [{ clip }, { gap }] using only recorded clips, or null
//   processClip(pcm)  trim silence, level, fade: ready to stitch
//   nameClipKey(c)    the clip that holds a customer's name

// ── What to record ───────────────────────────────────────────────────────────

const P = (key, text, latin, hint) => ({ key, text, latin, hint });

const TA_PHRASES = [
  P('roobaai_kadan', 'ரூபாய் கடன்.', 'roobaai kadan.', 'as in "240 roobaai kadan"'),
  P('roobaai_kuduthaar', 'ரூபாய் குடுத்தார்.', 'roobaai kuduthaar.', 'as in "100 roobaai kuduthaar"'),
  P('mottham_baaki', 'மொத்தம் பாக்கி', 'mottham baaki', 'as in "mottham baaki 1,140"'),
  P('innum_baaki', 'இன்னும் பாக்கி', 'innum baaki', 'as in "innum baaki 900"'),
  P('baaki', 'பாக்கி', 'baaki', 'as in "Murugan anna, baaki 1,140 roobaai"'),
  P('roobaai', 'ரூபாய்.', 'roobaai.', 'end of a sentence'),
  P('baaki_illa', 'பாக்கி இல்ல.', 'baaki illa.', 'nothing owed'),
  P('advance_paid', 'ரூபாய் முன்னாடியே குடுத்திருக்கார்.', 'roobaai munnaadiye kuduthirukkaar.', 'paid in advance'),
  P('adhiga_baaki', 'அதிக பாக்கி:', 'adhiga baaki:', 'start of "who owes most"'),
  P('top_none', 'யாருக்கும் பாக்கி இல்ல.', 'yaarukkum baaki illa.'),
  P('innaikku_vasool', 'இன்னைக்கு வசூல்:', 'innaikku vasool:', 'start of "who to collect from today"'),
  P('vasool_illa', 'இன்னைக்கு வசூல் பண்ண யாரும் இல்ல.', 'innaikku vasool panna yaarum illa.'),
  P('qr_kaattren', 'QR காட்டுறேன், ஸ்கேன் பண்ணுங்க.', 'QR kaattren, scan pannunga.', 'as in "Murugan anna, 1,140 roobaai. QR kaattren…"'),
  P('innikku', 'இன்னிக்கு', 'innikku', 'as in "innikku 3,340 roobaai kadan"'),
  P('roobaai_varavu', 'ரூபாய் வரவு.', 'roobaai varavu.', 'money received today'),
  P('ask_amount', 'எவ்வளவு ரூபாய்? திரும்ப சொல்லுங்க.', 'evlo roobaai? thirumba sollunga.'),
  P('ask_who', 'யாருக்கு? பேரு சொல்லுங்க.', 'yaarukku? peru sollunga.'),
  P('yaaru', 'யாரு?', 'yaaru?', 'as in "Yaaru? Murugan anna, illa Murugesan?"'),
  P('illa_or', 'இல்ல', 'illa', '"or", as in "Murugan anna, illa Murugesan?"'),
  P('sariyaa', 'சரியா?', 'sariyaa?', 'as in "Murugan anna, sariyaa?"'),
  P('tap_which', 'ஸ்கிரீன்ல தொட்டு சொல்லுங்க.', 'screen-la thottu sollunga.', 'tap the name on the screen'),
  P('new_customer_q', 'புது கஸ்டமரா? சேவ் பண்ணட்டுமா?', 'pudhu customer-aa? save pannattumaa?'),
  P('seri', 'சரி,', 'seri,', 'as in "Seri, Ganesh save pannitten"'),
  P('save_pannitten', 'சேவ் பண்ணிட்டேன்.', 'save pannitten.'),
  P('munnaadiye_irukkaar', 'முன்னாடியே இருக்கார்.', 'munnaadiye irukkaar.', 'customer already exists'),
  P('no_account', 'இந்த பேர்ல கணக்கு இல்ல.', 'indha peru-la kanakku illa.'),
  P('confirm_q', 'ரூபாய்னு சொன்னீங்க, சரியா?', 'roobaai-nu sonneenga, sariyaa?', 'as in "2,500 roobaai-nu sonneenga, sariyaa?"'),
  P('undo_done', 'சரி, கேன்சல் பண்ணிட்டேன்.', 'seri, cancel pannitten.'),
  P('undo_done_2', 'கேன்சல் ஆயிடுச்சு.', 'cancel aayiduchu.'),
  P('nothing_to_undo', 'கேன்சல் பண்ண ஒண்ணும் இல்ல.', 'cancel panna onnum illa.'),
  P('not_saved', 'சரி, சேவ் பண்ணல.', 'seri, save pannala.'),
  P('not_saved_2', 'சரி, விட்டுடறேன்.', 'seri, vittudren.'),
  P('try_again', 'புரியல, திரும்ப சொல்லுங்க.', 'puriyala, thirumba sollunga.'),
  P('try_again_2', 'இன்னொரு தடவை சொல்லுங்க.', 'innoru thadava sollunga.'),
  P('failed_twice', 'புரியல. ஸ்கிரீன்ல டைப் பண்ணுங்க.', 'puriyala. screen-la type pannunga.'),
  P('come_closer', 'கொஞ்சம் பக்கத்துல வந்து பேசுங்க.', 'konjam pakkathula vandhu pesunga.'),
  P('saved_for_review', 'நெட் இல்ல. ரெக்கார்டிங் சேவ் பண்ணிட்டேன், அப்புறம் பாருங்க.', 'net illa. recording save pannitten, apparam paarunga.'),
  P('ok', 'சரி.', 'seri.'),
  P('ok_2', 'சரிங்க.', 'seringa.'),
];

// Spoken Tamil numbers. "Joining" forms are used when more follows: 240 = irunoothi naappadhu.
const TA_NUMBERS = [
  P('n0', 'பூஜ்ஜியம்', 'poojjiyam', '0'),
  ...[
    ['ஒண்ணு', 'onnu'], ['ரெண்டு', 'rendu'], ['மூணு', 'moonu'], ['நாலு', 'naalu'], ['அஞ்சு', 'anju'],
    ['ஆறு', 'aaru'], ['ஏழு', 'ezhu'], ['எட்டு', 'ettu'], ['ஒம்போது', 'ombodhu'],
  ].map(([ta, la], i) => P(`n${i + 1}`, ta, la, String(i + 1))),
  ...[
    ['பத்து', 'pathu'], ['பதினொண்ணு', 'padhinonnu'], ['பன்னெண்டு', 'pannendu'], ['பதிமூணு', 'padhimoonu'],
    ['பதினாலு', 'padhinaalu'], ['பதினஞ்சு', 'padhinanju'], ['பதினாறு', 'padhinaaru'], ['பதினேழு', 'padhinezhu'],
    ['பதினெட்டு', 'padhinettu'], ['பத்தொம்போது', 'patthombodhu'],
  ].map(([ta, la], i) => P(`n${i + 10}`, ta, la, String(i + 10))),
  ...[
    ['இருபது', 'irubadhu'], ['முப்பது', 'muppadhu'], ['நாப்பது', 'naappadhu'], ['அம்பது', 'ambadhu'],
    ['அறுபது', 'arubadhu'], ['எழுபது', 'ezhubadhu'], ['எம்பது', 'embadhu'], ['தொண்ணூறு', 'thonnooru'],
  ].map(([ta, la], i) => P(`n${(i + 2) * 10}`, ta, la, String((i + 2) * 10))),
  ...[
    ['இருபத்தி', 'irubaththi'], ['முப்பத்தி', 'muppaththi'], ['நாப்பத்தி', 'naappaththi'], ['அம்பத்தி', 'ambaththi'],
    ['அறுபத்தி', 'arubaththi'], ['எழுபத்தி', 'ezhubaththi'], ['எம்பத்தி', 'embaththi'], ['தொண்ணூத்தி', 'thonnootthi'],
  ].map(([ta, la], i) => P(`t${(i + 2) * 10}`, ta, la, `${(i + 2) * 10} joining, as in "${la} anju" (${(i + 2) * 10 + 5})`)),
  ...[
    ['நூறு', 'nooru'], ['இருநூறு', 'irunooru'], ['முன்னூறு', 'munnooru'], ['நானூறு', 'naanooru'], ['ஐநூறு', 'ainooru'],
    ['அறுநூறு', 'arunooru'], ['எழுநூறு', 'ezhunooru'], ['எண்ணூறு', 'ennooru'], ['தொள்ளாயிரம்', 'thollaayiram'],
  ].map(([ta, la], i) => P(`n${(i + 1) * 100}`, ta, la, String((i + 1) * 100))),
  ...[
    ['நூத்தி', 'noothi'], ['இருநூத்தி', 'irunoothi'], ['முன்னூத்தி', 'munnoothi'], ['நானூத்தி', 'naanoothi'], ['ஐநூத்தி', 'ainoothi'],
    ['அறுநூத்தி', 'arunoothi'], ['எழுநூத்தி', 'ezhunoothi'], ['எண்ணூத்தி', 'ennoothi'], ['தொள்ளாயிரத்தி', 'thollaayirathi'],
  ].map(([ta, la], i) => P(`h${(i + 1) * 100}`, ta, la, `${(i + 1) * 100} joining, as in "${la} pathu" (${(i + 1) * 100 + 10})`)),
  P('aayiram', 'ஆயிரம்', 'aayiram', '1,000'),
  P('aayirathi', 'ஆயிரத்தி', 'aayirathi', 'thousand joining, as in "aayirathi noothi" (1,100)'),
  P('oru', 'ஒரு', 'oru', 'as in "oru latcham"'),
  P('latcham', 'லட்சம்', 'latcham', '1,00,000'),
  P('latchathi', 'லட்சத்தி', 'latchathi', 'lakh joining, as in "oru latchathi aayiram"'),
];

export const VOICE_SCRIPT = {
  ta: {
    sections: [
      { id: 'phrases', title: 'Phrases', items: TA_PHRASES },
      { id: 'numbers', title: 'Numbers', items: TA_NUMBERS },
    ],
  },
};
export const VOICE_LANGS = Object.keys(VOICE_SCRIPT);

/** Every clip of a language's script (names excluded). */
export function scriptItems(lang) {
  return (VOICE_SCRIPT[lang]?.sections || []).flatMap((s) => s.items);
}

// ── Names ────────────────────────────────────────────────────────────────────

/** "Murugan anna" -> "murugan anna". Keyed by the spoken label so demo resets keep the clip. */
export function nameKeyOf(customerOrLabel) {
  const label = typeof customerOrLabel === 'string'
    ? customerOrLabel
    : [customerOrLabel?.name, customerOrLabel?.honorific].filter(Boolean).join(' ');
  return label.trim().toLowerCase().replace(/\s+/g, ' ') || null;
}
export const nameClipKey = (customerOrLabel) => {
  const k = nameKeyOf(customerOrLabel);
  return k ? `name:${k}` : null;
};

// ── Numbers ──────────────────────────────────────────────────────────────────

function below100(n) {
  if (n < 20) return [`n${n}`];
  const tens = Math.floor(n / 10) * 10;
  const u = n % 10;
  return u ? [`t${tens}`, `n${u}`] : [`n${tens}`];
}

function below1000(n) {
  const h = Math.floor(n / 100) * 100;
  const rest = n % 100;
  if (!h) return below100(rest);
  return rest ? [`h${h}`, ...below100(rest)] : [`n${h}`];
}

/**
 * Clip keys that say a whole number of rupees in spoken Tamil, or null (fractions, negative,
 * a crore or more). 240 -> irunoothi naappadhu, 2,500 -> rendu aayirathi ainooru.
 */
export function numberClips(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n >= 1e7) return null;
  if (n === 0) return ['n0'];
  const lakhs = Math.floor(n / 1e5);
  const thousands = Math.floor((n % 1e5) / 1000);
  const rest = n % 1000;
  const out = [];
  if (lakhs) out.push(...(lakhs === 1 ? ['oru'] : below100(lakhs)), thousands || rest ? 'latchathi' : 'latcham');
  if (thousands) out.push(...(thousands === 1 ? [] : below100(thousands)), rest ? 'aayirathi' : 'aayiram');
  if (rest) out.push(...below1000(rest));
  return out;
}

// ── Sentences ────────────────────────────────────────────────────────────────

// Clips keep LEAD_MS of silence before the voice and TAIL_MS after it (see processClip).
// Words of one number are pulled together so "irunoothi naappadhu" flows; phrases keep a
// natural breath between them, a little longer after a comma or full stop.
export const LEAD_MS = 50;
export const TAIL_MS = 120;
const TIGHT = -(LEAD_MS + TAIL_MS - 40);
const COMMA = 140;
const STOP = 260;

const clip = (key, join = 0) => ({ clip: key, join });
const gap = (ms) => ({ gap: ms });

/** Builders for each reply. `name(k)` returns segments or null when that name was not recorded. */
const TA_PLANS = {
  credit_saved: (p, x) => [...x.optName(p.nameKey, COMMA), ...x.num(p.amtN), clip('roobaai_kadan'), gap(STOP), clip('mottham_baaki'), ...x.num(p.totalN)],
  payment_saved: (p, x) => [...x.optName(p.nameKey, COMMA), ...x.num(p.amtN), clip('roobaai_kuduthaar'), gap(STOP), clip('innum_baaki'), ...x.num(p.totalN)],
  balance: (p, x) => [...x.optName(p.nameKey, COMMA), clip('baaki'), ...x.num(p.totalN), clip('roobaai')],
  balance_zero: (p, x) => [...x.optName(p.nameKey, COMMA), clip('baaki_illa')],
  advance: (p, x) => [...x.optName(p.nameKey, COMMA), ...x.num(p.totalN), clip('advance_paid')],
  top: (p, x) => [clip('adhiga_baaki'), gap(COMMA), ...(p.items || []).flatMap((it) => [...x.name(it.nameKey), ...x.num(it.n), gap(COMMA)])],
  top_none: () => [clip('top_none')],
  collect_list: (p, x) => [clip('innaikku_vasool'), gap(COMMA), ...(p.items || []).flatMap((it) => [...x.name(it.nameKey), ...x.num(it.n), gap(COMMA)])],
  collect_none: () => [clip('vasool_illa')],
  pay_qr: (p, x) => [...x.optName(p.nameKey, COMMA), ...x.num(p.amtN), clip('roobaai'), gap(STOP), clip('qr_kaattren')],
  today_summary: (p, x) => [clip('innikku'), ...x.num(p.creditN), clip('roobaai_kadan'), gap(COMMA), ...x.num(p.paymentN), clip('roobaai_varavu'), gap(STOP), clip('mottham_baaki'), ...x.num(p.totalN)],
  ask_amount: () => [clip('ask_amount')],
  ask_who: () => [clip('ask_who')],
  ask_which: (p, x) => (x.hasName(p.aKey) && x.hasName(p.bKey)
    ? [clip('yaaru'), gap(COMMA), ...x.name(p.aKey), gap(80), clip('illa_or'), ...x.name(p.bKey)]
    : [clip('yaaru'), gap(COMMA), clip('tap_which')]),
  ask_is_it: (p, x) => (x.hasName(p.aKey) ? [...x.name(p.aKey), gap(COMMA), clip('sariyaa')] : [clip('yaaru'), gap(COMMA), clip('tap_which')]),
  ask_new_customer: (p, x) => [...x.optName(p.nameKey, COMMA), clip('new_customer_q')],
  customer_added: (p, x) => [clip('seri'), ...x.optName(p.nameKey, 0), clip('save_pannitten')],
  customer_exists: (p, x) => [...x.optName(p.nameKey, 0), clip('munnaadiye_irukkaar')],
  no_account: () => [clip('no_account')],
  confirm_amount: (p, x) => [...x.optName(p.nameKey, COMMA), ...x.num(p.amtN), clip('confirm_q')],
  undo_done: (p, x) => [clip(x.variant ? 'undo_done_2' : 'undo_done')],
  nothing_to_undo: () => [clip('nothing_to_undo')],
  not_saved: (p, x) => [clip(x.variant ? 'not_saved_2' : 'not_saved')],
  try_again: (p, x) => [clip(x.variant ? 'try_again_2' : 'try_again')],
  failed_twice: () => [clip('failed_twice')],
  come_closer: () => [clip('come_closer')],
  saved_for_review: () => [clip('saved_for_review')],
  ok: (p, x) => [clip(x.variant ? 'ok_2' : 'ok')],
};
const PLANS = { ta: TA_PLANS };

class Missing extends Error {}

/**
 * Turn a reply into clip segments using only clips that were recorded (`has(key)`).
 * Customer names are optional where the sentence still makes sense without them.
 * Returns null when the reply can't be said in the shop voice (a missing clip, a fraction).
 */
export function planReply(reply, has) {
  if (!reply) return null;
  if (reply.chain) {
    const parts = reply.chain.map((r) => planReply(r, has));
    if (parts.some((x) => !x)) return null;
    return parts.flatMap((x, i) => (i ? [gap(STOP), ...x] : x));
  }
  const build = PLANS[reply.lang]?.[reply.key];
  if (!build) return null;
  const hasName = (k) => Boolean(k) && has(`name:${k}`);
  const x = {
    variant: reply.variant || 0,
    hasName,
    name: (k) => {
      if (!hasName(k)) throw new Missing(`name:${k}`);
      return [clip(`name:${k}`)];
    },
    optName: (k, after) => (hasName(k) ? [clip(`name:${k}`), ...(after ? [gap(after)] : [])] : []),
    num: (n) => {
      const keys = numberClips(n);
      if (!keys) throw new Missing(`number ${n}`);
      return keys.map((k, i) => clip(k, i ? TIGHT : 0));
    },
  };
  let segs;
  try {
    segs = build(reply.params || {}, x);
  } catch (e) {
    if (e instanceof Missing) return null;
    throw e;
  }
  return segs.every((s) => !s.clip || has(s.clip)) ? segs : null;
}

/** Clips a reply needs that are not recorded yet (for the "try it" panel). */
export function missingFor(reply, has) {
  const all = new Set();
  const probe = (k) => {
    if (!has(k)) all.add(k);
    return true;
  };
  planReply(reply, probe);
  return [...all].filter((k) => !k.startsWith('name:'));
}

// ── Clip clean-up ────────────────────────────────────────────────────────────

const dbOf = (x) => (x > 0 ? 20 * Math.log10(x) : -120);

/**
 * Trim the silence around a recorded word, remove DC, bring speech to a common loudness and
 * fade the edges so clips join without clicks. Returns { pcm, ms, verdict } where verdict is
 * ok | short (nothing said) | quiet (too far from the mic) | loud (distorted).
 */
export function processClip(input, rate) {
  const frame = Math.max(1, Math.round(rate * 0.01)); // 10 ms
  const n = Math.floor(input.length / frame);
  if (n < 10) return { pcm: new Float32Array(0), ms: 0, verdict: 'short' };

  let mean = 0;
  for (let i = 0; i < input.length; i++) mean += input[i];
  mean /= input.length;
  const pcm = new Float32Array(input.length);
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < input.length; i++) {
    pcm[i] = input[i] - mean;
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    if (Math.abs(input[i]) > 0.985) clipped++;
  }

  const energy = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) s += pcm[i] * pcm[i];
    energy[f] = dbOf(Math.sqrt(s / frame));
  }
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const noise = sorted[Math.floor(n * 0.1)];
  const loudest = sorted[n - 1];
  const threshold = Math.max(noise + 10, loudest - 35, -58);
  let first = -1;
  let last = -1;
  let speech = 0;
  let speechPower = 0;
  for (let f = 0; f < n; f++) {
    if (energy[f] > threshold) {
      if (first < 0) first = f;
      last = f;
      speech++;
      speechPower += 10 ** (energy[f] / 10);
    }
  }
  if (first < 0 || speech * 10 < 120) return { pcm: new Float32Array(0), ms: 0, verdict: 'short' };
  if (loudest < -45) return { pcm: new Float32Array(0), ms: 0, verdict: 'quiet' };
  if (clipped / input.length > 0.01) return { pcm: new Float32Array(0), ms: 0, verdict: 'loud' };

  const start = Math.max(0, first * frame - Math.round((rate * LEAD_MS) / 1000));
  const end = Math.min(pcm.length, (last + 1) * frame + Math.round((rate * TAIL_MS) / 1000));
  const out = pcm.slice(start, end);

  // Speech at about -20 dBFS RMS, peaks below -1 dBFS.
  const rms = Math.sqrt(speechPower / speech);
  const gain = Math.min(10 ** (-20 / 20) / Math.max(rms, 1e-6), 10 ** (-1 / 20) / Math.max(peak, 1e-6));
  const fadeIn = Math.round(rate * 0.008);
  const fadeOut = Math.round(rate * 0.03);
  for (let i = 0; i < out.length; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    const fromEnd = out.length - 1 - i;
    if (fromEnd < fadeOut) g *= fromEnd / fadeOut;
    out[i] *= g;
  }
  return { pcm: out, ms: Math.round((out.length / rate) * 1000), verdict: 'ok' };
}
