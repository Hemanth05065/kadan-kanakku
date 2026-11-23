// The conversation brain. Pure: (parse, conversation, ledger context) -> action.
// The voice hook carries out the action (speak, count down, save, ask, open the form).
//
// Rules from the field:
//  • complete + confident (>= 0.8) + not large  -> confirm aloud, auto-save after 3 s
//  • large (> ₹2,000) or unsure                  -> "1,500-nu sonneenga, sariya?" first
//  • something missing                           -> ONE short question, then listen
//  • unknown name                                -> offer to add a new customer
//  • two names sound alike                       -> "Murugan anna-va, Murugesan-a?"
//  • corrections are remembered as aliases
//  • two failures                                -> "type it" + manual form; the clip goes to Needs review
import { LIMITS } from '../lib/config.js';
import { reply, PACKS } from '../i18n/index.js';
import { resolveName, buildNameIndex, displayName, tamilName, nativeNameFor } from '../lib/names.js';
import { balanceOf, balances, todayStats, totalPending } from '../lib/ledger.js';
import { fmt, sayNum } from '../lib/util.js';
import { skeleton } from '../lib/translit.js';
import { tokenize } from '../lib/numbers.js';
import { nameKeyOf } from './voicePack.js';

export const EMPTY_CONVO = Object.freeze({ awaiting: null, pending: null, failures: 0 });

const label = (c) => (c.honorific ? `${c.name} ${c.honorific}` : c.name);
// Speak the native-script name when it is in the reply language's script (முருகன் அண்ணா for Tamil).
const sayName = (c, lang) => nativeNameFor(c.name_ta, lang) || label(c);
const spokenShow = (s) => displayName(s) || s;
const spokenSay = (s, lang) => nativeNameFor(tamilName(s), lang) || spokenShow(s);

const FIRST = new Set(['first', 'mutal', 'mutalla', 'motal', 'motalla', 'mutalatu', 'mutalavatu', 'mutalil'].map(skeleton));
const SECOND = new Set(['second', 'rentavatu', 'rentamatu', 'rentavatu', 'iranṭavatu', 'irantavatu', 'aduttatu', 'next'].map(skeleton));

function pickLang(parse, convo, ctx) {
  if (PACKS[ctx.replyLang]) return ctx.replyLang;
  if (convo.awaiting && convo.pending?.lang) return convo.pending.lang;
  return PACKS[parse.language] ? parse.language : 'ta';
}

const r = (key, lang, params) => reply(key, lang, params);

function ask(key, params, awaiting, pending, convo, options = []) {
  return {
    kind: 'ask',
    reply: r(key, pending.lang, params),
    awaiting,
    options,
    convo: { awaiting, pending, failures: convo.failures },
  };
}

const answer = (key, lang, params = {}, extra = {}) => ({ kind: 'answer', reply: r(key, lang, params), convo: { ...EMPTY_CONVO }, ...extra });

const YES_NO = [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }];

function newPending(parse, lang) {
  return {
    intent: parse.intent,
    customer_name: parse.customer_name || null,
    llm_customer_id: parse.customer_id || null,
    customer_id: null,
    amount: parse.amount ?? null,
    items: parse.items || [],
    confidence: parse.confidence ?? 0.5,
    lang,
    transcripts: parse.transcript ? [parse.transcript] : [],
    clipKey: parse.clipKey ?? null,
    clarified: false,
    confirmed: false,
  };
}

const withUtterance = (p, parse, patch = {}) => ({
  ...p,
  ...patch,
  transcripts: parse.transcript ? [...p.transcripts, parse.transcript] : p.transcripts,
});

export function toEntryFields(p) {
  return {
    customer_id: p.customer_id,
    type: p.intent,
    amount: Number(p.amount),
    items: p.items || [],
    transcript: p.transcripts.join(' → ') || null,
    confidence: p.clarified || p.confirmed ? Math.max(p.confidence, 0.8) : p.confidence,
    lang: p.lang,
    source: 'voice',
    status: 'confirmed',
  };
}

/** Continue a pending command once everything we know is filled in. */
export function evaluate(p, convo, ctx) {
  const lang = p.lang;
  if (!p.customer_id) {
    if (!p.customer_name) return ask('ask_who', {}, 'customer', p, convo);
    const res = resolveName(p.customer_name, ctx.index, p.llm_customer_id);
    if (res.status === 'match') {
      p = { ...p, customer_id: res.customer.id };
    } else if (res.status === 'ambiguous') {
      const [a, b] = res.candidates;
      return ask(
        'ask_which',
        { a: label(a), aSay: sayName(a, lang), aKey: nameKeyOf(a), b: label(b), bSay: sayName(b, lang), bKey: nameKeyOf(b) },
        'choice',
        { ...p, candidates: [a.id, b.id] },
        convo,
        [{ value: `id:${a.id}`, label: label(a) }, { value: `id:${b.id}`, label: label(b) }, { value: 'new', label: 'new_customer' }],
      );
    } else if (res.status === 'weak') {
      const [a] = res.candidates;
      return ask(
        'ask_is_it',
        { a: label(a), aSay: sayName(a, lang), aKey: nameKeyOf(a) },
        'choice',
        { ...p, candidates: [a.id] },
        convo,
        [{ value: `id:${a.id}`, label: label(a) }, { value: 'new', label: 'new_customer' }],
      );
    } else {
      const params = { name: spokenShow(p.customer_name), nameSay: spokenSay(p.customer_name, lang) };
      if (p.intent === 'query_balance') return answer('no_account', lang, params);
      return ask('ask_new_customer', params, 'new_customer', p, convo, YES_NO);
    }
  }

  const c = ctx.customers.find((x) => x.id === p.customer_id);
  if (!c) return answer('try_again', lang);
  const bal = balanceOf(ctx.entries, c.id);
  const who = { name: label(c), nameSay: sayName(c, lang), nameKey: nameKeyOf(c) };

  if (p.intent === 'query_balance') {
    const key = bal > 0 ? 'balance' : bal < 0 ? 'advance' : 'balance_zero';
    return answer(key, lang, { ...who, total: fmt(Math.abs(bal)), totalSay: sayNum(Math.abs(bal)), totalN: Math.abs(bal) }, { customerId: c.id });
  }
  if (p.intent === 'add_customer') return answer('customer_exists', lang, who, { customerId: c.id });

  if (!(Number(p.amount) > 0)) return ask('ask_amount', {}, 'amount', { ...p, amount: null }, convo);

  const amount = Number(p.amount);
  const total = bal + (p.intent === 'credit' ? amount : -amount);
  const params = { ...who, amt: fmt(amount), amtSay: sayNum(amount), amtN: amount, total: fmt(total), totalSay: sayNum(total), totalN: total };
  const unsure = (p.confidence ?? 0) < LIMITS.CONFIDENCE_OK && !p.clarified;
  if (!p.confirmed && (amount > LIMITS.LARGE_AMOUNT || unsure)) {
    return ask('confirm_amount', params, 'confirm', p, convo, YES_NO);
  }
  return {
    kind: p.confirmed ? 'save' : 'pending_save',
    reply: r(p.intent === 'credit' ? 'credit_saved' : 'payment_saved', lang, params),
    entry: toEntryFields(p),
    clipKey: p.clipKey,
    customerId: c.id,
    convo: { ...EMPTY_CONVO },
  };
}

/** After the owner agreed to add a new customer. */
export function afterCustomerAdded(p, customer, ctx) {
  const lang = p.lang;
  const added = r('customer_added', lang, { name: label(customer), nameSay: sayName(customer, lang), nameKey: nameKeyOf(customer) });
  if (!['credit', 'payment', 'query_balance'].includes(p.intent)) return { kind: 'answer', reply: added, convo: { ...EMPTY_CONVO } };
  const next = evaluate({ ...p, customer_id: customer.id, clarified: true }, EMPTY_CONVO, ctx);
  return { ...next, reply: { ...next.reply, show: `${added.show} ${next.reply.show}`, say: `${added.say} ${next.reply.say}`, chain: [added, next.reply] } };
}

export function fail(convo, lang, reason, parse = null) {
  const failures = (convo.failures || 0) + 1;
  if (failures >= LIMITS.MAX_FAILURES) {
    const p = convo.pending;
    return {
      kind: 'manual',
      reply: r('failed_twice', lang),
      review: reason,
      prefill: {
        type: p?.intent === 'payment' ? 'payment' : 'credit',
        customer_id: p?.customer_id || null,
        // Only names from a recognised command; a garbled word is not a customer.
        customer_name: p?.customer_name || (parse && parse.intent !== 'unclear' ? parse.customer_name : null) || null,
        amount: p?.amount ?? parse?.amount ?? null,
        items: p?.items || parse?.items || [],
      },
      convo: { ...EMPTY_CONVO },
    };
  }
  const key = reason === 'noisy' || reason === 'quiet' ? 'come_closer' : convo.awaiting === 'amount' ? 'ask_amount' : 'try_again';
  return { kind: 'fail', reply: r(key, lang), review: reason, convo: { ...convo, failures } };
}

function topAnswer(ctx, lang) {
  const bal = balances(ctx.entries);
  const top = ctx.customers
    .filter((c) => !c.deleted_at && (bal.get(c.id) || 0) > 0)
    .sort((a, b) => bal.get(b.id) - bal.get(a.id))
    .slice(0, 3);
  if (!top.length) return answer('top_none', lang);
  return answer('top', lang, {
    list: top.map((c) => `${label(c)} ${fmt(bal.get(c.id))}`).join(', '),
    listSay: top.map((c) => `${sayName(c, lang)} ${sayNum(bal.get(c.id))}`).join(', '),
    items: top.map((c) => ({ nameKey: nameKeyOf(c), n: bal.get(c.id) })),
  });
}

/** "Indru 3,340 kadan, 100 varavu. Mottham baaki 8,400." */
export function todayAnswer(ctx, lang) {
  const s = todayStats(ctx.entries);
  const total = totalPending(balances(ctx.entries));
  return answer('today_summary', lang, {
    credit: fmt(s.credit), creditSay: sayNum(s.credit),
    payment: fmt(s.payment), paymentSay: sayNum(s.payment),
    total: fmt(total), totalSay: sayNum(total),
    creditN: s.credit, paymentN: s.payment, totalN: total,
  });
}

function isFreshCommand(parse) {
  const named = Boolean(parse.customer_name || parse.customer_id);
  if (['credit', 'payment'].includes(parse.intent)) return named && parse.amount != null;
  if (parse.intent === 'query_balance' || parse.intent === 'add_customer') return named;
  return parse.intent === 'query_top' || parse.intent === 'query_today';
}

function ordinal(parse) {
  for (const t of tokenize(parse.transcript || '')) {
    if (FIRST.has(t.sk)) return 0;
    if (SECOND.has(t.sk)) return 1;
  }
  if (!parse.customer_name && (parse.amount === 1 || parse.amount === 2)) return parse.amount - 1;
  return null;
}

function handleAwaiting(parse, convo, ctx, lang) {
  const p = convo.pending;
  const cancel = () => answer('not_saved', lang);
  const isNo = parse.intent === 'confirm_no' || parse.yes_no === 'no';
  const isYes = parse.intent === 'confirm_yes' || (parse.yes_no === 'yes' && !isNo);
  if (parse.intent === 'undo_last') return cancel();

  switch (convo.awaiting) {
    case 'amount':
      if (parse.amount > 0) return evaluate(withUtterance(p, parse, { amount: parse.amount, clarified: true, clipKey: parse.clipKey ?? p.clipKey }), convo, ctx);
      if (isNo) return cancel();
      return fail(convo, lang, 'unclear', parse);

    case 'customer':
      if (parse.customer_name || parse.customer_id) {
        return evaluate(withUtterance(p, parse, {
          customer_name: parse.customer_name,
          llm_customer_id: parse.customer_id,
          customer_id: null,
          amount: p.amount ?? parse.amount ?? null,
          clarified: true,
        }), convo, ctx);
      }
      if (isNo) return cancel();
      return fail(convo, lang, 'unclear', parse);

    case 'choice': {
      const cands = p.candidates || [];
      let chosen = null;
      if (parse.choiceId === 'new') {
        return { kind: 'add_customer', customer: { name: spokenShow(p.customer_name), name_ta: tamilName(p.customer_name) }, pending: p, convo: { ...EMPTY_CONVO } };
      }
      if (parse.choiceId) chosen = parse.choiceId;
      if (!chosen && (parse.customer_name || parse.customer_id)) {
        const candCustomers = ctx.customers.filter((c) => cands.includes(c.id));
        const local = resolveName(parse.customer_name || '', buildNameIndex(candCustomers, ctx.aliases), parse.customer_id);
        if (local.status === 'match') chosen = local.customer.id;
        else if (parse.customer_id && cands.includes(parse.customer_id)) chosen = parse.customer_id;
        else {
          const any = resolveName(parse.customer_name || '', ctx.index, parse.customer_id);
          if (any.status === 'match') chosen = any.customer.id;
        }
      }
      if (!chosen) {
        const o = ordinal(parse);
        if (o !== null && cands[o]) chosen = cands[o];
      }
      if (!chosen && isYes && cands.length === 1) chosen = cands[0];
      if (chosen) {
        const next = evaluate(withUtterance(p, parse, { customer_id: chosen, clarified: true }), convo, ctx);
        return { ...next, aliases: p.customer_name ? [{ customerId: chosen, spoken: p.customer_name }] : [] };
      }
      if (isNo) {
        const params = { name: spokenShow(p.customer_name), nameSay: spokenSay(p.customer_name, lang) };
        return ask('ask_new_customer', params, 'new_customer', p, convo, YES_NO);
      }
      return fail(convo, lang, 'unclear', parse);
    }

    case 'new_customer': {
      if (isYes || parse.choiceId === 'new') {
        return { kind: 'add_customer', customer: { name: spokenShow(p.customer_name), name_ta: tamilName(p.customer_name) }, pending: p, convo: { ...EMPTY_CONVO } };
      }
      // "Illa, Murugan" - they meant someone we already know: learn the alias.
      if (parse.customer_name || parse.customer_id || parse.choiceId) {
        const res = parse.choiceId
          ? { status: 'match', customer: ctx.customers.find((c) => c.id === parse.choiceId) }
          : resolveName(parse.customer_name || '', ctx.index, parse.customer_id);
        if (res.status === 'match' && res.customer) {
          const next = evaluate(withUtterance(p, parse, { customer_id: res.customer.id, clarified: true }), convo, ctx);
          return { ...next, aliases: [{ customerId: res.customer.id, spoken: p.customer_name }] };
        }
      }
      if (isNo) return cancel();
      return fail(convo, lang, 'unclear', parse);
    }

    case 'confirm':
      if (parse.amount > 0 && !isNo) {
        if (Number(parse.amount) === Number(p.amount)) return evaluate(withUtterance(p, parse, { confirmed: true }), convo, ctx);
        return evaluate(withUtterance(p, parse, { amount: parse.amount, clarified: true, clipKey: parse.clipKey ?? p.clipKey }), convo, ctx);
      }
      if (isYes) return evaluate(withUtterance(p, parse, { confirmed: true }), convo, ctx);
      if (isNo) return ask('ask_amount', {}, 'amount', { ...p, amount: null }, convo);
      return fail(convo, lang, 'unclear', parse);

    default:
      return null;
  }
}

/**
 * Main entry. `parse` is the merged understanding of one utterance (or a quick-reply tap),
 * `convo` the conversation so far, `ctx` = { customers, aliases, entries, index, replyLang,
 * lastUndoable(), justSaved }.
 */
export function decide(parse, convo, ctx) {
  const lang = pickLang(parse, convo, ctx);
  if (convo.awaiting && convo.pending && !isFreshCommand(parse)) {
    const handled = handleAwaiting(parse, convo, ctx, lang);
    if (handled) return handled;
  }
  const failures = convo.awaiting ? 0 : convo.failures;
  const base = { ...EMPTY_CONVO, failures };

  switch (parse.intent) {
    case 'credit':
    case 'payment':
    case 'query_balance':
      return evaluate(newPending(parse, lang), base, ctx);
    case 'add_customer': {
      const p = newPending(parse, lang);
      if (!p.customer_name) return ask('ask_who', {}, 'customer', p, base);
      const res = resolveName(p.customer_name, ctx.index);
      if (res.status === 'match' && res.score >= 0.97) {
        return answer('customer_exists', lang, { name: label(res.customer), nameSay: sayName(res.customer, lang), nameKey: nameKeyOf(res.customer) });
      }
      const params = { name: spokenShow(p.customer_name), nameSay: spokenSay(p.customer_name, lang) };
      return ask('ask_new_customer', params, 'new_customer', p, base, YES_NO);
    }
    case 'query_top':
      return topAnswer(ctx, lang);
    case 'query_today':
      return todayAnswer(ctx, lang);
    case 'undo_last': {
      const e = ctx.lastUndoable();
      return e ? { kind: 'undo', entryId: e.id, reply: r('undo_done', lang), convo: { ...EMPTY_CONVO } } : answer('nothing_to_undo', lang);
    }
    case 'confirm_no':
      if (ctx.justSaved) return { kind: 'undo', entryId: ctx.justSaved, reply: r('undo_done', lang), convo: { ...EMPTY_CONVO } };
      return answer('ok', lang);
    case 'confirm_yes':
      return answer('ok', lang);
    default:
      return fail(base, lang, 'unclear', parse);
  }
}
