import { useMemo, useState } from 'react';
import { BiLabel, Button, Money, Empty, useT } from '../components/ui.jsx';
import { EntryRow, EntryEditor } from '../components/entries.jsx';
import { CustomerSheet } from './Customers.jsx';
import { useStore, useLedger, addEntry, updateEntry, removeEntry, updateCustomer } from '../lib/store.js';
import { historyWithRunningBalance } from '../lib/ledger.js';
import { reminderLink } from '../lib/whatsapp.js';
import { PACKS } from '../i18n/index.js';
import { NameVoiceRow } from '../components/VoiceClip.jsx';
import { PaySheet } from '../components/Pay.jsx';
import { payRequest } from '../lib/upi.js';

export default function CustomerDetail({ id, go }) {
  const s = useStore();
  const L = useLedger();
  const { t, en, lang: uiLang } = useT();
  const [editCustomer, setEditCustomer] = useState(false);
  const [editor, setEditor] = useState(null); // { initial, entry? }
  const [showPay, setShowPay] = useState(false);

  const c = L.customerById.get(id);
  const history = useMemo(() => historyWithRunningBalance(s.entries, id), [s.entries, id]);
  if (!c || c.deleted_at) {
    return (
      <div className="p-6">
        <Button variant="secondary" onClick={() => go('#/customers')}>← {t('back')}</Button>
      </div>
    );
  }
  const balance = L.bal.get(id) || 0;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-28 pt-3">
      <button type="button" className="py-1 text-leaf-800" onClick={() => go('#/customers')}>← {t('back')} · {en('back')}</button>

      <section className="rounded-3xl bg-leaf-800 p-5 text-white shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">{c.name}{c.honorific ? ` ${c.honorific}` : ''}</h1>
            {c.name_ta && <p className="text-leaf-100">{c.name_ta}</p>}
            {c.phone && <p className="text-sm text-leaf-100">📞 {c.phone}</p>}
          </div>
          <button type="button" className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold" onClick={() => setEditCustomer(true)}>
            ✎ {t('edit')}
          </button>
        </div>
        <div className="mt-4">
          <BiLabel k="balance" className="text-sm text-leaf-100" />
          <p className="text-4xl font-extrabold"><Money value={balance} /></p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="danger" onClick={() => setEditor({ initial: { type: 'credit', customer_id: id } })}>
          + <BiLabel k="credit" />
        </Button>
        <Button onClick={() => setEditor({ initial: { type: 'payment', customer_id: id } })}>
          − <BiLabel k="payment" />
        </Button>
      </div>

      {balance > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {[uiLang === 'en' ? 'ta' : uiLang, 'en'].map((lang) => (
            <a
              key={lang}
              href={reminderLink(c, balance, s.shop?.name || 'our shop', lang, { payUrl: payRequest(c, balance, s.settings, s.shop?.name || '')?.page })}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => updateCustomer(c.id, { last_reminded_at: new Date().toISOString() })}
              className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-3 text-center font-semibold text-white shadow-sm"
            >
              <span aria-hidden>💬</span>
              <span className="text-sm leading-tight">
                {t('remind_en').replace(/\s*\(.*\)/, '')} · {PACKS[lang].name}
              </span>
            </a>
          ))}
        </div>
      )}

      {balance > 0 && (
        <Button variant="secondary" className="w-full" onClick={() => setShowPay(true)}>
          📱 {t('show_qr')} · {t('scan_to_pay')} <Money value={balance} />
        </Button>
      )}

      <NameVoiceRow customer={c} />

      <Button variant="secondary" className="w-full" onClick={() => go(`#/statement/${id}`)}>
        📄 {t('statement')} · {en('statement')}
      </Button>

      <section className="space-y-2">
        <h2 className="font-bold text-stone-700"><BiLabel k="history" /></h2>
        {history.length ? (
          <ul className="space-y-2">
            {history.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                running={e.deleted_at ? undefined : e.running}
                showCustomer={false}
                onClick={e.deleted_at ? undefined : () => setEditor({ initial: e, entry: e })}
              />
            ))}
          </ul>
        ) : (
          <Empty k="no_entries" />
        )}
      </section>

      {showPay && <PaySheet customer={c} amount={balance} onClose={() => setShowPay(false)} go={go} />}
      {editCustomer && <CustomerSheet open customer={c} onClose={() => setEditCustomer(false)} />}
      {editor && (
        <EntryEditor
          key={editor.entry?.id || `new-${editor.initial.type}`}
          open
          title={editor.entry ? 'edit' : editor.initial.type}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onDelete={editor.entry ? async () => {
            if (confirm(`${t('delete')}?`)) { await removeEntry(editor.entry.id); setEditor(null); }
          } : undefined}
          onSubmit={async (fields) => {
            if (editor.entry) await updateEntry(editor.entry.id, fields);
            else await addEntry({ ...fields, source: 'manual', confidence: 1 });
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}
