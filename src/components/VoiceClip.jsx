import { useEffect, useRef, useState } from 'react';
import { useT } from './ui.jsx';
import { Recorder } from '../voice/recorder.js';
import { STUDIO_RATE, storeRecording, playClip, stopVoice, deleteClip, useVoiceClips } from '../voice/voiceClips.js';
import { nameClipKey } from '../voice/voicePack.js';
import { stopSpeaking } from '../voice/tts.js';

export const CLIP_PROBLEMS = {
  short: 'Hold the button while you speak, then let go.',
  quiet: 'Too quiet. Come a little closer to the phone.',
  loud: 'Too loud. Hold the phone a little further away.',
};

// One studio microphone shared by every record button on screen (a list of names would
// otherwise open a microphone per row); released when the last of them goes away.
let shared = null;
let users = 0;
const acquire = () => {
  users++;
  shared ||= new Recorder({ rate: STUDIO_RATE, studio: true });
};
const releaseOne = () => {
  users = Math.max(0, users - 1);
  if (!users) {
    shared?.release();
    shared = null;
  }
};

/**
 * Hold-to-record one clip of the shop voice. stop(key) cleans the recording up, keeps it
 * and plays it back. phase: idle | recording | processing.
 */
export function useClipRecorder() {
  const pressing = useRef(false);
  const [phase, setPhase] = useState('idle');
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    acquire();
    return releaseOne;
  }, []);

  const start = async () => {
    if (pressing.current) return;
    pressing.current = true;
    setProblem(null);
    stopSpeaking();
    shared ||= new Recorder({ rate: STUDIO_RATE, studio: true });
    try {
      await shared.start(setLevel);
      if (!pressing.current) {
        shared.cancel();
        return;
      }
      setPhase('recording');
    } catch {
      pressing.current = false;
      setPhase('idle');
      setProblem('mic_blocked');
    }
  };

  /** Returns true when a clip was kept. */
  const stop = async (key) => {
    if (!pressing.current) return false;
    pressing.current = false;
    setPhase('processing');
    try {
      const r = await shared?.stop();
      if (!r) return false;
      const out = await storeRecording(key, r.raw, r.rawRate);
      if (out.verdict !== 'ok') {
        setProblem(out.verdict);
        return false;
      }
      await playClip(key);
      return true;
    } finally {
      setPhase('idle');
      setLevel(0);
    }
  };

  return { phase, level, problem, start, stop };
}

export function ProblemText({ problem }) {
  const { t } = useT();
  if (!problem) return null;
  return <p className="text-sm font-semibold text-red-700">{problem === 'mic_blocked' ? t('mic_blocked') : CLIP_PROBLEMS[problem]}</p>;
}

/** A compact hold-to-record pill. */
export function HoldToRecord({ phase, onStart, onEnd, label = 'Hold to record' }) {
  const live = phase === 'recording';
  return (
    <button
      type="button"
      className={`no-touch-ui min-h-12 rounded-full px-4 font-semibold text-white shadow-sm ${live ? 'mic-live bg-red-600' : 'bg-leaf-800 active:scale-95'}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onStart();
      }}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onContextMenu={(e) => e.preventDefault()}
      disabled={phase === 'processing'}
    >
      {live ? '● Recording… let go' : phase === 'processing' ? '…' : `🎙 ${label}`}
    </button>
  );
}

/** "Name in your voice": record how the shop says this customer's name, used in spoken replies. */
export function NameVoiceRow({ customer, compact = false }) {
  const { t, en } = useT();
  const { has } = useVoiceClips();
  const r = useClipRecorder();
  const key = nameClipKey(customer);
  const recorded = has(key);
  const label = [customer.name, customer.honorific].filter(Boolean).join(' ');
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${compact ? 'py-2' : 'rounded-2xl bg-white p-3 shadow-sm'}`}>
      <div className="min-w-0">
        {compact ? (
          <>
            <p className="font-semibold">{label}</p>
            {customer.name_ta && <p className="text-sm text-stone-500">{customer.name_ta}</p>}
          </>
        ) : (
          <>
            <p className="font-semibold">🎙 {t('name_voice')}</p>
            <p className="text-xs text-stone-500">{en('name_voice')} · say “{label}” the way you call them</p>
          </>
        )}
        <ProblemText problem={r.problem} />
      </div>
      <div className="flex items-center gap-2">
        {recorded && (
          <button type="button" aria-label="Play" className="h-12 w-12 rounded-full bg-leaf-100 text-leaf-900" onClick={() => playClip(key)}>▶</button>
        )}
        {recorded && !compact && (
          <button type="button" aria-label="Delete" className="h-12 w-12 rounded-full bg-stone-100 text-stone-600" onClick={() => { stopVoice(); deleteClip(key); }}>✕</button>
        )}
        <HoldToRecord phase={r.phase} onStart={r.start} onEnd={() => r.stop(key)} label={recorded ? 'Again' : 'Record'} />
      </div>
    </div>
  );
}
