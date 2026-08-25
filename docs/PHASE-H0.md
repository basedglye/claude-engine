# Phase H0 spec — "Walk the Lobby" (GRAND FOYER foundation)

Status: **planned** (this document is the step-1 output of the [WORKFLOW.md](WORKFLOW.md) loop; the step-3 review gate verdicts against it, verbatim). Game context: [apps/hotel/docs/DESIGN.md](../apps/hotel/docs/DESIGN.md), [apps/hotel/docs/ARCHITECTURE.md](../apps/hotel/docs/ARCHITECTURE.md), [docs/ROADMAP-HOTEL.md](ROADMAP-HOTEL.md).

This phase changes engine public contracts (`Sim`, `ThreeHostOptions`, `WorldforgeHook`, `BrowserSpec`, harness CLI, `check-purity.mjs`), which is why it gets a full spec and a review gate per WORKFLOW.md's escalation rule.

## Goal

The player can walk around a small procedurally generated hotel ground floor in a browser, in first or third person, with mouse look, colliding with walls, and open a door by looking at it and clicking — and every part of that is verifiable by the headless harness, which today cannot produce mouse input at all.

## Non-goals (aggressive by design — this phase gravitationally pulls toward Phase 1)

- **No guests, no staff, no NPCs, no jobs, no economy, no terminal/OS, no front desk.** One player entity, four empty rooms, doors. That's the game.
- **No textures, no UVs, no PS1 shader, no lighting design.** Vertex colours with the host's default lights. Art direction is a later phase.
- **No multiplayer.** `@claude-engine/net`/`server` are untouched. The interact-revalidation posture is designed *for* multiplayer but not wired to it.
- **No upper floors, stairs, or elevators.** One floor, one grid.
- **No A\* pathfinding execution in the sim.** `space` ships the grid A\* + portal-route *functions* with unit tests (they are cheap to write against the same grid and Phase H1 guests need them on day one), but no H0 system calls them. Stubbing them out entirely was rejected because the one-source-of-truth generator is the hard part and testing routing against it now is nearly free. LOS ships as a single `losClear` grid raycast; room queries ship as `roomAt` only.
- **No physics.** Circle-vs-grid, axis-separated, integer. No capsules, no step-up, no slopes, no jumping, no vertical movement (y is presentation).
- **No pitch in sim state.** Ever, in any phase. Recorded here as a standing decision, not an H0 deferral.
- **No save/load/persistence wiring.** `Sim.restore()` compatibility is a *design constraint* (see Determinism rules) but no `GameStore` is configured.
- **No `screenClick{u,v}` implementation.** The harness accepts the step shape and exits 2 "not implemented in H0" — reserving the name so later phases don't invent a second spelling.

## Scaffold decision

**Scaffold-then-modify.** Run `npm run scaffold --silent -- hotel-tmp --template 3d-world`, then move the generated files into the existing `apps/hotel/` (which already contains `docs/` — `scripts/scaffold.mjs` exits 2 on an existing directory, so scaffolding directly into `apps/hotel` is not possible), rename the package to `@claude-engine/hotel`, and replace `src/game.ts`/`src/main.ts` wholesale.

*Rejected: hand-authoring from scratch.* The template's `tsconfig.game.json` / `build:game` dual-compile arrangement (sim module compiled separately to `dist-game/` so headless scenarios import the *same compiled artifact* the browser bundles) is exactly the pattern H0's two scenarios depend on, and copying it by hand invites drift.

## Scope and dependency order

- **A. `@claude-engine/space`** (incl. `sim-math`) — pure, no deps beyond core. Foundation for everything.
- **B. `packages/core` additions** — independent of A.
- **C. `@claude-engine/interiors`** — depends on A (emits `space` types).
- **D. `packages/renderer-three` additions** — independent of A–C.
- **E. `@claude-engine/player-fps`** — depends on D (and core).
- **F. `apps/hotel`** — depends on A, B, C, E.
- **G. harness additions + purity-check extension** — G's purity work is independent and can land first; the pointer steps depend on E's hook contract.
- **H. Scenarios + CI wiring** — last.

A, B, D, and the purity half of G can proceed in parallel.

## API contracts

Everything below is real exported TypeScript. Items marked **[public-contract change]** touch surfaces the WORKFLOW.md gate audits.

### A. `@claude-engine/space` (new package, pure root — same purity rules as core)

`packages/space/src/sim-math.ts`:

```ts
/** Fixed-point Q16.16 scale: trig results are integers in [-ONE, ONE]. */
export const ONE = 65536;
/** Full circle in millidegrees. All angle args are wrapped mod 360_000. */
export const FULL_TURN_MDEG = 360_000;

/** sin of an angle in millidegrees, as Q16.16 integer. Deterministic across
 *  JS engines: computed by integer linear interpolation over the committed
 *  SIN_LUT table (never Math.sin). */
export function sinMdeg(mdeg: number): number;
export function cosMdeg(mdeg: number): number;

/** Integer atan2 over integer coordinates (e.g. mm deltas), returning
 *  millidegrees in [0, 360_000). Octant reduction + binary search over
 *  SIN_LUT — no floating transcendentals. Accuracy: within 100 mdeg. */
export function atan2Mdeg(y: number, x: number): number;

/** floor(sqrt(n)) for n >= 0, integer Newton iteration. Throws on n < 0. */
export function isqrt(n: number): number;

/** Smallest signed difference a-b in millidegrees, in (-180_000, 180_000]. */
export function angleDeltaMdeg(a: number, b: number): number;
```

`packages/space/src/sin-lut.ts` is a **committed generated file**: 901 Q16.16 entries for 0°..90° in 0.1° steps, produced once by `packages/space/scripts/gen-sin-lut.mjs` (which may use `Math.sin` — it is a build-time codegen script, not sim code, and its output is committed literals). Regenerating must be byte-identical or CI fails (`git diff --exit-code` after running the generator, wired into the space package's test script).

*Rejected: computing the LUT at module load.* That reintroduces `Math.sin` variance — the exact hazard this module exists to remove.

`packages/space/src/grid.ts`:

```ts
/** Cell bitfield flags. A cell may be walkable AND door, etc. */
export const CELL = {
  SOLID: 1, WALKABLE: 2, DOOR: 4, FURNITURE: 8,
} as const;

export const CELL_SIZE_MM = 250;

/** Immutable static collision grid for one floor. Plain JSON-serializable
 *  data (Uint8Array is NOT used — cells is number[] so grids survive the
 *  JSON round-trips core snapshots perform, if a game ever does store one). */
export interface NavGrid {
  width: number;   // cells
  height: number;  // cells
  originXMm: number; // world-mm of cell (0,0)'s min corner
  originZMm: number;
  cells: number[]; // length width*height, row-major, CELL bitfields
}

export function cellAt(grid: NavGrid, cx: number, cz: number): number;
export function cellOfMm(grid: NavGrid, xMm: number, zMm: number): { cx: number; cz: number };

/** Axis-separated circle-vs-grid move. Integer in, integer out. `isOpen`
 *  lets the caller overlay dynamic door state without mutating the grid:
 *  a DOOR cell blocks unless isOpen(cx,cz) returns true; SOLID always
 *  blocks; FURNITURE blocks. Resolves X then Z (documented order — part of
 *  the determinism contract). Returns the final position, never NaN, never
 *  inside a blocking cell. */
export function moveCircle(
  grid: NavGrid,
  xMm: number, zMm: number,
  dxMm: number, dzMm: number,
  radiusMm: number,
  isOpen?: (cx: number, cz: number) => boolean
): { xMm: number; zMm: number };

/** True if the swept grid line from a to b crosses no blocking cell (same
 *  isOpen overlay semantics). Integer DDA. */
export function losClear(
  grid: NavGrid, axMm: number, azMm: number, bxMm: number, bzMm: number,
  isOpen?: (cx: number, cz: number) => boolean
): boolean;
```

`packages/space/src/portals.ts` + `route.ts`:

```ts
export interface Portal {
  id: number;
  roomA: number; roomB: number;
  /** The door cell(s) this portal passes through. */
  cells: { cx: number; cz: number }[];
}
export interface PortalGraph {
  /** roomId -> portal ids touching it. Room 0 is reserved for "outside". */
  rooms: number[][];
  portals: Portal[];
}

/** Room id at a world position, or -1 if in a wall. Backed by a room-id
 *  layer emitted by the generator (see interiors). */
export function roomAt(rooms: readonly number[], grid: NavGrid, xMm: number, zMm: number): number;

/** Grid A* between two cells (4-connected, unit cost, deterministic
 *  tie-break: lower (cz*width+cx) index wins). Ships tested in H0; no H0
 *  system calls it. */
export function findPathCells(
  grid: NavGrid, from: {cx:number;cz:number}, to: {cx:number;cz:number},
  isOpen?: (cx: number, cz: number) => boolean
): { cx: number; cz: number }[] | null;

/** Portal-level route (BFS over PortalGraph, lowest-portal-id tie-break).
 *  Ships tested in H0; no H0 system calls it. */
export function findRoute(graph: PortalGraph, fromRoom: number, toRoom: number): number[] | null;
```

### B. `packages/core` additions **[public-contract change: `Sim`; `IWorld` unchanged]**

```ts
// sim.ts
/** Remove an entity: deletes it from every component store. Emits nothing —
 *  callers emit their own events. Ids are never reused (nextEntity is
 *  monotonic), so a despawned id in an old event stays unambiguous. */
despawn(entity: EntityId): void;

/** All components currently attached to an entity, as [name, value] pairs
 *  in component-store registration order (deterministic). Read-only view;
 *  O(#component types). */
componentsOf(entity: EntityId): Iterable<[string, unknown]>;
```

`eventsSince(tick)` **keeps its exact `IWorld` signature** and becomes indexed: the event log is append-only with monotonically non-decreasing `tick`, so the implementation switches from `Array.filter` (O(total events) per call, per frame, forever) to a binary search for the first index with `e.tick >= tick`, returning `eventLog.slice(idx)`. Additionally `Sim` gains a constructor option:

```ts
constructor(seed: string, opts?: {
  /** Retain events for at most this many most-recent ticks (default:
   *  unbounded, preserving current behaviour for all existing callers).
   *  Trimming happens at the start of step(). eventsSince(t) for a t older
   *  than the retained window returns only retained events — documented. */
  eventRetentionTicks?: number;
});
```

`stateHash()`, `snapshot()`, `restore()` are untouched (events were never hashed or restored — the existing hashes, including smoke's, must survive byte-identically; the gate checks).

*Rejected: a fixed-capacity ring buffer.* Retention-by-ticks composes with the 20 Hz contract and avoids a magic element count. `apps/hotel` constructs `new Sim(seed, { eventRetentionTicks: 600 })` (30 s).

### C. `@claude-engine/interiors` (new package, pure root)

One generator, three synchronized outputs — geometry, nav grid, portal graph — from a single BSP pass, so they cannot desync.

```ts
// packages/interiors/src/index.ts
import type { NavGrid, PortalGraph } from "@claude-engine/space";
import type { MeshData } from "@claude-engine/assets";

export interface DoorSpec {
  /** Stable per-layout door index (generation order). */
  doorIndex: number;
  cx: number; cz: number;        // the DOOR cell
  xMm: number; zMm: number;      // center, for placing the mesh + interactable
  yawMdeg: number;               // hinge orientation
  roomA: number; roomB: number;
}

export interface GroundFloor {
  grid: NavGrid;
  rooms: number[];               // room-id per cell (parallel to grid.cells)
  portals: PortalGraph;
  doors: DoorSpec[];
  /** One static mesh for floor+walls+ceiling, vertex-coloured, no UVs.
   *  Positions in METRES (renderer space; mm/1000) — geometry is
   *  presentation, the grid is truth. */
  mesh: MeshDataWithColors;
  spawn: { xMm: number; zMm: number; yawMdeg: number }; // lobby center
}

/** Pure function of the seed: BSP-partition a lobby + corridor + 4 rooms
 *  onto the 250 mm grid, carve door cells, then rasterize walls into the
 *  grid AND emit wall quads from the SAME cell data (each wall face is
 *  generated by scanning solid/walkable cell boundaries — there is no
 *  second geometric description to drift). Deterministic: same seed, same
 *  bytes, forever (golden test). */
export function generateGroundFloor(seed: string): GroundFloor;

/** Door mesh for one door (H0: one fixed panel sized to the doorway). */
export function generateDoorMesh(spec: DoorSpec): MeshDataWithColors;
```

`MeshDataWithColors` extends the existing `assets` `MeshData` with `colors: number[]` (per-vertex RGB, 0..1) — added in `packages/assets` (additive) with `toBufferGeometry` in `assets/web` gaining color-attribute support **[public-contract change: `assets` types, additive]**.

### D. `packages/renderer-three` additions **[public-contract change: `ThreeHostOptions`, `WorldforgeHook` — all additive]**

```ts
// three-host.ts — new optional ThreeHostOptions fields
export interface PointerHandlers {
  /** Normalized relative look deltas (movementX/Y px). Called from the real
   *  mousemove listener only while pointer-locked. */
  onLook?(dxPx: number, dyPx: number): void;
  /** Button 0 down while pointer-locked. */
  onClick?(): void;
  onPointerLockChange?(locked: boolean): void;
}
export interface ThreeHostOptions {
  // ...existing fields unchanged...
  /** Pointer input, alongside the existing keyboard `keymap`. The host owns
   *  listener lifecycle (added on start, removed on stop) and requests
   *  pointer lock on canvas click when handlers are present. */
  pointerHandlers?: PointerHandlers;
  /** Called once per animation frame after syncScene, before render — the
   *  hook player-fps uses to drive the camera at refresh rate. */
  onFrame?(camera: THREE.Camera, world: IWorld, alpha: number): void;
}
```

```ts
// test-hook.ts
export interface SyntheticPointer {
  lock(): void;                       // simulate pointerlockchange -> locked
  look(dxPx: number, dyPx: number): void;
  click(): void;
}
export interface WorldforgeHook {
  // ...existing fields unchanged...
  /** Present iff the app registered a pointer pipeline (player-fps does). */
  pointer?: SyntheticPointer;
  /** Present iff the app wired tick timing (see sim-tick-ms probe). */
  tickTimings?(): readonly number[];
}
export function installTestHook(opts: {
  world: IWorld; submit: (c: Command) => void; app: string; tickRateHz?: number;
  pointer?: SyntheticPointer;                 // NEW, optional
  tickTimings?: () => readonly number[];      // NEW, optional
}): WorldforgeHook;
```

### E. `@claude-engine/player-fps` (new package — renderer-side, NOT pure; may import three)

```ts
// packages/player-fps/src/index.ts
export interface FpsControllerOptions {
  actor: string;
  playerEntity: EntityId;
  /** Read the player's authoritative sim pose. */
  readPose(world: IWorld): { xMm: number; zMm: number; yawMdeg: number } | undefined;
  /** Command factories — the controller never constructs Commands itself. */
  makeFace(tick: number, yawMdeg: number): Command;
  makeMove(tick: number, forwardMilli: number, strafeMilli: number): Command;
  makeInteract(tick: number, target: EntityId): Command;
  /** Submit yaw drift only when |camYaw - simYaw| exceeds this (default 500 mdeg). */
  yawDriftThresholdMdeg?: number;
  mouseSensitivityMdegPerPx?: number;   // default 220
  eyeHeightM?: number;                   // default 1.6
  thirdPersonBoomM?: number;             // default 3.5
}

export interface FpsController {
  /** Wire into ThreeHostOptions. */
  pointerHandlers: PointerHandlers;
  onFrame(camera: THREE.Camera, world: IWorld, alpha: number): void;
  /** Per-tick input pump: emits at most one face + one move command for the
   *  upcoming tick from held WASD keys + accumulated look. */
  onTick(world: IWorld, submit: (c: Command) => void): void;
  /** The synthetic pointer implementation for installTestHook. */
  syntheticPointer: SyntheticPointer;
  /** Reticle target resolution: raycast from camera center against the
   *  registered interactable objects; returns the sim entity or undefined.
   *  Presentation-side suggestion only — the sim revalidates. */
  currentTarget(): EntityId | undefined;
  registerInteractable(entity: EntityId, object: THREE.Object3D): void;
  /** Replayable input trace. */
  inputTrace(): readonly InputTraceEntry[];
}
export function createFpsController(opts: FpsControllerOptions): FpsController;

/** One normalized input event, recorded post-normalization. */
export type InputTraceEntry =
  | { atMs: number; kind: "lock"; locked: boolean }
  | { atMs: number; kind: "look"; dxPx: number; dyPx: number }
  | { atMs: number; kind: "click" }
  | { atMs: number; kind: "key"; code: string; down: boolean };
```

### F. `packages/harness` additions **[public-contract change: `BrowserSpec`, CLI]**

```ts
// browser.ts
export type InputStep =
  | { key: string; downMs: number; upMs: number }                    // existing
  | { pointer: "lock"; atMs: number }
  | { pointer: "look"; atMs: number; dx: number; dy: number }        // px deltas
  | { pointer: "click"; atMs: number }
  | { pointer: "screenClick"; atMs: number; u: number; v: number };  // RESERVED: exit 2 in H0

export interface BrowserSpec {
  app: string;
  input?: readonly InputStep[];       // widened
  // ...existing fields unchanged...
}

export type ProbeSpec =
  | { probe: "fps"; sampleMs?: number }
  | { probe: "input-latency"; key: string; component: string; samples?: number }
  | { probe: "sim-tick-ms"; minSamples?: number };   // NEW
```

Pointer steps are driven by `page.evaluate` calls into `window.__WORLDFORGE__.pointer` at their wall-clock offsets (same scheduler as keyboard steps). If a scenario has pointer steps and the hook exposes no `pointer`, that is a `BrowserInfraError` (exit 2). The `sim-tick-ms` probe reads `__WORLDFORGE__.tickTimings()` and reports `{ avgMs, p95Ms, maxMs }`; addressable from `feelTargets` as `"simTickMs.avgMs"` etc. Missing `tickTimings` with the probe requested: exit 2.

CLI **[additive]**: `npm run harness -- <scenario> --browser [--browser-engine <chromium|firefox>]`. Default `chromium` with the existing ANGLE/SwiftShader args. `firefox` launches `playwright.firefox.launch({ headless: true })` with no extra args (the ANGLE flags are Chromium-only). The installed Playwright supports Firefox, but **the browser binary is not installed on this machine** (`%LOCALAPPDATA%\ms-playwright` has chromium only) — implementation includes running `npx playwright install firefox` and adding it to the CI setup step; a missing binary is a `BrowserInfraError` naming that command.

Browser mode also gains `--verify-replay` **[additive]**: after the live run, the harness replays the captured command log in-process (`verifyReplay(scenario, finalStateHash, commands)` — already exported) and exits 3 on divergence. This is what makes the cross-engine gate one command per browser.

### G. `scripts/check-purity.mjs` extension

New violation class `math-transcendental`: regex

```
/\bMath\.(sin|cos|tan|asin|acos|atan2|atan|exp|log2|log10|log|pow|hypot|cbrt)\s*\(/
```

(longest-first alternation so `atan2`/`log2` match before `atan`/`log`), applied per-line with the existing comment-line skip — same mechanism as the `Math.random` check, deliberately grep-level not AST (matching the file's existing style; an AST pass is over-engineering for a CI tripwire, and false positives in sim code are acceptable friction).

Scope: the check is **per-root opt-in** via a new `banTranscendentals: true` flag on `PURITY_ROOTS` entries, set for `packages/core/src`, `packages/bots/src`, `packages/net/src` (excl. web), and the two new roots this phase adds: `packages/space/src` and `packages/interiors/src`. (`gen-sin-lut.mjs` lives in `packages/space/scripts/`, outside `src`, so it needs no carve-out.)

**`packages/assets` carve-out, resolved explicitly:** `banTranscendentals` stays `false` for `packages/assets/src`. Its `Math.sin/cos` uses (`mesh.ts`, `icon.ts`) are legitimate because asset synthesis output is presentation data. The invariant, stated here and to be added to CLAUDE.md's invariant #2 wording by this phase **[public-contract change: CLAUDE.md — escalated; this spec is the escalation]**:

> Asset-synthesis output (meshes, icons, terrain heightfields, music) must never be hashed into sim state or used in sim-side decisions with float precision; any generated data the sim reasons about must arrive as integers on the sim's grid.

(The existing template's `heightAt` ground-following predates this rule and is grandfathered for the demo; hotel sim code never touches `assets`.)

Self-test gains planted-violation fixtures: `Math.atan2` planted in `packages/space/src` must be CAUGHT; `Math.cos` planted in `packages/assets/src` must be correctly NOT flagged.

## The `apps/hotel` skeleton

```
apps/hotel/
  docs/DESIGN.md, ARCHITECTURE.md      (already committed, untouched)
  package.json                          @claude-engine/hotel; deps: core, space,
                                        interiors, renderer-three, player-fps, assets(web), three
  index.html, vite.config.ts, tsconfig.json, tsconfig.game.json
  src/game.ts                           sim module: core+space+interiors ONLY (headless-safe)
  src/main.ts                           host: Three host + FpsController + test hook wiring
```

Scenarios live in the repo-root `scenarios/` directory, matching existing convention.

**Components (H0 only, all JSON-plain, all integers):**

| component | shape | on |
|---|---|---|
| `pos` | `{ xMm, zMm }` | player |
| `prevPos` | `{ xMm, zMm }` | player |
| `yaw` | `{ mdeg }` (0..359_999) | player |
| `prevYaw` | `{ mdeg }` | player |
| `collider` | `{ radiusMm }` (player: 300) | player |
| `door` | `{ doorIndex, open: boolean, cx, cz }` | each door entity |
| `interactable` | `{ kind: "door", xMm, zMm, radiusMm: 1500, arcMdeg: 60_000 }` | each door entity |
| `player` | `{ actor }` marker | player |

The `GroundFloor` (grid, rooms, portals, mesh, doors) is **setup-derived deterministic data, not sim state** — see Determinism rules, item 5.

**Command vocabulary (H0 only):**

- `face { yawMdeg }` — set player yaw. Quantized, at most one per tick per actor (later duplicates in a tick are ignored; documented).
- `move { forwardMilli, strafeMilli }` — intent in [-1000, 1000] each, relative to current sim yaw; the sim scales by `MOVE_SPEED_MM_PER_TICK = 200` (4 m/s at 20 Hz) using `sinMdeg/cosMdeg` and integer division, then resolves via `moveCircle`.
- `interact { target: EntityId }` — request to use an interactable. Revalidated (see below).

**System execution order (registration order in `setup`, per core contract):**

1. `snapshotPrevSystem` — copy `pos`→`prevPos`, `yaw`→`prevYaw` (render interpolation source).
2. `faceSystem` — apply the first `face` per actor; wrap mod 360_000.
3. `moveSystem` — apply `move` intents through `space.moveCircle` with `isOpen = (cx,cz) => someOpenDoorAt(cx,cz)` derived by scanning `withComponent("door")`.
4. `interactSystem` — for each `interact`: target must have `interactable`; squared-mm distance from player ≤ `radiusMm²` (integers, no sqrt); `angleDeltaMdeg(bearingTo(target), yaw)` within `±arcMdeg/2` where bearing uses `atan2Mdeg`; then flip `door.open` and `emit("door", { doorIndex, open })`. Invalid interacts emit `interact-denied { reason }` — the anti-cheat seam.

**Host module (`main.ts`):** constructs `Sim`, calls `setup`, builds the `GroundFloor` again from `sim.seed` for meshes, creates `createFpsController`, wires `pointerHandlers`/`onFrame` into `createThreeHost`, wraps `stepSim` to record timings for `tickTimings`, calls `controller.onTick(world, hook.submit)` inside the wrapped `stepSim` (before `sim.step()`), registers each door's mesh with `controller.registerInteractable(doorEntity, mesh)`, and passes `controller.syntheticPointer` + timings into `installTestHook`.

## Determinism rules

1. **Units.** Positions: integer millimetres. Angles: integer millidegrees, yaw in [0, 360_000). Any computation producing a fraction rounds via explicit `Math.floor`/`Math.round` (allowed — exactly specified by ECMAScript) at a documented point. Floats never cross a tick boundary in sim state.
2. **Trig.** Sim code calls `sinMdeg/cosMdeg/atan2Mdeg/isqrt` only. Every `Math.` transcendental is mechanically banned in sim roots (Scope G). Integer millimetres alone are NOT sufficient — `Math.sin` is implementation-defined and diverges across engines only at boundary values, which is precisely why the failure would otherwise be misdiagnosed as a game bug. The Chromium-vs-Firefox gate scenario is the executable proof.
3. **Yaw is sim state; pitch is presentation.** The camera consumes mouse look at refresh rate; the host submits `face{yawMdeg}` at most once per tick and only when drift exceeds 500 mdeg. Interaction facing is 2D yaw plus the interactable's vertical band (H0: doors span the whole band — no pitch check at all).
4. **The raycast is a suggestion, never truth.** `currentTarget()` resolves the reticle to an entity *host-side*; the sim's `interactSystem` revalidates proximity and facing against the `interactable` component before honouring it. A hostile client that submits `interact{target: farDoor}` gets `interact-denied`.
5. **No closure state (invariant 6 — the Phase-3 item-1 lesson, applied).** The `GroundFloor` is generated by a **pure function of `sim.seed`** (`generateGroundFloor(seed)`), called inside `setup()` and captured by system closures — legal because it is *setup-derived deterministic data that never changes after setup and is byte-identically re-derived by `Sim.restore()`'s fresh `setup()` run*. It is NOT stored in components (that would bloat `stateHash()`/snapshots with bulk data — the same reasoning as the template's terrain).

   The rule, unambiguous for the implementer: **immutable data derivable from the seed alone may live in setup closures; anything that changes after tick 1 (door `open`, positions) must live in components; no closure may accumulate command-derived state.** Door *entities* (mutable `open`) are components; door *geometry and cell positions* are closure data keyed by `doorIndex`, joined at lookup time. The mapping doorIndex→entity must itself be derived by scanning `withComponent("door")`, never a closure `Map` populated at spawn time — spawn happens in setup so a closure map would actually survive restore, but the rule is taught without the exception to keep it teachable.
6. **Collision** is circle-vs-grid, axis-separated (X then Z, documented), integer, per-floor uniform 250 mm cells with the `CELL` bitfield. No rigid-body physics.

## The synthetic-input contract (the load-bearing testability decision)

**Injection point:** inside `createFpsController`, the real DOM path is `mousemove listener → normalizeLook(e.movementX, e.movementY) → applyLook(dxPx, dyPx)` and `mousedown listener → applyClick()`. `syntheticPointer.look/click/lock` call **`applyLook`/`applyClick`/`applyLockChange` directly — the exact functions the normalized real events call, one frame after normalization and zero frames before any game logic.**

Everything downstream — sensitivity scaling, yaw accumulation, drift thresholding, `face` quantization, reticle raycast against the *real Three scene*, `interact` target resolution, command construction — is shared byte-for-byte between real and synthetic input. The only code synthetic input skips is DOM event plumbing that carries no logic. This is why a green synthetic gate certifies the real path: if they could diverge, every later phase's browser gate would be theatre.

The trace recorder also lives in `applyLook`/`applyClick`, so real sessions and synthetic sessions produce the same `InputTraceEntry[]` format (normalized deltas, wall-clock `atMs`), and a recorded human session can be replayed as a harness `input` script mechanically.

Note the layering: `renderer-three`'s `installTestHook` gains only the optional `pointer` *slot* (it stays game-agnostic); `player-fps` supplies the implementation. Clicks resolve through the real raycast against the real scene — synthetic input does not shortcut target resolution.

## Exit criteria

1. **`fps-look-interact` (browser, cross-engine determinism gate).** `scenarios/fps-look-interact.scenario.mjs`:
   - name `fps-look-interact`, seed `hotel-h0-look-1`, ticks 60, `setup` imported from `apps/hotel/dist-game/game.js`.
   - `browser.app: "@claude-engine/hotel"`; input: `[{pointer:"lock",atMs:100}, {pointer:"look",atMs:300,dx:<toward nearest lobby door>,dy:0}, {key:"KeyW",downMs:400,upMs:1400}, {pointer:"look",atMs:1500,dx:…,dy:0}, {pointer:"click",atMs:1800}]` (exact deltas computed by the implementer from the seed's generated layout and committed as literals with a comment deriving them); `screenshotAtTicks: [5, 50]`; probes: `fps`, `sim-tick-ms`.
   - `feelTargets`: `{ "fps.avg": { min: 5 }, "simTickMs.avgMs": { max: 10 } }`.
   - Assertion (checked headlessly via the replay): some entity's `door` component has `open === true`, and a `door` event with `open: true` exists — **the flip happened in the sim**, not in scenery.
   - Pass condition, run twice:
     - `npm run harness --silent -- fps-look-interact --browser --verify-replay` → exit 0
     - `npm run harness --silent -- fps-look-interact --browser --verify-replay --browser-engine firefox` → exit 0

     Each run's captured command log must replay headlessly to the same final hash (exit 3 otherwise). The two live runs need not hash-equal *each other* (wall-clock input lands on different ticks); the gate is that **each** engine's session is deterministically reproducible by the pure sim — divergent trig would break the replay on at least one.

2. **`walk-collide` (headless).** `scenarios/walk-collide.scenario.mjs`: name `walk-collide`, seed `hotel-h0-walk-1`, ticks 200, same `setup`; scripted `commands`: a `face`+`move` path that walks the lobby, rams a wall head-on for 40 ticks, slides along it, and traverses the corridor. Assertions:
   - (a) `noStuckAgents` — final `pos` differs from the tick-1 `pos` and total displacement ≥ 5000 mm (a plain assertion against components; no new harness vocabulary).
   - (b) for the final `pos`, `cellAt(grid, cellOfMm(...))` has no `SOLID` bit — and a recording system in the scenario's own extra setup asserts per-tick never-inside-solid by emitting `stuck-in-wall` events, with the assertion that `eventsSince(0)` contains none.
   - (c) the wall-ram segment moved the player 0 mm on the blocked axis.

   Pass: `npm run harness --silent -- walk-collide --verify-replay` → exit 0.

3. **Purity gates.** `node scripts/check-purity.mjs` → exit 0 with `space` and `interiors` roots listed; `--self-test` → exit 0 including the new `math-transcendental` CAUGHT fixtures and the assets not-flagged fixture.

4. **Probe reports.** The `fps-look-interact` verdict JSON contains `browser.probes["sim-tick-ms"].avgMs` as a finite number.

5. **Existing gates stay green:** `npm run build`, smoke hash `919868270` unchanged, existing scenarios pass (`eventsSince` re-implementation must be behaviour-identical for unbounded logs).

## Implementation order

1. **G1: purity extension** (no deps). check-purity + self-test fixtures.
2. **A: `space`** — `gen-sin-lut.mjs` + committed LUT → `sim-math` + unit tests (golden values incl. boundary angles 0/90_000/180_000/359_999) → `grid.ts` (`moveCircle`, `losClear`) + tests → `portals.ts`/`route.ts` + tests. Register the root in G1's config.
3. **B: core additions** — `despawn`, `componentsOf`, indexed `eventsSince` + `eventRetentionTicks`; unit tests incl. a hash-stability test against a recorded pre-change hash.
4. **D: renderer-three** — `pointerHandlers`, `onFrame`, test-hook `pointer`/`tickTimings` slots.

   *(1, 2, 3 and 4 are mutually independent — parallelize.)*
5. **C: `interiors`** — depends on 2. Generator + golden test (byte-equal `GroundFloor` JSON for seed `hotel-h0-look-1`) + a property test: every emitted wall quad corresponds to a solid/walkable cell boundary and vice versa (the one-source-of-truth check, executable).
6. **`assets` vertex-colour additive change** (independent; needed by 5's mesh type and 8's rendering).
7. **E: `player-fps`** — depends on 4. Controller + synthetic pointer + trace.
8. **F: `apps/hotel`** — depends on 2, 3, 5, 7. Scaffold-then-modify; `game.ts` first (headless-testable immediately), then `main.ts`.
9. **G2: harness pointer steps + `sim-tick-ms` + `--browser-engine` + browser `--verify-replay`** — depends on 4/7 for the hook contract; `npx playwright install firefox`; CI wiring.
10. **H: the two scenarios**, run the full gate matrix, fix, commit verdicts as evidence.

## Risks (with early warning signs)

1. **LUT-interpolated trig accumulates error vs. expectations tuned on `Math.sin`** (movement feels subtly wrong, diagonal speed off). *Early sign:* `sim-math` unit tests comparing `sinMdeg` to `Math.sin*ONE` show max error > 3 ulp-of-Q16 at LUT midpoints — tighten the table step before building on it.
2. **Firefox headless WebGL fails like Chromium did** (blank canvas, no console error). *Early sign:* the tick-5 screenshot is uniform-colour — add a screenshot-brightness sanity check while bringing the scenario up; budget for a `MOZ_HEADLESS` / `webgl.force-enabled` pref pass.
3. **Synthetic/real divergence sneaks in via ordering** — e.g. real mousemove coalesces multiple deltas per frame, synthetic injects one big delta. *Early sign:* a manual play session's `inputTrace()` replayed as a harness script yields a different final door state. Added as a manual verification step in the review gate.
4. **Wall-clock pointer scheduling lands the click before the walk finishes** (flaky gate). *Early sign:* intermittent `interact-denied` in the verdict's events tail. Mitigation already in the design: generous `atMs` spacing and a 1500 mm proximity radius; if flake persists, gate the click step on `world.tick` instead of wall clock (small harness change).
5. **`eventsSince` retention breaks an existing consumer** that reads from tick 0 late. *Early sign:* any existing scenario's `eventCount` changes — retention is opt-in and defaults off precisely so this cannot happen silently; the gate diffs all committed verdict hashes.
6. **BSP generator emits a layout where a door is unreachable or the spawn is inside furniture for some seed.** *Early sign:* the interiors property test should include "every room reachable from spawn via `findRoute`" — for the committed seeds and a 100-seed sweep.

## Open questions for the review gate (deliberate implementer judgment, not oversights)

1. Exact `sinMdeg` LUT step (0.1° specified) and interpolation rounding mode — implementer may tighten to 0.05° if risk 1's error test demands it; the contract is the function signature + determinism, not the table size.
2. Whether `moveCircle` slides with one axis-separated pass or two (re-attempting the blocked axis after the free axis moves) — either is acceptable if documented and covered by the wall-slide test.
3. The precise `atan2Mdeg` algorithm (binary search over LUT vs. integer CORDIC) — contract is signature + ≤100 mdeg accuracy + determinism.
4. Third-person camera collision (boom clipping through walls) — H0 may ship a naive boom; noted as accepted jank.
5. Whether `player-fps` key handling reuses the host's `keymap` or owns its own listeners (spec sketches ownership via `onTick`; implementer may instead route WASD through `keymap` if that produces a smaller diff — the command stream contract is what's fixed).
6. `interact-denied` reason vocabulary (strings) — pick short stable slugs.
