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
  close(): Promise<void>;
}
