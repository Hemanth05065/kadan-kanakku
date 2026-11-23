// Offline queue -> Supabase. Pushes the outbox in order (audio clips to storage, rows by
// upsert), then pulls rows changed on the server since the last pull. Runs on start-up,
// when the phone comes back online, after local writes, and every 30 s.
import { db, setMeta } from './db.js';
import { supabase } from './supabase.js';
import { getState, setState, onWrite, applyRemote } from './store.js';
import { debounce } from './util.js';

const SERVER_TABLE = { customers: 'customers', aliases: 'customer_aliases', entries: 'entries' };
const COLUMNS = {
  customers: ['id', 'shop_id', 'name', 'name_ta', 'honorific', 'phone', 'last_reminded_at', 'created_at', 'deleted_at'],
  aliases: ['id', 'shop_id', 'customer_id', 'alias', 'created_at', 'deleted_at'],
  entries: [
    'id', 'shop_id', 'customer_id', 'type', 'amount', 'items', 'transcript', 'audio_path', 'confidence', 'lang',
    'source', 'status', 'review_reason', 'suggestion', 'created_at', 'deleted_at',
  ],
};
const pickCols = (table, row) => Object.fromEntries(COLUMNS[table].map((k) => [k, row[k] ?? null]));

let running = null;

async function push() {
  const d = await db();
  const ops = await d.getAll('outbox');
  for (const op of ops) {
    if (op.table === 'audio') {
      const clip = await d.get('audio', op.entryId);
      if (clip?.blob) {
        const { error } = await supabase.storage
          .from('entry-audio')
          .upload(op.path, clip.blob, { upsert: true, contentType: op.mime || clip.mime });
        if (error && !/exists/i.test(error.message)) throw error;
      }
    } else {
      const { error } = await supabase.from(SERVER_TABLE[op.table]).upsert(pickCols(op.table, op.row));
      if (error) {
        // A row the server will never accept (bad data) must not block the queue forever.
        if (error.code && /^(22|23)/.test(error.code)) console.warn('dropping rejected row', op, error);
        else throw error;
      }
    }
    await d.delete('outbox', op.seq);
    setState((s) => ({ outbox: Math.max(0, s.outbox - 1) }));
  }
}

async function pull() {
  const { shop, lastSync } = getState();
  const d = await db();
  const pending = new Set((await d.getAll('outbox')).map((o) => o.row?.id).filter(Boolean));
  let newest = lastSync;
  for (const table of ['customers', 'aliases', 'entries']) {
    let q = supabase.from(SERVER_TABLE[table]).select('*').eq('shop_id', shop.id).order('updated_at').limit(5000);
    if (lastSync) q = q.gt('updated_at', lastSync);
    const { data, error } = await q;
    if (error) throw error;
    await applyRemote(table, data, pending);
    for (const r of data) if (!newest || r.updated_at > newest) newest = r.updated_at;
  }
  if (newest !== lastSync) {
    await setMeta('lastPull', newest);
    setState({ lastSync: newest });
  }
}

export async function syncNow() {
  const s = getState();
  if (s.mode !== 'cloud' || !s.session || !s.shop || !navigator.onLine) return;
  if (running) return running;
  running = (async () => {
    setState({ syncing: true });
    try {
      await push();
      await pull();
      setState({ syncError: null });
    } catch (err) {
      console.warn('sync failed', err);
      setState({ syncError: String(err?.message || err) });
    } finally {
      setState({ syncing: false });
      running = null;
    }
  })();
  return running;
}

const soon = debounce(syncNow, 1500);

export function startSync() {
  onWrite(soon);
  window.addEventListener('online', () => {
    setState({ online: true });
    syncNow();
  });
  window.addEventListener('offline', () => setState({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  setInterval(syncNow, 30000);
  syncNow();
}
