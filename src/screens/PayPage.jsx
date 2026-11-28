import { useState } from 'react';
import { Qr } from '../components/Pay.jsx';
import { decodePay, upiLink } from '../lib/upi.js';
import { t } from '../i18n/index.js';
import { fmt } from '../lib/util.js';

const both = (k) => (
  <>
    {t(k, 'ta')}
    <span className="block text-[0.75em] font-normal opacity-70">{t(k, 'en')}</span>
  </>
);

/**
 * The page a WhatsApp reminder links to (#/pay?d=…). Everything it shows comes from the
 * link itself: no account, no shop data, nothing stored. On a phone the button opens the
 * customer's UPI app with the shop's UPI ID and the amount filled in.
 */
export default function PayPage() {
  const code = new URLSearchParams(location.hash.split('?')[1] || '').get('d');
  const pay = decodePay(code);
  const [copied, setCopied] = useState(false);

  if (!pay) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm items-center justify-center p-6 text-center">
        <p className="text-lg font-semibold text-stone-700">{both('pay_link_broken')}</p>
      </main>
    );
  }
  const link = upiLink(pay);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">{pay.shop || pay.name}</p>
      {pay.customer && <p className="text-lg text-stone-700">{pay.customer}</p>}
      {pay.amount > 0 && <p className="text-5xl font-extrabold text-leaf-900">₹{fmt(pay.amount)}</p>}
      <a href={link} className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-leaf-800 px-4 text-lg font-bold text-white shadow-lg">
        <span>{both('open_upi_app')}</span>
      </a>
      <Qr text={link} className="w-60 rounded-xl ring-1 ring-stone-200" />
      <p className="text-sm text-stone-600">{both('pay_page_hint')}</p>
      <button
        type="button"
        className="rounded-full bg-stone-100 px-4 py-2 font-mono text-sm text-stone-700"
        onClick={() => navigator.clipboard?.writeText(pay.vpa).then(() => setCopied(true), () => {})}
      >
        {pay.vpa} {copied ? '✓' : '⧉'}
      </button>
      <p className="text-xs text-stone-400">{pay.name} · Kadan Kanakku</p>
    </main>
  );
}
