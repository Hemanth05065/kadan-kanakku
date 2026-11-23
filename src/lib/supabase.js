import { createClient } from '@supabase/supabase-js';
import { CLOUD, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = CLOUD
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  : null;
