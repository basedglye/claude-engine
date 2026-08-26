import { Rng, type RngState } from "./rng.js";
import type { SimSnapshot, SimSnapshotV1 } from "./snapshot.js";
import type { Command, EntityId, GameEvent, IWorld } from "./types.js";

export type System = (world: Sim) => void;

/** Thrown by Sim.restore() on a fork-label mismatch or an unrestorable
 *  (v: 1) snapshot. */
export class RestoreError extends Error {}

/**
 * ECS-lite deterministic simulation.
 *
 * - Fixed-tick: hosts call step() exactly once per sim tick.
 * - Systems run in registration order, always.
 * - All randomness must come from `this.rng` (or forks created at init).
 * - Component stores are Maps keyed by numeric EntityId; iteration order is
 *   insertion order, which is deterministic given deterministic logic.
 */
export interface SimOptions {
  /** Retain events for at most this many most-recent ticks (default:
   *  unbounded, preserving current behaviour for all existing callers).
   *  Trimming happens at the start of step(). eventsSince(t) for a t older
   *  than the retained window returns only retained events. */
  eventRetentionTicks?: number;
}

export class Sim implements IWorld {
  readonly seed: string;
  readonly rng: Rng;
  tick = 0;

  private nextEntity: EntityId = 1;
  private readonly components = new Map<string, Map<EntityId, unknown>>();
  /**
   * Per-(component, entity) cached FNV entry hash — the incremental
   * stateHash()'s only state. Mirrors `components` key-for-key AND in the
   * same insertion order — every write path (setComponent, removeComponent,
   * despawn) touches both maps together — so the hash walk iterates the
   * cache directly instead of paying a Map lookup per entry. `undefined`
   * means "dirty, recompute"; an absent cache Map for a component means
   * "not built yet" (a brand-new store, or post-restore, which clears the
   * cache wholesale) and is rebuilt from the store on the next hash. The
   * cache can never be stale-wrong on its own: it goes wrong only if sim
   * code mutates a component object in place without a setComponent()
   * call, which is exactly what stateHashSlow() exists to catch.
   */
  private readonly entryHashes = new Map<string, Map<EntityId, number | undefined>>();
  private readonly systems: System[] = [];
  private readonly pendingCommands: Command[] = [];
  private readonly eventLog: GameEvent[] = [];
  private readonly forks = new Map<string, Rng>();
  private stepped = false;
  private readonly eventRetentionTicks: number | undefined;

  constructor(seed: string, opts?: SimOptions) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.eventRetentionTicks = opts?.eventRetentionTicks;
  }

  // --- setup ---------------------------------------------------------------

  addSystem(system: System): void {
    this.systems.push(system);
  }

  /**
   * Fork + register a sim-held Rng stream so a snapshot can capture and
   * restore it faithfully. Draw-sequence-identical to `this.rng.fork(label)`
   * — migrating a call site 1:1 changes no hashes. Setup-time only: throws
   * once step() has run (long-lived streams must be declared up front so a
   * snapshot can capture them all), and throws on a duplicate label.
   */
  forkRng(label: string): Rng {
    if (this.stepped) {
      throw new Error(
        `Sim.forkRng("${label}"): forks must be registered during setup, before the first step()`
      );
    }
    if (this.forks.has(label)) {
      throw new Error(`Sim.forkRng("${label}"): duplicate fork label`);
    }
    const forked = this.rng.fork(label);
    this.forks.set(label, forked);
    return forked;
  }

  // --- entities & components ----------------------------------------------

  spawn(): EntityId {
    return this.nextEntity++;
  }

  setComponent<T>(entity: EntityId, component: string, value: T): void {
    let store = this.components.get(component);
    if (!store) {
      store = new Map();
      this.components.set(component, store);
    }
    store.set(entity, value);
    // Mark dirty, never delete: a delete would move the key to the END of
    // the cache's insertion order when it is written again, desyncing it
    // from the store order the hash folds in.
    this.entryHashes.get(component)?.set(entity, undefined);
  }

  getComponent<T>(entity: EntityId, component: string): T | undefined {
    return this.components.get(component)?.get(entity) as T | undefined;
  }

  removeComponent(entity: EntityId, component: string): void {
    this.components.get(component)?.delete(entity);
    this.entryHashes.get(component)?.delete(entity);
  }

  *withComponent<T>(component: string): Iterable<[EntityId, T]> {
    const store = this.components.get(component);
    if (store) yield* store.entries() as Iterable<[EntityId, T]>;
  }

  *entities(): Iterable<EntityId> {
    const seen = new Set<EntityId>();
    for (const store of this.components.values())
      for (const id of store.keys())
        if (!seen.has(id)) {
          seen.add(id);
          yield id;
        }
  }

  /**
   * Remove an entity: deletes it from every component store. Emits nothing —
   * callers emit their own events. Entity ids are never reused (nextEntity
   * is monotonic), so a despawned id appearing in an older event stays
   * unambiguous.
   */
  despawn(entity: EntityId): void {
    for (const store of this.components.values()) store.delete(entity);
    for (const cache of this.entryHashes.values()) cache.delete(entity);
  }

  /**
   * All components currently attached to an entity, as [name, value] pairs,
   * in component-store registration order (the same order `stateHash()` and
   * `snapshot()` iterate `this.components` in) so iteration is deterministic.
   * Read-only view; O(#component types).
   */
  *componentsOf(entity: EntityId): Iterable<[string, unknown]> {
    for (const [name, store] of this.components) {
      if (store.has(entity)) yield [name, store.get(entity)];
    }
  }

  // --- commands & events ---------------------------------------------------

  submit(command: Command): void {
    this.pendingCommands.push(command);
  }

  /** Commands queued for the current tick; systems consume these. */
  commands(): readonly Command[] {
    return this.pendingCommands;
  }

  emit(type: string, payload?: unknown): void {
    this.eventLog.push({ tick: this.tick, type, payload });
  }

  /**
   * Events with tick >= the given tick. The event log is append-only with
   * monotonically non-decreasing `tick`, so this binary-searches for the
   * first qualifying index rather than filtering the whole log (O(log n)
   * vs. O(total events), forever). If `eventRetentionTicks` is set, older
   * events have already been trimmed at the start of step() — a `tick`
   * older than the retained window returns only what survived trimming.
   */
  eventsSince(tick: number): readonly GameEvent[] {
    let lo = 0;
    let hi = this.eventLog.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const e = this.eventLog[mid];
      if (e !== undefined && e.tick >= tick) hi = mid;
      else lo = mid + 1;
    }
    return this.eventLog.slice(lo);
  }

  // --- the loop --------------------------------------------------------------

  /** Advance exactly one tick. Hosts own timing; the sim owns logic. */
  step(): void {
    this.stepped = true;
    this.tick++;
    if (this.eventRetentionTicks !== undefined) {
      const minTick = this.tick - this.eventRetentionTicks + 1;
      let lo = 0;
      let hi = this.eventLog.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const e = this.eventLog[mid];
        if (e !== undefined && e.tick >= minTick) hi = mid;
        else lo = mid + 1;
      }
      if (lo > 0) this.eventLog.splice(0, lo);
    }
    for (const system of this.systems) system(this);
    this.pendingCommands.length = 0;
  }

  /**
   * Deterministic state hash — the replay-divergence detector.
   *
   * INCREMENTAL as of Phase H2 (docs/PHASE-H2.md contract A): every write
   * path invalidates a per-(component, entity) cached entry hash;
   * stateHash() recomputes only invalidated entries (FNV-1a over
   * name + id + JSON — exactly one JSON.stringify per WRITE, not per call)
   * and folds the cached entry hashes in component-store insertion order.
   * Same order as the pre-H2 byte-stream hash, so iteration-order
   * divergence stays detectable; the numeric VALUES differ from pre-H2 (a
   * one-time, repo-wide golden re-pin — a sequential stream hash cannot be
   * reproduced by folding per-entry digests). Cost: O(entities) small mixes
   * plus O(dirty bytes) instead of O(total state bytes) per call.
   *
   * CONTRACT — the write-through rule, now load-bearing: sim code MUST
   * mutate components via setComponent(). Mutating a fetched component
   * object in place without a setComponent() call was always against house
   * style and is now a hash-corrupting bug. stateHashSlow() exists so the
   * harness can catch exactly that (see verifyStateHashConsistency in
   * @claude-engine/harness, asserted on every --verify-replay).
   */
  stateHash(): number {
    return this.combineStateHash(true);
  }

  /**
   * The pre-H2 full-walk hash, in the SAME combination scheme as the
   * incremental path — the two MUST always agree. A divergence means some
   * component object was mutated in place without a setComponent() call
   * (see stateHash()'s contract note), which is a P0 determinism bug, not a
   * hashing detail. Kept as the --verify slow path per ARCHITECTURE B8's
   * fix-order item 2.
   */
  stateHashSlow(): number {
    return this.combineStateHash(false);
  }

  /** FNV-1a over `name`, `id`, and `JSON.stringify(value)` — one component
   *  entry's digest, the unit both hash paths fold. */
  private static entryHash(name: string, id: EntityId, value: unknown): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= id >>> 0;
    h = Math.imul(h, 0x01000193);
    const json = JSON.stringify(value) ?? "";
    for (let i = 0; i < json.length; i++) {
      h ^= json.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** One combination scheme, two entry-hash sources. Component NAMES are
   *  still folded per store even when the store is empty, so a
   *  created-then-emptied store stays distinguishable from one that never
   *  existed — the pre-H2 hash made that distinction and dropping it would
   *  quietly weaken the detector. */
  private combineStateHash(useCache: boolean): number {
    // The mixing step is written out inline rather than through a `mix()`
    // closure: this is the hot loop of the whole determinism check, and a
    // closure over a mutable `h` costs more than the mix itself.
    const PRIME = 0x01000193;
    let h = 0x811c9dc5;
    h ^= this.tick >>> 0;
    h = Math.imul(h, PRIME);
    h ^= this.nextEntity >>> 0;
    h = Math.imul(h, PRIME);
    for (const [name, store] of this.components) {
      for (let i = 0; i < name.length; i++) {
        h ^= name.charCodeAt(i);
        h = Math.imul(h, PRIME);
      }
      if (!useCache) {
        for (const [id, value] of store) {
          h ^= Sim.entryHash(name, id, value);
          h = Math.imul(h, PRIME);
        }
        continue;
      }
      let cache = this.entryHashes.get(name);
      if (cache === undefined || cache.size !== store.size) {
        // Not built yet: a brand-new store, or post-restore. Rebuild the
        // key set in store order, all dirty. Sizes are the only way the two
        // maps can ever differ — content and order cannot diverge, because
        // every write path writes to both.
        cache = new Map();
        for (const id of store.keys()) cache.set(id, undefined);
        this.entryHashes.set(name, cache);
      }
      for (const [id, cached] of cache) {
        let entry = cached;
        if (entry === undefined) {
          entry = Sim.entryHash(name, id, store.get(id));
          cache.set(id, entry);
        }
        h ^= entry;
        h = Math.imul(h, PRIME);
      }
    }
    return h >>> 0;
  }

  /**
   * Plain-JSON dump of current state — evidence for verdicts, and (v2) a
   * faithful restore point: captures the root Rng stream plus every
   * forkRng()-registered stream, in registration order.
   *
   * Component values are deep-cloned (JSON round-trip — they are already
   * required to be JSON-serializable, per stateHash()) rather than
   * referenced live. Sim code is required to write through setComponent()
   * (stateHash()'s Phase-H2 contract), but a caller outside the sim can
   * still hold a reference to a component object; without cloning, every
   * captured checkpoint would alias the live object and silently show
   * whatever it mutates to by the time anything reads the snapshot back —
   * wrong once restore() makes snapshot.components load-bearing.
   */
  snapshot(): SimSnapshot {
    const components: Record<string, [EntityId, unknown][]> = {};
    for (const [name, store] of this.components) {
      components[name] = [...store.entries()].map(
        ([id, value]) => [id, JSON.parse(JSON.stringify(value) ?? "null")] as [EntityId, unknown]
      );
    }
    return {
      v: 2,
      tick: this.tick,
      nextEntity: this.nextEntity,
      stateHash: this.stateHash(),
      components,
      rng: {
        root: this.rng.getState(),
        forks: [...this.forks.entries()].map(
          ([label, rng]) => [label, rng.getState()] as [string, RngState]
        ),
      },
    };
  }

  /**
   * Restore this sim's component stores, tick/entity counters, and Rng
   * state (root + every registered forkRng() stream) from a v2 snapshot.
   * Requires setup() to have already run on this sim — systems are code
   * and are never serialized, so restore replaces *data*, not logic. Clears
   * pending commands and the event log: events are derivable outputs (the
   * persisted source of truth is the command log), so eventsSince() after a
   * restore covers post-restore ticks only. Throws RestoreError on a v:1
   * snapshot or a fork-label mismatch between this sim's setup and the
   * snapshot.
   */
  restore(snapshot: SimSnapshot | SimSnapshotV1): void {
    if (snapshot.v !== 2) {
      throw new RestoreError(
        `Sim.restore: requires a v:2 snapshot (Sim.forkRng + snapshot()), got v:${(snapshot as { v: number }).v}`
      );
    }

    const snapshotLabels = snapshot.rng.forks.map(([label]) => label);
    const snapshotLabelSet = new Set(snapshotLabels);
    const registeredLabelSet = new Set(this.forks.keys());
    const missingInSnapshot = [...registeredLabelSet].filter((l) => !snapshotLabelSet.has(l));
    const missingInSim = [...snapshotLabelSet].filter((l) => !registeredLabelSet.has(l));
    if (missingInSnapshot.length > 0 || missingInSim.length > 0) {
      throw new RestoreError(
        `Sim.restore: forkRng label mismatch — this sim's setup registered [${[...registeredLabelSet].join(", ")}], snapshot has [${snapshotLabels.join(", ")}]`
      );
    }

    this.components.clear();
    this.entryHashes.clear();
    for (const [name, entries] of Object.entries(snapshot.components)) {
      // Deep-clone (not just re-Map the same value refs): the snapshot
      // object may be restored more than once (e.g. persistence recovery
      // re-reading the same latestSnapshot()), and must never end up
      // aliased with live, in-place-mutated component objects afterward.
      this.components.set(
        name,
        new Map(
          entries.map(([id, value]) => [id, JSON.parse(JSON.stringify(value) ?? "null")] as [EntityId, unknown])
        )
      );
    }
    this.tick = snapshot.tick;
    this.nextEntity = snapshot.nextEntity;
    this.rng.restoreState(snapshot.rng.root);
    for (const [label, state] of snapshot.rng.forks) {
      this.forks.get(label)!.restoreState(state);
    }
    this.pendingCommands.length = 0;
    this.eventLog.length = 0;
    this.stepped = true;
  }
}

/** Replay a command log against a fresh sim and return per-tick hashes. */
export function replay(
  seed: string,
  setup: (sim: Sim) => void,
  commandLog: readonly Command[],
  ticks: number
): number[] {
  const sim = new Sim(seed);
  setup(sim);
  const byTick = new Map<number, Command[]>();
  for (const c of commandLog) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const hashes: number[] = [];
  for (let t = 1; t <= ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
    hashes.push(sim.stateHash());
  }
  return hashes;
}
