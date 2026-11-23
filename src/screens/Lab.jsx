import { useEffect, useMemo, useRef, useState } from 'react';
import { BiLabel, Button, useT } from '../components/ui.jsx';
import { MicButton, LevelBar } from '../components/MicPanel.jsx';
import { useStore } from '../lib/store.js';
import { Recorder } from '../voice/recorder.js';
import { transcribe, engines, startLiveRecognition, speechLangCode } from '../voice/stt.js';
import { wordErrorRate, evalCustomers, scoreUnderstanding } from '../lib/evalScore.js';
import data from '../../eval/cases.json';

const customers = evalCustomers(data);

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Accuracy lab: say each test phrase into the real microphone, see what the speech engine
 * heard and whether the app understood it. Export the clips to score other engines on the
 * same recordings with scripts/eval-stt.mjs.
 */
export default function Lab({ go }) {
  const { settings } = useStore();
  const { t, en } = useT();
  const lang = speechLangCode();
  const phrases = useMemo(() => {
    const mine = data.cases.filter((c) => c.lang === lang && c.intent !== 'unclear');
    return mine.length ? mine : data.cases.filter((c) => c.intent !== 'unclear');
  }, [lang]);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [level, setLevel] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const rec = useRef(null);
  const live = useRef(null);
  const pressing = useRef(false);

  useEffect(() => () => rec.current?.release(), []);

  const phrase = phrases[i % phrases.length];

  const start = async () => {
    if (pressing.current) return;
    pressing.current = true;
    setError(null);
    rec.current ||= new Recorder();
    try {
      await rec.current.start(setLevel);
      setPhase('recording');
      const eng = engines();
      live.current = !eng.server && !eng.device && eng.browser ? startLiveRecognition(lang) : null;
    } catch {
      pressing.current = false;
      setError(t('mic_blocked'));
    }
  };

  const stop = async () => {
    if (!pressing.current) return;
    pressing.current = false;
    live.current?.stop();
    const r = await rec.current.stop();
    if (!r || r.quality.verdict === 'short') { setPhase('idle'); return; }
    setPhase('transcribing');
    const t0 = performance.now();
    const stt = await transcribe({ wav: r.wav, archive: r.archive, pcm: r.pcm, live: live.current });
    live.current = null;
    const heard = stt?.text || '';
    const score = scoreUnderstanding(phrase, heard, customers);
    setResults((rs) => [...rs, {
      text: phrase.text, lang: phrase.lang, expected: { intent: phrase.intent, customer: phrase.customer, amount: phrase.amount },
      heard, engine: stt?.engine || 'none', ms: Math.round(performance.now() - t0), quality: r.quality.verdict, snr: r.quality.snr,
      wer: wordErrorRate(phrase.text, heard), ...score, wav: r.wav,
    }]);
    setPhase('idle');
    setI((n) => n + 1);
  };

  const n = results.length;
  const avg = (f) => (n ? results.reduce((s, r) => s + f(r), 0) / n : 0);
  const exportBundle = async () => {
    const bundle = {
      created_at: new Date().toISOString(),
      speech_language: settings.speechLang,
      customers: data.customers,
      clips: await Promise.all(results.map(async ({ wav, ...r }) => ({ ...r, wav_base64: await toBase64(wav) }))),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `kadan-eval-${Date.now()}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pb-28 pt-3">
      <button type="button" className="py-1 text-leaf-800" onClick={() => go('#/settings')}>← {t('back')} · {en('back')}</button>
      <h1 className="text-xl font-extrabold text-leaf-900"><BiLabel k="accuracy_lab" /></h1>

      <section className="space-y-3 rounded-3xl bg-white p-5 text-center shadow-sm">
        <p className="text-sm text-stone-500">{(i % phrases.length) + 1} / {phrases.length} · {lang}</p>
        <p className="text-2xl font-bold leading-snug">“{phrase.text}”</p>
        <p className="text-xs text-stone-500">{phrase.intent} · {phrase.customer ?? '—'} · {phrase.amount ?? '—'}</p>
        <LevelBar level={level} active={phase === 'recording'} />
        <div className="flex justify-center">
          <MicButton phase={phase} onStart={start} onEnd={stop} />
        </div>
        <button type="button" className="text-sm text-leaf-800 underline" onClick={() => setI((x) => x + 1)}>{t('next')} →</button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      {n > 0 && (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-2xl font-extrabold">{Math.round(avg((r) => r.wer) * 100)}%</p><p className="text-xs text-stone-500">word error</p></div>
            <div><p className="text-2xl font-extrabold">{Math.round(avg((r) => (r.exact ? 1 : 0)) * 100)}%</p><p className="text-xs text-stone-500">understood</p></div>
            <div><p className="text-2xl font-extrabold text-red-700">{results.filter((r) => r.silentWrong).length}</p><p className="text-xs text-stone-500">silent wrong saves</p></div>
          </div>
          <ul className="divide-y divide-stone-100 text-sm">
            {results.slice().reverse().map((r, k) => (
              <li key={k} className="py-2">
                <p><span className={r.exact ? 'text-leaf-700' : 'text-red-700'}>{r.exact ? '✓' : '✗'}</span> {r.text}</p>
                <p className="text-stone-500">heard: “{r.heard || '—'}” · WER {Math.round(r.wer * 100)}% · {r.engine} · {r.ms} ms</p>
                {!r.exact && <p className="text-xs text-stone-500">got {r.got.intent} / {r.got.customer ?? '—'} / {r.got.amount ?? '—'}</p>}
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="w-full" onClick={exportBundle}>⬇ Export recordings (for scripts/eval-stt.mjs)</Button>
        </section>
      )}
    </div>
  );
}
