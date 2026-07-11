import type { EntityId } from "./types.js";

/**
 * A plain-JSON dump of sim state — evidence for verdicts and replay-drift
 * detection, NOT a restore point. No Rng state is captured: game code may
 * hold forked Rng streams the Sim itself does not track, so a faithful
 * mid-run restore needs real design work (Phase 3, alongside persistence).
 * Versioned so a future restore-capable format can extend it compatibly.
 */
export interface SimSnapshot {
  v: 1;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  /** Component stores as [entity, value] pairs in deterministic (insertion) order. */
  components: Record<string, [EntityId, unknown][]>;
}
