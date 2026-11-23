// Orchestrates one counter conversation:
// hold mic (or hands-free: just talk) -> record -> (quality gate) -> Whisper -> LLM + grammar
// -> decide -> speak -> 3 s auto-save with Undo, or one clarifying question, or the manual form.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Recorder } from './recorder.js';
import { transcribe, engines, startLiveRecognition, speechLangCode } from './stt.js';
import { understand } from './nlu.js';
import { speak, stopSpeaking } from './tts.js';
import { chime } from './voiceClips.js';
import { HandsFree } from './handsFree.js';
import { handsFreeShouldAct } from './vad.js';
import { analyse, encodeWav } from './audio.js';
import { decide, afterCustomerAdded, fail, todayAnswer, EMPTY_CONVO } from './decide.js';
import { reply, PACKS } from '../i18n/index.js';
import { LIMITS } from '../lib/config.js';
import { getState, addEntry, updateEntry, removeEntry, addCustomer, addAlias, lastUndoable } from '../lib/store.js';
import { buildNameIndex } from '../lib/names.js';
import { uuid } from '../lib/util.js';

const recorder = new Recorder();
const IDLE_RESET_MS = 90000;
const HF_QUIET_OFF_MS = 10 * 60 * 1000; // hands-free switches itself off after 10 quiet minutes

const INITIAL = {
  phase: 'idle', // idle | recording | transcribing | understanding | speaking | countdown | awaiting
  level: 0,
  heard: '',
  engine: null,
  reply: null,
  options: [],
  countdown: null, // { until, ms }
  lastSaved: null, // entry just saved (Undo button)
  manual: null, // prefill for the manual form
  error: null,
  hint: null,
  handsFree: null, // { detector: 'silero' | 'loudness' } while hands-free listening is on
};

const AWAIT_FOR_LLM = { amount: 'amount', customer: 'customer', choice: 'customer', new_customer: 'yes_no', confirm: 'yes_no' };

export function useVoiceFlow() {
  const [ui, setUiState] = useState(INITIAL);
  const setUi = useCallback((patch) => setUiState((u) => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) })), []);

  const convo = useRef(EMPTY_CONVO);
  const clips = useRef(new Map()); // clipKey -> { blob, mime }
  const reviewIds = useRef([]); // needs_review rows created in this conversation
  const reviewedClips = useRef(new Set());
  const countdown = useRef(null); // { action, timer }
  const live = useRef(null);
  const pressing = useRef(false);
  const lastActivity = useRef(0);
  const justSaved = useRef(null);
  const lastClipKey = useRef(null);
  const lastOptions = useRef([]);
  const demoRun = useRef(null);
  const handsFree = useRef(null); // HandsFree while hands-free listening is on
  const wakeLock = useRef(null);
  const quietTimer = useRef(null);

  /** Where the conversation rests between utterances. */
  const restPhase = () => (countdown.current ? 'countdown' : convo.current.awaiting ? 'awaiting' : 'idle');
  /** Mid-conversation: the app asked something, or a save is counting down. */
  const engaged = () => Boolean(countdown.current || convo.current.awaiting);

  /** Speak, with hands-free listening paused so the app never hears (and answers) itself. */
  const talk = async (r) => {
    const hf = handsFree.current;
    hf?.pause();
    try {
      await speak(r);
    } finally {
      hf?.resume();
    }
  };

  const replyLang = () => {
    const pref = getState().settings.replyLang;
    if (pref === 'ta' || pref === 'en') return pref;
    return convo.current.pending?.lang || 'ta';
  };

  const ctxNow = () => {
    const s = getState();
    return {
      customers: s.customers,
      aliases: s.aliases,
      entries: s.entries,
      index: buildNameIndex(s.customers, s.aliases),
      replyLang: s.settings.replyLang,
      lastUndoable,
      justSaved: justSaved.current && Date.now() - justSaved.current.at < 10000 ? justSaved.current.id : null,
    };
  };

  // ── saving ────────────────────────────────────────────────────────────────

  const resolveReviews = async () => {
    const ids = reviewIds.current;
    reviewIds.current = [];
    reviewedClips.current.clear();
    for (const id of ids) await updateEntry(id, { status: 'discarded' });
  };

  const saveReview = async (clipKey, reason, transcript = null, parse = null) => {
    if (!clipKey || reviewedClips.current.has(clipKey)) return;
    const clip = clips.current.get(clipKey);
    if (!clip) return;
    reviewedClips.current.add(clipKey);
    const suggestion = parse
      ? { intent: parse.intent, customer_name: parse.customer_name, customer_id: parse.customer_id, amount: parse.amount, items: parse.items, confidence: parse.confidence }
      : null;
    const row = await addEntry(
      { status: 'needs_review', review_reason: reason, transcript, suggestion, source: 'voice', confidence: parse?.confidence ?? null, lang: parse?.language ?? null },
      clip,
    );
    reviewIds.current.push(row.id);
  };

  const saveEntryFrom = async (action) => {
    const clip = clips.current.get(action.clipKey) || clips.current.get(lastClipKey.current) || null;
    const entry = await addEntry(action.entry, clip);
    await resolveReviews();
    clips.current.clear();
    justSaved.current = { id: entry.id, at: Date.now() };
    return entry;
  };

  // ── countdown (3 s auto-save) ────────────────────────────────────────────

  const commitCountdown = async () => {
    const cd = countdown.current;
    if (!cd) return null;
    clearTimeout(cd.timer);
    countdown.current = null;
    const entry = await saveEntryFrom(cd.action);
    handsFree.current?.deafen(450);
    chime('saved'); // the 3-second save happens silently otherwise
    setUi((u) => ({ phase: u.phase === 'countdown' ? 'idle' : u.phase, countdown: null, lastSaved: entry }));
    return entry;
  };

  const armCountdown = () => {
    const cd = countdown.current;
    if (!cd) return;
    clearTimeout(cd.timer);
    cd.timer = setTimeout(commitCountdown, LIMITS.SAVE_DELAY_MS);
    setUi({ phase: 'countdown', countdown: { until: Date.now() + LIMITS.SAVE_DELAY_MS, ms: LIMITS.SAVE_DELAY_MS } });
  };

  const cancelCountdown = useCallback(async (spoken = true) => {
    const cd = countdown.current;
    if (!cd) return;
    clearTimeout(cd.timer);
    countdown.current = null;
    const r = reply('not_saved', cd.action.reply.lang);
    setUi({ phase: 'idle', countdown: null, reply: r, options: [] });
    if (spoken) await talk(r);
  }, [setUi]);

  // ── carrying out decisions ───────────────────────────────────────────────

  const say = async (r, phaseAfter) => {
    setUi({ reply: r, phase: 'speaking' });
    await talk(r);
    if (phaseAfter) setUi({ phase: phaseAfter });
  };

  const run = async (action, clipKey = null) => {
    for (const a of action.aliases || []) await addAlias(a.customerId, a.spoken);
    if (action.convo) convo.current = action.convo;
    lastActivity.current = Date.now();

    switch (action.kind) {
      case 'pending_save':
        countdown.current = { action, timer: null };
        setUi({ options: [], reply: action.reply, countdown: { until: null, ms: LIMITS.SAVE_DELAY_MS }, phase: 'speaking' });
        await talk(action.reply);
        if (countdown.current?.action === action) armCountdown();
        return;
      case 'save': {
        const entry = await saveEntryFrom(action);
        setUi({ options: [], lastSaved: entry });
        return say(action.reply, 'idle');
      }
      case 'ask':
        lastOptions.current = action.options || [];
        setUi({ options: action.options || [] });
        return say(action.reply, 'awaiting');
      case 'answer':
        await resolveReviews();
        setUi({ options: [] });
        return say(action.reply, 'idle');
      case 'undo':
        await removeEntry(action.entryId);
        justSaved.current = null;
        setUi({ options: [], lastSaved: null });
        return say(action.reply, 'idle');
      case 'add_customer': {
        const c = await addCustomer(action.customer);
        return run(afterCustomerAdded(action.pending, c, ctxNow()), clipKey);
      }
      case 'fail':
        await saveReview(clipKey, action.review);
        return say(action.reply, convo.current.awaiting ? 'awaiting' : 'idle');
      case 'manual':
        await saveReview(clipKey, action.review);
        setUi({ options: [] });
        await say(action.reply, 'idle');
        setUi({ manual: { ...action.prefill, clipKey: clipKey || lastClipKey.current } });
        return;
      default:
        return say(action.reply, 'idle');
    }
  };

  const processText = async (text, clipKey, { hf = false } = {}) => {
    setUi({ phase: 'understanding', heard: text });
    const c = convo.current;
    const context = c.awaiting
      ? { awaiting: AWAIT_FOR_LLM[c.awaiting], pending: { intent: c.pending?.intent, customer_name: c.pending?.customer_name, amount: c.pending?.amount } }
      : null;
    const parse = await understand(text, context);
    parse.clipKey = clipKey;

    // An utterance during the 3-second window: "venaam" cancels, anything else saves first.
    if (countdown.current) {
      if (parse.intent === 'confirm_no' || parse.intent === 'undo_last' || (parse.yes_no === 'no' && !parse.amount)) {
        return cancelCountdown();
      }
      await commitCountdown();
      if (parse.intent === 'confirm_yes') return setUi({ phase: 'idle' });
    }
    // Hands-free hears the whole shop: outside a conversation, only clear ledger commands count.
    if (hf && !handsFreeShouldAct(parse, { engaged: Boolean(convo.current.awaiting), justSaved: Boolean(ctxNow().justSaved) })) {
      if (clipKey) clips.current.delete(clipKey);
      return setUi({ phase: restPhase(), hint: 'hf_ignored' });
    }
    const action = decide(parse, convo.current, ctxNow());
    if (action.kind === 'fail' || action.kind === 'manual') {
      await saveReview(clipKey, action.review, text, parse);
    }
    return run(action, clipKey);
  };

  // ── one recorded utterance -> understood ─────────────────────────────────

  /**
   * rec = { pcm, wav, archive, quality } from a hold-to-talk press or a hands-free sentence.
   * Hands-free (hf) clips that come to nothing outside a conversation are dropped quietly:
   * the shop is never noisy enough to make the app nag.
   */
  const handleClip = async (rec, { hf = false } = {}) => {
    const quiet = hf && !engaged();
    if (rec.quality.verdict === 'short' || (quiet && rec.quality.verdict !== 'ok')) {
      live.current?.abort();
      live.current = null;
      setUi({ phase: restPhase(), hint: hf ? null : 'hold_longer' });
      if (countdown.current) armCountdown();
      return;
    }
    const clipKey = uuid();
    clips.current.set(clipKey, rec.archive);
    lastClipKey.current = clipKey;
    lastActivity.current = Date.now();

    // Quality gate: never guess from audio we can't hear properly.
    if (rec.quality.verdict === 'quiet' || rec.quality.verdict === 'noisy') {
      live.current?.abort();
      live.current = null;
      if (countdown.current) await commitCountdown();
      return run(fail(convo.current, replyLang(), rec.quality.verdict), clipKey);
    }

    setUi({ phase: 'transcribing', heard: '' });
    const stt = await transcribe({ wav: rec.wav, archive: rec.archive, pcm: rec.pcm, live: live.current });
    live.current = null;
    if (!stt) {
      // No engine reachable (offline, no on-device model): keep the clip for later.
      if (hf) stopHandsFree('hf_needs_engine'); // or every word in the shop would pile up for review
      if (countdown.current) await commitCountdown();
      await saveReview(clipKey, 'offline');
      reviewIds.current = []; // stays in Needs review; not tied to this conversation
      convo.current = EMPTY_CONVO;
      return say(reply('saved_for_review', replyLang()), 'idle');
    }
    setUi({ engine: stt.engine });
    if (!stt.text.trim()) {
      if (hf && !engaged()) {
        clips.current.delete(clipKey);
        return setUi({ phase: restPhase() });
      }
      return run(fail(convo.current, replyLang(), 'unclear'), clipKey);
    }
    return processText(stt.text, clipKey, { hf });
  };

  // ── mic press / release ──────────────────────────────────────────────────

  const pressStart = useCallback(async () => {
    if (pressing.current || handsFree.current) return;
    stopSpeaking();
    pressing.current = true;
    if (countdown.current) clearTimeout(countdown.current.timer);
    if (Date.now() - lastActivity.current > IDLE_RESET_MS && !countdown.current) convo.current = EMPTY_CONVO;
    setUi({ phase: 'recording', hint: null, error: null, level: 0 });
    try {
      await recorder.start((level) => setUi({ level }));
    } catch (err) {
      console.warn('mic failed', err);
      pressing.current = false;
      setUi({ phase: 'idle', error: 'mic_blocked' });
      return;
    }
    if (!pressing.current) {
      recorder.cancel();
      return;
    }
    const eng = engines();
    live.current = !eng.server && !eng.device && eng.browser ? startLiveRecognition(speechLangCode()) : null;
  }, [setUi]);

  const pressEnd = useCallback(async () => {
    if (!pressing.current) return;
    pressing.current = false;
    live.current?.stop();
    let rec;
    try {
      rec = await recorder.stop();
    } catch (err) {
      console.warn('stop failed', err);
    }
    if (!rec) {
      setUi({ phase: 'idle' });
      return;
    }
    return handleClip(rec);
  }, [setUi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── hands-free: just talk ────────────────────────────────────────────────

  const quietSoon = () => {
    clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => stopHandsFree('hf_quiet_off'), HF_QUIET_OFF_MS);
  };

  const stopHandsFree = useCallback((hint = null) => {
    const hf = handsFree.current;
    if (!hf) return;
    handsFree.current = null;
    hf.stop();
    clearTimeout(quietTimer.current);
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setUi((u) => ({ handsFree: null, level: 0, phase: u.phase === 'recording' ? restPhase() : u.phase, hint }));
  }, [setUi]); // eslint-disable-line react-hooks/exhaustive-deps

  const startHandsFree = useCallback(async () => {
    if (handsFree.current || pressing.current || demoRun.current) return;
    const eng = engines();
    if (!eng.server && !eng.device) {
      // The browser's own recognition can't be pointed at a clip, so hands-free needs Whisper.
      setUi({ error: 'hf_needs_engine', hint: null });
      return;
    }
    stopSpeaking();
    const hf = new HandsFree(recorder, {
      onLevel: (level) => setUi({ level }),
      onDetector: (detector) => handsFree.current === hf && setUi({ handsFree: { detector } }),
      onStart: () => {
        quietSoon();
        if (countdown.current) clearTimeout(countdown.current.timer);
        if (Date.now() - lastActivity.current > IDLE_RESET_MS && !countdown.current) convo.current = EMPTY_CONVO;
        setUi({ phase: 'recording', hint: null, error: null });
      },
      onMisfire: () => {
        setUi({ phase: restPhase() });
        if (countdown.current) armCountdown();
      },
      onUtterance: async ({ pcm, noiseDb }) => {
        hf.pause();
        try {
          const quality = analyse(pcm, undefined, { noiseDb });
          const wav = encodeWav(quality.trimmed);
          await handleClip({ pcm: quality.trimmed, wav, archive: { blob: wav, mime: 'audio/wav' }, quality }, { hf: true });
        } catch (err) {
          console.warn('hands-free turn failed', err);
          setUi({ phase: restPhase() });
        } finally {
          hf.resume();
        }
      },
    });
    handsFree.current = hf;
    try {
      await hf.start({ wait: getState().settings.handsFreeWait });
    } catch (err) {
      console.warn('mic failed', err);
      handsFree.current = null;
      hf.stop();
      setUi({ handsFree: null, error: 'mic_blocked' });
      return;
    }
    quietSoon();
    try {
      wakeLock.current = (await navigator.wakeLock?.request('screen')) || null; // keep the counter phone awake
    } catch { /* not allowed here: the screen may sleep */ }
    setUi({ handsFree: { detector: hf.detector }, phase: restPhase(), hint: null, error: null, level: 0 });
  }, [setUi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── touch helpers ────────────────────────────────────────────────────────

  const submitText = useCallback(async (text) => {
    if (!text.trim()) return;
    stopSpeaking();
    lastActivity.current = Date.now();
    await processText(text.trim(), null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const quickReply = useCallback(async (value) => {
    stopSpeaking();
    let parse;
    if (value === 'yes') parse = { intent: 'confirm_yes', yes_no: 'yes' };
    else if (value === 'no') parse = { intent: 'confirm_no', yes_no: 'no' };
    else if (value === 'new') parse = { intent: 'unclear', choiceId: 'new' };
    else parse = { intent: 'unclear', choiceId: value.replace(/^id:/, '') };
    await run(decide(parse, convo.current, ctxNow()), null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const undoSaved = useCallback(async () => {
    const e = ui.lastSaved;
    if (!e) return;
    await removeEntry(e.id);
    justSaved.current = null;
    const r = reply('undo_done', e.lang || 'ta');
    setUi({ lastSaved: null, reply: r });
    await talk(r);
  }, [ui.lastSaved, setUi]);

  const saveNow = useCallback(() => commitCountdown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Manual form saved: attach the last voice clip, resolve review rows, learn the name. */
  const completeManual = useCallback(async (fields, prefill) => {
    const clip = prefill?.clipKey ? clips.current.get(prefill.clipKey) : null;
    const entry = await addEntry({ ...fields, source: clip ? 'voice' : 'manual', status: 'confirmed', confidence: 1 }, clip);
    if (prefill?.customer_name && fields.customer_id && prefill.customer_id !== fields.customer_id) {
      await addAlias(fields.customer_id, prefill.customer_name);
    }
    await resolveReviews();
    clips.current.clear();
    convo.current = EMPTY_CONVO;
    setUi({ manual: null, lastSaved: entry, phase: 'idle', options: [] });
    return entry;
  }, [setUi]); // eslint-disable-line react-hooks/exhaustive-deps

  const openManual = useCallback((prefill = {}) => setUi({ manual: { type: 'credit', ...prefill } }), [setUi]);
  const closeManual = useCallback(() => {
    convo.current = EMPTY_CONVO;
    reviewIds.current = []; // failed clips stay in Needs review
    setUi({ manual: null, phase: 'idle', options: [] });
  }, [setUi]);


  /** Speak today's totals ("Indru 3,340 kadan, 100 varavu. Mottham baaki 8,400."). */
  const speakSummary = useCallback(async () => {
    stopSpeaking();
    const st = getState().settings;
    const lang = PACKS[st.replyLang] ? st.replyLang : st.uiLang || 'ta';
    await run(todayAnswer(ctxNow(), lang), null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Demo autopilot: plays a scripted counter conversation through the real pipeline
   * (understanding, decisions, spoken replies, saves). Typed out like live captions.
   */
  const runDemo = useCallback(async (script) => {
    if (demoRun.current) return;
    stopHandsFree();
    const token = {};
    demoRun.current = token;
    const alive = () => demoRun.current === token;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    convo.current = EMPTY_CONVO;
    try {
      for (let i = 0; i < script.length && alive(); i++) {
        const step = script[i];
        setUi({ demo: { step: i + 1, total: script.length, note: step.note || null } });
        if (step.say) {
          setUi({ phase: 'recording', heard: '', reply: null, options: [], engine: 'demo autopilot' });
          for (let k = 2; k <= step.say.length + 1 && alive(); k += 2) {
            setUi({ heard: step.say.slice(0, k), level: 0.35 + Math.random() * 0.5 });
            await sleep(28);
          }
          setUi({ level: 0 });
          if (!alive()) break;
          await processText(step.say, null);
        } else if (step.tap) {
          await sleep(700);
          const opt = lastOptions.current.find((o) => String(o.label).toLowerCase().includes(step.tap.toLowerCase()));
          if (opt) await quickReply(opt.value);
        } else if (step.summary) {
          await speakSummary();
        }
        await sleep(step.pause ?? 900);
      }
      if (countdown.current) await commitCountdown();
    } finally {
      if (alive()) demoRun.current = null;
      setUi({ demo: null, phase: 'idle', level: 0 });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopDemo = useCallback(() => {
    demoRun.current = null;
    stopSpeaking();
  }, []);

  const dismiss = useCallback(() => {
    stopSpeaking();
    convo.current = EMPTY_CONVO;
    setUi({ phase: 'idle', options: [], reply: null, heard: '', hint: null });
  }, [setUi]);

  // Release the microphone when the app is hidden; clear the Undo chip after a while.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        stopHandsFree(); // never listen from the background
        recorder.release();
        if (countdown.current) commitCountdown();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ui.lastSaved) return undefined;
    const t = setTimeout(() => setUi({ lastSaved: null }), 8000);
    return () => clearTimeout(t);
  }, [ui.lastSaved, setUi]);

  return {
    ui,
    awaiting: convo.current.awaiting,
    pressStart,
    pressEnd,
    submitText,
    quickReply,
    cancelCountdown,
    saveNow,
    undoSaved,
    openManual,
    closeManual,
    completeManual,
    dismiss,
    speakSummary,
    runDemo,
    stopDemo,
    startHandsFree,
    stopHandsFree,
  };
}
