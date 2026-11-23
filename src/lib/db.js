// IndexedDB: the on-device copy of the ledger, audio clips and the offline outbox.
import { openDB } from 'idb';

let dbp = null;

export function db() {
  if (!dbp) {
    dbp = openDB('kadan-kanakku', 1, {
      upgrade(d) {
        d.createObjectStore('customers', { keyPath: 'id' });
        d.createObjectStore('aliases', { keyPath: 'id' });
        const e = d.createObjectStore('entries', { keyPath: 'id' });
        e.createIndex('customer_id', 'customer_id');
        d.createObjectStore('audio', { keyPath: 'id' }); // { id: entryId, blob, mime }
        d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
        d.createObjectStore('meta', { keyPath: 'key' });
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
