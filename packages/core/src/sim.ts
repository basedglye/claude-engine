import { Rng } from "./rng.js";
import type { SimSnapshot } from "./snapshot.js";
import type { Command, EntityId, GameEvent, IWorld } from "./types.js";

export type System = (world: Sim) => void;

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

  constructor(seed: string) {
    this.seed = seed;
    this.rng = new Rng(seed);
  }

  // --- setup ---------------------------------------------------------------

  addSystem(system: System): void {
    this.systems.push(system);
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
   * Plain-JSON dump of current state — evidence for verdicts, not a restore
   * point (see SimSnapshot doc comment: no Rng state is captured).
   */
  snapshot(): SimSnapshot {
    const components: Record<string, [EntityId, unknown][]> = {};
    for (const [name, store] of this.components) {
      components[name] = [...store.entries()];
    }
    return {
      v: 1,
      tick: this.tick,
      nextEntity: this.nextEntity,
      stateHash: this.stateHash(),
      components,
    };
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
