// IndexedDB: the on-device copy of the ledger, audio clips, the offline outbox and the
// recorded shop voice (kept across demo resets: it belongs to the device, not the ledger).
import { openDB } from 'idb';

let dbp = null;

export function db() {
  if (!dbp) {
    dbp = openDB('kadan-kanakku', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('customers', { keyPath: 'id' });
          d.createObjectStore('aliases', { keyPath: 'id' });
          const e = d.createObjectStore('entries', { keyPath: 'id' });
          e.createIndex('customer_id', 'customer_id');
          d.createObjectStore('audio', { keyPath: 'id' }); // { id: entryId, blob, mime }
          d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
          d.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 2) d.createObjectStore('voice', { keyPath: 'key' }); // { key, wav, ms, rate, at }
      },
    });
  }
  return dbp;
}

export async function getMeta(key, fallback = null) {
  const row = await (await db()).get('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await (await db()).put('meta', { key, value });
}

export async function clearAll() {
  const d = await db();
  const tx = d.transaction(['customers', 'aliases', 'entries', 'audio', 'outbox', 'meta'], 'readwrite');
  await Promise.all([...tx.objectStoreNames].map((n) => tx.objectStore(n).clear()));
  await tx.done;
}
