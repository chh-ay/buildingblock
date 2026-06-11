/** Minimal promise wrappers around the IndexedDB saves store. */

const DB_NAME = "buildingblock";
const STORE = "saves";

/** One persisted save slot. */
export interface SaveRecord {
  name: string;
  updatedAt: number;
  data: ArrayBuffer;
}

/** Open (creating on first run) the 'buildingblock' database with its 'saves' store. */
export const openSavesDb = (): Promise<IDBDatabase> => {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore(STORE, { keyPath: "name" });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error("failed to open saves db"));
  return promise;
};

const run = <T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const req = op(db.transaction(STORE, mode).objectStore(STORE));
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error("saves transaction failed"));
  return promise;
};

/** Insert or replace a save record. */
export const idbPut = async (db: IDBDatabase, rec: SaveRecord): Promise<void> => {
  await run(db, "readwrite", (s) => s.put(rec));
};

/** Fetch a save record by name; undefined when absent. */
export const idbGet = (db: IDBDatabase, name: string): Promise<SaveRecord | undefined> =>
  run<SaveRecord | undefined>(db, "readonly", (s) => s.get(name));

/** Delete a save record by name (no-op when absent). */
export const idbDelete = async (db: IDBDatabase, name: string): Promise<void> => {
  await run(db, "readwrite", (s) => s.delete(name));
};

/** Fetch every save record. */
export const idbAll = (db: IDBDatabase): Promise<SaveRecord[]> =>
  run<SaveRecord[]>(db, "readonly", (s) => s.getAll());
