import { useMemo, useState } from 'react';
import { BiLabel, Button, Money, Sheet, Empty, useT } from '../components/ui.jsx';
import { useLedger, useStore, addCustomer, updateCustomer, removeCustomer } from '../lib/store.js';
import { rankCustomers } from '../lib/names.js';
import { overdueCustomers } from '../lib/ledger.js';
import { reminderLink } from '../lib/whatsapp.js';
import { dayLabel } from '../lib/util.js';

const HONORIFICS = ['', 'anna', 'akka', 'amma', 'thambi', 'sir', 'madam'];

export function CustomerSheet({ open, customer, onClose, onSaved }) {
  const { t, en } = useT();
  const [f, setF] = useState({
    name: customer?.name || '',
    name_ta: customer?.name_ta || '',
    honorific: customer?.honorific || '',
    phone: customer?.phone || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const field = 'min-h-14 w-full rounded-2xl border-2 border-stone-300 bg-white px-4 text-lg';
  return (
    <Sheet open={open} onClose={onClose} title={<BiLabel k={customer ? 'edit' : 'add_customer'} />}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!f.name.trim()) return;
          const row = customer ? await updateCustomer(customer.id, f) : await addCustomer(f);
          onSaved?.(row);
          onClose();
        }}
      >
        <label className="block space-y-1"><BiLabel k="name" className="text-sm font-semibold text-stone-600" />
          <input className={field} value={f.name} onChange={set('name')} placeholder="Murugan" autoFocus />
        </label>
        <label className="block space-y-1"><BiLabel k="name_ta" className="text-sm font-semibold text-stone-600" />
          <input className={field} value={f.name_ta} onChange={set('name_ta')} placeholder="முருகன்" />
        </label>
        <label className="block space-y-1"><BiLabel k="honorific" className="text-sm font-semibold text-stone-600" />
          <select className={field} value={f.honorific} onChange={set('honorific')}>
            {HONORIFICS.map((h) => <option key={h} value={h}>{h || '—'}</option>)}
          </select>
        </label>
        <label className="block space-y-1"><BiLabel k="phone" className="text-sm font-semibold text-stone-600" />
          <input className={field} value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98xxxxxxxx" />
        </label>
        <Button type="submit" className="w-full">{t('save')} · {en('save')}</Button>
        {customer && (
          <Button
            variant="ghost"
            className="w-full text-red-700"
            onClick={async () => {
              if (confirm(`${t('delete')} ${customer.name}?`)) {
                await removeCustomer(customer.id);
                onClose();
                location.hash = '#/customers';
              }
            }}
          >
            {t('delete')} · {en('delete')}
          </Button>
        )}
      </form>
    </Sheet>
  );
}

/** 30+ days unpaid: one tap per customer opens WhatsApp with the reminder and marks it sent. */
function OverdueList({ list, go }) {
  const { shop } = useStore();
  const { t, en, lang } = useT();
  const remindLang = lang;
  if (!list.length) return <Empty k="all_clear" />;
  return (
    <div className="space-y-2">
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
        💬 {t('remind_all')} · {en('remind_all')}
      </p>
      <ul className="space-y-2">
        {list.map((c) => {
          const reminded = c.last_reminded_at ? Math.floor((Date.now() - new Date(c.last_reminded_at)) / 86400000) : null;
          return (
            <li key={c.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => go(`#/customer/${c.id}`)}>
                <span className="block truncate text-lg font-semibold">{c.name}{c.honorific ? ` ${c.honorific}` : ''}</span>
                <span className="block text-sm text-red-700">
                  {c.neverPaid ? t('never_paid') : `${c.daysUnpaid} ${t('days_unpaid')}`} · <Money value={c.balance} className="font-bold" />
                </span>
                {reminded !== null && (
                  <span className="block text-xs text-leaf-700">✓ {t('reminded')} {reminded === 0 ? dayLabel(c.last_reminded_at, lang) : `${reminded}d`}</span>
                )}
              </button>
              <a
                href={reminderLink(c, c.balance, shop?.name || '', remindLang)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => updateCustomer(c.id, { last_reminded_at: new Date().toISOString() })}
                className={`flex min-h-12 items-center rounded-xl px-4 font-semibold text-white ${reminded === 0 ? 'bg-stone-400' : 'bg-[#25D366]'}`}
              >
                💬
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Customers({ go }) {
  const L = useLedger();
  const { entries, customers } = useStore();
  const { t, en, lang } = useT();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState('all');
  const overdue = useMemo(() => overdueCustomers(customers, entries, 30), [customers, entries]);

  const lastAt = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (e.status !== 'confirmed' || e.deleted_at) continue;
      if (!m.has(e.customer_id) || e.created_at > m.get(e.customer_id)) m.set(e.customer_id, e.created_at);
    }
    return m;
  }, [entries]);

  const list = q.trim()
    ? rankCustomers(q, L.nameIndex).filter((r) => r.score >= 0.55).map((r) => L.sortedCustomers.find((c) => c.id === r.customer.id)).filter(Boolean)
    : L.sortedCustomers;

  return (
    <div className="mx-auto max-w-lg space-y-3 px-4 pb-28 pt-3">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-leaf-900"><BiLabel k="customers" /></h1>
        <div className="text-right">
          <BiLabel k="total_pending" className="items-end text-xs text-stone-500" />
          <p className="text-lg font-bold text-red-700"><Money value={L.pending} /></p>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-2">
        {[['all', 'all', L.sortedCustomers.length], ['overdue', 'overdue', overdue.length]].map(([k, labelKey, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 font-semibold ${tab === k ? 'bg-leaf-800 text-white' : 'bg-white ring-1 ring-stone-300'}`}
          >
            <BiLabel k={labelKey} className="items-center text-sm" />
            <span className={`rounded-full px-2 text-xs ${k === 'overdue' && n ? 'bg-red-600 text-white' : 'bg-black/10'}`}>{n}</span>
          </button>
        ))}
      </div>
      {tab === 'overdue' ? <OverdueList list={overdue} go={go} /> : (<>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`${t('search')} · ${en('search')}`}
        className="min-h-14 w-full rounded-2xl border-2 border-stone-300 bg-white px-4 text-lg"
      />
      {list.length ? (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => go(`#/customer/${c.id}`)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm active:bg-stone-50"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xl font-bold text-leaf-800">
                  {c.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold">{c.name}{c.honorific ? ` ${c.honorific}` : ''}</span>
                  <span className="block truncate text-sm text-stone-500">
                    {c.name_ta || ''}{lastAt.get(c.id) ? ` · ${dayLabel(lastAt.get(c.id), lang)}` : ''}
                  </span>
                </span>
                <span className={`text-xl font-extrabold ${c.balance > 0 ? 'text-red-700' : 'text-leaf-700'}`}>
                  <Money value={Math.abs(c.balance)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty k="no_customers" />
      )}
      </>)}
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="fixed bottom-24 right-5 z-30 flex h-16 items-center gap-2 rounded-full bg-amber-500 px-6 text-lg font-bold text-ink shadow-xl"
      >
        + <BiLabel k="add_customer" />
      </button>
      {adding && <CustomerSheet open onClose={() => setAdding(false)} onSaved={(c) => go(`#/customer/${c.id}`)} />}
    </div>
  );
}
