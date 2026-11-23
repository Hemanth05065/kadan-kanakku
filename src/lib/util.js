/** UUID v4 that also works on plain-http LAN testing (randomUUID needs a secure context). */
export function uuid() {
  if (globalThis.crypto?.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* insecure context */ }
  }
  const b = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** 1140 -> "1,140", 100000 -> "1,00,000" */
export const fmt = (n) => inr.format(Math.round(Number(n || 0) * 100) / 100);
export const money = (n) => `₹${fmt(n)}`;
/** For speech: plain digits read best by TTS engines. */
export const sayNum = (n) => String(Math.round(Number(n || 0) * 100) / 100);

export const nowIso = () => new Date().toISOString();

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dayLabel(iso, lang = 'ta') {
  const d = new Date(iso);
  const today = startOfDay();
  const diff = Math.round((today - startOfDay(d)) / 86400000);
  if (diff === 0) return lang === 'ta' ? 'இன்று' : 'Today';
  if (diff === 1) return lang === 'ta' ? 'நேற்று' : 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
