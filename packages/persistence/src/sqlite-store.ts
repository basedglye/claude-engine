import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Command, SimSnapshot } from "@claude-engine/core";
import type { GameRecord, GameStore } from "./store.js";

interface GameRow {
  id: string;
  name: string;
  seed: string;
  proto_version: number;
  created_at: string;
}
interface CommandRow {
  tick: number;
  actor: string;
  type: string;
  payload: string | null;
}
interface SnapshotRow {
  snapshot: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed TEXT NOT NULL,
    proto_version INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS commands (
    game_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    actor TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    PRIMARY KEY (game_id, tick, idx)
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    game_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    state_hash INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    PRIMARY KEY (game_id, tick)
  );
`;

/** better-sqlite3 (dev driver): synchronous under the hood, no experimental
 *  Node flags required (unlike node:sqlite). Wrapped in Promises to conform
 *  to the async GameStore interface shared with postgresStore. */
export function sqliteStore(path: string): GameStore {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const insertGame = db.prepare(
    "INSERT INTO games (id, name, seed, proto_version, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const getGameStmt = db.prepare("SELECT * FROM games WHERE id = ?");
  const maxIdxStmt = db.prepare(
    "SELECT COALESCE(MAX(idx), -1) AS maxIdx FROM commands WHERE game_id = ? AND tick = ?"
  );
  const insertCommand = db.prepare(
    "INSERT INTO commands (game_id, tick, idx, actor, type, payload) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const commandsSinceStmt = db.prepare(
    "SELECT tick, actor, type, payload FROM commands WHERE game_id = ? AND tick > ? ORDER BY tick ASC, idx ASC"
  );
  const upsertSnapshot = db.prepare(
    "INSERT OR REPLACE INTO snapshots (game_id, tick, state_hash, snapshot) VALUES (?, ?, ?, ?)"
  );
  const latestSnapshotStmt = db.prepare(
    "SELECT snapshot FROM snapshots WHERE game_id = ? ORDER BY tick DESC LIMIT 1"
  );

  const appendTxn = db.transaction((gameId: string, commands: readonly Command[]) => {
    const tickCounters = new Map<number, number>();
    for (const c of commands) {
      let idx = tickCounters.get(c.tick);
      if (idx === undefined) {
        idx = (maxIdxStmt.get(gameId, c.tick) as { maxIdx: number }).maxIdx + 1;
      }
      insertCommand.run(gameId, c.tick, idx, c.actor, c.type, JSON.stringify(c.payload ?? null));
      tickCounters.set(c.tick, idx + 1);
    }
  });

  return {
    async createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord> {
      const id = opts.id ?? randomUUID();
      const createdAt = new Date().toISOString();
      insertGame.run(id, opts.name, opts.seed, 1, createdAt);
      return { id, name: opts.name, seed: opts.seed, protoVersion: 1, createdAt };
    },
    async getGame(id: string): Promise<GameRecord | null> {
      const row = getGameStmt.get(id) as GameRow | undefined;
      if (!row) return null;
      return { id: row.id, name: row.name, seed: row.seed, protoVersion: row.proto_version, createdAt: row.created_at };
    },
    async appendCommands(gameId: string, commands: readonly Command[]): Promise<void> {
      if (commands.length === 0) return;
      appendTxn(gameId, commands);
    },
    async commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]> {
      const rows = commandsSinceStmt.all(gameId, afterTick) as CommandRow[];
      return rows.map((r) => ({
        tick: r.tick,
        actor: r.actor,
        type: r.type,
        payload: r.payload !== null ? JSON.parse(r.payload) : undefined,
      }));
    },
    async saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void> {
      upsertSnapshot.run(gameId, snapshot.tick, snapshot.stateHash, JSON.stringify(snapshot));
    },
    async latestSnapshot(gameId: string): Promise<SimSnapshot | null> {
      const row = latestSnapshotStmt.get(gameId) as SnapshotRow | undefined;
      if (!row) return null;
      return JSON.parse(row.snapshot) as SimSnapshot;
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}
