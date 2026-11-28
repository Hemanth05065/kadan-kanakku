import { useEffect, useState } from 'react';
import { BiLabel, Button, Money, useT } from './ui.jsx';
import { useStore } from '../lib/store.js';
import { payRequest } from '../lib/upi.js';
import { waLink } from '../lib/whatsapp.js';
import { fmt } from '../lib/util.js';

/** A QR code drawn locally (no QR web service sees the payment details). Loaded only when shown. */
export function Qr({ text, className = '' }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14281d', light: '#ffffff' } }))
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <div
      className={`aspect-square bg-white [&>svg]:h-full [&>svg]:w-full ${className}`}
      role="img"
      aria-label="UPI QR code"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const label = (c) => (c.honorific ? `${c.name} ${c.honorific}` : c.name);

/** WhatsApp text with the pay-page link: "Murugan anna: ₹1,140 · Pay by UPI: https://…" */
export function payMessage(customer, req, lang, t) {
  return `${label(customer)}: ₹${fmt(req.amount)}\n${t('pay_by_upi', lang)}: ${req.page}`;
}

/**
 * Full-screen QR for the exact amount, shown at the counter (by tap or by voice:
 * "Murugan anna-ku QR kaattu"). The customer scans it with any UPI app.
 */
export function PaySheet({ customer, amount, onClose, go }) {
  const s = useStore();
  const { t, en, lang } = useT();
  const req = payRequest(customer, amount, s.settings, s.shop?.name || '');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-5 text-center shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {req ? (
          <>
            <p className="text-sm text-stone-500">{req.name}</p>
            <p className="text-xl font-bold text-ink">{label(customer)}</p>
            <p className="text-4xl font-extrabold text-leaf-900"><Money value={req.amount} /></p>
            <Qr text={req.link} className="mx-auto w-64 max-w-full rounded-xl ring-1 ring-stone-200" />
            <BiLabel k="scan_to_pay" className="items-center font-semibold text-stone-700" />
            <p className="font-mono text-sm text-stone-500">{req.vpa}</p>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={waLink(customer, payMessage(customer, req, lang, (k, l) => t(k, l)))}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-3 font-semibold text-white"
              >
                💬 <span className="text-sm leading-tight">{t('send_pay_link')}</span>
              </a>
              <Button variant="secondary" onClick={onClose}>{t('close')}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">{t('upi_missing_title')}</p>
            <p className="text-sm text-stone-600">{en('upi_missing_title')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => { onClose(); go?.('#/settings'); }}>{t('settings')}</Button>
              <Button variant="secondary" onClick={onClose}>{t('close')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
