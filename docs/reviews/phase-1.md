# Phase 1 review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `phase-1` at `a581850` ("Phase 1: CI enforcement, Three.js
render host, harness CLI"), diffed against `main`.
Spec: [docs/PHASE-1.md](../PHASE-1.md). All verification below was re-run by
the reviewer on Windows 10 / Node 24.12.0; no implementer claims were taken
on trust.

## Resubmission verdict: PASS

Resubmitted at `19e4569` ("Fix Phase 1 review fix-list: harness path
resolution, CLAUDE.md diff"). The reviewer re-ran the full resubmission
checklist below on 2026-07-11; both fix-list items are resolved and nothing
regressed. **Phase 1 passes the gate — clear to merge.** (The FIX-LIST
sections below are preserved as history of the first review round; their
verification table remains valid evidence.)

Resubmission checks executed by the reviewer (repo root, Windows 10):

| Check | Result |
|---|---|
| `npm run build` | exit 0 (all workspaces incl. demo tsc + vite) |
| `npm run lint` | exit 0 |
| `npm run check:purity` | exit 0 — no violations in packages/core/src |
| `npm test` | exit 0 — smoke verdict passed, replay equivalence PASS |
| `npm run harness --silent -- scenarios/smoke.scenario.mjs` (exact item-1 repro, previously exit 2) | **exit 0**; single JSON verdict, `finalStateHash` 919868270 — fix-list item 1 resolved |
| `git diff main..phase-1 -- CLAUDE.md` | exactly the spec-flagged `--silent` correction; "(Phase 2+)" annotation reverted — fix-list item 2 resolved |
| `npm run harness --silent -- smoke` | exit 0, verdict JSON with perf fields |
| `npm run harness --silent -- smoke --verify-replay` | exit 0; `replayCheck.verified: true`, hashes 919868270/919868270 |
| `npm run harness --silent -- failing-example` | exit 1; names failed assertion "player reached x:999", `eventsTail` (20 events), replay bundle (seed + commands) |
| `npm run build:game -w @claude-engine/demo` then `npm run harness --silent -- demo-walk` | both exit 0 |
| `node packages/harness/dist/cli.js scenarios/smoke.scenario.mjs` (direct relative, INIT_CWD unset) | exit 0 — cwd fallback intact |
| `node packages/harness/dist/cli.js <absolute path>` | exit 0 |
| `npm run harness --silent -- nonexistent-scenario` | exit 2, diagnostics on stderr (error path intact) |

The item-1 fix (`resolveScenarioPath()` in
`packages/harness/src/cli.ts`) resolves relative specs against
`process.env.INIT_CWD ?? process.cwd()`, exactly as this review suggested;
bare-name, absolute, direct-invocation, and missing-scenario paths all
verified unaffected. Exit criteria 3 and 8 move from PARTIALLY MET to MET;
all 8 criteria are now met. The non-blocking observations in section 6
(including ticking the ROADMAP.md checkboxes at merge time) remain
outstanding but do not gate.

## 1. Original verdict (first round): FIX-LIST (2 items) — superseded by PASS above

Close to PASS — 7 of 8 exit criteria fully met, all invariants intact, all
harness scenarios green, and the reviewer obtained a real-browser pixel check
of the demo rendering. Two items block per the spec's own wording:

1. **[Exit criterion 3 — blocking] Explicit-path scenario resolution is
   broken under `npm run harness`.**
   `npm run harness --silent -- scenarios/smoke.scenario.mjs` from the repo
   root exits **2** with:
   `Failed to load scenario "scenarios/smoke.scenario.mjs" (resolved:
   C:\ClaudeGame\claude-engine\packages\harness\scenarios\smoke.scenario.mjs)`.
   Root cause: the root `harness` script delegates via
   `npm run start --workspace @claude-engine/harness --`, which sets the
   child's cwd to `packages/harness`; `resolveScenarioPath()` in
   `packages/harness/src/cli.ts` (line 66) resolves relative specs against
   `process.cwd()`. Bare names, absolute paths, and direct
   `node packages/harness/dist/cli.js <relpath>` invocations all work; only
   the documented relative-path form through the root script fails. Criterion
   3 explicitly requires "the explicit-path form" to exit 0.
   Suggested fix: resolve relative specs against `process.env.INIT_CWD`
   (npm sets it to the original invocation directory) falling back to
   `process.cwd()`. Re-verify with the exact command above.

2. **[Exit criterion 8 — minor] CLAUDE.md diff contains one unflagged
   addition beyond the documented correction.**
   The Verification-loop diff includes the spec-documented `--silent`
   command correction *and* an undocumented annotation appending
   "(Phase 2+)" to the browser-mode-screenshot sentence. The five numbered
   invariants are byte-for-byte unchanged and the annotation is factually
   consistent with the spec's Non-goals, but criterion 8 says "the only
   permitted diff is the one documented command-example correction", and
   the whole point of the CLAUDE.md gate is that nothing lands unflagged —
   however benign. Fix: either revert the two words "(Phase 2+)", or add a
   one-line addendum to PHASE-1.md's "Invariant / contract impact" section
   flagging it, which this gate will then accept on resubmission.

No other blocking findings. Everything below is the evidence.

## 2. Verification re-run (all commands executed by the reviewer)

| Command | Result |
|---|---|
| `npm run build` | exit 0 (all workspaces incl. demo tsc + vite build) |
| `npm run lint` | exit 0 |
| `npm run check:purity` | exit 0 — "No purity violations found in packages/core/src" |
| `node scripts/check-purity.mjs --self-test` | exit 0 — all three violation classes CAUGHT (three import, node:fs, Math.random) |
| `npm test` | exit 0 — smoke verdict passed, replay equivalence PASS |
| `npm run harness --silent -- smoke` | exit 0; stdout is a single JSON `Verdict` with `perf.p95TickMs` (0.0097), `perf.maxTickMs` (0.0928), `entityCount` (1) |
| `npm run harness --silent -- smoke --verify-replay` | exit 0; `replayCheck: {verified: true, expectedHash: 919868270, actualHash: 919868270}` |
| `npm run harness --silent -- failing-example` | exit 1; verdict names failed assertion "player reached x:999", includes `eventsTail` (20 events) and replay bundle (`seed` + `commands`) |
| `npm run harness --silent -- failing-example --verify-replay` | exit 1; `replayCheck.verified: true` with matching hashes (deterministic, reproducible failure) |
| `npm run build:game -w @claude-engine/demo` | exit 0 |
| `npm run harness --silent -- demo-walk` | exit 0; both assertions pass ("player walked to (2,2)", "movement events were emitted") — runs the compiled `apps/demo/dist-game/game.js` |
| `npm run harness --silent -- <absolute path to smoke.scenario.mjs>` | exit 0 |
| `npm run harness --silent -- scenarios/smoke.scenario.mjs` | **exit 2 — fix-list item 1** |
| `npm run harness --silent -- nonexistent-scenario` | exit 2, diagnostics on stderr (correct) |
| `npm run harness --silent -- smoke --out <file>` | exit 0, valid JSON written to file |
| Ad-hoc nondeterministic scenario + `--verify-replay` (reviewer-written, scratchpad only) | exit **3**, `replayCheck.verified: false` — divergence detection path confirmed live |
| `git diff main..phase-1 -- packages/core/src/types.ts` | empty |
| `git diff main..phase-1 -- CLAUDE.md` | Verification-loop section only; see fix-list item 2 |
| `npm run dev -w @claude-engine/demo` + real Chrome | page loads clean (zero console errors), 3D scene renders: lit green ground plane + yellow player cube (screenshot taken by reviewer). See criterion 6 note on live-WASD verification. |

## 3. Exit criteria checklist

1. **CI green — MET (locally).** `.github/workflows/ci.yml` exists with the
   spec's exact step sequence (Node 22.x, `npm ci`, build, lint,
   check:purity, `npm test`, `npm run harness --silent -- smoke`) on push
   and PR. Actions could not run pre-merge; per the criterion's own fallback
   the reviewer ran the identical commands locally — all exit 0.
2. **Purity gate proven — MET.** `check:purity` exits 0 on the clean tree;
   `--self-test` catches all three violation classes.
   `packages/core/tsconfig.json` has `"lib": ["ES2022"]` and `"types": []`;
   `npm run build` still passes.
3. **Harness CLI works — PARTIALLY MET (fix-list item 1).** Bare-name form
   exits 0 with a single JSON `Verdict` on stdout containing `p95TickMs`,
   `maxTickMs`, `entityCount`; absolute-path form works; the repo-relative
   explicit-path form exits 2.
4. **Failure reproducible from verdict alone — MET.** `failing-example`
   exits 1, names the failed assertion, includes `eventsTail` and the
   replay bundle; `--verify-replay` reports `verified: true` with matching
   hashes. (Its command log is empty by design — the scenario scripts no
   commands, so seed + empty log is the complete reproduction.)
5. **Replay divergence detectable — MET.** `smoke --verify-replay` exits 0
   with `verified: true`; the reviewer additionally confirmed the negative
   path with an ad-hoc nondeterministic scenario → exit 3, `verified: false`.
6. **Demo playable — MET on code-level + rendering evidence; live-WASD
   pixel check remains outstanding.** The reviewer served the demo and
   loaded it in a real Chrome tab: zero console errors, and a screenshot
   shows the correctly rendered scene (lit ground plane, player cube at
   origin) — stronger evidence than the implementer had (whose sandboxed
   pane never fired rAF). A live keyboard-driven movement screenshot was
   still not obtainable: the automatable tab sat in the background
   (`visibilityState: "hidden"`, rAF throttled to zero), and fronting it
   would have hijacked the user's active browser window, which the reviewer
   declined to do. Movement is instead verified by (a) the headless
   `demo-walk` scenario passing against the identical compiled `game.ts`
   with scripted move commands, and (b) code review: all input flows
   `keymap → pumpInput() → options.submit` on tick boundaries
   (`three-host.ts` lines 112–126), `game.ts` imports only
   `@claude-engine/core`, and `renderer-three` contains no game component
   names. This satisfies the criterion's reviewer-verifies-in-code clause;
   noting explicitly per the gate's honesty bar that no human/pixel
   verification of live WASD motion has occurred yet.
7. **Demo agent-verifiable headless — MET.** `demo-walk` exits 0 importing
   `apps/demo/dist-game/game.js`, the tsc output of the same
   `apps/demo/src/game.ts` the browser bundle compiles (spec's own
   mechanism: `tsc -p tsconfig.game.json` + Vite over one source module).
8. **Contracts untouched — PARTIALLY MET (fix-list item 2).** Zero diff to
   `packages/core/src/types.ts` (`IWorld`/`HostPort` untouched). The five
   CLAUDE.md invariants are byte-for-byte unchanged. `Verdict`/`Scenario`
   changes are strictly additive; `scripts/smoke.mjs` diff is exactly the
   permitted unused-`Sim`-import removal and it still passes. The CLAUDE.md
   diff, however, carries the one unflagged "(Phase 2+)" annotation.

## 4. Invariant / contract check

- **CLAUDE.md**: diff confined to the "Verification loop" section. Contains
  (a) the spec-flagged `--silent` command-example correction with its
  rationale — approved; (b) an unflagged "(Phase 2+)" annotation — fix-list
  item 2. All five numbered invariants byte-for-byte identical.
- **`IWorld` / `HostPort`** (`packages/core/src/types.ts`): zero diff. The
  interpolation pressure point was handled exactly as the spec directed —
  game-level `prevPos` component in `apps/demo/src/game.ts`, host passes
  `alpha` through; no snapshot history smuggled into `IWorld`.
- **Invariant 1 (sim purity)**: now triple-enforced (ESLint restricted
  imports/globals/properties on `packages/core/src/**`, standalone
  self-testing `check-purity.mjs`, DOM-less/`types: []` tsconfig).
- **Invariant 2 (determinism)**: demo hazard system uses `sim.rng.fork`;
  replay checks green.
- **Invariant 4 (hosts render, sims decide)**: see host checklist below.
- **`startHostLoop`**: moved verbatim from `renderer-three/src/index.ts` to
  `host-loop.ts` and re-exported — public contract unchanged, as required.
- **Harness surface**: `Verdict` extensions additive (`entityCount`, `perf`
  p95/max, optional `eventsTail`/`replayCheck`, `assertions[].error`);
  `runScenario` signature unchanged; Phase 0 consumer `scripts/smoke.mjs`
  passes with only the permitted lint fix.
- **Root `package.json`**: gains `lint` + `check:purity`; `harness` script
  kept its name and now works (modulo fix-list item 1).

## 5. `renderer-three` host obligations (spec API-contracts checklist)

Checked against `packages/renderer-three/src/three-host.ts`:

1. **Reads `world` only via `IWorld`** — MET. `world` is typed `IWorld`;
   the only reads are `world.entities()` (stale-object pruning) and the
   pass-through to `syncScene`/keymap factories.
2. **Mutates only via `options.submit`** — MET. The single sim-affecting
   call site is `pumpInput()` → `submit(command)`; `stepSim` is
   host-owned timing invoking a game-supplied closure, per contract.
3. **No game component names/types in the package** — MET. Grep of
   `packages/renderer-three/src` finds no `pos`/`hp`/`player`/`move`/demo
   identifiers; entity→visual mapping lives entirely in the game's
   `syncScene` (`apps/demo/src/main.ts`).
4. **Handles resize; `stop()` cancels loop and disposes GPU resources** —
   MET. `resize()` on `window` resize updates renderer size + camera
   aspect; `stop()` cancels the loop flag, removes all three listeners,
   disposes every tracked object's geometry/material, clears the map, and
   calls `renderer.dispose()`.

Contract shapes (`SceneContext`, `ThreeHostOptions`, `ThreeHost`,
`createThreeHost`) match the spec signatures, including doc-comment
semantics (keymap fired per held tick, null → no submit; `objectFor`
get-or-create with host-side disposal of stale entities).

## 6. Non-blocking observations

- **`check-purity.mjs` line 76**: in the bare-builtin regex template the
  `\s*` before the closing paren is written with a single backslash, so it
  reaches the regex as literal `s*`. `require('fs')` still matches (zero
  `s`), but `require('fs' )` — whitespace before `)` — would be missed in
  the require-form only. ESLint's `no-restricted-imports` covers the same
  ground, and core is ESM anyway; worth a two-character fix whenever the
  file is next touched.
- **`docs/ROADMAP.md`**: the Phase 1 checkboxes for the four newly delivered
  items (and Phase 0's carried CI bullet) are still unchecked; tick them at
  merge time.
- **Demo ground plane** (`main.ts`) is added directly to `ctx.scene`,
  outside `objectFor`, so `stop()` does not dispose its geometry/material
  (only `renderer.dispose()` runs). Fine for a disposable demo; a future
  `SceneContext` may want a host-owned slot for non-entity scenery.
- **Scenario `commands` are replayed from the scenario module, not from a
  serialized verdict file** — `verifyReplay(scenario, hash)` re-executes
  `scenario.setup` + `scenario.commands`. Equivalent today because the
  verdict's replay bundle is exactly `{seed, commands}` and setup is code,
  but when Phase 2+ wants replay-from-verdict-JSON (no scenario module in
  hand), setup will need to be reconstructable. Flagging for the Phase 2
  planning turn alongside the checkpoint-snapshot work.
- **Windows note**: all Phase 1 commands, including the CI sequence, pass on
  Windows (this review) — the CI matrix is ubuntu-only, which is fine, but
  fix-list item 1's `INIT_CWD` fix should be tested on both path styles.

## Resubmission

Address items 1 and 2, re-run:
`npm run build && npm run lint && npm run check:purity && npm test`,
`npm run harness --silent -- scenarios/smoke.scenario.mjs` (must exit 0),
`git diff main..phase-1 -- CLAUDE.md` (must show only spec-flagged changes),
then return to this gate.

*Completed at `19e4569` — see "Resubmission verdict: PASS" at the top of
this document.*
