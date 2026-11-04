// Бэкенды хранения. Store держит все записи в памяти, а изменения пишет пачкой
// в одной транзакции: запись + операция очереди фиксируются вместе или не фиксируются вовсе.

export const STORES = ['locations', 'routes', 'trips', 'trip_segments', 'inspections', 'track_points', 'sync_queue', 'meta'];

/**
 * @typedef {{store: string, value?: object, key?: string, delete?: boolean}} Write
 * @typedef {{loadAll(): Promise<Record<string, object[]>>, commit(writes: Write[]): Promise<void>, clear(): Promise<void>}} Backend
 */

/**
 * Версии схемы IndexedDB. Каждая миграция переводит базу с версии i на i + 1 и выполняется
 * в транзакции обновления: если она упадёт, браузер откатит всё и оставит старую версию.
 * Новые изменения формата — только новой миграцией в конце списка; старые не меняются.
 */
export const MIGRATIONS = [
  // 0 → 1: хранилища записей
  (db) => {
    for (const s of STORES) {
      if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
    }
  },
  // 1 → 2: индексы по поездке — для выборки этапов, наблюдений и трека без полного чтения
  (db, tx) => {
    for (const s of ['trip_segments', 'inspections', 'track_points']) {
      const os = tx.objectStore(s);
      if (!os.indexNames.contains('trip_id')) os.createIndex('trip_id', 'trip_id');
    }
  },
];
export const DB_VERSION = MIGRATIONS.length;

/** Применить миграции с oldVersion до текущей. */
export function upgrade(db, tx, oldVersion) {
  for (let v = oldVersion; v < MIGRATIONS.length; v++) MIGRATIONS[v](db, tx);
}

/** IndexedDB (браузер). */
export class IdbBackend {
  constructor(name = 'road-tracker', { onVersionChange = null } = {}) {
    this.name = name;
    this.dbPromise = null;
    this.onVersionChange = onVersionChange;
  }

  open() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.name, DB_VERSION);
        req.onupgradeneeded = (ev) => upgrade(req.result, req.transaction, ev.oldVersion);
        req.onsuccess = () => {
          const db = req.result;
          // Другая вкладка открыла новую версию сайта: закрываем соединение, чтобы не мешать её обновлению.
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
            this.onVersionChange?.();
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('Сайт открыт в другой вкладке со старой версией. Закройте её и обновите страницу.'));
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
