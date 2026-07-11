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
export class Sim implements IWorld {
  readonly seed: string;
  readonly rng: Rng;
  tick = 0;

  private nextEntity: EntityId = 1;
  private readonly components = new Map<string, Map<EntityId, unknown>>();
  private readonly systems: System[] = [];
  private readonly pendingCommands: Command[] = [];
  private readonly eventLog: GameEvent[] = [];
  private readonly forks = new Map<string, Rng>();
  private stepped = false;

  constructor(seed: string) {
    this.seed = seed;
    this.rng = new Rng(seed);
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
  }

  getComponent<T>(entity: EntityId, component: string): T | undefined {
    return this.components.get(component)?.get(entity) as T | undefined;
  }

  removeComponent(entity: EntityId, component: string): void {
    this.components.get(component)?.delete(entity);
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

  eventsSince(tick: number): readonly GameEvent[] {
    return this.eventLog.filter((e) => e.tick >= tick);
  }

  // --- the loop --------------------------------------------------------------

  /** Advance exactly one tick. Hosts own timing; the sim owns logic. */
  step(): void {
    this.stepped = true;
    this.tick++;
    for (const system of this.systems) system(this);
    this.pendingCommands.length = 0;
  }

  /** Deterministic state hash — the replay-divergence detector. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      h ^= n >>> 0;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.tick);
    mix(this.nextEntity);
    for (const [name, store] of this.components) {
      for (let i = 0; i < name.length; i++) mix(name.charCodeAt(i));
      for (const [id, value] of store) {
        mix(id);
        const json = JSON.stringify(value) ?? "";
        for (let i = 0; i < json.length; i++) mix(json.charCodeAt(i));
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
   * referenced live. Game code in this repo mutates component objects in
   * place (`pos.x += dx`); without cloning, every captured checkpoint would
   * alias the same live object and silently show whatever it mutates to by
   * the time anything reads the snapshot back — invisible in Phase 1/2
   * (only stateHash(), computed immediately, was ever relied on) but wrong
   * once restore() makes snapshot.components load-bearing.
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
