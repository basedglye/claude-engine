# Phase 1 spec — CI enforcement, Three.js render host, runnable harness CLI

Status: **planned** (this document is the step-1 output of the
[docs/WORKFLOW.md](WORKFLOW.md) loop; the step-3 review gate verdicts against
it, verbatim).

## Context: what Phase 0 already delivered

Phase 0 over-delivered on the original Phase 1 roadmap bullets. The following
exist, build, and are verified by `scripts/smoke.mjs` (including a
replay-equivalence check):

- `packages/core` — ECS-lite `Sim` (Map-based component stores), 20 Hz tick
  constants, seeded forkable `Rng` (sfc32), `Command`/`GameEvent`/`IWorld`/
  `HostPort` protocol types, FNV-mix `stateHash()`, `replay()`.
- `packages/harness` — `runScenario()` returning a JSON `Verdict`
  (per-assertion pass/fail, `finalStateHash`, `eventCount`, replay bundle,
  `totalMs`/`avgTickMs`).
- `packages/renderer-three` — host-loop skeleton only (`startHostLoop`
  fixed-tick accumulator). No Three.js dependency, no rendering, no demo.

What is genuinely missing, and therefore is Phase 1:

1. **Enforcement** — no CI, no lint, no automated sim-purity check. The
   "zero host imports in core" invariant (CLAUDE.md #1) is enforced by
   nothing but attention. This was explicitly deferred from Phase 0.
2. **A real render host** — `renderer-three` renders nothing; there is no
   browser-playable anything. This is the unbuilt half of the original
   Phase 1 bullet ("render a sim world, offline play in browser").
3. **A runnable harness CLI** — CLAUDE.md's own verification loop says
   `npm run harness -- <scenario>`, and the root `package.json` wires that to
   a `start` script that `packages/harness` does not have. The documented
   agent workflow is currently a lie; Phase 1 makes it true.
4. **Verdict enrichment (partial — see Scope item D)** — DESIGN.md promises
   event-log excerpts, checkpoint state snapshots, tick-time p95, and entity
   counts in verdicts; today's `Verdict` has only an event *count* and
   avg/total timing.

## Scope

### A. CI + lint + sim-purity enforcement

Targets: `.github/workflows/ci.yml`, `eslint.config.mjs` (root),
`scripts/check-purity.mjs`, `packages/core/tsconfig.json`, root
`package.json` scripts.

- **GitHub Actions workflow** (`.github/workflows/ci.yml`), on push and PR:
  Node 22.x → `npm ci` → `npm run build` → `npm run lint` →
  `npm run check:purity` → `npm test` (smoke) → run the smoke scenario
  through the harness CLI and require exit 0.
- **ESLint** (flat config, typescript-eslint) across all packages. In
  `packages/core/src/**` additionally:
  - `no-restricted-imports`: ban `three`, all Node built-ins (`node:*` and
    bare forms), and any `packages/renderer-*`/host package.
  - `no-restricted-properties`: ban `Math.random`.
  - `no-restricted-globals`: ban `window`, `document`, `navigator`,
    `process`, `require`.
- **Standalone purity check** (`scripts/check-purity.mjs`, exposed as
  `npm run check:purity`): scans `packages/core/src/**` for the same
  violations independently of ESLint config, so the gate holds even if lint
  config drifts. Must include a self-test mode (embedded bad fixtures) that
  demonstrates it exits non-zero on: a `three` import, a `node:fs` import,
  and a `Math.random` call.
- **Compile-time hardening**: `packages/core/tsconfig.json` set to
  `"lib": ["ES2022"]` (no DOM lib) and `"types": []`, so referencing DOM or
  Node APIs in core is a *type error*, not just a lint error.

### B. Real `renderer-three` host + browser-playable demo

Targets: `packages/renderer-three/src/**` (adds `three` dependency),
new app `apps/demo` (private workspace `@claude-engine/demo`, Vite dev
server).

- `renderer-three` becomes an actual Three.js host: owns the WebGL renderer,
  scene, camera, lighting, resize handling, and the fixed-tick/render loop
  (reusing the existing `startHostLoop` accumulator contract). It translates
  keyboard input into `Command`s via a game-supplied keymap and submits them
  on tick boundaries — it never mutates sim state (invariant #4). It contains
  **no game-specific knowledge**: which entities look like what is supplied
  by the game as a scene-sync callback (see API contracts).
- `apps/demo`: a minimal browser-playable toy game — a player entity moving
  on a ground plane via WASD, plus the smoke test's hazard system so events
  visibly occur. Its sim logic lives in `apps/demo/src/game.ts` and imports
  **only** `@claude-engine/core` (it must run headless). The demo build emits
  the game module via tsc (e.g. `tsc -p tsconfig.game.json && vite build`) so
  the harness can import the exact same game the browser runs.
- A committed harness scenario (`scenarios/demo-walk.scenario.mjs`) runs that
  same `game.ts` headless with scripted move commands and assertions — the
  demo is verified without a browser, per invariant "how does an agent verify
  this works?".

Interpolation note: `IWorld` exposes only current state (no snapshot
history), so engine-owned interpolation between the last two sim states is
**not** built in Phase 1 — that would require an `IWorld` contract change
(see Invariant/contract impact). The host passes the accumulator `alpha` to
the scene-sync callback; the demo interpolates with a game-kept
previous-position component. This is recorded here as the known-deferred
design item.

### C. Harness CLI — make `npm run harness -- <scenario>` real

Targets: `packages/harness/src/cli.ts`, `packages/harness/package.json`
(`start` script + `bin`), new `scenarios/` directory at repo root with
`smoke.scenario.mjs` (a port of `scripts/smoke.mjs`'s scenario),
`demo-walk.scenario.mjs`, and `failing-example.scenario.mjs` (a deliberately
failing scenario, committed as the reproduce-a-failure fixture).

Contract in "API contracts" below.

### D. Verdict enrichment — split decision (explicit)

DESIGN.md promises four enrichments. Phase 1 ships the two that are cheap,
additive, and needed for the CLI's verdicts to be agent-sufficient:

- **In Phase 1**: `perf.p95TickMs` / `perf.maxTickMs` (per-tick timing is
  collected anyway once `runScenario` loops per tick), final `entityCount`,
  and an `eventsTail` excerpt (last ~50 events) included when a run fails.
  These directly serve the Phase 1 exit criterion "read a verdict … no human
  eyes needed": a count is not readable evidence; an excerpt is.
- **Deferred to Phase 2, with reason**: *state snapshots at checkpoints*.
  Checkpoints require a scenario-schema notion of "checkpoint" and a
  serialization format for sim state; both should be co-designed with the
  Phase 2 browser-mode harness (screenshots are checkpoint-shaped) and with
  an eye toward the Phase 3 persistence snapshot format, rather than invented
  ad hoc now. Recording the deferral here satisfies the review gate; the
  Phase 2 spec must pick this up.

### Out of scope for A–D

Anything not listed above; see Non-goals.

## API contracts

No changes to `IWorld` or `HostPort` in this phase (see Invariant/contract
impact). Two public surfaces change: `renderer-three` (new exports) and
`harness` (additive extensions + new CLI). Signatures below are the contract;
implementers may adjust parameter details where the spec is silent, but the
listed capabilities, names, and behaviors are what the review gate checks.
Renames or capability changes require a spec addendum (a planning turn).

### `@claude-engine/renderer-three` (new public surface)

```ts
// Existing — unchanged:
export function startHostLoop(world: IWorld, opts: RenderHostOptions): () => void;

// New:
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Get-or-create the scene object for an entity. The host disposes/removes
   *  objects whose entity no longer exists in the world. */
  objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D;
}

export interface ThreeHostOptions {
  canvas: HTMLCanvasElement;
  /** Advance the sim exactly one tick. Host owns timing; sim owns logic. */
  stepSim: () => void;
  /** Command ingress — the ONLY way the host affects the sim. */
  submit: (command: Command) => void;
  /** Game-supplied view sync, called once per animation frame with the
   *  interpolation alpha in [0,1). All game-specific visuals live here. */
  syncScene: (ctx: SceneContext, world: IWorld, alpha: number) => void;
  /** KeyboardEvent.code → command factory. Fired once per sim tick while the
   *  key is held; returning null submits nothing. */
  keymap?: Record<string, (world: IWorld) => Command | null>;
}

export interface ThreeHost { stop(): void; }

export function createThreeHost(world: IWorld, options: ThreeHostOptions): ThreeHost;
```

Host obligations (review-gate checklist): reads `world` only via `IWorld`;
mutates only via `options.submit`; no game component names or game types
anywhere in the package; handles canvas resize; `stop()` cancels the loop and
disposes GPU resources.

### `@claude-engine/harness` — CLI contract

Invocation (root script already exists and starts working):

```
npm run harness --silent -- <scenario> [--verify-replay] [--out <file>]
```

- `<scenario>`: path to a scenario module (`.mjs`/`.js`) whose default export
  (or named export `scenario`) is a `Scenario`. A bare name `foo` resolves to
  `scenarios/foo.scenario.mjs` from the repo root.
- **`--silent` is required for the stdout-purity guarantee below.** It is an
  `npm run` flag (placed before `--`, not passed to the CLI) that suppresses
  npm's own `> pkg@ver harness` banner lines, which npm otherwise prepends to
  stdout for every `npm run` invocation — that banner, not the CLI, is what
  would break machine parsing. Without `--silent` the command still exits
  correctly and the JSON still prints (interactive/human use is fine); only
  scripted/agent consumption of stdout requires it. `npm run start` inside
  `packages/harness` (i.e. running `node dist/cli.js <scenario>` directly, or
  via the package's `bin`) never has this issue since there's no wrapping
  `npm run` banner.
- **stdout** carries exactly one JSON document — the `Verdict` — and nothing
  else (when invoked with `--silent`, or when invoking `dist/cli.js`
  directly). Human diagnostics go to **stderr**. `--out <file>` additionally
  writes the JSON to a file.
- `--verify-replay`: after the run, replays the verdict's own replay bundle
  (`seed` + command log) against a fresh sim and compares final state hashes;
  the result is recorded in `verdict.replayCheck`.
- Exit codes: `0` all assertions passed (and replay verified, if requested);
  `1` one or more assertions failed; `2` scenario failed to load or threw
  mid-run; `3` replay divergence under `--verify-replay`.
- `packages/harness/package.json` gains `"start": "node dist/cli.js"` (and a
  `bin` entry), which is what the existing root `harness` script delegates to.

### `@claude-engine/harness` — `Verdict` extensions (additive only)

```ts
export interface Verdict {
  // ...all existing fields unchanged...
  assertions: { description: string; passed: boolean; error?: string }[]; // error: message if check threw
  entityCount: number;                       // entity count at final tick
  perf: {
    totalMs: number; avgTickMs: number;      // existing
    p95TickMs: number; maxTickMs: number;    // new, from per-tick samples
  };
  /** Last ~50 events; included only when passed === false. */
  eventsTail?: readonly GameEvent[];
  /** Present only when --verify-replay was used. */
  replayCheck?: { verified: boolean; expectedHash: number; actualHash: number };
}
```

Existing fields keep their exact names and shapes — Phase 0 consumers
(`scripts/smoke.mjs`) must not need changes to keep passing.

## Exit criteria (review gate verdicts against these)

Grounding criterion, from ROADMAP.md Phase 1: *an agent can build a toy game,
run a scenario, read a verdict, and reproduce a failure from seed+log — no
human eyes needed.* Concretely:

1. **CI green**: `.github/workflows/ci.yml` exists and every step (build,
   lint, purity, smoke test, smoke scenario via harness CLI) passes on the
   phase branch. If Actions cannot run pre-merge, the reviewer runs the
   identical commands locally.
2. **Purity gate proven**: `npm run check:purity` exits 0 on a clean tree,
   and its self-test demonstrates a non-zero exit for each violation class
   (`three` import, `node:` built-in import, `Math.random`).
   `packages/core/tsconfig.json` has no DOM lib and empty `types`, and
   `npm run build` still passes.
3. **Harness CLI works**: `npm run harness --silent -- smoke` (and the
   explicit-path form) exits 0; stdout parses as a single JSON `Verdict`
   containing `p95TickMs`, `maxTickMs`, and `entityCount`.
4. **Failure is reproducible from the verdict alone**: `npm run harness
   --silent -- failing-example` exits 1; its verdict names the failed
   assertion, includes `eventsTail` and the replay bundle; and re-running
   with `--verify-replay` shows `replayCheck.verified: true` with matching
   hashes (deterministic failure, reproducible from seed+log — the roadmap
   criterion, mechanically checked).
5. **Replay divergence is detectable**: `--verify-replay` on `smoke` exits 0
   and `replayCheck.verified` is true.
6. **Demo is playable**: `npm run dev -w @claude-engine/demo` serves a page
   where the player entity visibly moves under WASD. Reviewer verifies in
   code: all input flows through `submit(Command)`; `apps/demo/src/game.ts`
   imports only `@claude-engine/core`; `packages/renderer-three` contains no
   game-specific component names.
7. **Demo is agent-verifiable headless**: `npm run harness --silent --
   demo-walk` exits 0 running the *same* `game.ts` module the browser demo
   uses.
8. **Contracts untouched**: zero diff to `IWorld`/`HostPort` in
   `packages/core/src/types.ts`. `CLAUDE.md`'s five numbered invariants are
   byte-for-byte unchanged; the only permitted diff is the one documented
   command-example correction above (see "Invariant/contract impact"),
   explicitly flagged rather than snuck in. `Verdict`/`Scenario` changes are
   strictly additive (`scripts/smoke.mjs` still passes unmodified, aside from
   its pre-existing unused `Sim` import removed to satisfy the new lint
   gate).

## Non-goals for this phase (explicitly deferred)

- **Browser-mode harness / Playwright screenshots** — Phase 2 per
  ROADMAP.md. Do not pull it forward, even though the demo makes it tempting.
- **Verdict state snapshots at checkpoints** — Phase 2, reason in Scope D.
- **Game-feel probes, bot players** — Phase 2/3 per DESIGN.md.
- **Server host, persistence, auth** — Phase 3.
- **Engine-owned render interpolation** (snapshot history in `IWorld`) —
  requires an `IWorld` contract change; deferred until a planning turn takes
  it up deliberately (likely alongside Phase 3 netcode, which needs snapshot
  buffers anyway). Phase 1 demo interpolates at game level.
- **`worldforge` skill content, templates, procedural assets** — Phase 2.
- **WebGPU renderer path** — Three.js WebGL default only.
- **`apps/living-world`** — remains a stub; the flagship is Phase 4. The
  Phase 1 demo is `apps/demo`, deliberately disposable.
- **Plugin hooks (post-edit lint, pre-done harness run)** — later per
  DESIGN.md; CI covers the enforcement need for now.

## Invariant / contract impact

- **CLAUDE.md**: one non-invariant correction, flagged explicitly since exit
  criterion 8 otherwise calls for zero diff. The "Verification loop" section
  documented `npm run harness -- <scenario>` as the verification command;
  implementation discovered `npm run` unconditionally prints its own
  `> pkg@ver script` banner onto stdout ahead of the script's own output,
  which breaks the harness CLI's stdout-is-pure-JSON contract (section C).
  The fix is `npm run harness --silent -- <scenario>` (`--silent` suppresses
  npm's banner; it is an `npm run` flag, not a harness CLI flag). This is a
  correction to a broken example command, not a change to any of the five
  numbered invariants — those are byte-for-byte unchanged. Reviewer should
  diff CLAUDE.md and confirm the only change is that one command example.
- **CLAUDE.md invariants**: none changed. Invariant #1 (sim purity) gains
  automated enforcement (lint + purity script + tsconfig hardening) — a
  strengthening of enforcement, not a change in meaning. Invariant #4 (hosts
  render, sims decide) is load-bearing for the new `createThreeHost` design:
  the host's only sim-affecting capability is the injected `submit`.
- **`IWorld` / `HostPort`**: **no changes.** The one pressure point found
  during planning — engine-owned interpolation wants snapshot history on
  `IWorld` — is explicitly deferred (see Non-goals) rather than smuggled in.
  Any implementer discovering they "need" an `IWorld`/`HostPort` change must
  stop and escalate to a planning turn per WORKFLOW.md.
- **`@claude-engine/harness` public types**: `Verdict` and CLI surface
  extended additively; existing fields and `runScenario` signature unchanged.
- **`@claude-engine/renderer-three`**: new public API (`createThreeHost`,
  `ThreeHostOptions`, `SceneContext`, `ThreeHost`); existing `startHostLoop`
  unchanged. This is new surface, not a change to a protected contract, but
  it becomes public API on merge — the review gate should treat its
  obligations list above as contract.
- **Root `package.json`**: gains `lint` and `check:purity` scripts; the
  existing `harness` script becomes functional (no rename).
