import { useEffect, useState } from 'react';
import { BiLabel, Button, useT } from './ui.jsx';
import { useStore } from '../lib/store.js';

const BARS = 14;

export function LevelBar({ level, active }) {
  const lit = Math.round(level * BARS);
  return (
    <div className="flex h-8 items-end justify-center gap-1" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => {
        const h = 20 + Math.abs(i - BARS / 2) * -4 + 60;
        return (
          <span
            key={i}
            className={`w-2 rounded-full transition-all duration-75 ${active && i < lit ? (i > BARS - 3 ? 'bg-amber-500' : 'bg-red-500') : 'bg-stone-300'}`}
            style={{ height: `${active && i < lit ? h : 18}%` }}
          />
        );
      })}
    </div>
  );
}

/** Big hold-to-talk button. Pointer capture keeps the press alive if the thumb slides. */
export function MicButton({ phase, onStart, onEnd }) {
  const live = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'understanding';
  return (
    <button
      type="button"
      aria-label="Hold to talk"
      className={`no-touch-ui relative flex h-36 w-36 items-center justify-center rounded-full text-white shadow-xl transition-transform ${
        live ? 'mic-live scale-110 bg-red-600' : busy ? 'bg-leaf-700' : 'bg-leaf-800 active:scale-95'
      }`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onStart();
      }}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {busy ? (
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-16 w-16" fill="currentColor" aria-hidden>
          <path d={MIC_ICON} />
        </svg>
      )}
    </button>
  );
}

const MIC_ICON = 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z';

/** Hands-free on: the big button shows what the app is doing; a tap turns hands-free off. */
export function HandsFreeButton({ phase, level, onStop }) {
  const hearing = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'understanding';
  const speaking = phase === 'speaking';
  return (
    <button
      type="button"
      aria-label="Hands-free is on. Tap to stop"
      onClick={onStop}
      className={`relative flex h-36 w-36 items-center justify-center rounded-full text-white shadow-xl transition-colors ${
        hearing ? 'bg-red-600' : busy || speaking ? 'bg-leaf-700' : 'bg-leaf-800'
      }`}
    >
      {!busy && !speaking && (
        <>
          <span className="absolute inset-0 animate-ping rounded-full bg-leaf-500/30" style={{ animationDuration: '2.2s' }} aria-hidden />
          <span
            className={`absolute inset-0 rounded-full ring-8 transition-transform duration-75 ${hearing ? 'ring-red-400/50' : 'ring-leaf-400/40'}`}
            style={{ transform: `scale(${1 + Math.min(1, level) * 0.3})` }}
            aria-hidden
          />
        </>
      )}
      {busy ? (
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      ) : speaking ? (
        <span className="text-5xl" aria-hidden>🔊</span>
      ) : (
        <svg viewBox="0 0 24 24" className="relative h-16 w-16" fill="currentColor" aria-hidden>
          <path d={MIC_ICON} />
        </svg>
      )}
    </button>
  );
}

/** Small round switch next to the hold-to-talk button. */
export function HandsFreeToggle({ onStart }) {
  const { t, en, both } = useT();
  return (
    <button type="button" onClick={onStart} className="flex max-w-[7rem] flex-col items-center gap-1 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow ring-1 ring-leaf-700/30" aria-hidden>🎧</span>
      <span className="text-xs font-semibold leading-tight text-leaf-900">
        {t('hands_free')}
        {both && <span className="block font-normal opacity-70">{en('hands_free')}</span>}
      </span>
    </button>
  );
}

function Countdown({ ms, armed }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-leaf-100">
      {armed ? (
        <div key={armed} className="countdown-bar h-full bg-leaf-700" style={{ animationDuration: `${ms}ms` }} />
      ) : (
        <div className="h-full w-full bg-leaf-700/60" />
      )}
    </div>
  );
}

const STATUS = { recording: 'listening', transcribing: 'understanding', understanding: 'understanding', speaking: 'speaking' };

export function VoicePanel({ flow }) {
  const { ui } = flow;
  const { t, en, both } = useT();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const { customers } = useStore();

  useEffect(() => {
    if (ui.phase === 'recording' && !ui.handsFree) setTyping(false); // hands-free hears the shop: keep typing
  }, [ui.phase, ui.handsFree]);

  const optionLabel = (o) => {
    if (o.label === 'yes' || o.label === 'no' || o.label === 'new_customer') {
      return <BiLabel k={o.label} className="items-center" />;
    }
    return o.label;
  };

  const status = STATUS[ui.phase];
  const inCountdown = Boolean(ui.countdown);

  return (
    <section className="space-y-3">
      {status && (
        <p className="text-center text-base font-semibold text-leaf-800" aria-live="polite">
          {t(status)} {both && <span className="text-sm font-normal text-stone-500">· {en(status)}</span>}
        </p>
      )}

      {ui.heard && (
        <div className="rounded-2xl bg-white/70 px-4 py-2 text-stone-700 shadow-sm">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <BiLabel k="heard" />
            {ui.engine && <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono">{ui.engine}</span>}
          </div>
          <p className="mt-1 text-lg">“{ui.heard}”</p>
        </div>
      )}

      {ui.reply && (
        <div
          className={`rounded-2xl px-4 py-3 shadow-sm ${inCountdown || ui.lastSaved ? 'bg-leaf-50 ring-2 ring-leaf-700/30' : 'bg-amber-50 ring-2 ring-amber-400/40'}`}
          aria-live="assertive"
        >
          <p className="text-xl font-bold text-ink">{ui.reply.show}</p>
          {ui.reply.lang === 'ta' && ui.reply.say !== ui.reply.show && <p className="mt-1 text-sm text-stone-600">{ui.reply.say}</p>}
        </div>
      )}

      {inCountdown && (
        <div className="space-y-2">
          <Countdown ms={ui.countdown.ms} armed={ui.countdown.until} />
          <div className="grid grid-cols-2 gap-3">
            <Button variant="danger" onClick={() => flow.cancelCountdown()}>
              <BiLabel k="undo" className="items-center" />
            </Button>
            <Button onClick={() => flow.saveNow()}>
              <BiLabel k="save" className="items-center" />
            </Button>
          </div>
        </div>
      )}

      {!inCountdown && ui.lastSaved && (
        <div className="flex items-center justify-between rounded-2xl bg-leaf-800 px-4 py-2 text-white">
          <span className="font-semibold">✓ {t('saved')}</span>
          <button type="button" className="rounded-xl bg-white/15 px-4 py-2 font-semibold" onClick={() => flow.undoSaved()}>
            {t('undo')}
          </button>
        </div>
      )}

      {ui.options.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {ui.options.map((o) => (
            <Button
              key={o.value}
              variant={o.value === 'no' ? 'secondary' : o.value === 'new' ? 'amber' : 'primary'}
              onClick={() => flow.quickReply(o.value)}
            >
              {optionLabel(o)}
            </Button>
          ))}
        </div>
      )}

      {ui.hint && <p className="text-center text-sm text-amber-800">{t(ui.hint)} · {en(ui.hint)}</p>}
      {ui.error && (
        <p className="rounded-xl bg-red-50 p-3 text-center text-sm text-red-800">
          {t(ui.error)} · {en(ui.error)}
        </p>
      )}

      {typing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            flow.submitText(text);
            setText('');
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            list="kk-customer-names"
            placeholder="Murugan anna 240 kadan"
            className="min-h-14 flex-1 rounded-2xl border-2 border-stone-300 bg-white px-4 text-lg"
          />
          <datalist id="kk-customer-names">
            {customers.filter((c) => !c.deleted_at).map((c) => <option key={c.id} value={c.name} />)}
          </datalist>
          <Button type="submit" className="px-5">{t('send')}</Button>
        </form>
      ) : (
        <div className="flex justify-center gap-4 text-sm">
          <button type="button" className="py-2 text-leaf-800 underline underline-offset-4" onClick={() => setTyping(true)}>
            ⌨ {t('type_instead')} · {en('type_instead')}
          </button>
          <button type="button" className="py-2 text-leaf-800 underline underline-offset-4" onClick={() => flow.openManual()}>
            ✎ {t('manual_entry')}
          </button>
        </div>
      )}
    </section>
  );
}
