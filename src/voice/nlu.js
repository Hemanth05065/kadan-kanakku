// Understanding = open LLM (server) + deterministic Tamil/English grammar (on device).
// The LLM handles messy phrasing; the grammar catches number and name slips and keeps
// working with no internet. Disagreements lower confidence, which makes the app confirm aloud.
import { getState } from '../lib/store.js';
import { parseLocal } from '../lib/localParser.js';
import { buildNameIndex } from '../lib/names.js';
import { serverAvailable, callFunction, NotConfigured } from './server.js';
import { PACKS } from '../i18n/index.js';

function compactCustomers(customers, aliases) {
  const byId = new Map();
  for (const a of aliases) {
    if (a.deleted_at) continue;
    if (!byId.has(a.customer_id)) byId.set(a.customer_id, []);
    byId.get(a.customer_id).push(a.alias);
  }
  return customers
    .filter((c) => !c.deleted_at)
    .map((c) => ({ id: c.id, name: c.name, ...(c.name_ta ? { name_ta: c.name_ta } : {}), ...(byId.get(c.id) ? { aliases: byId.get(c.id) } : {}) }));
}

export function mergeParses(llm, local) {
  if (!llm) return local;
  const out = { ...llm, source: 'llm' };
  // The LLM missed what the grammar is sure about -> use the grammar.
  if (llm.intent === 'unclear' && local.intent !== 'unclear' && local.confidence >= 0.8) return { ...local, source: 'local' };
  if (['credit', 'payment'].includes(out.intent)) {
    if (out.amount == null && local.amount != null) {
      out.amount = local.amount;
      out.confidence = Math.min(out.confidence, 0.75);
    } else if (local.amountFromDigits && out.amount != null && Number(out.amount) !== Number(local.amount)) {
      // Spoken digits disagree with the LLM: never save silently.
      out.confidence = Math.min(out.confidence, 0.6);
    }
  }
  if (!out.customer_name && local.customer_name) out.customer_name = local.customer_name;
  if (!out.items?.length && local.items?.length) out.items = local.items;
  if (!out.yes_no && local.yes_no) out.yes_no = local.yes_no;
  return out;
}

export async function understand(transcript, context = null) {
  const s = getState();
  const index = buildNameIndex(s.customers, s.aliases);
  const defaultLang = PACKS[s.settings.replyLang] ? s.settings.replyLang : (s.settings.speechLang || 'ta-IN').slice(0, 2);
  const local = parseLocal(transcript, { index, defaultLang });

  let llm = null;
  if (serverAvailable('understand')) {
    try {
      llm = await callFunction('understand', {
        transcript,
        customers: compactCustomers(s.customers, s.aliases),
        context,
      }, 10000);
    } catch (err) {
      if (!(err instanceof NotConfigured)) console.warn('LLM failed, using on-device grammar', err);
    }
  }
  return { ...mergeParses(llm, local), transcript };
}
