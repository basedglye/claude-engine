import type { Command, SimSnapshot } from "@claude-engine/core";
import type { GameRecord, GameStore } from "@claude-engine/persistence";
import { COMMANDS_STORE, GAMES_STORE, SNAPSHOTS_STORE, openSaveDb, requestToPromise, txDone } from "./idb.js";

interface CommandRecord {
  gameId: string;
  tick: number;
  idx: number;
  actor: string;
  type: string;
  payload: unknown;
}

interface SnapshotRecord {
  gameId: string;
  tick: number;
  /** Stringified — an exported save file and the stored bytes share one
   *  canonical JSON form (docs/PHASE-H1.md section B). */
  snapshot: string;
}

/** Reads the highest existing `idx` for (gameId, tick) within the given
 *  transaction's `commands` store, or -1 if none exists yet. Must be called
 *  with a request chained synchronously off the transaction — no unrelated
 *  awaits in between, or IDB may auto-close the transaction first. */
function maxIdxForTick(store: IDBObjectStore, gameId: string, tick: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([gameId, tick, -Infinity], [gameId, tick, Infinity]);
    const req = store.openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as CommandRecord).idx : -1);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
  });
}

/**
 * IndexedDB implementation of the existing `GameStore` interface — no
 * interface change (invariant 5: the engine owns persistence). Schema
 * version 1: `games` (key `id`), `commands` (key `[gameId, tick, idx]`),
 * `snapshots` (key `[gameId, tick]`). See packages/save-web/README.md and
 * docs/PHASE-H1.md section B for the derivation against `sqliteStore`.
 */
export function webStore(dbName = "claude-engine-save"): GameStore {
  const dbPromise = openSaveDb(dbName);

  return {
    async createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord> {
      const db = await dbPromise;
      const id = opts.id ?? crypto.randomUUID();
      const record: GameRecord = { id, name: opts.name, seed: opts.seed, protoVersion: 1, createdAt: new Date().toISOString() };
      const tx = db.transaction(GAMES_STORE, "readwrite");
      tx.objectStore(GAMES_STORE).put(record);
      await txDone(tx);
      return record;
    },

    async getGame(id: string): Promise<GameRecord | null> {
      const db = await dbPromise;
      const tx = db.transaction(GAMES_STORE, "readonly");
      const result = await requestToPromise(tx.objectStore(GAMES_STORE).get(id) as IDBRequest<GameRecord | undefined>);
      return result ?? null;
    },

    /** Atomic append: one readwrite transaction over `commands` per call
     *  (the write-ahead contract), maintaining the per-(gameId,tick) `idx`
     *  counter inside this same transaction so intra-tick order is
     *  structural — commandsSince() reads it back via a bound cursor. */
    async appendCommands(gameId: string, commands: readonly Command[]): Promise<void> {
      if (commands.length === 0) return;
      const db = await dbPromise;
      const tx = db.transaction(COMMANDS_STORE, "readwrite");
      const store = tx.objectStore(COMMANDS_STORE);
      const nextIdx = new Map<number, number>();
      for (const c of commands) {
        let idx = nextIdx.get(c.tick);
        if (idx === undefined) {
          idx = (await maxIdxForTick(store, gameId, c.tick)) + 1;
        }
        const record: CommandRecord = { gameId, tick: c.tick, idx, actor: c.actor, type: c.type, payload: c.payload ?? null };
        store.put(record);
        nextIdx.set(c.tick, idx + 1);
      }
      await txDone(tx);
    },

    async commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]> {
      const db = await dbPromise;
      const tx = db.transaction(COMMANDS_STORE, "readonly");
      const store = tx.objectStore(COMMANDS_STORE);
      // A 2-element bound is a strict prefix of any 3-element key with the
      // same (gameId, tick) — IDB array-key comparison treats a shorter
      // array as less than a longer one sharing that prefix — so this range
      // is exactly every [gameId, tick, idx] with tick > afterTick,
      // returned in (tick, idx) ascending order by the cursor's default
      // "next" direction: order is structural, not incidental.
      const range = IDBKeyRange.bound([gameId, afterTick + 1], [gameId, Infinity]);
      const out: Command[] = [];
      await new Promise<void>((resolve, reject) => {
        const req = store.openCursor(range, "next");
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          const r = cursor.value as CommandRecord;
          out.push({ tick: r.tick, actor: r.actor, type: r.type, payload: r.payload ?? undefined });
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
      });
      await txDone(tx);
      return out;
    },

    async saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void> {
      const db = await dbPromise;
      const record: SnapshotRecord = { gameId, tick: snapshot.tick, snapshot: JSON.stringify(snapshot) };
      const tx = db.transaction(SNAPSHOTS_STORE, "readwrite");
      tx.objectStore(SNAPSHOTS_STORE).put(record);
      await txDone(tx);
    },

    async latestSnapshot(gameId: string): Promise<SimSnapshot | null> {
      const db = await dbPromise;
      const tx = db.transaction(SNAPSHOTS_STORE, "readonly");
      const store = tx.objectStore(SNAPSHOTS_STORE);
      const range = IDBKeyRange.bound([gameId, -Infinity], [gameId, Infinity]);
      const result = await new Promise<SnapshotRecord | null>((resolve, reject) => {
        const req = store.openCursor(range, "prev");
        req.onsuccess = () => {
          const cursor = req.result;
          resolve(cursor ? (cursor.value as SnapshotRecord) : null);
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
      });
      await txDone(tx);
      return result ? (JSON.parse(result.snapshot) as SimSnapshot) : null;
    },

    /**
     * All stored games, newest-first by `createdAt` with ties broken by
     * `id` ascending (the store-wide ordering contract, @claude-engine/
     * persistence's store.ts). IDB's default object-store key order is by
     * the keyPath (`id`), NOT insertion or `createdAt` — there is no
     * secondary index on `createdAt` here (one more index is one more
     * upgrade migration for a list that is expected to stay small), so we
     * fetch every game via `getAll()` and sort explicitly rather than
     * trusting cursor order, exactly as the contract requires.
     */
    async listGames(): Promise<{ id: string; name: string; seed: string; latestSnapshotTick?: number }[]> {
      const db = await dbPromise;
      const tx = db.transaction([GAMES_STORE, SNAPSHOTS_STORE], "readonly");
      const games = await requestToPromise(tx.objectStore(GAMES_STORE).getAll() as IDBRequest<GameRecord[]>);
      games.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1; // newest first
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // tie-break ascending
      });
      const snapshotsStore = tx.objectStore(SNAPSHOTS_STORE);
      const out: { id: string; name: string; seed: string; latestSnapshotTick?: number }[] = [];
      for (const g of games) {
        const range = IDBKeyRange.bound([g.id, -Infinity], [g.id, Infinity]);
        const latest = await new Promise<SnapshotRecord | null>((resolve, reject) => {
          const req = snapshotsStore.openCursor(range, "prev");
          req.onsuccess = () => {
            const cursor = req.result;
            resolve(cursor ? (cursor.value as SnapshotRecord) : null);
          };
          req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
        });
        out.push(
          latest === null
            ? { id: g.id, name: g.name, seed: g.seed }
            : { id: g.id, name: g.name, seed: g.seed, latestSnapshotTick: latest.tick }
        );
      }
      await txDone(tx);
      return out;
    },

    /**
     * Removes the game record and all its commands/snapshots in ONE
     * readwrite transaction spanning all three object stores — the IDB
     * equivalent of the SQL stores' single-transaction delete. A delete of
     * a nonexistent id resolves (IDB `delete()` on a missing key is a
     * successful no-op), matching the documented GameStore contract.
     */
    async deleteGame(id: string): Promise<void> {
      const db = await dbPromise;
      const tx = db.transaction([GAMES_STORE, COMMANDS_STORE, SNAPSHOTS_STORE], "readwrite");
      tx.objectStore(GAMES_STORE).delete(id);
      const commandsStore = tx.objectStore(COMMANDS_STORE);
      // 2-element bounds, same convention as commandsSince() above: a
      // shorter array is less than any longer array sharing its prefix, so
      // [id, -Infinity]..[id, Infinity] covers every [id, tick, idx] key.
      const commandsRange = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
      await new Promise<void>((resolve, reject) => {
        const req = commandsStore.openCursor(commandsRange, "next");
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
      });
      const snapshotsStore = tx.objectStore(SNAPSHOTS_STORE);
      const snapshotsRange = IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
      await new Promise<void>((resolve, reject) => {
        const req = snapshotsStore.openCursor(snapshotsRange, "next");
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB cursor failed"));
      });
      await txDone(tx);
    },

    async close(): Promise<void> {
      const db = await dbPromise;
      db.close();
    },
  };
}

/**
 * A GameStore that lives in memory only. For hosts that deny IndexedDB
 * (a sandboxed iframe without allow-same-origin -- the claude.ai artifact
 * viewer, for one): the write-ahead pump, quick-save and quick-load all
 * keep working for the session and are simply forgotten on reload. Same
 * ordering semantics as webStore (commands sorted by tick then insertion).
 */
export function memoryStore(): GameStore {
  const games = new Map<string, GameRecord>();
  const commands = new Map<string, Command[]>();
  const snapshots = new Map<string, SimSnapshot[]>();
  return {
    async createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord> {
      const id = opts.id ?? crypto.randomUUID();
      const record: GameRecord = { id, name: opts.name, seed: opts.seed, protoVersion: 1, createdAt: new Date().toISOString() };
      games.set(id, record);
      if (!commands.has(id)) commands.set(id, []);
      return record;
    },
    async getGame(id: string): Promise<GameRecord | null> {
      return games.get(id) ?? null;
    },
    async appendCommands(gameId: string, cmds: readonly Command[]): Promise<void> {
      const list = commands.get(gameId) ?? [];
      list.push(...cmds);
      commands.set(gameId, list);
    },
    async commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]> {
      return (commands.get(gameId) ?? []).filter((c) => c.tick > afterTick);
    },
    async saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void> {
      const list = snapshots.get(gameId) ?? [];
      list.push(snapshot);
      snapshots.set(gameId, list);
    },
    async latestSnapshot(gameId: string): Promise<SimSnapshot | null> {
      const list = snapshots.get(gameId) ?? [];
      return list.length > 0 ? list[list.length - 1]! : null;
    },
    async listGames(): Promise<{ id: string; name: string; seed: string; latestSnapshotTick?: number }[]> {
      // Same ordering as webStore.listGames: newest createdAt first, id
      // ascending as the tie-break, so boot recovery picks the same game
      // whichever store backs the session.
      const list = [...games.values()].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      return list.map((g) => {
        const snaps = snapshots.get(g.id) ?? [];
        const latest = snaps.length > 0 ? snaps[snaps.length - 1]!.tick : undefined;
        return { id: g.id, name: g.name, seed: g.seed, ...(latest === undefined ? {} : { latestSnapshotTick: latest }) };
      });
    },
    async deleteGame(id: string): Promise<void> {
      games.delete(id);
      commands.delete(id);
      snapshots.delete(id);
    },
    async close(): Promise<void> {
      /* nothing to release */
    },
  };
}

/** True when this document can open IndexedDB at all. A denied context
 *  throws synchronously from `indexedDB.open`, so the probe is cheap. */
export function indexedDbAvailable(): boolean {
  try {
    if (typeof indexedDB === "undefined") return false;
    indexedDB.open("claude-engine-probe");
    return true;
  } catch {
    return false;
  }
}
