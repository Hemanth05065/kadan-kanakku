import { useEffect, useState } from 'react';
import { BiLabel, Money, SyncBadge, Empty, useT } from '../components/ui.jsx';
import { MicButton, LevelBar, VoicePanel, HandsFreeButton, HandsFreeToggle } from '../components/MicPanel.jsx';
import { EntryRow, EntryEditor, ReviewCard } from '../components/entries.jsx';
import { useStore, useLedger, updateEntry, addAlias, resetDemo } from '../lib/store.js';
import { DEMO_SCRIPT } from '../voice/demoScript.js';

function Stat({ k, value, tone }) {
  return (
    <div className={`rounded-2xl p-3 shadow-sm ${tone}`}>
      <BiLabel k={k} className="text-sm font-semibold" />
      <p className="mt-1 text-2xl font-extrabold"><Money value={value} /></p>
    </div>
  );
}

export default function Home({ flow, go }) {
  const s = useStore();
  const L = useLedger();
  const { t, en } = useT();
  const [review, setReview] = useState(null); // { initial, entry }
  const { ui } = flow;

  // Desktop / keyboard: hold Space to talk.
  useEffect(() => {
    const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    const down = (e) => { if (e.code === 'Space' && !e.repeat && !typing(e)) { e.preventDefault(); flow.pressStart(); } };
    const up = (e) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); flow.pressEnd(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [flow.pressStart, flow.pressEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const idleView = ui.phase === 'idle' && !ui.reply && !ui.heard;
  const hf = ui.handsFree;

  // Hands-free listens only on this screen, where its replies and Undo button are visible.
  useEffect(() => () => flow.stopHandsFree(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex h-[calc(100dvh-4.75rem)] max-w-lg flex-col">
      <header className="flex items-center justify-between px-4 pt-3">
        <div>
          <h1 className="text-xl font-extrabold text-leaf-900">{t('app_name')}</h1>
          <p className="text-sm text-stone-500">{s.shop?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {s.mode === 'local' && !ui.demo && (
            <button
              type="button"
              className="rounded-full bg-amber-500 px-3 py-1.5 text-sm font-bold text-ink shadow"
              onClick={async () => {
                if (!confirm('Reset the demo shop and play the demo conversation?')) return;
                await resetDemo();
                flow.runDemo(DEMO_SCRIPT);
              }}
            >
              ▶ {t('play_demo')}
            </button>
          )}
          <SyncBadge />
        </div>
      </header>

      {ui.demo && (
        <div className="mx-4 mt-2 flex items-center gap-3 rounded-2xl bg-ink px-4 py-2 text-white shadow-lg">
          <span className="rounded-full bg-amber-500 px-2 text-xs font-bold text-ink">{ui.demo.step}/{ui.demo.total}</span>
          <span className="min-w-0 flex-1 text-sm leading-tight">{ui.demo.note}</span>
          <button type="button" className="rounded-lg bg-white/15 px-3 py-1 text-sm font-semibold" onClick={flow.stopDemo}>
            ■ {t('stop')}
          </button>
        </div>
      )}

      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <Stat k="today_credit" value={L.today.credit} tone="bg-red-50 text-red-900" />
          <Stat k="today_payment" value={L.today.payment} tone="bg-leaf-50 text-leaf-900" />
          <button type="button" onClick={() => go('#/customers')} className="col-span-2 rounded-2xl bg-leaf-800 p-3 text-left text-white shadow-sm">
            <BiLabel k="total_pending" className="text-sm font-semibold" />
            <p className="mt-1 text-3xl font-extrabold"><Money value={L.pending} /></p>
          </button>
          <button
            type="button"
            onClick={flow.speakSummary}
            className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-leaf-800 shadow-sm ring-1 ring-leaf-700/20"
          >
            🔊 <BiLabel k="today_summary" className="items-center" />
          </button>
        </div>

        {L.review.length > 0 && (
          <section className="space-y-2">
            <h2 className="flex items-center gap-2 font-bold text-amber-900">
              <span className="rounded-full bg-amber-500 px-2 text-sm text-white">{L.review.length}</span>
              <BiLabel k="needs_review" />
            </h2>
            <ul className="space-y-2">
              {L.review.slice(0, 5).map((e) => (
                <ReviewCard key={e.id} entry={e} onEdit={(initial) => setReview({ initial, entry: e })} />
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-bold text-stone-700"><BiLabel k="recent" /></h2>
          {L.recent.length ? (
            <ul className="space-y-2">
              {L.recent.map((e) => (
                <EntryRow key={e.id} entry={e} customer={L.customerById.get(e.customer_id)} onClick={() => go(`#/customer/${e.customer_id}`)} />
              ))}
            </ul>
          ) : (
            <Empty k="no_entries" />
          )}
        </section>
      </main>

      <div className="shrink-0 space-y-3 border-t border-stone-200 bg-paper/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="max-h-[42dvh] overflow-y-auto">
          <VoicePanel flow={flow} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <LevelBar level={ui.level} active={ui.phase === 'recording' || Boolean(hf)} />
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
            <span />
            {hf ? (
              <HandsFreeButton phase={ui.phase} level={ui.level} onStop={() => flow.stopHandsFree()} />
            ) : (
              <MicButton phase={ui.phase} onStart={flow.pressStart} onEnd={flow.pressEnd} />
            )}
            <div className="flex justify-center">
              {!hf && !ui.demo && ui.phase !== 'recording' && <HandsFreeToggle onStart={flow.startHandsFree} />}
            </div>
          </div>
          {hf ? (
            ui.phase !== 'recording' && (
              <p className="text-center text-sm text-stone-600">
                <span className="block text-base font-semibold text-leaf-900">{t('hf_listening')}</span>
                {t('hf_tap_stop')} · <span className="text-xs">{en(hf.detector === 'silero' ? 'hf_ai_detector' : 'hf_basic_detector')}</span>
              </p>
            )
          ) : (
            <>
              {idleView && <BiLabel k="hold_to_talk" className="items-center text-base font-semibold text-leaf-900" />}
              {ui.phase === 'recording' && <BiLabel k="release_to_send" className="items-center text-base font-semibold text-red-700" />}
            </>
          )}
        </div>
      </div>

      {ui.manual && (
        <EntryEditor
          key={`manual-${ui.manual.clipKey || 'new'}`}
          open
          initial={ui.manual}
          onSubmit={(fields) => flow.completeManual(fields, ui.manual)}
          onClose={flow.closeManual}
        />
      )}
      {review && (
        <EntryEditor
          key={`review-${review.entry.id}`}
          open
          title="needs_review"
          initial={review.initial}
          onClose={() => setReview(null)}
          onSubmit={async (fields) => {
            await updateEntry(review.entry.id, { ...fields, status: 'confirmed', review_reason: null });
            if (review.initial.customer_name && review.initial.customer_id !== fields.customer_id) {
              await addAlias(fields.customer_id, review.initial.customer_name);
            }
            setReview(null);
          }}
        />
      )}
    </div>
  );
}
