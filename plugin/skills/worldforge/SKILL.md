---
name: worldforge
description: Build, extend, and verify games on ClaudeEngine — a deterministic TypeScript game engine with a headless-and-browser playtest harness, procedural asset generation, and a validated import pipeline. Use when the user wants to create a game, add gameplay systems, generate procedural content, import external assets, or playtest/verify game behavior with ClaudeEngine. Triggers on "make a game", "new game project", "add a gameplay system", "playtest", "game feel", "ClaudeEngine", "worldforge".
version: 0.1.0
---

# WorldForge — building games on ClaudeEngine

ClaudeEngine games are deterministic simulations rendered by thin hosts. To
build well on it, follow the invariants below and verify every change through
the harness — never by assumption. Deep API signatures live in `references/`
(loaded on demand); this file is the workflow map.

## Architecture invariants

1. Game logic lives in sim systems (`packages/core` `Sim` + `System`
   functions). Sim code imports nothing from the DOM, Three.js, or Node.
   Procedural asset **generators** (`@claude-engine/assets`'s pure root) are
   the one exception — they're pure data functions and safe to call from sim
   code (e.g. `heightAt()` for ground-following gameplay).
2. All randomness comes from a seeded `Rng` (fork per subsystem:
   `sim.rng.fork("loot")`, or `new Rng(seed).fork("terrain")` for data a
   renderer must reconstruct independently — see "Procedural assets" below).
   `Math.random()` is banned in sim code.
3. Hosts (renderer, server, harness) read state via `IWorld` and mutate only
   by submitting `Command`s.
4. Every run is reproducible from (seed, command log). If behavior can't be
   replayed, the change is wrong even if it looks right.
5. Use engine-provided netcode/persistence/auth. Do not hand-roll these.

## Workflow: creating a game

Scaffold a starter template rather than building from scratch:

```bash
npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>
npm install
npm run build -w @claude-engine/<app-name>
```

This copies `templates/<template>/` to `apps/<app-name>/` and rewrites the
package name. Both templates are complete, harness-verified apps out of the
box — `npm run dev -w @claude-engine/<app-name>` serves a playable scene
immediately. See `references/templates.md` for what each template contains
and how to extend it.

Game structure, either way:
- `src/game.ts` — sim logic. Imports **only** `@claude-engine/core` (and
  optionally `@claude-engine/assets`'s pure root). Must run headless — this
  is what the harness executes directly.
- `src/main.ts` — host wiring. Constructs a `Sim`, calls `setup()`, and wires
  `createThreeHost` from `@claude-engine/renderer-three` (see
  `references/renderer-api.md`). Never mutates sim state except via
  `submit(Command)`.
- `scenarios/*.scenario.mjs` — harness scenarios (see below).

## Workflow: verifying changes (do this before claiming anything works)

1. Write or extend a harness `Scenario` (`@claude-engine/harness` — full
   contract in `references/harness-api.md`): seed, tick budget, scripted
   commands, assertions about end state and events.
2. Run it headless and read the JSON `Verdict`:
   ```bash
   npm run harness --silent -- <scenario-path-or-bare-name>
   ```
   Per-assertion pass/fail, final state hash, perf stats, and a replay bundle
   (seed + commands + the scenario module path) for any failure.
3. To reproduce a failure or verify a stored verdict is still honest, replay
   it from the verdict alone — no scenario re-authoring needed:
   ```bash
   npm run harness --silent -- --replay <verdict.json>
   ```
   Exit 0 = verified; exit 3 = genuine replay divergence; exit 2 = the
   scenario module has drifted since the verdict was produced (a different
   failure mode than divergence — the diagnostic says which).
4. For visual/game-feel changes, run the same scenario in a real (headless
   Chromium) browser: `--browser` drives real keyboard input, captures
   screenshots at ticks you name, and checks `feelTargets` (fps,
   input-latency) if declared. A browser run's command log becomes its own
   replay bundle — feed it straight to `--replay` to reproduce a browser
   session's exact final state headlessly, no browser required the second
   time.
5. Use `Scenario.checkpoints` when a failure needs mid-run evidence, not just
   the final state — each checkpoint tick's verdict entry carries a full
   state snapshot (JSON dump of every component; not a restore point).

## Workflow: procedural assets

Prefer procedural generation over static assets (`@claude-engine/assets` —
full API in `references/assets-api.md`):

1. **Generate pure data** from a seeded `Rng`: `generateTerrain`,
   `generateCreatureMesh`/`generatePropMesh`, `generateIconSvg`,
   `generateScore`. These live in the package's pure root — safe to import
   from `game.ts` if gameplay needs the data (e.g. terrain height for
   ground-following).
2. **Adapt for the browser** in `main.ts` via the `/web` subpath:
   `terrainToGeometry`, `toBufferGeometry`, `svgToTexture`, `playScore`.
3. **Don't store bulk generated data as sim components** — it bloats
   `stateHash()` and checkpoint snapshots. Store only the seed/params needed
   to regenerate, and call the pure generator again wherever the data is
   needed (game logic and renderer alike) — same seed always reproduces the
   same result, so this costs nothing but a function call. Both starter
   templates follow this pattern; copy it.

## Workflow: external assets

Codex generates 2D image assets (icons, textures) interactively — this is
the project's standing image-generation policy, not something this skill
automates. Every externally-produced asset, from Codex or anywhere else,
must pass the import pipeline before it enters a game:

```bash
npm run assets:import --silent -- <file> --type <texture|icon|mesh|audio> --into apps/<app-name> [--validate-only]
```

Validates format/dimensions/power-of-two/tri-budget/materials/duration/size
against budgets, and on success copies the asset into
`apps/<app-name>/assets/` with a manifest entry. See
`references/assets-api.md` for the full gate list and budgets.

## Design guidance

- Keep systems small and data-driven; content (quests, NPCs, items) belongs
  in schema-validated data files, not code branches.
- Tune game feel against numbers (jump arc, input-to-response ticks, fps),
  not adjectives — declare `Scenario.feelTargets` and let `--browser` report
  which ones missed.
- `references/core-api.md` has the full `Sim`/`Rng`/`IWorld` contract if you
  need signatures beyond what's shown here.
