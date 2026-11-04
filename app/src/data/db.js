// Бэкенды хранения. Store держит все записи в памяти, а изменения пишет пачкой
// в одной транзакции: запись + операция очереди фиксируются вместе или не фиксируются вовсе.

export const STORES = ['locations', 'routes', 'trips', 'trip_segments', 'inspections', 'track_points', 'sync_queue', 'meta'];

/**
 * @typedef {{store: string, value?: object, key?: string, delete?: boolean}} Write
 * @typedef {{loadAll(): Promise<Record<string, object[]>>, commit(writes: Write[]): Promise<void>, clear(): Promise<void>}} Backend
 */

/** IndexedDB (браузер). */
export class IdbBackend {
  constructor(name = 'road-tracker') {
    this.name = name;
    this.dbPromise = null;
  }

  open() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('База данных открыта в другой вкладке со старой версией. Закройте её.'));
      });
    }
    return this.dbPromise;
  }

  async loadAll() {
    const db = await this.open();
    const tx = db.transaction(STORES, 'readonly');
    const out = {};
    await Promise.all(STORES.map((s) => new Promise((resolve, reject) => {
      const r = tx.objectStore(s).getAll();
      r.onsuccess = () => { out[s] = r.result; resolve(); };
      r.onerror = () => reject(r.error);
    })));
    return out;
  }

  async commit(writes) {
    if (!writes.length) return;
    const db = await this.open();
    const stores = [...new Set(writes.map((w) => w.store))];
    await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite', { durability: 'strict' });
      for (const w of writes) {
        const os = tx.objectStore(w.store);
        if (w.delete) os.delete(w.key);
        else os.put(w.value);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Транзакция отменена'));
    });
  }

  async clear() {
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, 'readwrite');
      for (const s of STORES) tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/** В памяти — для тестов. failNext имитирует сбой записи (транзакция не применяется). */
export class MemoryBackend {
  constructor() {
    this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
    this.failNext = false;
    this.commits = 0;
  }

  async loadAll() {
    return Object.fromEntries(STORES.map((s) => [s, [...this.data[s].values()].map((v) => structuredClone(v))]));
  }

  async commit(writes) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('disk full');
    }
    this.commits += 1;
    for (const w of writes) {
      const key = w.delete ? w.key : (w.store === 'meta' ? w.value.key : w.value.id);
      if (w.delete) this.data[w.store].delete(key);
      else this.data[w.store].set(key, structuredClone(w.value));
    }
  }

  async clear() {
    for (const s of STORES) this.data[s].clear();
  }
}
