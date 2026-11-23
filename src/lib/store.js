// App state: an in-memory mirror of the IndexedDB ledger. Every write goes to IndexedDB
// first (so nothing is lost offline) and, in cloud mode, into the outbox for sync.
import { useSyncExternalStore, useMemo } from 'react';
import { db, getMeta, setMeta, clearAll } from './db.js';
import { CLOUD, LIMITS } from './config.js';
import { uuid, nowIso } from './util.js';
import { skeleton } from './translit.js';
import { balances, todayStats, totalPending, customersByPending, recentEntries, reviewQueue, isLive } from './ledger.js';
import { buildNameIndex } from './names.js';
import { generateDemo } from './seed.js';
import { supabase } from './supabase.js';

const DEFAULT_SETTINGS = {
  uiLang: 'ta', // primary label language (English shown underneath)
  replyLang: 'auto', // auto = same language the owner spoke
  voice: 'auto', // auto | phone | server
  speechLang: 'ta-IN', // browser recognition fallback language
};

let state = {
  ready: false,
  mode: CLOUD ? 'cloud' : 'local',
  session: null,
  shop: null,
  customers: [],
  aliases: [],
  entries: [],
  outbox: 0,
  syncing: false,
  lastSync: null,
  syncError: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  settings: DEFAULT_SETTINGS,
  server: { stt: CLOUD, nlu: CLOUD, tts: CLOUD }, // turned off when a function says "not configured"
};

const listeners = new Set();
const writeHooks = new Set();

export function getState() {
  return state;
}
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function useStore() {
  return useSyncExternalStore(subscribe, getState);
}
/** Called after every local write (sync engine hooks in here). */
export function onWrite(fn) {
  writeHooks.add(fn);
  return () => writeHooks.delete(fn);
}

/** Derived ledger numbers, memoised on the underlying arrays. */
export function useLedger() {
  const s = useStore();
  return useMemo(() => {
    const bal = balances(s.entries);
    return {
      bal,
      today: todayStats(s.entries),
      pending: totalPending(bal),
      sortedCustomers: customersByPending(s.customers, bal),
      recent: recentEntries(s.entries),
      review: reviewQueue(s.entries),
      customerById: new Map(s.customers.map((c) => [c.id, c])),
      nameIndex: buildNameIndex(s.customers, s.aliases),
    };
  }, [s.entries, s.customers, s.aliases]);
}

// ── loading ──────────────────────────────────────────────────────────────────

const LOCAL_SHOP = { id: 'local-shop', name: 'Demo Kadai', lang: 'ta' };

async function loadRows() {
  const d = await db();
  const [customers, aliases, entries, outbox] = await Promise.all([
    d.getAll('customers'), d.getAll('aliases'), d.getAll('entries'), d.count('outbox'),
  ]);
  return { customers, aliases, entries, outbox };
}

export async function initStore() {
  const settings = { ...DEFAULT_SETTINGS, ...(await getMeta('settings', {})) };
  const lastSync = await getMeta('lastPull', null);
  let shop = await getMeta('shop', null);
  if (!CLOUD && !shop) {
    shop = LOCAL_SHOP;
    await setMeta('shop', shop);
    await seedInto(shop);
  }
  setState({ settings, shop, lastSync, ...(await loadRows()), ready: true });
}

/** Switch the device to a (cloud) shop. Clears the cache if it belonged to another shop. */
export async function switchShop(shop) {
  const prev = await getMeta('shop', null);
  if (prev && prev.id !== shop.id) {
    const settings = state.settings;
    await clearAll();
    await setMeta('settings', settings);
  }
  await setMeta('shop', shop);
  setState({ shop, ...(await loadRows()) });
}

export async function resetDevice() {
  await clearAll();
  setState({ shop: null, customers: [], aliases: [], entries: [], outbox: 0, lastSync: null });
}

export async function resetDemo() {
  await clearAll();
  await setMeta('settings', state.settings);
  await setMeta('shop', LOCAL_SHOP);
  await seedInto(LOCAL_SHOP);
  setState({ shop: LOCAL_SHOP, lastSync: null, ...(await loadRows()) });
}

/** Write the 3-week demo ledger into a shop (through the outbox in cloud mode). */
export async function seedInto(shop) {
  const { customers, entries } = generateDemo(shop.id);
  const d = await db();
  const tx = d.transaction(['customers', 'entries', 'outbox'], 'readwrite');
  for (const c of customers) {
    tx.objectStore('customers').put(c);
    if (CLOUD) tx.objectStore('outbox').add({ table: 'customers', row: c });
  }
  for (const e of entries) {
    tx.objectStore('entries').put(e);
    if (CLOUD) tx.objectStore('outbox').add({ table: 'entries', row: e });
  }
  await tx.done;
}

export async function loadDemoIntoShop() {
  await seedInto(state.shop);
  setState(await loadRows());
  writeHooks.forEach((h) => h());
}

export async function setSettings(patch) {
  const settings = { ...state.settings, ...patch };
  await setMeta('settings', settings);
  setState({ settings });
}

// ── writes ───────────────────────────────────────────────────────────────────

const replaceIn = (list, row) => {
  const i = list.findIndex((r) => r.id === row.id);
  if (i === -1) return [...list, row];
  const copy = list.slice();
  copy[i] = row;
  return copy;
};

const MEM = { customers: 'customers', aliases: 'aliases', entries: 'entries' };

async function putRow(table, row) {
  const d = await db();
  const tx = d.transaction([table, 'outbox'], 'readwrite');
  tx.objectStore(table).put(row);
  if (state.mode === 'cloud') tx.objectStore('outbox').add({ table, row });
  await tx.done;
  setState((s) => ({ [MEM[table]]: replaceIn(s[MEM[table]], row), outbox: s.outbox + (s.mode === 'cloud' ? 1 : 0) }));
  writeHooks.forEach((h) => h());
  return row;
}

const base = () => {
  const t = nowIso();
  return { shop_id: state.shop.id, created_at: t, updated_at: t, deleted_at: null };
};

export async function addCustomer({ name, name_ta = null, honorific = null, phone = null }) {
  return putRow('customers', {
    ...base(),
    id: uuid(),
    name: name.trim(),
    name_ta: name_ta?.trim() || null,
    honorific: honorific?.trim() || null,
    phone: phone?.trim() || null,
  });
}

export async function updateCustomer(id, patch) {
  const cur = state.customers.find((c) => c.id === id);
  if (!cur) return null;
  return putRow('customers', { ...cur, ...patch, updated_at: nowIso() });
}

export async function removeCustomer(id) {
  return updateCustomer(id, { deleted_at: nowIso() });
}

/** Remember how the owner says a customer's name (learned from corrections). */
export async function addAlias(customerId, spoken) {
  const alias = String(spoken || '').trim().slice(0, 80);
  if (!alias) return null;
  const sk = skeleton(alias);
  const c = state.customers.find((x) => x.id === customerId);
  if (!c || skeleton(c.name) === sk || (c.name_ta && skeleton(c.name_ta) === sk)) return null;
  if (state.aliases.some((a) => a.customer_id === customerId && !a.deleted_at && skeleton(a.alias) === sk)) return null;
  // The same sound must not point at two customers: retire older aliases for it.
  for (const a of state.aliases) {
    if (!a.deleted_at && a.customer_id !== customerId && skeleton(a.alias) === sk) {
      await putRow('aliases', { ...a, deleted_at: nowIso(), updated_at: nowIso() });
    }
  }
  return putRow('aliases', { ...base(), id: uuid(), customer_id: customerId, alias });
}

const AUDIO_EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };

/**
 * Save a ledger entry (confirmed or needs_review), with its voice clip if there is one.
 * The clip is kept on the device and uploaded to storage by the sync engine.
 */
export async function addEntry(fields, audio = null) {
  const id = fields.id || uuid();
  let audio_path = null;
  if (audio?.blob) {
    const mime = (audio.mime || audio.blob.type || 'audio/webm').split(';')[0];
    audio_path = `${state.shop.id}/${id}.${AUDIO_EXT[mime] || 'webm'}`;
    const d = await db();
    const tx = d.transaction(['audio', 'outbox'], 'readwrite');
    tx.objectStore('audio').put({ id, blob: audio.blob, mime });
    if (state.mode === 'cloud') tx.objectStore('outbox').add({ table: 'audio', entryId: id, path: audio_path, mime });
    await tx.done;
    if (state.mode === 'cloud') setState((s) => ({ outbox: s.outbox + 1 }));
  }
  const row = {
    ...base(),
    id,
    customer_id: fields.customer_id ?? null,
    type: fields.type ?? null,
    amount: fields.amount ?? null,
    items: fields.items || [],
    transcript: fields.transcript ?? null,
    audio_path: audio_path ?? fields.audio_path ?? null,
    confidence: fields.confidence ?? null,
    lang: fields.lang ?? null,
    source: fields.source || 'voice',
    status: fields.status || 'confirmed',
    review_reason: fields.review_reason ?? null,
    suggestion: fields.suggestion ?? null,
    created_at: fields.created_at || nowIso(),
  };
  return putRow('entries', row);
}

export async function updateEntry(id, patch) {
  const cur = state.entries.find((e) => e.id === id);
  if (!cur) return null;
  return putRow('entries', { ...cur, ...patch, updated_at: nowIso() });
}

export async function removeEntry(id) {
  return updateEntry(id, { deleted_at: nowIso() });
}

/** The most recent live entry that voice undo may cancel. */
export function lastUndoable() {
  const cutoff = Date.now() - LIMITS.UNDO_WINDOW_MIN * 60000;
  return state.entries
    .filter((e) => isLive(e) && new Date(e.created_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
}

/** Playable URL for an entry's clip: local blob first, else a signed URL from storage. */
export async function audioUrl(entry) {
  const local = await (await db()).get('audio', entry.id);
  if (local?.blob) return URL.createObjectURL(local.blob);
  if (state.mode === 'cloud' && entry.audio_path) {
    const { data } = await supabase.storage.from('entry-audio').createSignedUrl(entry.audio_path, 300);
    return data?.signedUrl || null;
  }
  return null;
}

export async function audioBlob(entryId) {
  return (await (await db()).get('audio', entryId)) || null;
}

// ── used by the sync engine ──────────────────────────────────────────────────

/** Merge rows pulled from the server, skipping rows with unsent local changes. */
export async function applyRemote(table, rows, pendingIds) {
  if (!rows.length) return;
  const d = await db();
  const tx = d.transaction(table, 'readwrite');
  let list = state[MEM[table]];
  for (const r of rows) {
    if (pendingIds.has(r.id)) continue;
    const row = table === 'entries' ? { ...r, amount: r.amount === null ? null : Number(r.amount) } : r;
    tx.store.put(row);
    list = replaceIn(list, row);
  }
  await tx.done;
  setState({ [MEM[table]]: list });
}
