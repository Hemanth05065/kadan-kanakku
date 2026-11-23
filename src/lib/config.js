export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

/** Cloud mode: Supabase auth, sync, audio storage and server speech/LLM. Otherwise local demo mode. */
export const CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const LIMITS = {
  LARGE_AMOUNT: 2000, // confirm aloud above this
  CONFIDENCE_OK: 0.8, // confirm aloud below this
  SAVE_DELAY_MS: 3000, // auto-save after the spoken confirmation
  UNDO_WINDOW_MIN: 15, // voice undo only reaches entries this recent
  MAX_FAILURES: 2, // then open the manual form
  MAX_CLIP_MS: 15000,
};
