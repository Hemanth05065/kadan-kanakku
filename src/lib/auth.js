// Phone-OTP sign-in and shop selection (cloud mode only).
import { supabase } from './supabase.js';
import { setState, getState, switchShop, resetDevice } from './store.js';
import { getMeta } from './db.js';
import { syncNow } from './sync.js';

/** +91 is assumed for 10-digit Indian mobile numbers. */
export function normalisePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  setState({ session: data.session });
  supabase.auth.onAuthStateChange((_event, session) => setState({ session }));
  if (data.session) await loadShop();
}

export async function sendOtp(phone) {
  const { error } = await supabase.auth.signInWithOtp({ phone: normalisePhone(phone) });
  if (error) throw error;
}

export async function verifyOtp(phone, token) {
  const { data, error } = await supabase.auth.verifyOtp({ phone: normalisePhone(phone), token: token.trim(), type: 'sms' });
  if (error) throw error;
  setState({ session: data.session });
  await loadShop();
}

/** Find the signed-in user's shop; the cached one is used while offline. */
export async function loadShop() {
  if (!navigator.onLine) {
    const cached = await getMeta('shop', null);
    if (cached) setState({ shop: cached });
    return cached;
  }
  const userId = getState().session?.user?.id;
  const { data, error } = await supabase
    .from('shop_members')
    .select('shop_id, role, shops(id, name, lang)')
    .eq('user_id', userId)
    .order('created_at')
    .limit(1);
  if (error) {
    const cached = await getMeta('shop', null);
    if (cached) setState({ shop: cached });
    return cached;
  }
  const row = data?.[0];
  const shop = row?.shops ? { ...row.shops, role: row.role } : null;
  if (shop) {
    await switchShop(shop);
    syncNow();
  } else {
    setState({ shop: null });
  }
  return shop;
}

export async function createShop(name, lang = 'ta') {
  const { data, error } = await supabase.rpc('create_shop', { p_name: name.trim(), p_lang: lang });
  if (error) throw error;
  const shop = { id: data.id, name: data.name, lang: data.lang, role: 'owner' };
  await switchShop(shop);
  return shop;
}

/** Owner: a 6-digit code a staff member types after signing in with their own phone. */
export async function createInvite() {
  const { data, error } = await supabase.rpc('create_invite', { p_shop: getState().shop.id, p_role: 'staff' });
  if (error) throw error;
  return data;
}

/** Staff: join the shop that issued this code. */
export async function joinShop(code) {
  const { data, error } = await supabase.rpc('join_shop', { p_code: String(code).trim() });
  if (error) throw error;
  const shop = { id: data.id, name: data.name, lang: data.lang, role: 'staff' };
  await switchShop(shop);
  syncNow();
  return shop;
}

/** Everyone working in this shop. */
export async function listMembers() {
  const { data, error } = await supabase
    .from('shop_members')
    .select('user_id, role, created_at')
    .eq('shop_id', getState().shop.id)
    .order('created_at');
  if (error) throw error;
  const me = getState().session?.user?.id;
  return (data || []).map((m) => ({ ...m, isMe: m.user_id === me }));
}

export async function signOut() {
  if (getState().outbox > 0 && !confirm('Some entries are not synced yet. Sign out anyway?')) return;
  await supabase.auth.signOut();
  await resetDevice();
  setState({ session: null });
}
