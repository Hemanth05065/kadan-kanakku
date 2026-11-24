import { useMemo, useRef, useState } from 'react';
import { BiLabel, Button, useT } from '../components/ui.jsx';
import { MicButton, LevelBar } from '../components/MicPanel.jsx';
import { useClipRecorder, ProblemText, NameVoiceRow } from '../components/VoiceClip.jsx';
import { useStore } from '../lib/store.js';
import { reply } from '../i18n/index.js';
import { VOICE_SCRIPT, scriptItems, missingFor, nameClipKey } from '../voice/voicePack.js';
import { useVoiceClips, packProgress, playClip, playReply, exportVoice, importVoice, clearVoice } from '../voice/voiceClips.js';
import { stopSpeaking } from '../voice/tts.js';

const LANG = 'ta';
const LATIN = Object.fromEntries(scriptItems(LANG).map((i) => [i.key, i.latin]));

/** Sentences to hear the shop voice with (demo customers). */
const SAMPLES = [
  ['credit_saved', { name: 'Murugan anna', nameKey: 'murugan anna', amt: '240', amtN: 240, total: '1,140', totalN: 1140 }],
  ['payment_saved', { name: 'Lakshmi akka', nameKey: 'lakshmi akka', amt: '500', amtN: 500, total: '1,250', totalN: 1250 }],
  ['confirm_amount', { name: 'Selvi akka', nameKey: 'selvi akka', amt: '2,500', amtN: 2500 }],
  ['ask_which', { a: 'Murugan anna', aKey: 'murugan anna', b: 'Murugesan', bKey: 'murugesan' }],
  ['today_summary', { credit: '3,340', creditN: 3340, payment: '100', paymentN: 100, total: '8,405', totalN: 8405 }],
  ['undo_done', {}],
];

function Tab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-12 flex-1 rounded-xl px-2 text-sm font-semibold ${active ? 'bg-leaf-800 text-white' : 'bg-white ring-1 ring-stone-300'}`}
    >
      {children}
    </button>
  );
}

function Recorder({ items, has }) {
  const { t, en } = useT();
  const r = useClipRecorder();
  const firstMissing = () => Math.max(0, items.findIndex((i) => !has(i.key)));
  const [idx, setIdx] = useState(firstMissing);
  const item = items[Math.min(idx, items.length - 1)];

  const nextMissing = (from) => {
    for (let k = 1; k <= items.length; k++) {
      const j = (from + k) % items.length;
      if (!has(items[j].key)) return j;
    }
    return Math.min(from + 1, items.length - 1);
  };

  return (
    <>
      <section className="space-y-3 rounded-3xl bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-stone-500">
          {idx + 1} / {items.length}
          {has(item.key) && <span className="ml-2 font-semibold text-leaf-700">✓ {t('recorded')}</span>}
        </p>
        <p className="text-3xl font-bold leading-snug">{item.text}</p>
        <p className="text-lg font-semibold text-leaf-800">{item.latin}</p>
        {item.hint && <p className="text-xs text-stone-500">{item.hint}</p>}
        <LevelBar level={r.level} active={r.phase === 'recording'} />
        <div className="flex justify-center">
          <MicButton
            phase={r.phase === 'processing' ? 'transcribing' : r.phase}
            onStart={r.start}
            onEnd={async () => {
              if (await r.stop(item.key)) setIdx((i) => nextMissing(i));
            }}
          />
        </div>
        <p className="text-sm text-stone-500">{t('hold_to_record')} · {en('hold_to_record')}</p>
        <ProblemText problem={r.problem} />
        <div className="flex items-center justify-between">
          <button type="button" className="min-h-12 px-3 text-leaf-800" onClick={() => setIdx((i) => Math.max(0, i - 1))}>← Back</button>
          {has(item.key) && (
            <button type="button" className="min-h-12 rounded-full bg-leaf-100 px-4 font-semibold text-leaf-900" onClick={() => playClip(item.key)}>▶ Play</button>
          )}
          <button type="button" className="min-h-12 px-3 text-leaf-800" onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))}>Next →</button>
        </div>
      </section>

      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            onClick={() => setIdx(i)}
            className={`rounded-lg px-2 py-1 text-xs ${has(it.key) ? 'bg-leaf-100 text-leaf-900' : 'bg-white text-stone-600 ring-1 ring-stone-300'} ${i === idx ? 'outline outline-2 outline-amber-500' : ''}`}
          >
            {has(it.key) ? '✓ ' : ''}{it.latin.replace(/[.,?:]$/, '')}
          </button>
        ))}
      </div>
    </>
  );
}

function Samples({ has }) {
  const { t, en } = useT();
  const [note, setNote] = useState(null);
  const replies = useMemo(() => SAMPLES.map(([k, p]) => reply(k, LANG, p)), []);
  return (
    <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="font-bold text-leaf-900">🔊 {t('try_it')} · {en('try_it')}</h2>
      <ul className="space-y-2">
        {replies.map((rp) => {
          const missing = missingFor(rp, has);
          const names = [rp.params.nameKey, rp.params.aKey, rp.params.bKey].filter((k) => k && !has(nameClipKey(k)));
          return (
            <li key={rp.key}>
              <button
                type="button"
                disabled={missing.length > 0}
                onClick={async () => {
                  stopSpeaking();
                  setNote(null);
                  if (!(await playReply(rp))) setNote('Could not play this one.');
                }}
                className="w-full rounded-xl bg-leaf-50 px-3 py-2 text-left disabled:opacity-60"
              >
                <span className="font-semibold">▶ {rp.show}</span>
                {missing.length > 0 && (
                  <span className="block text-xs text-red-700">Record first: {missing.slice(0, 6).map((k) => LATIN[k] || k).join(' · ')}{missing.length > 6 ? ` +${missing.length - 6}` : ''}</span>
                )}
                {!missing.length && names.length > 0 && (
                  <span className="block text-xs text-stone-500">Name not recorded yet: said without it</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {note && <p className="text-sm text-red-700">{note}</p>}
    </section>
  );
}

function FileCard() {
  const [msg, setMsg] = useState(null);
  const input = useRef(null);
  const download = async () => {
    const url = URL.createObjectURL(await exportVoice());
    const a = Object.assign(document.createElement('a'), { href: url, download: `kadan-kanakku-voice-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-sm text-stone-600">
        Move the voice to another phone (staff phone, a new phone): save it as a file here and open it there. Nothing is uploaded anywhere.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={download}>⬇ Save file</Button>
        <Button variant="secondary" onClick={() => input.current?.click()}>⬆ Open file</Button>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setMsg(`✓ Added ${await importVoice(f)} clips.`);
          } catch (err) {
            setMsg(err.message);
          }
        }}
      />
      <Button variant="ghost" className="w-full text-red-700" onClick={async () => confirm('Delete every recorded clip on this phone?') && (await clearVoice(), setMsg('Deleted.'))}>
        Delete the recorded voice
      </Button>
      {msg && <p className="text-sm text-stone-700">{msg}</p>}
    </section>
  );
}

/**
 * Shop voice studio: a real person records the reply phrases, Tamil number words and the
 * customers' names once; every spoken reply is then stitched from those clips.
 */
export default function VoiceStudio({ go }) {
  const s = useStore();
  const { t, en } = useT();
  const { has } = useVoiceClips();
  const [tab, setTab] = useState('phrases');
  const sections = VOICE_SCRIPT[LANG].sections;
  const prog = packProgress(LANG);
  const customers = s.customers.filter((c) => !c.deleted_at);
  const namesDone = customers.filter((c) => has(nameClipKey(c))).length;
  const sectionDone = (id) => {
    const items = sections.find((x) => x.id === id).items;
    return `${items.filter((i) => has(i.key)).length}/${items.length}`;
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-28 pt-3">
      <button type="button" className="py-1 text-leaf-800" onClick={() => go('#/settings')}>← {t('back')} · {en('back')}</button>
      <h1 className="text-xl font-extrabold text-leaf-900">🎙 <BiLabel k="shop_voice" /></h1>

      <section className="space-y-2 rounded-2xl bg-gradient-to-br from-leaf-800 to-leaf-900 p-4 text-white shadow-lg">
        <p className="text-sm text-leaf-100">
          Record your own voice once, about 15 minutes. The app then answers in it: a real person, not a robot voice. It works offline, with no delay.
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} />
        </div>
        <p className="text-sm font-semibold">
          {prog.done} / {prog.total} {t('recorded')} · {t('names')} {namesDone}/{customers.length}
          {prog.ready && <span className="ml-2 text-amber-300">✓ Ready</span>}
        </p>
        <p className="text-xs text-leaf-100">
          Tips: a quiet corner · phone about a hand's length away · say each one the way you talk at the counter, not like reading.
        </p>
      </section>

      <div className="flex gap-2">
        <Tab active={tab === 'phrases'} onClick={() => setTab('phrases')}>{t('phrases')} {sectionDone('phrases')}</Tab>
        <Tab active={tab === 'numbers'} onClick={() => setTab('numbers')}>{t('numbers')} {sectionDone('numbers')}</Tab>
        <Tab active={tab === 'names'} onClick={() => setTab('names')}>{t('names')} {namesDone}/{customers.length}</Tab>
      </div>

      {tab === 'names' ? (
        <section className="divide-y divide-stone-100 rounded-2xl bg-white px-4 shadow-sm">
          <p className="py-3 text-sm text-stone-600">Say each name the way you call them at the counter (“Murugan anna”). Replies use it, for example “Murugan anna, 240 roobaai kadan”.</p>
          {[...customers]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => <NameVoiceRow key={c.id} customer={c} compact />)}
        </section>
      ) : (
        <Recorder key={tab} items={sections.find((x) => x.id === tab).items} has={has} />
      )}

      <Samples has={has} />
      <FileCard />
    </div>
  );
}
