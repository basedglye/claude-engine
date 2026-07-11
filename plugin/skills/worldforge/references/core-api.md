# `@claude-engine/core` API reference

The sim kernel. Zero DOM/Three.js/Node imports anywhere in this package —
enforced by ESLint (`no-restricted-imports`/`globals`/`properties`) and
`scripts/check-purity.mjs`, both independently, plus a DOM-free tsconfig.

## `Rng` (`rng.ts`)

Deterministic, forkable random number generator (sfc32). The **only**
sanctioned randomness source anywhere in sim code.

```ts
class Rng {
  constructor(seed: number | string);
  nextUint32(): number;
  next(): number;                          // float in [0, 1)
  int(min: number, max: number): number;   // inclusive
  pick<T>(items: readonly T[]): T;
  fork(label: string): Rng;                // independent, reproducible stream
  getState(): RngState;                    // capture exact draw position
  static fromState(state: RngState): Rng;  // resume from a captured state
}
type RngState = readonly [number, number, number, number];
```

`fork(label)` derives an independent stream so adding draws in one subsystem
never perturbs another. Each `fork()` call consumes one word from the
*parent* stream — calling it from anywhere other than deterministic sim
code (e.g. from renderer code against the live `sim.rng`) would perturb
future sim draws and break determinism. If a renderer needs the same
procedural data a sim generator produced, reconstruct it from a **fresh**
`new Rng(seed).fork(label)` using the world's `seed` string, never by
forking the live `sim.rng` — see `assets-api.md` and `templates.md` for the
pattern both starter templates use.

## `Sim` (`sim.ts`)

ECS-lite deterministic simulation. Implements `IWorld`.

```ts
class Sim implements IWorld {
  readonly seed: string;
  readonly rng: Rng;
  tick: number;

  addSystem(system: (world: Sim) => void): void;
  spawn(): EntityId;
  setComponent<T>(entity: EntityId, component: string, value: T): void;
  getComponent<T>(entity: EntityId, component: string): T | undefined;
  removeComponent(entity: EntityId, component: string): void;
  withComponent<T>(component: string): Iterable<[EntityId, T]>;
  entities(): Iterable<EntityId>;

  submit(command: Command): void;          // queues for the current tick
  commands(): readonly Command[];          // what systems consume
  emit(type: string, payload?: unknown): void;
  eventsSince(tick: number): readonly GameEvent[];

  step(): void;                            // advance exactly one tick
  stateHash(): number;                     // deterministic, replay-divergence detector
  forkRng(label: string): Rng;             // tracked fork — capturable/restorable (see below)
  snapshot(): SimSnapshot;                 // v2: a faithful restore point
  restore(snapshot: SimSnapshot): void;    // requires setup() already run on this sim
}

function replay(seed: string, setup: (sim: Sim) => void, commandLog: readonly Command[], ticks: number): number[];

class RestoreError extends Error {}       // thrown by restore() on a v:1 snapshot or fork-label mismatch
```

Component values must be JSON-serializable — `stateHash()` and `snapshot()`
both depend on this. Systems run in registration order, every tick, forever
(no removal). Iteration order over collections is deterministic (insertion
order for `Map`-backed component stores).

### Snapshots and `Sim.restore()`

`snapshot()` (`snapshot.ts`) returns:

```ts
interface SimSnapshot {
  v: 2;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  components: Record<string, [EntityId, unknown][]>;  // insertion order, deep-cloned
  rng: { root: RngState; forks: [string, RngState][] };
}
```

**Use `sim.forkRng(label)` instead of `sim.rng.fork(label)` for any stream a
system holds across ticks.** `forkRng` delegates to exactly `this.rng.fork
(label)` (identical draw sequence — migrating a call site 1:1 changes no
hashes) but also *registers* the returned stream so `snapshot()`/`restore()`
can capture and faithfully resume it. It's setup-time only: it throws once
`step()` has run, and throws on a duplicate label. `sim.rng.fork(...)` called
directly (untracked) remains correct for transient, setup-local derivation
whose output lands in a component (e.g. terrain seeds — see "Procedural
assets" below), and for host/asset code, which isn't sim state — just don't
hold an untracked fork across ticks, or a restore can't reproduce it.

`restore(snapshot)` requires `setup()` to have already run on the target
`Sim` (systems are code and are never serialized — restore replaces *data*,
not logic): it replaces component stores, `tick`/`nextEntity`, and Rng state
(root + every `forkRng`-registered stream, matched by label), then clears
pending commands and the event log (events are derivable outputs; the
persisted source of truth is the command log — see `net-api.md`'s
persistence section). Throws `RestoreError` if the snapshot is `v: 1`
(pre-Phase-3 evidence, not restorable) or if the target sim's `forkRng`
registrations don't match the snapshot's.

Harness checkpoints support resuming from a snapshot instead of replaying
from tick 1: `npm run harness --silent -- --replay <verdict.json>
--from-checkpoint <tick>` (see `harness-api.md`).

**All cross-tick sim state must live in components, never in a setup
closure.** A `Map` (or any variable) that a system populates from commands
over time — e.g. an actor→entity lookup built up as players join — is
exactly the kind of state `restore()` cannot rebuild: `setup()` runs fresh
before `restore()` replaces component data, so a closure-cached index starts
empty and never learns what the snapshot already contains. Every actor who
joined before the last snapshot would then have a real entity in the
restored components but no map entry, silently dropping every replayed
command for them. Setup closures may still capture *setup-spawned* entity
ids (a fixed number known at construction time, like a single-player demo's
one player entity) — that's just a constant, not accumulated state. For
anything commands add over time, derive the lookup from a component instead
(e.g. `withComponent("owner")`, scanning for the value that matches an
actor) so it's automatically correct after any restore. See `net-api.md`'s
multiplayer workflow for the worked pattern.

## `types.ts` — the protocol

```ts
type EntityId = number;

interface Command { tick: number; actor: string; type: string; payload?: unknown; }
interface GameEvent { tick: number; type: string; payload?: unknown; }

interface IWorld {
  readonly tick: number;
  readonly seed: string;
  stateHash(): number;
  entities(): Iterable<EntityId>;
  getComponent<T>(entity: EntityId, component: string): T | undefined;
  eventsSince(tick: number): readonly GameEvent[];
}

interface HostPort {
  submit(command: Command): void;
  onEvents(handler: (events: readonly GameEvent[]) => void): void;
}

const TICK_RATE_HZ = 20;
const TICK_MS = 1000 / TICK_RATE_HZ;
```

Hosts (renderers, servers, the harness) read state only through `IWorld` and
mutate only via `submit(Command)` — this is invariant #4 ("hosts render,
sims decide"), and it's the shape every host in this engine follows,
including the browser-mode test hook (`renderer-api.md`).
