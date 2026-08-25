/** Small promise wrappers around raw IndexedDB. Kept separate from
 *  web-store.ts so the transaction-lifetime discipline (never `await`
 *  anything that isn't itself an IDBRequest tied to the current
 *  transaction — a stray microtask hop lets IDB auto-close the tx) is easy
 *  to audit in one place. */

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export const GAMES_STORE = "games";
export const COMMANDS_STORE = "commands";
export const SNAPSHOTS_STORE = "snapshots";
export const SCHEMA_VERSION = 1;

/** Opens (creating/upgrading as needed) the save-web database. Schema
 *  version 1: `games` (key `id`), `commands` (key `[gameId, tick, idx]`),
 *  `snapshots` (key `[gameId, tick]`) — see packages/save-web/README.md and
 *  docs/PHASE-H1.md section B for the derivation against sqliteStore. */
export function openSaveDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GAMES_STORE)) {
        db.createObjectStore(GAMES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(COMMANDS_STORE)) {
        db.createObjectStore(COMMANDS_STORE, { keyPath: ["gameId", "tick", "idx"] });
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: ["gameId", "tick"] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}
