import { pack, t } from '../i18n/index.js';
import { fmt } from './util.js';
import { nativeNameFor } from './names.js';

const label = (c) => (c.honorific ? `${c.name} ${c.honorific}` : c.name);

function phoneDigits(customer) {
  const digits = String(customer.phone || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/** wa.me link; without a phone number WhatsApp lets the owner pick the contact. */
export function waLink(customer, text) {
  return `https://wa.me/${phoneDigits(customer)}?text=${encodeURIComponent(text)}`;
}

/** A polite balance reminder in the customer's language, with a UPI pay link when there is one. */
export function reminderText(customer, balance, shopName, lang = 'ta', { payUrl = null } = {}) {
  const name = nativeNameFor(customer.name_ta, lang) || label(customer);
  const date = new Date().toLocaleDateString(`${lang}-IN`, { day: 'numeric', month: 'long' });
  const text = pack(lang).whatsapp({ name, shop: shopName, amount: fmt(balance), date });
  return payUrl ? `${text}

${t('pay_by_upi', lang)}: ${payUrl}` : text;
}

export function reminderLink(customer, balance, shopName, lang = 'ta', opts = {}) {
  return waLink(customer, reminderText(customer, balance, shopName, lang, opts));
}

/** Month-end statement as WhatsApp text: opening, each entry with running balance, closing. */
export function statementText(customer, st, shopName, lang = 'ta', period = '') {
  const L = (k) => t(k, lang);
  const lines = [];
  lines.push(`*${shopName}* · ${L('statement')}`);
  lines.push(`${nativeNameFor(customer.name_ta, lang) || label(customer)}${period ? ` · ${period}` : ''}`);
  lines.push('');
  lines.push(`${L('opening_balance')}: ₹${fmt(st.opening)}`);
  const MAX = 25;
  const shown = st.lines.slice(-MAX);
  if (st.lines.length > MAX) lines.push(`… (${st.lines.length - MAX})`);
  for (const e of shown) {
    const d = new Date(e.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const what = e.type === 'credit' ? (e.items?.length ? e.items.join(', ') : L('credit')) : L('payment');
    const sign = e.type === 'credit' ? '+' : '−';
    lines.push(`${d}  ${what}  ${sign}₹${fmt(e.amount)}  = ₹${fmt(e.running)}`);
  }
  lines.push('');
  lines.push(`${L('closing_balance')}: ₹${fmt(st.closing)}`);
  return lines.join('\n');
}
