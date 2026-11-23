import { useEffect, useRef, useState } from 'react';
import { t as translate } from '../i18n/index.js';
import { useStore, audioUrl } from '../lib/store.js';
import { money } from '../lib/util.js';

/** Labels in the shop's language with English underneath. */
export function useT() {
  const { settings } = useStore();
  const lang = settings.uiLang || 'ta';
  return {
    lang,
    t: (k) => translate(k, lang),
    en: (k) => translate(k, 'en'),
    both: lang !== 'en',
  };
}

export function BiLabel({ k, className = '', subClass = '' }) {
  const { t, en, both } = useT();
  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      <span>{t(k)}</span>
      {both && <span className={`text-[0.7em] font-normal opacity-70 ${subClass}`}>{en(k)}</span>}
    </span>
  );
}

export function Money({ value, className = '' }) {
  return <span className={`tabular-nums ${className}`}>{money(value)}</span>;
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-leaf-800 text-white active:bg-leaf-900',
    secondary: 'bg-white text-leaf-800 border-2 border-leaf-800 active:bg-leaf-50',
    danger: 'bg-red-600 text-white active:bg-red-700',
    ghost: 'bg-transparent text-leaf-800 active:bg-leaf-50',
    amber: 'bg-amber-500 text-ink active:bg-amber-600',
  };
  return (
    <button
      type="button"
      className={`min-h-14 rounded-2xl px-4 py-2 text-lg font-semibold shadow-sm disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-paper p-5 pb-safe shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-leaf-900">{title}</h2>
          <button type="button" onClick={onClose} className="-m-2 p-2 text-3xl leading-none text-stone-500" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Replay the voice clip saved with an entry (settles "I never said that" disputes). */
export function AudioButton({ entry, className = '' }) {
  const [state, setState] = useState('idle');
  const audio = useRef(null);
  if (!entry.audio_path) return null;
  const play = async (e) => {
    e.stopPropagation();
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    const url = await audioUrl(entry).catch(() => null);
    if (!url) { setState('missing'); return; }
    audio.current = new Audio(url);
    audio.current.onended = () => setState('idle');
    audio.current.onerror = () => setState('missing');
    audio.current.play().then(() => setState('playing')).catch(() => setState('missing'));
  };
  return (
    <button
      type="button"
      onClick={play}
      aria-label="Play voice clip"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-leaf-700/30 bg-white text-leaf-800 ${className}`}
    >
      {state === 'playing' ? '■' : state === 'loading' ? '…' : state === 'missing' ? '⊘' : '▶'}
    </button>
  );
}

export function SyncBadge() {
  const s = useStore();
  const { t } = useT();
  if (s.mode === 'local') {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">DEMO</span>;
  }
  if (!s.online) {
    return <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">⚡ {t('offline')}{s.outbox ? ` · ${s.outbox}` : ''}</span>;
  }
  if (s.outbox || s.syncing) {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">↻ {s.outbox}</span>;
  }
  return <span className="rounded-full bg-leaf-100 px-2 py-0.5 text-xs font-medium text-leaf-800">✓ {t('synced')}</span>;
}

export function BottomNav({ route, go }) {
  const items = [
    ['home', '#/', '🎙'],
    ['customers', '#/customers', '👥'],
    ['settings', '#/settings', '⚙'],
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-safe backdrop-blur">
      <div className="mx-auto flex max-w-lg">
        {items.map(([k, href, icon]) => {
          const active = route === k || (k === 'customers' && route === 'customer');
          return (
            <button
              key={k}
              type="button"
              onClick={() => go(href)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 ${active ? 'text-leaf-800' : 'text-stone-500'}`}
            >
              <span className="text-xl" aria-hidden>{icon}</span>
              <BiLabel k={k} className="items-center text-sm font-semibold" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Empty({ k }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-stone-500">
      <BiLabel k={k} className="items-center" />
    </div>
  );
}
