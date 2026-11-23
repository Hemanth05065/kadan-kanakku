import { useState } from 'react';
import { BiLabel, Button, useT } from '../components/ui.jsx';
import { sendOtp, verifyOtp, createShop, joinShop } from '../lib/auth.js';
import { loadDemoIntoShop } from '../lib/store.js';

const field = 'min-h-16 w-full rounded-2xl border-2 border-stone-300 bg-white px-4 text-2xl tracking-wide';

function Shell({ children }) {
  const { t } = useT();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="text-center">
        <img src="/icon-192.png" alt="" className="mx-auto h-20 w-20 rounded-3xl shadow-lg" />
        <h1 className="mt-4 text-3xl font-extrabold text-leaf-900">{t('app_name')}</h1>
        <p className="text-stone-600">Kadan Kanakku · voice credit ledger</p>
      </div>
      {children}
    </div>
  );
}

export function Login() {
  const { t, en } = useT();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <Shell>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (!sent) { await sendOtp(phone); setSent(true); } else await verifyOtp(phone, otp);
          });
        }}
      >
        <label className="block space-y-1">
          <BiLabel k="phone_number" className="text-sm font-semibold text-stone-600" />
          <div className="flex items-center gap-2">
            <span className="text-2xl text-stone-500">+91</span>
            <input className={field} inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} placeholder="98xxxxxxxx" />
          </div>
        </label>
        {sent && (
          <label className="block space-y-1">
            <BiLabel k="otp" className="text-sm font-semibold text-stone-600" />
            <input className={field} inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value)} autoFocus />
          </label>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || (!sent ? phone.replace(/\D/g, '').length < 10 : otp.length < 4)}>
          {sent ? `${t('verify')} · ${en('verify')}` : `${t('send_otp')} · ${en('send_otp')}`}
        </Button>
        {sent && (
          <button type="button" className="w-full py-2 text-sm text-leaf-800 underline" onClick={() => { setSent(false); setOtp(''); }}>
            ← {t('phone_number')}
          </button>
        )}
      </form>
    </Shell>
  );
}

export function Onboarding() {
  const { t, en } = useT();
  const [mode, setMode] = useState('create'); // create | join
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err.message || String(err)); } finally { setBusy(false); }
  };
  return (
    <Shell>
      {mode === 'create' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await createShop(name);
              if (demo) await loadDemoIntoShop();
            });
          }}
        >
          <label className="block space-y-1">
            <BiLabel k="shop_name" className="text-sm font-semibold text-stone-600" />
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Murugan Stores" autoFocus />
          </label>
          <label className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            <input type="checkbox" className="h-6 w-6 accent-leaf-800" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            <BiLabel k="load_demo" />
          </label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {t('create_shop')} · {en('create_shop')}
          </Button>
          <button type="button" className="w-full py-2 text-leaf-800 underline" onClick={() => { setMode('join'); setError(null); }}>
            {t('or')} · {t('join_shop')}
          </button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => joinShop(code));
          }}
        >
          <label className="block space-y-1">
            <BiLabel k="invite_code" className="text-sm font-semibold text-stone-600" />
            <input
              className={`${field} text-center tracking-[0.4em]`}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
            />
          </label>
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {t('join_shop')} · {en('join_shop')}
          </Button>
          <button type="button" className="w-full py-2 text-leaf-800 underline" onClick={() => { setMode('create'); setError(null); }}>
            ← {t('create_shop')}
          </button>
        </form>
      )}
    </Shell>
  );
}
