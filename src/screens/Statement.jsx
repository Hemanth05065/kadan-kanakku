import { useMemo, useState } from 'react';
import { AudioButton, BiLabel, Button, Money, useT } from '../components/ui.jsx';
import { useStore, useLedger } from '../lib/store.js';
import { statement, monthRange } from '../lib/ledger.js';
import { statementText, waLink } from '../lib/whatsapp.js';
import { fmt } from '../lib/util.js';
import { payRequest } from '../lib/upi.js';
import { Qr } from '../components/Pay.jsx';

const RANGES = [
  ['this', 'this_month'],
  ['last', 'last_month'],
  ['all', 'all_time'],
];

/**
 * Month-end statement for one customer. "Save PDF" uses the phone's print dialog, which
 * renders Tamil/Hindi/Telugu text correctly (PDF libraries usually can't shape these scripts).
 */
export default function Statement({ id, go }) {
  const s = useStore();
  const L = useLedger();
  const { t, en, lang } = useT();
  const [range, setRange] = useState('this');
  const c = L.customerById.get(id);

  const { st, period } = useMemo(() => {
    if (range === 'all') return { st: statement(s.entries, id), period: t('all_time') };
    const { from, to } = monthRange(range === 'last' ? -1 : 0);
    const label = from.toLocaleDateString(`${lang}-IN`, { month: 'long', year: 'numeric' });
    return { st: statement(s.entries, id, from, to), period: label };
  }, [s.entries, id, range, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null;
  const name = c.honorific ? `${c.name} ${c.honorific}` : c.name;
  const shareLang = lang === 'en' ? 'en' : lang;
  // The QR and link ask for what is owed today (the statement may be for last month).
  const owed = L.bal.get(id) || 0;
  const pay = payRequest(c, owed, s.settings, s.shop?.name || '');
  const shareText = statementText(c, st, s.shop?.name || '', shareLang, period) + (pay ? `

${t('pay_by_upi')}: ${pay.page}` : '');

  return (
    <div className="statement mx-auto max-w-lg space-y-4 px-4 pb-28 pt-3 print:max-w-none print:p-0">
      <div className="no-print flex items-center justify-between">
        <button type="button" className="py-1 text-leaf-800" onClick={() => go(`#/customer/${id}`)}>← {t('back')} · {en('back')}</button>
      </div>

      <div className="no-print grid grid-cols-3 gap-2">
        {RANGES.map(([k, labelKey]) => (
          <button
            key={k}
            type="button"
            onClick={() => setRange(k)}
            className={`min-h-12 rounded-xl px-2 text-sm font-semibold ${range === k ? 'bg-leaf-800 text-white' : 'bg-white ring-1 ring-stone-300'}`}
          >
            <BiLabel k={labelKey} className="items-center" />
          </button>
        ))}
      </div>

      <article className="space-y-4 rounded-2xl bg-white p-5 shadow-sm print:rounded-none print:shadow-none">
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 pb-3">
          <div>
            <p className="text-sm text-stone-500">{s.shop?.name}</p>
            <h1 className="text-2xl font-extrabold text-leaf-900">{name}</h1>
            {c.name_ta && <p className="text-stone-600">{c.name_ta}</p>}
            {c.phone && <p className="text-sm text-stone-500">📞 {c.phone}</p>}
          </div>
          <div className="text-right">
            <BiLabel k="statement" className="items-end font-bold text-leaf-900" />
            <p className="text-sm text-stone-600">{period}</p>
          </div>
        </header>

        <div className="flex justify-between rounded-xl bg-stone-50 px-3 py-2">
          <BiLabel k="opening_balance" className="text-sm font-semibold" />
          <Money value={st.opening} className="font-bold" />
        </div>

        {st.lines.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                <th className="py-1 font-semibold">{t('date')}</th>
                <th className="py-1 font-semibold">{t('details')}</th>
                <th className="py-1 pl-2 text-right font-semibold">{t('credit')}</th>
                <th className="py-1 pl-2 text-right font-semibold">{t('payment')}</th>
                <th className="py-1 pl-2 text-right font-semibold">{t('balance')}</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {st.lines.map((e) => (
                <tr key={e.id} className="border-b border-stone-100 align-top">
                  <td className="py-1.5 pr-1 whitespace-nowrap tabular-nums">
                    {new Date(e.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className="py-1.5 pr-1">{e.type === 'credit' ? (e.items?.join(', ') || t('credit')) : t('payment')}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums text-red-700">{e.type === 'credit' ? fmt(e.amount) : ''}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums text-leaf-700">{e.type === 'payment' ? fmt(e.amount) : ''}</td>
                  <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{fmt(e.running)}</td>
                  <td className="no-print pl-1"><AudioButton entry={e} className="h-8 w-8 text-xs" /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-sm font-bold">
                <td colSpan={2} className="pt-2">{t('total')}</td>
                <td className="pt-2 text-right tabular-nums text-red-700">{fmt(st.credit)}</td>
                <td className="pt-2 text-right tabular-nums text-leaf-700">{fmt(st.payment)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="py-6 text-center text-stone-500">{t('no_entries')}</p>
        )}

        <div className="flex justify-between rounded-xl bg-leaf-800 px-3 py-3 text-white">
          <BiLabel k="closing_balance" className="font-semibold" />
          <Money value={st.closing} className="text-xl font-extrabold" />
        </div>
        {pay && (
          <div className="flex items-center gap-4 rounded-xl border border-stone-200 p-3">
            <Qr text={pay.link} className="w-28 shrink-0" />
            <div className="text-left">
              <BiLabel k="scan_to_pay" className="font-semibold" />
              <p className="text-2xl font-extrabold text-leaf-900"><Money value={owed} /></p>
              <p className="font-mono text-xs text-stone-500">{pay.vpa}</p>
            </div>
          </div>
        )}
        <p className="text-center text-xs text-stone-400">
          Kadan Kanakku · {new Date().toLocaleString('en-IN')} · voice clips for each entry can be replayed in the app
        </p>
      </article>

      <div className="no-print grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => window.print()}>🖨 <BiLabel k="print_pdf" /></Button>
        <a
          href={waLink(c, shareText)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-3 font-semibold text-white shadow-sm"
        >
          💬 <BiLabel k="share_whatsapp" className="text-sm" />
        </a>
      </div>
    </div>
  );
}
