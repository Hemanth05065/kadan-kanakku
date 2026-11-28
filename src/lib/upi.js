// UPI payments. The standard upi://pay link works in every UPI app (GPay, PhonePe, Paytm,
// BHIM): scanned as a QR at the counter, or opened from a small web page that a WhatsApp
// reminder links to (WhatsApp does not make upi:// links tappable, but it does https://).
// Money goes straight from the customer's bank to the shop's; the app never touches it.

/** A UPI ID (VPA) such as murugan.stores@okaxis or 9876543210@ybl. */
export const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
export const isVpa = (s) => VPA_RE.test(String(s || '').trim());

const label = (c) => (c?.honorific ? `${c.name} ${c.honorific}` : c?.name || '');
// UPI apps expect the "@" of the ID as is; everything else is percent-encoded.
const enc = (v) => encodeURIComponent(v).replace(/%40/g, '@');
const money2 = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

/** upi://pay?pa=…&pn=…&am=…&cu=INR&tn=… */
export function upiLink({ vpa, name, amount, note }) {
  const parts = [`pa=${enc(String(vpa).trim())}`];
  if (name) parts.push(`pn=${enc(String(name).slice(0, 50))}`);
  if (Number(amount) > 0) parts.push(`am=${money2(amount)}`);
  parts.push('cu=INR');
  if (note) parts.push(`tn=${enc(String(note).slice(0, 50))}`);
  return `upi://pay?${parts.join('&')}`;
}

// ── the shareable pay page (#/pay?d=…) ───────────────────────────────────────

function toBase64Url(text) {
  let bin = '';
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** Everything the pay page needs, packed into the link itself: it works with no account. */
export function encodePay({ vpa, name, amount, customer, shop, note }) {
  return toBase64Url(JSON.stringify({ v: vpa, n: name || '', a: Number(amount) || 0, c: customer || '', s: shop || '', t: note || '' }));
}

export function decodePay(code) {
  try {
    const p = JSON.parse(fromBase64Url(String(code || '')));
    if (!isVpa(p.v)) return null;
    const amount = Number(p.a);
    return {
      vpa: String(p.v),
      name: String(p.n || '').slice(0, 60),
      amount: Number.isFinite(amount) && amount > 0 && amount < 1e7 ? amount : 0,
      customer: String(p.c || '').slice(0, 60),
      shop: String(p.s || '').slice(0, 60),
      note: String(p.t || '').slice(0, 50),
    };
  } catch {
    return null;
  }
}

const appBase = () => (typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`);

export const payPageUrl = (pay, base = appBase()) => `${base}#/pay?d=${encodePay(pay)}`;

/** The shop's UPI details from settings, or null when no valid UPI ID is set. */
export function shopUpi(settings, shopName = '') {
  const vpa = String(settings?.upiId || '').trim();
  if (!isVpa(vpa)) return null;
  return { vpa, name: String(settings.upiName || '').trim() || shopName || '' };
}

/**
 * A payment request from `customer` for `amount`: the upi:// link (for the QR) and the
 * web page link (for WhatsApp). null if the shop has no UPI ID or nothing is owed.
 */
export function payRequest(customer, amount, settings, shopName = '', base = appBase()) {
  const upi = shopUpi(settings, shopName);
  if (!upi || !(Number(amount) > 0)) return null;
  const who = label(customer);
  const pay = { ...upi, amount: Number(amount), customer: who, shop: shopName, note: `${shopName || 'Kadan'} · ${who}`.slice(0, 50) };
  return { ...pay, link: upiLink(pay), page: payPageUrl(pay, base) };
}
