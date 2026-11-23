// Offline queue -> Supabase, with IndexedDB faked in memory and a Supabase client that
// records what it was asked to do.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const server = {
  upserts: [],
  uploads: [],
  rows: { customers: [], customer_aliases: [], entries: [] },
  failNext: null,
  offline: false,
};

function selectBuilder(table) {
  const filters = {};
  const b = {
    select: () => b,
    eq: (col, v) => { filters[col] = v; return b; },
    order: () => b,
    limit: () => b,
    gt: (col, v) => { filters.gt = [col, v]; return b; },
    then: (resolve) => {
      let data = server.rows[table].filter((r) => !filters.shop_id || r.shop_id === filters.shop_id);
      if (filters.gt) data = data.filter((r) => r[filters.gt[0]] > filters.gt[1]);
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return b;
}

vi.mock('./supabase.js', () => ({
  supabase: {
    from: (table) => ({
      upsert: async (row) => {
        if (server.offline) throw new TypeError('Failed to fetch');
        if (server.failNext) {
          const error = server.failNext;
          server.failNext = null;
          return { error };
        }
        server.upserts.push({ table, row });
        return { error: null };
      },
      select: () => selectBuilder(table),
    }),
    storage: {
      from: () => ({
        upload: async (path, blob) => {
          server.uploads.push({ path, size: blob.size });
          return { error: null };
        },
      }),
    },
  },
}));

const store = await import('./store.js');
const { syncNow } = await import('./sync.js');
const { db, clearAll } = await import('./db.js');

Object.defineProperty(globalThis.navigator, 'onLine', { get: () => !server.offline, configurable: true });

beforeEach(async () => {
  server.upserts = [];
  server.uploads = [];
  server.rows = { customers: [], customer_aliases: [], entries: [] };
  server.failNext = null;
  server.offline = false;
  await clearAll();
  store.setState({
    mode: 'cloud', session: { user: { id: 'u1' } }, shop: { id: 'shop-1', name: 'Test', lang: 'ta' },
    customers: [], aliases: [], entries: [], outbox: 0, lastSync: null, syncError: null,
  });
});

const outbox = async () => (await db()).getAll('outbox');

describe('offline queue', () => {
  it('queues writes while offline and sends them in order when back online', async () => {
    server.offline = true;
    const c = await store.addCustomer({ name: 'Ganesh' });
    const clip = new Blob([new Uint8Array(1200)], { type: 'audio/webm' });
    const e = await store.addEntry({ customer_id: c.id, type: 'credit', amount: 300, items: ['arisi'], transcript: 'Ganesh 300 kadan' }, { blob: clip, mime: 'audio/webm' });
    await syncNow(); // offline: does nothing
    expect((await outbox()).length).toBe(3);
    expect(server.upserts).toEqual([]);

    server.offline = false;
    await syncNow();
    expect(server.upserts.map((u) => u.table)).toEqual(['customers', 'entries']);
    expect(server.uploads).toEqual([{ path: `shop-1/${e.id}.webm`, size: 1200 }]);
    expect(await outbox()).toEqual([]);
    expect(store.getState().outbox).toBe(0);
  });

  it('sends only server columns and leaves updated_at to the server', async () => {
    const c = await store.addCustomer({ name: 'Ravi', phone: '9876543210' });
    await syncNow();
    const sent = server.upserts[0].row;
    expect(sent).toMatchObject({ id: c.id, shop_id: 'shop-1', name: 'Ravi', phone: '9876543210' });
    expect(sent).not.toHaveProperty('updated_at');
  });

  it('keeps the queue when the network drops mid-sync', async () => {
    await store.addCustomer({ name: 'A' });
    server.offline = true;
    Object.defineProperty(globalThis.navigator, 'onLine', { get: () => true, configurable: true }); // says online, fetch fails
    await syncNow();
    expect((await outbox()).length).toBe(1);
    expect(store.getState().syncError).toMatch(/fetch/i);
    Object.defineProperty(globalThis.navigator, 'onLine', { get: () => !server.offline, configurable: true });
  });

  it('drops a row the server will never accept instead of blocking the queue', async () => {
    await store.addCustomer({ name: 'Bad' });
    await store.addCustomer({ name: 'Good' });
    server.failNext = { code: '23514', message: 'check constraint' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await syncNow();
    warn.mockRestore();
    expect(server.upserts.map((u) => u.row.name)).toEqual(['Good']);
    expect(await outbox()).toEqual([]);
  });

  it('pulls changes made on other devices (this shop only)', async () => {
    server.rows.customers = [
      { id: 'remote-1', shop_id: 'shop-1', name: 'From staff phone', updated_at: '2026-11-23T10:00:00Z' },
      { id: 'other-shop', shop_id: 'shop-2', name: 'Not ours', updated_at: '2026-11-23T10:00:00Z' },
    ];
    server.rows.entries = [
      { id: 'e-r', shop_id: 'shop-1', customer_id: 'remote-1', type: 'credit', amount: '120.00', status: 'confirmed', created_at: '2026-11-23T10:00:00Z', updated_at: '2026-11-23T10:01:00Z' },
    ];
    await syncNow();
    const s = store.getState();
    expect(s.customers.map((c) => c.name)).toEqual(['From staff phone']);
    expect(s.entries[0].amount).toBe(120); // Postgres numeric arrives as a string
    expect(s.lastSync).toBe('2026-11-23T10:01:00Z');

    // Next pull asks only for newer rows.
    server.rows.customers.push({ id: 'remote-2', shop_id: 'shop-1', name: 'Later', updated_at: '2026-11-23T11:00:00Z' });
    await syncNow();
    expect(store.getState().customers.map((c) => c.name).sort()).toEqual(['From staff phone', 'Later']);
  });

  it('never overwrites a row that still has unsent local changes', async () => {
    const mine = await store.addCustomer({ name: 'Edited on this phone' });
    await store.applyRemote('customers', [{ ...mine, name: 'Older server copy', updated_at: '2026-11-23T09:00:00Z' }], new Set([mine.id]));
    expect(store.getState().customers.find((c) => c.id === mine.id).name).toBe('Edited on this phone');
    await store.applyRemote('customers', [{ ...mine, name: 'Newer server copy', updated_at: '2026-11-23T12:00:00Z' }], new Set());
    expect(store.getState().customers.find((c) => c.id === mine.id).name).toBe('Newer server copy');
  });
});
