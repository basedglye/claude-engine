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
}
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
  snapshot(): SimSnapshot;                 // evidence dump — NOT a restore point (no Rng state)
}

function replay(seed: string, setup: (sim: Sim) => void, commandLog: readonly Command[], ticks: number): number[];
```

Component values must be JSON-serializable — `stateHash()` and `snapshot()`
both depend on this. Systems run in registration order, every tick, forever
(no removal). Iteration order over collections is deterministic (insertion
order for `Map`-backed component stores).

`snapshot()` (`snapshot.ts`) returns:

```ts
interface SimSnapshot {
  v: 1;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  components: Record<string, [EntityId, unknown][]>;  // insertion order
}
```

No Rng state is captured. A faithful restore-from-snapshot contract needs
the sim to track forked Rng streams (it doesn't, by design — games hold
their own forks), and is deferred to the Phase 3 persistence work. Treat
`snapshot()` output as evidence for a verdict, never as a save file.

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
