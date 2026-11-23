import { useMemo, useState } from 'react';
import { AudioButton, BiLabel, Button, Money, Sheet, useT } from './ui.jsx';
import { useStore, addCustomer, updateEntry } from '../lib/store.js';
import { rankCustomers, buildNameIndex } from '../lib/names.js';
import { dayLabel, timeLabel } from '../lib/util.js';
import { parseNumber } from '../lib/numbers.js';

const custLabel = (c) => (c ? (c.honorific ? `${c.name} ${c.honorific}` : c.name) : '—');

export function EntryRow({ entry, customer, running, showCustomer = true, onClick }) {
  const { lang } = useT();
  const credit = entry.type === 'credit';
  const deleted = Boolean(entry.deleted_at);
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 shadow-sm ${deleted ? 'opacity-50' : ''} ${onClick ? 'cursor-pointer active:bg-stone-50' : ''}`}
      onClick={onClick}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${credit ? 'bg-red-50 text-red-700' : 'bg-leaf-50 text-leaf-700'}`}
        aria-hidden
      >
        {credit ? '↑' : '↓'}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${deleted ? 'line-through' : ''}`}>
          {showCustomer ? custLabel(customer) : <BiLabel k={credit ? 'credit' : 'payment'} />}
        </p>
        <p className="truncate text-sm text-stone-500">
          {dayLabel(entry.created_at, lang)} {timeLabel(entry.created_at)}
          {entry.items?.length ? ` · ${entry.items.join(', ')}` : ''}
          {entry.source === 'manual' ? ' · ✎' : ''}
        </p>
      </div>
      <div className="text-right">
        <p className={`text-lg font-bold tabular-nums ${credit ? 'text-red-700' : 'text-leaf-700'} ${deleted ? 'line-through' : ''}`}>
          {credit ? '+' : '−'}<Money value={entry.amount} />
        </p>
        {running !== undefined && <p className="text-xs text-stone-500 tabular-nums">= <Money value={running} /></p>}
      </div>
      <AudioButton entry={entry} />
    </li>
  );
}

/** Customer picker that matches by sound as you type ("muruga" finds Murugan). */
function CustomerPicker({ value, onChange, initialText = '' }) {
  const { customers, aliases } = useStore();
  const { t, en } = useT();
  const [q, setQ] = useState(initialText);
  const [adding, setAdding] = useState(false);
  const index = useMemo(() => buildNameIndex(customers, aliases), [customers, aliases]);
  const live = customers.filter((c) => !c.deleted_at);
  const selected = live.find((c) => c.id === value);
  const matches = q.trim()
    ? rankCustomers(q, index).filter((r) => r.score >= 0.55).slice(0, 6).map((r) => r.customer)
    : live.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  const exact = matches.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-2xl border-2 border-leaf-700 bg-leaf-50 px-4 py-3">
        <span className="text-lg font-semibold">{custLabel(selected)}</span>
        <button type="button" className="text-sm text-leaf-800 underline" onClick={() => { onChange(null); setQ(''); }}>
          {t('edit')}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`${t('search')} · ${en('search')}`}
        className="min-h-14 w-full rounded-2xl border-2 border-stone-300 bg-white px-4 text-lg"
      />
      <div className="flex flex-wrap gap-2">
        {matches.map((c) => (
          <button key={c.id} type="button" onClick={() => onChange(c.id)} className="rounded-full bg-white px-4 py-2 font-medium shadow-sm ring-1 ring-stone-200 active:bg-leaf-50">
            {custLabel(c)}
          </button>
        ))}
        {q.trim() && !exact && (
          <button
            type="button"
            disabled={adding}
            onClick={async () => {
              setAdding(true);
              const c = await addCustomer({ name: q.trim().replace(/\b\w/g, (m) => m.toUpperCase()) });
              setAdding(false);
              onChange(c.id);
            }}
            className="rounded-full bg-amber-100 px-4 py-2 font-medium text-amber-900"
          >
            + {t('new_customer')}: “{q.trim()}”
          </button>
        )}
      </div>
    </div>
  );
}

/** Manual entry / edit form. `initial` may come from a failed voice attempt. */
export function EntryEditor({ open, initial, title = 'manual_entry', onSubmit, onClose, onDelete }) {
  const { t, en } = useT();
  const [type, setType] = useState(initial?.type || 'credit');
  const [customerId, setCustomerId] = useState(initial?.customer_id || null);
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '');
  const [items, setItems] = useState((initial?.items || []).join(', '));
  const [busy, setBusy] = useState(false);
  const amt = /^\s*[\d.,]+\s*$/.test(amount) ? Number(amount.replace(/,/g, '')) : parseNumber(amount);
  const valid = customerId && amt > 0;

  return (
    <Sheet open={open} onClose={onClose} title={<BiLabel k={title} />}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          await onSubmit({
            type,
            customer_id: customerId,
            amount: amt,
            items: items.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
          });
          setBusy(false);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          {['credit', 'payment'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setType(k)}
              className={`min-h-16 rounded-2xl text-lg font-bold ${type === k ? (k === 'credit' ? 'bg-red-600 text-white' : 'bg-leaf-700 text-white') : 'bg-white ring-1 ring-stone-300'}`}
            >
              <BiLabel k={k} className="items-center" />
            </button>
          ))}
        </div>
        <label className="block space-y-1">
          <BiLabel k="customer" className="text-sm font-semibold text-stone-600" />
          <CustomerPicker value={customerId} onChange={setCustomerId} initialText={initial?.customer_name || ''} />
        </label>
        <label className="block space-y-1">
          <BiLabel k="amount" className="text-sm font-semibold text-stone-600" />
          <div className="flex items-center rounded-2xl border-2 border-stone-300 bg-white px-4">
            <span className="text-2xl text-stone-500">₹</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="240"
              className="min-h-16 w-full bg-transparent px-2 text-3xl font-bold tabular-nums outline-none"
            />
          </div>
          {amount && !/^\s*[\d.,]+\s*$/.test(amount) && amt > 0 && <p className="text-sm text-leaf-800">= ₹{amt}</p>}
        </label>
        <label className="block space-y-1">
          <BiLabel k="items" className="text-sm font-semibold text-stone-600" />
          <input
            value={items}
            onChange={(e) => setItems(e.target.value)}
            placeholder="arisi, oil"
            className="min-h-14 w-full rounded-2xl border-2 border-stone-300 bg-white px-4 text-lg"
          />
        </label>
        <Button type="submit" disabled={!valid || busy} className="w-full">
          {t('save')} · {en('save')}
        </Button>
        {onDelete && (
          <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>
            {t('delete')} · {en('delete')}
          </Button>
        )}
        {initial?.transcript && (
          <p className="text-center text-sm text-stone-500">{t('heard')}: “{initial.transcript}”</p>
        )}
      </form>
    </Sheet>
  );
}

const REASON = { offline: 'reason_offline', unclear: 'reason_unclear', noisy: 'reason_noisy', quiet: 'reason_noisy' };

/** One "Needs review" clip: listen, accept the suggestion, fix it, or discard. */
export function ReviewCard({ entry, onEdit }) {
  const { customers } = useStore();
  const { t, en, lang } = useT();
  const s = entry.suggestion;
  const cust = s?.customer_id ? customers.find((c) => c.id === s.customer_id) : null;
  const complete = s && ['credit', 'payment'].includes(s.intent) && cust && s.amount > 0;
  return (
    <li className="space-y-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-amber-300">
      <div className="flex items-center gap-3">
        <AudioButton entry={entry} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg">{entry.transcript ? `“${entry.transcript}”` : '…'}</p>
          <p className="text-xs text-stone-500">
            {dayLabel(entry.created_at, lang)} {timeLabel(entry.created_at)} · {t(REASON[entry.review_reason] || 'needs_review')}
          </p>
        </div>
      </div>
      {complete && (
        <p className="rounded-xl bg-leaf-50 px-3 py-2 text-sm">
          {t('suggestion')}: <b>{custLabel(cust)}</b> · {t(s.intent)} · <b>₹{s.amount}</b>
          {s.items?.length ? ` · ${s.items.join(', ')}` : ''}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="primary"
          className="text-base"
          disabled={!complete}
          onClick={() => updateEntry(entry.id, { status: 'confirmed', type: s.intent, customer_id: cust.id, amount: s.amount, items: s.items || [], review_reason: null })}
        >
          {t('confirm')}
        </Button>
        <Button
          variant="secondary"
          className="text-base"
          onClick={() => onEdit({ type: s?.intent === 'payment' ? 'payment' : 'credit', customer_id: cust?.id || null, customer_name: s?.customer_name, amount: s?.amount, items: s?.items || [] })}
        >
          {t('edit')}
        </Button>
        <Button variant="ghost" className="text-base text-red-700" onClick={() => updateEntry(entry.id, { status: 'discarded' })}>
          {t('discard')}
        </Button>
      </div>
      <p className="sr-only">{en('needs_review')}</p>
    </li>
  );
}
