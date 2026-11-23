// Calls to the Supabase edge functions. A 503 "not_configured" switches that feature to
// its on-device fallback for the rest of the session.
import { supabase } from '../lib/supabase.js';
import { getState, setState } from '../lib/store.js';

export class NotConfigured extends Error {}

const FEATURE = { transcribe: 'stt', understand: 'nlu', speak: 'tts' };

export function serverAvailable(fn) {
  const s = getState();
  return s.mode === 'cloud' && Boolean(s.session) && s.server[FEATURE[fn]] && navigator.onLine;
}

export async function callFunction(fn, body, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body, signal: ctrl.signal });
    if (error) {
      let detail = null;
      try { detail = await error.context?.json?.(); } catch { /* not JSON */ }
      if (detail?.code === 'not_configured' || error.context?.status === 503) {
        setState((s) => ({ server: { ...s.server, [FEATURE[fn]]: false } }));
        throw new NotConfigured(detail?.error || `${fn} not configured`);
      }
      throw new Error(detail?.error || error.message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
