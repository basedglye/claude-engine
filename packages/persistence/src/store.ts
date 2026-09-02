import type { Command, SimSnapshot } from "@claude-engine/core";

export interface GameRecord {
  id: string;
  name: string;
  seed: string;
  protoVersion: number;
  createdAt: string;
}

/**
 * Event-sourced saves: the command log is the source of truth (invariant
 * #3 — (seed, command log) -> identical state); snapshots are an
 * accelerator for recovery, not a replacement for the log. All SQL for both
 * drivers lives behind this interface — "no hand-rolled SQL in game code"
 * (docs/DESIGN.md).
 */
export interface GameStore {
  createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord>;
  getGame(id: string): Promise<GameRecord | null>;
  /** Atomic append; called write-ahead (before the consuming tick steps). */
  appendCommands(gameId: string, commands: readonly Command[]): Promise<void>;
  commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]>;
  saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void>;
  latestSnapshot(gameId: string): Promise<SimSnapshot | null>;
  /**
   * All stored games (id, name, seed, latest snapshot tick if any).
   * ORDERING CONTRACT (must hold in every implementation — sqliteStore,
   * postgresStore, webStore): newest-first by `createdAt`, ties broken by
   * `id` ascending. This is the order the boot path relies on to pick "the
   * most recent game" (docs/PHASE-H2.md section C) — deterministic even
   * when two games share a millisecond-resolution `createdAt`, which
   * `Date.now()`/`new Date().toISOString()` can produce under fast
   * synchronous game creation (tests do this routinely).
   */
  listGames(): Promise<{ id: string; name: string; seed: string; latestSnapshotTick?: number }[]>;
  /**
   * Remove a game and all its commands/snapshots. Resolves when durable.
   * Atomic per store's capability: one SQL transaction (sqlite/postgres),
   * one IDB readwrite transaction spanning all three object stores
   * (webStore) — a partial delete that leaves orphaned commands/snapshots
   * behind is a silent save-corruption bug, not an acceptable degradation.
   * Deleting a nonexistent id resolves (not an error) — deleteGame is
   * idempotent, matching the "delete is not found-then-delete" convention
   * used elsewhere in this store.
   */
  deleteGame(id: string): Promise<void>;
  close(): Promise<void>;
}
