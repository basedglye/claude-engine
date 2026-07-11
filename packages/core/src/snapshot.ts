import type { EntityId } from "./types.js";
import type { RngState } from "./rng.js";

/**
 * A plain-JSON dump of sim state — evidence for verdicts, replay-drift
 * detection, and (v2 onward) a faithful mid-run restore point via
 * Sim.restore(). Versioned so the format can extend compatibly; readers
 * should switch on `v`.
 */
export interface SimSnapshot {
  v: 2;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  /** Component stores as [entity, value] pairs in deterministic (insertion) order. */
  components: Record<string, [EntityId, unknown][]>;
  /** Root Rng stream + every Sim.forkRng-registered stream, in registration
   *  order — what makes restore() faithful for sim-held randomness. */
  rng: { root: RngState; forks: [string, RngState][] };
}

/**
 * The Phase 2 evidence-only shape (no Rng state captured — game code could
 * hold forked Rng streams the Sim didn't track). Kept for reading old
 * evidence; Sim.snapshot() no longer emits it and Sim.restore() rejects it.
 */
export interface SimSnapshotV1 {
  v: 1;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  components: Record<string, [EntityId, unknown][]>;
}
