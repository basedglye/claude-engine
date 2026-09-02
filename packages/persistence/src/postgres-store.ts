import pg from "pg";
import { randomUUID } from "node:crypto";
import type { Command, SimSnapshot } from "@claude-engine/core";
import type { GameRecord, GameStore } from "./store.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    seed TEXT NOT NULL,
    proto_version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
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
    state_hash BIGINT NOT NULL,
    snapshot TEXT NOT NULL,
    PRIMARY KEY (game_id, tick)
  );
`;

/** Postgres (prod driver): identical logical schema to sqliteStore, driver-
 *  specific DDL only. state_hash is write-only here (an indexable mirror for
 *  ops queries) — every value returned to callers is re-parsed from the
 *  `snapshot` JSON blob, so BIGINT/string round-tripping never touches
 *  application logic. */
export function postgresStore(url: string): GameStore {
  const pool = new pg.Pool({ connectionString: url });
  const ready = pool.query(SCHEMA);

  return {
    async createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord> {
      await ready;
      const id = opts.id ?? randomUUID();
      const createdAt = new Date().toISOString();
      await pool.query(
        "INSERT INTO games (id, name, seed, proto_version, created_at) VALUES ($1,$2,$3,$4,$5)",
        [id, opts.name, opts.seed, 1, createdAt]
      );
      return { id, name: opts.name, seed: opts.seed, protoVersion: 1, createdAt };
    },
    async getGame(id: string): Promise<GameRecord | null> {
      await ready;
      const res = await pool.query("SELECT * FROM games WHERE id = $1", [id]);
      const row = res.rows[0] as
        | { id: string; name: string; seed: string; proto_version: number; created_at: Date | string }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        seed: row.seed,
        protoVersion: row.proto_version,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      };
    },
    async appendCommands(gameId: string, commands: readonly Command[]): Promise<void> {
      await ready;
      if (commands.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tickCounters = new Map<number, number>();
        for (const c of commands) {
          let idx = tickCounters.get(c.tick);
          if (idx === undefined) {
            const res = await client.query(
              "SELECT COALESCE(MAX(idx), -1) AS max_idx FROM commands WHERE game_id = $1 AND tick = $2",
              [gameId, c.tick]
            );
            idx = Number((res.rows[0] as { max_idx: number | string }).max_idx) + 1;
          }
          await client.query(
            "INSERT INTO commands (game_id, tick, idx, actor, type, payload) VALUES ($1,$2,$3,$4,$5,$6)",
            [gameId, c.tick, idx, c.actor, c.type, JSON.stringify(c.payload ?? null)]
          );
          tickCounters.set(c.tick, idx + 1);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]> {
      await ready;
      const res = await pool.query(
        "SELECT tick, actor, type, payload FROM commands WHERE game_id = $1 AND tick > $2 ORDER BY tick ASC, idx ASC",
        [gameId, afterTick]
      );
      return (res.rows as { tick: number; actor: string; type: string; payload: string | null }[]).map((r) => ({
        tick: r.tick,
        actor: r.actor,
        type: r.type,
        payload: r.payload !== null ? JSON.parse(r.payload) : undefined,
      }));
    },
    async saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void> {
      await ready;
      await pool.query(
        `INSERT INTO snapshots (game_id, tick, state_hash, snapshot) VALUES ($1,$2,$3,$4)
         ON CONFLICT (game_id, tick) DO UPDATE SET state_hash = EXCLUDED.state_hash, snapshot = EXCLUDED.snapshot`,
        [gameId, snapshot.tick, snapshot.stateHash, JSON.stringify(snapshot)]
      );
    },
    async latestSnapshot(gameId: string): Promise<SimSnapshot | null> {
      await ready;
      const res = await pool.query(
        "SELECT snapshot FROM snapshots WHERE game_id = $1 ORDER BY tick DESC LIMIT 1",
        [gameId]
      );
      const row = res.rows[0] as { snapshot: string } | undefined;
      if (!row) return null;
      return JSON.parse(row.snapshot) as SimSnapshot;
    },
    async listGames(): Promise<{ id: string; name: string; seed: string; latestSnapshotTick?: number }[]> {
      await ready;
      // Same shape as sqliteStore's: LEFT JOIN a per-game MAX(tick)
      // subquery so games without a snapshot still get one row, ordered by
      // the store-wide contract (store.ts) — newest created_at first, ties
      // broken by id ascending.
      const res = await pool.query(
        `SELECT g.id, g.name, g.seed, s.max_tick
           FROM games g
           LEFT JOIN (SELECT game_id, MAX(tick) AS max_tick FROM snapshots GROUP BY game_id) s
             ON s.game_id = g.id
           ORDER BY g.created_at DESC, g.id ASC`
      );
      return (res.rows as { id: string; name: string; seed: string; max_tick: number | string | null }[]).map((r) =>
        r.max_tick === null || r.max_tick === undefined
          ? { id: r.id, name: r.name, seed: r.seed }
          : { id: r.id, name: r.name, seed: r.seed, latestSnapshotTick: Number(r.max_tick) }
      );
    },
    async deleteGame(id: string): Promise<void> {
      await ready;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM commands WHERE game_id = $1", [id]);
        await client.query("DELETE FROM snapshots WHERE game_id = $1", [id]);
        await client.query("DELETE FROM games WHERE id = $1", [id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
