# Phase 2 spec — worldforge skill v0.1, procedural assets, browser-mode harness

Status: **planned** (this document is the step-1 output of the
[docs/WORKFLOW.md](WORKFLOW.md) loop; the step-3 review gate verdicts against
it, verbatim).

## Context: what Phase 1 delivered

Phase 1 passed the gate ([docs/reviews/phase-1.md](reviews/phase-1.md)) and is
merged. The engine now has:

- **Enforcement**: CI (build/lint/purity/smoke/harness-smoke), ESLint
  restricted imports/globals in core, self-testing `scripts/check-purity.mjs`,
  DOM-less/`types: []` core tsconfig. Invariant #1 is triple-enforced.
- **A real render host**: `@claude-engine/renderer-three` (`createThreeHost`,
  `SceneContext`, keymap → `Command` input, game-supplied `syncScene`, zero
  game knowledge) plus `apps/demo`, browser-playable and verified headless by
  `scenarios/demo-walk.scenario.mjs` against the identical `game.ts`.
- **A working harness CLI**: `npm run harness --silent -- <scenario>
  [--verify-replay] [--out <file>]` — single JSON `Verdict` on stdout, exit
  codes 0/1/2/3, bare-name and path resolution (`INIT_CWD`-aware), enriched
  verdicts (`entityCount`, `perf.p95TickMs`/`maxTickMs`, `eventsTail`,
  `replayCheck`).

What is genuinely missing, and therefore is Phase 2:

1. **The plugin does nothing yet.** `plugin/skills/worldforge/SKILL.md` is a
   v0.0.1 stub with no manifest, no `references/`, no templates, no scaffold
   command — it even points at `startHostLoop` where games should now use
   `createThreeHost`. A fresh Claude Code session cannot install it, let
   alone build a game with it.
2. **No procedural assets.** DESIGN.md's "Procedural asset layer" (terrain,
   primitive meshes, icons, WebAudio music, import-pipeline validation gates)
   has no code at all. Games on the engine today are colored cubes.
3. **No browser-mode harness.** CLAUDE.md's verification loop says "for
   rendering changes, capture a screenshot via the harness browser mode" —
   that mode does not exist. Rendering claims are still human-eyes-only
   (the Phase 1 review's live-WASD check remained outstanding for exactly
   this reason).
4. **Two explicit carryovers from the Phase 1 gate**
   ([reviews/phase-1.md](reviews/phase-1.md) §6):
   - *Checkpoint state snapshots in verdicts* — deferred from Phase 1 Scope D
     with the recorded promise that "the Phase 2 spec must pick this up".
   - *Replay-from-verdict-JSON* — `verifyReplay` re-executes the scenario
     module's `setup` + `commands`; a serialized verdict alone is not yet a
     runnable reproduction. Browser-mode work makes this decision due now.
     Resolved in Scope D below.
5. **No game-feel probes.** "Tune game feel against numbers, not adjectives"
   is skill guidance with nothing behind it.

Two further non-blocking Phase 1 observations are picked up opportunistically
where Phase 2 touches the same files (see Scope B enforcement note and the
`SceneContext.scenery` addition in Scope A/API contracts): the
`check-purity.mjs` line-76 `\s*` regex escape bug, and the demo's
non-entity-scenery disposal gap.

## Scope

Dependency order: D (checkpoint snapshots + replay-from-verdict) and B/C
(assets + pipeline) are independent; E (browser mode) builds on D's
checkpoint notion; F (feel probes) builds on E; A (skill + templates)
documents all of it and lands last in content, though its scaffolding can be
built in parallel.

### A. `worldforge` skill v0.1 — plugin manifest, scaffold command, references, starter templates

Targets: `plugin/.claude-plugin/plugin.json` (new),
`.claude-plugin/marketplace.json` at repo root (new, local-install plumbing),
`plugin/skills/worldforge/SKILL.md` (rewrite to v0.1),
`plugin/skills/worldforge/references/` (new), `plugin/commands/new-game.md`
(new), `scripts/scaffold.mjs` + root `scaffold` script (new),
`templates/3d-world/**` and `templates/topdown-2d/**` (new),
`scripts/check-plugin.mjs` + root `check:plugin` script (new).

- **Plugin manifest**: `plugin/.claude-plugin/plugin.json` with name
  `worldforge` (skill names can't contain "claude", per DESIGN.md), version
  `0.1.0`, description. Repo-root `.claude-plugin/marketplace.json` lists the
  plugin so a fresh session can do a local marketplace add + install from a
  checkout. Public marketplace listing remains Phase 4 — this is install
  plumbing only.
- **Scaffold command**: `scripts/scaffold.mjs`, exposed as
  `npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>`.
  Copies `templates/<template>/` to `apps/<app-name>/`, rewrites the package
  name to `@claude-engine/<app-name>` and any `__NAME__` placeholders.
  Contract in "API contracts" below. `plugin/commands/new-game.md` is a thin
  slash-command wrapper that runs the script and then points at the harness
  workflow.
- **Starter templates** (each a complete npm workspace app, matching
  `apps/demo`'s build shape — `tsconfig.game.json` emitting a headless game
  module + Vite for the browser bundle):
  - `templates/3d-world`: perspective camera, WASD player on
    `@claude-engine/assets` terrain (`generateTerrain` + `heightAt` for
    ground-following), a handful of `generatePropMesh` props placed from a
    forked `Rng`, optional `generateScore`/`playScore` music behind a
    user-gesture toggle (muted by default; browsers block autoplay).
  - `templates/topdown-2d`: **orthographic camera on `renderer-three`** — no
    new renderer package this phase. Grid/tile movement, sprite planes
    textured from `generateIconSvg` output via `svgToTexture`.
  - Both templates: sim logic in `src/game.ts` importing only
    `@claude-engine/core` and the pure root of `@claude-engine/assets`
    (must run headless); host wiring in `src/main.ts` via `createThreeHost`,
    calling `installTestHook` (Scope E) so browser-mode verification works
    from commit one; a committed `scenarios/first-run.scenario.mjs` inside
    the app (headless assertions + `browser` spec + `feelTargets`); a short
    README. Templates store terrain/prop *seeds and params* in components,
    never bulk generated data — keeps `stateHash()` cheap and snapshots
    small.
- **SKILL.md v0.1**: rewrite the stub. Corrects the stale `startHostLoop`
  guidance to `createThreeHost`; documents the scaffold command, the harness
  workflow including `--verify-replay`, `--replay <verdict.json>`,
  `--browser`, checkpoints, and feel targets; the procedural-asset workflow
  (generate pure data from `Rng` → adapt in `/web`) and the external-asset
  workflow (Codex generates → `assets:import` gates — Scope C). Progressive
  disclosure: SKILL.md stays lean; deep API docs live in `references/`.
- **`references/`**: `core-api.md`, `harness-api.md`, `renderer-api.md`,
  `assets-api.md`, `templates.md`. These document the **as-built** Phase 1+2
  surfaces (the review gate spot-checks signatures against source, not
  against DESIGN.md aspirations).
- **`scripts/check-plugin.mjs`** (`npm run check:plugin`): mechanical
  validity gate — manifest and marketplace JSON parse and carry required
  fields, SKILL.md frontmatter has name/description/version, every
  `references/` file linked from SKILL.md exists, every template contains
  the required files (game.ts, main.ts, scenario, package.json). Wired into
  CI.

### B. Procedural asset layer v0 — `packages/assets`

Targets: new package `packages/assets` (`@claude-engine/assets`), two entry
points; `scripts/check-purity.mjs` + `eslint.config.mjs` extensions; CI step.

- **Pure root** (`@claude-engine/assets`, sources `packages/assets/src/**`
  excluding `src/web/**`): deterministic data generators, fed exclusively
  from a caller-passed `Rng` (fork internally with fixed labels; no other
  randomness source). Same purity rules as core: zero DOM /
  Three.js / Node imports. Generators v0:
  - `generateTerrain(rng, opts)` → heightmap (`TerrainData`) via
    deterministic layered value noise; `heightAt(terrain, x, z)` bilinear
    sample for sim-side ground queries.
  - `generateCreatureMesh(rng, opts)` and
    `generatePropMesh(rng, kind, opts)` (`kind: "rock" | "tree" | "crystal"`)
    → `MeshData` (plain typed arrays: positions/normals/indices/colors,
    `triCount`). Low-poly, symmetric-perturbed primitives — this is v0, not
    art.
  - `generateIconSvg(rng, opts)` → deterministic SVG string (vector output;
    rasterization is a web concern).
  - `generateScore(rng, opts)` → `MusicScore` (bpm, tracks, notes,
    instrument params — plain data, no WebAudio types).
  - `hashAsset(data)` → FNV-style content hash used by the golden tests.
- **Web adapter** (`@claude-engine/assets/web`, sources
  `packages/assets/src/web/**`, may import `three` and DOM/WebAudio):
  `terrainToGeometry`, `toBufferGeometry(mesh)`, `svgToTexture`,
  `playScore(score, audioContext)` returning a `{ stop() }` handle.
- **Determinism tests** (`npm test -w @claude-engine/assets`, wired into
  root CI): for every generator — same seed twice ⇒ byte-identical output
  hash; two different seeds ⇒ different hashes; hashes for fixed seeds match
  committed goldens (so a refactor that silently changes output is caught —
  changing goldens requires touching the committed file, which the review
  gate sees).
- **Enforcement extension**: `check-purity.mjs` and the core ESLint
  restricted-import block extended to also cover `packages/assets/src/**`
  minus `src/web/**`; the purity self-test gains an assets-path fixture.
  While touching `check-purity.mjs`, fix the Phase 1 review's line-76 `\s*`
  single-backslash regex bug (two-character fix, flagged here so it isn't an
  unreviewed drive-by). This is an *enforcement-scope extension by config*;
  CLAUDE.md invariant #1's text (which names `packages/core/src/**`) is not
  edited — see Invariant/contract impact.

### C. Asset import pipeline + Codex/Blender tooling policy

Targets: new package `packages/asset-pipeline`
(`@claude-engine/asset-pipeline`, Node-targeted, CLI `bin`), root script
`assets:import`, committed good/bad fixtures under
`packages/asset-pipeline/fixtures/`, CI step.

- **Validation gates v0** (per DESIGN.md: "format, tri budget, materials"):
  - `texture` / `icon` (PNG, and SVG for icons): file parses as its claimed
    format; dimensions ≤ budget; power-of-two check for textures (warn or
    fail per budget flag); byte-size budget.
  - `mesh` (glTF `.glb`/`.gltf`): parses; triangle count ≤ budget (from
    accessor counts — a minimal JSON-chunk reader is sufficient; no heavy
    runtime dependency mandated); material count ≤ budget; byte-size budget.
  - `audio` (`.ogg`/`.wav`): parses; duration ≤ budget; byte-size budget.
- **CLI contract** (mirrors the harness CLI's stdout discipline):
  `npm run assets:import --silent -- <file> --type <texture|icon|mesh|audio>
  --into <appDir> [--validate-only]` — stdout is exactly one JSON
  `ImportReport`; diagnostics to stderr; exit 0 all gates passed (asset
  normalized/copied into `<appDir>/assets/` + manifest entry appended unless
  `--validate-only`), 1 a gate failed (report names it), 2 unreadable
  file/bad args. Signatures in "API contracts".
- **Codex tooling (decided, ROADMAP.md + DESIGN.md "Tooling for asset
  authoring")**: Codex generates 2D image assets (icons, textures)
  interactively per the global image-generation policy; the *pipeline is the
  gate* — every Codex-produced file enters a game only via `assets:import`.
  No Codex API integration code ships in Phase 2; the skill's
  `references/assets-api.md` documents the generate → save → import → verify
  workflow.
- **Blender (stretch, not exit criteria)**: `tools/blender/` scripted
  `bpy` + CLI export to `.glb`, gated by the same pipeline. Build only if
  the Scope B hand-rolled mesh generators prove insufficient for the
  templates; skipping it entirely is a valid Phase 2 outcome.
- **Grok / other non-Anthropic LLMs**: explicitly out of scope (restated
  from ROADMAP.md — no identified capability gap).

### D. Verdict checkpoint snapshots + replay-from-verdict-JSON (headless)

Targets: `packages/core/src/snapshot.ts` (new; keeps
`packages/core/src/types.ts` zero-diff), `packages/core/src/sim.ts`
(additive `snapshot()` method), `packages/harness/src/index.ts` (additive
`Scenario`/`Verdict` fields), `packages/harness/src/cli.ts` (`--replay`
mode), `scenarios/smoke.scenario.mjs` (gains `checkpoints`, additive).

This section resolves both Phase 1 carryovers. The design decisions,
explicitly:

- **Snapshots are evidence, not restore points.** `Sim.snapshot()` returns a
  plain-JSON `SimSnapshot` (versioned `v: 1`): tick, `nextEntity`,
  `stateHash`, and all component stores in deterministic insertion order.
  Component values are already required to be JSON-serializable (that is
  what `stateHash()` hashes), so this is a faithful dump. **No Rng state is
  captured and no `restore()` ships in Phase 2**: game code holds *forked*
  Rng streams the `Sim` does not track, so a faithful mid-run restore
  contract needs real design work — it is deferred to Phase 3, co-designed
  with event-sourced persistence (which needs exactly that machinery). The
  snapshot format is versioned so Phase 3 can extend it compatibly.
- **`snapshot()` lives on `Sim`, not `IWorld`.** The pressure to put it on
  `IWorld` ("any host could checkpoint") is real but not needed: the only
  Phase 2 consumer is the harness, which constructs and holds the concrete
  `Sim`. Adding it to `IWorld` would obligate every future host and edge the
  interface toward exposing history — the same pressure Phase 1 named and
  deferred for interpolation. Named, decided: deferred; revisit at Phase 3
  persistence. Zero diff to `IWorld`/`HostPort`.
- **Checkpoints in scenarios/verdicts**: `Scenario.checkpoints?: readonly
  number[]` (ticks). `runScenario` captures a `Checkpoint` — `{ tick,
  stateHash, entityCount, eventCount, snapshot }` — at the end of each
  listed tick; `Verdict.checkpoints` is present iff the scenario declared
  any. Snapshot size is the scenario author's responsibility (templates keep
  bulk data out of components, per Scope A); no truncation magic in v0.
- **Replay-from-verdict: replay needs code, so the verdict names the code.**
  `setup` registers *systems* — functions — which can never be serialized;
  any "fully self-contained verdict" story is false until restore-from-
  snapshot exists (Phase 3). The honest Phase 2 contract: the replay bundle
  is extended (additively) with `scenarioModule` (repo-relative path of the
  scenario file that produced the verdict), `ticks`, and `setupStateHash`
  (the `stateHash()` after `setup` ran, before tick 1). A new CLI mode,
  `npm run harness --silent -- --replay <verdict.json>`, loads the verdict,
  imports `scenarioModule`, runs its `setup`, injects **the verdict's**
  commands (not the module's), steps `ticks`, and compares per-checkpoint
  hashes (when present) and the final hash. `setupStateHash` mismatch is
  diagnosed as *"scenario module has drifted since this verdict"* (exit 2,
  clear stderr) — distinct from true nondeterminism (exit 3). This gives the
  browser-mode harness (Scope E) and any agent holding only a verdict JSON a
  runnable reproduction, with the stated limitation that the repo checkout
  must contain the named scenario module. Full module-free replay is
  **deferred again, with reason**: it requires restore-from-snapshot, which
  requires the Rng/persistence design, which is Phase 3.

### E. Browser-mode harness (Playwright)

Targets: `packages/harness/src/browser.ts` + subpath export
`@claude-engine/harness/browser`, `packages/harness/src/cli.ts`
(`--browser`, `--screenshot-dir`), `packages/renderer-three/src/test-hook.ts`
(new export `installTestHook`), `apps/demo/src/main.ts` (installs the hook),
`scenarios/demo-visual.scenario.mjs` (new), `.github/workflows/ci.yml`
(browser job), `.gitignore` (`artifacts/`).

- **Dependency policy**: `playwright` is a root devDependency and an
  `optionalPeerDependency` of `packages/harness`; the CLI imports it
  dynamically only under `--browser` and exits 2 with a clear stderr message
  if it is missing. Headless harness usage stays Playwright-free.
- **Test hook (the page-side contract)**: `installTestHook({ world, submit,
  app })` from `@claude-engine/renderer-three` sets `window.__WORLDFORGE__`
  exposing `{ world: IWorld, submit, commandLog(), info: { app,
  tickRateHz } }`, where the installed `submit` wraps the game's and records
  every command. Invariant #4 audit point: the hook's **only** sim-affecting
  capability is `submit(Command)` — it is an input vector equivalent to the
  keyboard, and reads go through `IWorld` only. (`apps/demo` has no
  production build, so CLAUDE.md's no-debug-in-prod rule is untriggered;
  templates install it unconditionally for now and note the prod-build
  question for the phase that first introduces one.)
- **Run contract**: `npm run harness --silent -- <scenario> --browser
  [--screenshot-dir <dir>]` requires `scenario.browser: BrowserSpec` (shape
  in API contracts): the target app (workspace name, built + served via Vite
  preview by the harness, or a plain URL), a wall-clock keyboard input
  script, screenshot ticks, timeout. The harness launches headless Chromium,
  waits for the hook, executes the input script in real time, captures
  screenshots when `world.tick` passes each requested tick (recording
  `requestedTick` vs `actualTick` — real-time capture is best-effort),
  collects console/page errors, then reads final tick/state hash and the
  hook's captured command log.
- **What browser mode judges** — explicitly *not* the scenario's headless
  `assertions` (their `check(sim)` closures run in Node against a `Sim`
  browser mode doesn't have). Browser mode passes (exit 0) iff: the hook
  appeared and reached `scenario.ticks`, zero console/page errors, every
  requested screenshot was captured, and all `feelTargets` (Scope F) hold.
  Exit 1 on any check failing; exit 2 on infra failure (build/serve/hook
  timeout/Playwright missing). Determinism remains the headless run's job:
  the browser verdict's `browser.deterministic` is `false` (wall-clock input
  lands on nondeterministic ticks) — **but** the captured command log is
  emitted as the verdict's replay bundle, so a browser session is
  reproducible *headlessly* via Scope D's `--replay`. That is the bridge
  that makes "playable" and "verified" the same artifact.
- **stdout discipline unchanged**: one JSON verdict (with the additive
  `browser` block); screenshots go to `--screenshot-dir` (default
  `artifacts/harness/<scenario>/`, gitignored); paths appear in the verdict.
- **`scenarios/demo-visual.scenario.mjs`**: browser-mode scenario for
  `apps/demo` — holds WASD keys via the input script, screenshots at ~2 ticks
  and near the end, feel targets from Scope F. This finally closes the
  Phase 1 review's outstanding live-WASD evidence gap mechanically.
- **CI**: a second workflow job (`browser`) on ubuntu — install Chromium
  (`npx playwright install --with-deps chromium`), build, run `demo-visual
  --browser`, upload the screenshot directory as a build artifact. Required,
  not advisory.

### F. Game-feel probes v0

Targets: `packages/harness/src/probes.ts` (part of the browser module),
`Scenario.feelTargets` (additive), template + demo scenarios declare targets.

Exactly two built-in probes ship in v0 — this is a measurement vocabulary,
not an analyzer (analyzer maturity is a Later/stretch roadmap item):

- **`fps`**: rAF-timestamp sampling over the browser run → `fps.avg`,
  `fps.p5`, `fps.min`.
- **`input-latency`**: synthetic keydown of a declared key, then poll the
  hook until the declared component (on the first entity that has it)
  changes value → `inputLatency.avgMs`, `inputLatency.maxMs`,
  `inputLatency.avgTicks`, over N samples.

Probes are declared in `BrowserSpec.probes`; results land in
`verdict.browser.probes` as plain numbers. `Scenario.feelTargets` maps
result keys to `{ min?, max? }` bounds; each bound is evaluated as a browser
check (`verdict.browser.feelChecks`, failures → exit 1). This makes "tune
feel against numbers" a mechanical loop: state targets in the scenario, run
`--browser`, read which numbers missed.

### Out of scope for A–F

Anything not listed above; see Non-goals.

## API contracts

**No changes to `IWorld` or `HostPort`** (see Invariant/contract impact);
`packages/core/src/types.ts` must be zero-diff. All `Scenario`/`Verdict`
changes are additive — Phase 0/1 consumers (`scripts/smoke.mjs`, existing
scenarios, `--verify-replay`) must pass unmodified. As in Phase 1:
signatures below are the contract; implementers may adjust parameter details
where the spec is silent, but listed capabilities, names, and behaviors are
what the review gate checks. Renames or capability changes require a spec
addendum (a planning turn).

### `@claude-engine/core` — snapshot (new, additive; new file `snapshot.ts`)

```ts
// packages/core/src/snapshot.ts
export interface SimSnapshot {
  v: 1;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  /** Component stores as [entity, value] pairs in deterministic (insertion)
   *  order. Values are plain JSON data (already required by stateHash()). */
  components: Record<string, [EntityId, unknown][]>;
}

// Sim (sim.ts) gains one method — evidence, not a restore point (no Rng
// state; restore() is Phase 3, co-designed with persistence):
snapshot(): SimSnapshot;
```

### `@claude-engine/harness` — `Scenario` / `Verdict` extensions (additive only)

```ts
export interface Scenario {
  // ...all existing fields unchanged...
  /** Ticks at which runScenario captures a Checkpoint. */
  checkpoints?: readonly number[];
  /** Present iff this scenario supports --browser runs. */
  browser?: BrowserSpec;
  /** Bounds on probe result keys, e.g. { "fps.avg": { min: 30 } }.
   *  Evaluated only in --browser runs. */
  feelTargets?: Record<string, { min?: number; max?: number }>;
}

export interface Checkpoint {
  tick: number;
  stateHash: number;
  entityCount: number;
  eventCount: number;
  snapshot: SimSnapshot;
}

export interface Verdict {
  // ...all existing fields unchanged...
  /** Present iff the scenario declared checkpoints. */
  checkpoints?: Checkpoint[];
  replay: {
    seed: string;
    commands: readonly Command[];
    // New optional fields (additive within the existing object):
    /** Repo-relative path of the scenario module that produced this verdict. */
    scenarioModule?: string;
    ticks?: number;
    /** stateHash() after setup(), before tick 1 — drift detector for --replay. */
    setupStateHash?: number;
  };
  /** Present iff run with --browser. */
  browser?: BrowserRunReport;
}
```

### `@claude-engine/harness` — CLI extensions

```
npm run harness --silent -- <scenario> [--verify-replay] [--out <file>]
                             [--browser] [--screenshot-dir <dir>]
npm run harness --silent -- --replay <verdict.json> [--out <file>]
```

- `--replay <verdict.json>`: loads the verdict, imports
  `replay.scenarioModule` (resolved against the repo root), runs its
  `setup`, injects the **verdict's** `replay.commands`, steps
  `replay.ticks`, compares checkpoint hashes (when `checkpoints` present)
  and final hash. stdout: one JSON `ReplayVerdict` —
  `{ source, scenarioModule, verified, expectedFinalHash, actualFinalHash,
  setupDrift, checkpointResults?: { tick, expected, actual, match }[] }`.
  Exit codes: `0` match; `2` verdict unreadable, module missing, or
  `setupStateHash` mismatch (module drift — stderr says so explicitly);
  `3` hash divergence.
- `--browser`: requires `scenario.browser`; exit `0` all browser checks pass
  (hook reached `scenario.ticks`, zero console/page errors, all screenshots
  captured, all feel targets met); `1` any check failed; `2` infra failure
  (app build/serve failure, hook timeout, Playwright not installed).
  stdout remains exactly one JSON document.
- Existing invocations, flags, exit codes, and stdout purity are unchanged.

### `@claude-engine/harness` — browser mode types

```ts
export interface BrowserSpec {
  /** Workspace name (e.g. "@claude-engine/demo") — harness builds it and
   *  serves via vite preview — or an http(s):// URL to use as-is. */
  app: string;
  /** Wall-clock keyboard script (KeyboardEvent.code), driven by Playwright. */
  input?: readonly { key: string; downMs: number; upMs: number }[];
  /** Sim ticks (via the test hook) at which to capture screenshots. */
  screenshotAtTicks?: readonly number[];
  probes?: readonly ProbeSpec[];
  /** Abort (exit 2) if the run exceeds this. Default 30_000. */
  timeoutMs?: number;
}

export type ProbeSpec =
  | { probe: "fps"; sampleMs?: number }
  | { probe: "input-latency"; key: string; component: string; samples?: number };

export interface BrowserRunReport {
  app: string;
  url: string;
  /** Always false in Phase 2: wall-clock input → nondeterministic ticks.
   *  Reproduce headlessly via the captured replay bundle + --replay. */
  deterministic: false;
  finalTick: number;
  finalStateHash: number;
  screenshots: { requestedTick: number; actualTick: number; path: string }[];
  consoleErrors: string[];
  pageErrors: string[];
  probes: Record<string, Record<string, number>>;
  feelChecks: { target: string; value: number; passed: boolean }[];
}
```

In a `--browser` run the top-level `verdict.replay.commands` is the hook's
captured command log, making the browser session headlessly reproducible.

### `@claude-engine/renderer-three` — additive surface

```ts
// New (test-hook.ts):
export interface WorldforgeHook {
  world: IWorld;
  /** The ONLY sim-affecting capability — standard command ingress. */
  submit(command: Command): void;
  /** Every command submitted through this hook, in order. */
  commandLog(): readonly Command[];
  info: { app: string; tickRateHz: number };
}
/** Sets window.__WORLDFORGE__; wraps `submit` to record the command log. */
export function installTestHook(opts: {
  world: IWorld;
  submit: (command: Command) => void;
  app: string;
}): WorldforgeHook;

// SceneContext gains one method (closes the Phase 1 review's non-entity
// scenery disposal observation; templates and demo use it for ground/sky):
export interface SceneContext {
  // ...existing members unchanged...
  /** Get-or-create host-owned non-entity scenery; disposed on stop(). */
  scenery(key: string, create: () => THREE.Object3D): THREE.Object3D;
}
```

`startHostLoop`, `createThreeHost`, `ThreeHostOptions`, `ThreeHost`: unchanged.

### `@claude-engine/assets` — new package

```ts
// Pure root (same purity rules as core; all randomness from the passed Rng):
export interface TerrainOptions {
  size: number;        // world units per side
  resolution: number;  // vertices per side
  heightScale: number;
  octaves?: number;    // default 4
}
export interface TerrainData {
  size: number; resolution: number; heights: Float32Array;
}
export function generateTerrain(rng: Rng, opts: TerrainOptions): TerrainData;
export function heightAt(terrain: TerrainData, x: number, z: number): number;

export interface MeshData {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array;
  colors?: Float32Array; triCount: number;
}
export function generateCreatureMesh(rng: Rng, opts?: CreatureOptions): MeshData;
export function generatePropMesh(
  rng: Rng, kind: "rock" | "tree" | "crystal", opts?: PropOptions): MeshData;

export function generateIconSvg(rng: Rng, opts?: IconOptions): string;

export interface MusicScore { /* bpm, length, tracks: notes + instrument params — plain data */ }
export function generateScore(rng: Rng, opts?: ScoreOptions): MusicScore;

export function hashAsset(
  data: TerrainData | MeshData | MusicScore | string): number;
```

```ts
// Web adapter (@claude-engine/assets/web — may import three/DOM/WebAudio):
export function terrainToGeometry(terrain: TerrainData): THREE.BufferGeometry;
export function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry;
export function svgToTexture(svg: string, sizePx?: number): Promise<THREE.Texture>;
export function playScore(
  score: MusicScore, ctx: AudioContext, destination?: AudioNode): { stop(): void };
```

`CreatureOptions`/`PropOptions`/`IconOptions`/`ScoreOptions` details are
implementer latitude; determinism (same `rng` seed + same opts ⇒
byte-identical output) is contract.

### `@claude-engine/asset-pipeline` — new package + CLI

```ts
export type AssetType = "texture" | "icon" | "mesh" | "audio";

export interface AssetBudgets {
  texture: { maxBytes: number; maxDim: number; requirePow2: boolean };
  icon:    { maxBytes: number; maxDim: number };
  mesh:    { maxBytes: number; maxTris: number; maxMaterials: number };
  audio:   { maxBytes: number; maxSeconds: number };
}
export const DEFAULT_BUDGETS: AssetBudgets;

export interface GateResult { name: string; passed: boolean; detail?: string }
export interface ImportReport {
  file: string;
  assetType: AssetType;
  passed: boolean;
  gates: GateResult[];
  /** Where the validated asset landed (absent on --validate-only or failure). */
  normalizedPath?: string;
}
export function validateAsset(
  file: string, type: AssetType, budgets?: Partial<AssetBudgets>): Promise<ImportReport>;
export function importAsset(file: string, opts: {
  type: AssetType; into: string; budgets?: Partial<AssetBudgets>;
}): Promise<ImportReport>;
```

CLI: `npm run assets:import --silent -- <file> --type <type> --into <appDir>
[--validate-only]` — stdout exactly one JSON `ImportReport`; exit `0` passed
(asset copied to `<appDir>/assets/` + manifest entry, unless
`--validate-only`), `1` gate failed, `2` unreadable file / bad arguments.

### Scaffold command

```
npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>
```

- `<app-name>`: kebab-case, validated; target `apps/<app-name>` must not
  exist. stdout: one JSON `{ app, template, path, files: string[] }`;
  diagnostics to stderr. Exit `0` created; `2` invalid name, existing
  directory, or unknown template.
- Postcondition (contract, gate-checked): the fresh app builds
  (`npm run build`), its `scenarios/first-run.scenario.mjs` passes headless,
  and `--browser` passes against it — with no edits.

## Exit criteria (review gate verdicts against these)

Grounding criterion, from ROADMAP.md Phase 2: *a fresh Claude Code session
with the plugin installed can produce a playable, verified 3D scene in one
sitting.* Concretely:

1. **Plugin valid + installable**: `npm run check:plugin` exits 0. The
   reviewer installs the plugin into a fresh Claude Code session from the
   checkout (local marketplace add + install) and confirms the `worldforge`
   skill loads and its `references/` files resolve.
2. **Scaffold → verified 3D game, unedited**:
   `npm run scaffold --silent -- gate-probe --template 3d-world` exits 0;
   `npm run build` exits 0; `npm run harness --silent --
   apps/gate-probe/scenarios/first-run.scenario.mjs` exits 0;
   the same scenario with `--browser` exits 0 and its screenshots show
   terrain + player (reviewer pixel check). Probe app deleted afterwards.
3. **Same for `topdown-2d`** (scaffold, build, headless scenario,
   `--browser`), rendering top-down via orthographic camera.
4. **Assets deterministic**: `npm test -w @claude-engine/assets` exits 0 —
   per generator: same-seed byte-identical hashes, cross-seed differing
   hashes, committed goldens matched.
5. **Purity gate extended and still proven**: `npm run check:purity` exits 0
   scanning both core and `packages/assets/src/**` (excl. `src/web/**`);
   its self-test demonstrates non-zero exit on a violation planted in the
   assets path; the line-76 regex fix is in (a `require('fs' )`-style
   fixture is caught); `npm run build` and `npm run lint` pass.
6. **Import pipeline gates work both ways**: `npm run assets:import --silent
   -- <good PNG fixture> --type texture --into apps/demo --validate-only`
   exits 0 with a JSON `ImportReport`; the committed bad fixtures (oversized
   texture, over-tri-budget `.glb`) each exit 1 with the failing gate named
   in `gates[]`.
7. **Checkpoints in verdicts**: `npm run harness --silent -- smoke` exits 0
   and (smoke now declares `checkpoints`) the verdict contains
   `checkpoints[]` with `tick`, `stateHash`, `entityCount`, `eventCount`,
   and a `snapshot` with `v: 1` and full component stores. A scenario
   without `checkpoints` yields a verdict without the field (additivity).
8. **Replay-from-verdict works**: `npm run harness --silent -- smoke
   --out v.json` then `npm run harness --silent -- --replay v.json` exits 0
   with `verified: true` and matching hashes. Tampering a command's payload
   in `v.json` → exit 3 with `verified: false`. Pointing `scenarioModule` at
   a missing file → exit 2. The reviewer additionally verifies the
   setup-drift path (edit the scenario's `setup`, re-run `--replay` against
   the old verdict → exit 2 with a drift diagnostic, not exit 3).
9. **Browser mode green with evidence**: `npm run harness --silent --
   demo-visual --browser` exits 0; stdout is a single JSON verdict whose
   `browser` block has empty `consoleErrors`/`pageErrors` and screenshot
   entries whose files exist; a screenshot visibly shows the demo scene with
   the player displaced from origin by the scripted WASD input (the
   Phase 1 review's outstanding live-WASD evidence, now mechanical). The
   run's verdict replays headlessly: feeding it to `--replay` exits 0.
10. **Feel probes report and gate**: the demo-visual verdict contains
    `browser.probes` with numeric `fps.*` and `inputLatency.*` results and
    passing `feelChecks` for the scenario's `feelTargets`. The reviewer
    flips one target to an impossible bound (e.g. `fps.avg ≥ 10000`),
    re-runs, and gets exit 1 with that target named in `feelChecks`.
11. **One-sitting E2E (the roadmap criterion, run literally)**: in a fresh
    Claude Code session with only the plugin installed and this repo checked
    out, the reviewer asks for a small 3D game; the session scaffolds from
    the template, makes at least one gameplay change, and lands green
    headless + browser verdicts — within one sitting, no human debugging of
    the engine or plugin.
12. **Contracts untouched**: zero diff to `packages/core/src/types.ts`
    (`IWorld`/`HostPort` byte-identical); **zero diff to CLAUDE.md** — no
    correction is needed this phase (its browser-mode sentence becomes true
    as written); all `Scenario`/`Verdict`/`replay`-bundle changes additive —
    `scripts/smoke.mjs` and all Phase 1 scenarios pass unmodified;
    `renderer-three` changes limited to the two additive items
    (`installTestHook`, `SceneContext.scenery`); `runScenario` and
    `verifyReplay` signatures unchanged.

## Non-goals for this phase (explicitly deferred)

- **`Sim.restore()` / replay-from-snapshot / module-free replay** — Phase 3,
  reason in Scope D (untracked forked Rng streams; co-design with
  persistence). Phase 2 snapshots are evidence only.
- **Engine-owned render interpolation / snapshot history on `IWorld`** —
  deferred again, unchanged from Phase 1; take it up with Phase 3 netcode.
- **Server host, persistence, auth, bot players, soak scenarios** — Phase 3.
- **`apps/living-world`, Claude-driven NPCs, governance layer, autonomous
  improvement loop, public plugin release / marketplace listing** — Phase 4.
  (The `.claude-plugin/marketplace.json` added here is local-install
  plumbing, not a public listing.)
- **Blender as a required path** — stretch only (Scope C); exit criteria
  must be met by hand-rolled generators alone.
- **Grok / non-Anthropic LLM integrations** — out of scope (ROADMAP.md).
- **A dedicated 2D renderer package** — the top-down template uses
  `renderer-three` with an orthographic camera.
- **Game-feel analyzer maturity / visual asset quality scoring (Claude
  Vision)** — Later/stretch per ROADMAP.md; v0 is exactly the two probes.
- **Deterministic in-browser replay** (fixed-seed tick-aligned input
  injection in the page) — browser runs are reproduced headlessly via
  `--replay`; in-browser determinism can ride along with Phase 3 prediction
  work if needed.
- **Plugin hooks (post-edit lint, pre-done harness run)** — later per
  DESIGN.md; CI covers enforcement.
- **WebGPU, visual editor, mobile-native, Godot/native hosts, npm publishing
  of engine packages** — per DESIGN.md non-goals / Later.

## Invariant / contract impact

- **CLAUDE.md: zero diff permitted this phase.** All five invariants and the
  rest of the file are already accurate for Phase 2 — the Verification-loop
  sentence about browser-mode screenshots stops being aspirational and
  becomes literally true. The review gate should confirm an empty
  `git diff main..phase-2 -- CLAUDE.md`.
- **`IWorld` / `HostPort`: no changes.** Two pressure points were found
  during planning, both named and decided rather than smuggled:
  1. *Snapshots want to live on `IWorld`* ("any host could checkpoint").
     Decided: no — `snapshot()` goes on the concrete `Sim` (harness holds
     one); putting it on `IWorld` obligates every host and edges the
     interface toward exposing history, the exact pressure Phase 1 deferred
     for interpolation. Revisit deliberately at Phase 3 persistence.
  2. *The browser test hook exposes sim access to the page.* Decided: the
     hook is `IWorld` reads + `submit(Command)` writes only — invariant #4's
     exact shape; it adds no new mutation channel. The review gate audits
     `installTestHook` against this the way it audited `createThreeHost`.
  Any implementer discovering they "need" an `IWorld`/`HostPort` change must
  stop and escalate to a planning turn per WORKFLOW.md.
- **Invariant #1 enforcement scope extends by config, not by text.** The
  purity gates (ESLint restricted imports/globals, `check-purity.mjs`,
  no-DOM tsconfig) additionally cover `packages/assets/src/**` excluding
  `src/web/**`. The invariant's wording (which names `packages/core/src/**`)
  is not edited; this spec is the recorded decision that the assets pure
  root adopts the same rules, and the gate checks the config, not CLAUDE.md.
- **Invariant #2 (determinism)**: asset generators take determinism as
  contract (caller-passed `Rng` only) and are golden-tested; browser-mode
  runs are explicitly nondeterministic and say so in their verdict
  (`deterministic: false`) while remaining reproducible headlessly via the
  captured command log + `--replay` — invariant #3's (seed, input log)
  contract is what makes that bridge sound.
- **`@claude-engine/core`**: additive only — new `snapshot.ts`
  (`SimSnapshot`) and one new `Sim` method; `types.ts` zero-diff; `Rng`,
  `replay()`, `stateHash()` untouched.
- **`@claude-engine/harness`**: `Scenario`/`Verdict` extended additively
  (`checkpoints`, `browser`, `feelTargets`; optional `replay.*` fields);
  CLI gains `--replay`, `--browser`, `--screenshot-dir`; existing flags,
  exit codes, stdout purity, and `runScenario`/`verifyReplay` signatures
  unchanged. `playwright` enters as optional (dynamic import; absent ⇒
  headless unaffected, `--browser` exits 2 with guidance).
- **`@claude-engine/renderer-three`**: two additive public items
  (`installTestHook` + `WorldforgeHook`; `SceneContext.scenery`). Existing
  exports byte-compatible. Host-obligations checklist from PHASE-1.md
  remains in force and extends to the hook.
- **New public surface on merge** (treated as contract by the gate, like
  `createThreeHost` was): `@claude-engine/assets` (pure root + `/web`),
  `@claude-engine/asset-pipeline` (API + CLI), the scaffold CLI, and the
  `window.__WORLDFORGE__` page hook shape.
- **`scripts/check-purity.mjs`**: scope extension + the flagged two-character
  line-76 regex fix (Phase 1 review §6) — both explicitly permitted here.
- **Root `package.json`**: gains `scaffold`, `assets:import`, and
  `check:plugin` scripts; existing scripts unchanged. `.gitignore` gains
  `artifacts/`. `.github/workflows/ci.yml` gains steps (assets tests,
  pipeline fixtures, check:plugin, scaffold smoke) and the required
  `browser` job.
