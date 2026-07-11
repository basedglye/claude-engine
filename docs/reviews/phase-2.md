# Phase 2 review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `phase-2` at `6444296` ("Phase 2: wire CI for assets/pipeline/
scaffold checks + required browser job"), diffed against `main` (8 commits).
Spec: [docs/PHASE-2.md](../PHASE-2.md). All verification below was re-run by
the reviewer on Windows 10 / Node 24.12.0; no implementer claims were taken
on trust.

## 1. Verdict: FIX-LIST (3 items)

Very close to PASS — every mechanical exit criterion the reviewer could run
(1–10, 12's zero-diff halves) is green, all five invariants are intact, both
templates scaffold to verified games with zero edits, the browser-mode
verdict replays headlessly with matching hashes, and both Phase 1 carryovers
are genuinely resolved. All three fix-list items are documentation/scope
accounting, not code defects; none requires reverting anything that shipped.

1. **[Exit criterion 12 — blocking] `renderer-three` shipped a third
   additive change set the spec's own contract accounting does not permit;
   reconcile by spec addendum.**
   Criterion 12 says renderer-three changes are "limited to the two additive
   items (`installTestHook`, `SceneContext.scenery`)", and the API-contracts
   section states `ThreeHostOptions` is "unchanged". The diff additionally
   contains: `createOrthographicCamera` (new export), optional
   `ThreeHostOptions.camera`, and `SceneContext.camera` widened
   `THREE.PerspectiveCamera` → `THREE.Camera`
   (`packages/renderer-three/src/three-host.ts`).
   The reviewer judged this on the merits (section 5 below): the technical
   backward-compatibility claim is **true**, the change is minimal and
   well-designed, the Scope A commit (`9ec5f0d`) flagged it explicitly rather
   than smuggling it, and the spec is internally inconsistent — Scope A's own
   bullet requires "orthographic camera on **renderer-three** — no new
   renderer package this phase", which cannot be satisfied without touching
   the host's public surface (the host constructs and owns the camera;
   `syncScene` callers cannot replace it). The code is approved as-shipped.
   What blocks is the bookkeeping: PHASE-2.md says "Renames or capability
   changes require a spec addendum (a planning turn)", and a commit message
   is not a spec addendum. The whole point of criterion 12 — established by
   this gate in Phase 1 over two words in CLAUDE.md — is that the spec and
   the shipped surface never disagree silently.
   **Fix**: add an addendum to PHASE-2.md's "Invariant / contract impact"
   (and a note under exit criterion 12) recording the three renderer-three
   additions and the `SceneContext.camera` widening, with the Scope A
   rationale. This review, as a Fable turn, pre-approves that addendum
   content — no separate planning turn needed. No code change.

2. **[Scope A — blocking, small] `plugin/commands/new-game.md` was never
   created, and its omission is flagged nowhere.**
   The spec's Scope A target list names it ("a thin slash-command wrapper
   that runs the script and then points at the harness workflow"); no
   `plugin/commands/` directory exists on the branch, `scripts/check-plugin.mjs`
   does not check for it, and no commit message mentions dropping it. The
   scaffold workflow is fully usable via SKILL.md, so nothing downstream
   broke — but a promised deliverable silently missing is exactly what this
   gate exists to catch.
   **Fix**: either add the command file per spec (and preferably teach
   `check-plugin.mjs` to require it), or add a one-line spec addendum
   descoping it with a reason. Either resolution is acceptable.

3. **[Scope C — blocking, small] `packages/asset-pipeline/src/gates/audio.ts`
   claims spec cover that does not exist.**
   The file header (and the inconclusive-gate detail string's framing)
   justifies the `.ogg` duration fallback "per PHASE-2.md's explicit fallback
   allowance" — PHASE-2.md contains no such allowance; Scope C simply says
   "duration ≤ budget". The fallback *behavior* is a defensible v0 (see
   section 6): the byte-size budget still applies unconditionally, the gate
   result honestly says "inconclusive … passing by default", and hand-parsing
   arbitrary Vorbis is genuinely out of v0 scope. But a fabricated citation
   is a documentation-integrity failure under this project's honesty bar —
   worse than the gap itself, because it makes the gap look pre-approved.
   **Fix**: correct the comment to say this is an implementation decision,
   and record the actual decision in the same PHASE-2.md addendum as item 1
   (recommended), or alternatively make inconclusive duration a failing gate.
   Note while there: an Ogg-Opus file (common) has no Vorbis header and will
   always take this inconclusive-pass path — worth stating explicitly in the
   comment, and revisiting when audio assets become real.

No other blocking findings. Everything below is the evidence.

## 2. Verification re-run (all commands executed by the reviewer)

| Command | Result |
|---|---|
| `npm run build` | exit 0 (all workspaces) |
| `npm run lint` | exit 0 |
| `npm run check:purity` | exit 0 — core **and** `packages/assets/src` (excl. `src/web`) both clean |
| `node scripts/check-purity.mjs --self-test` | exit 0 — all violation classes CAUGHT, including the Phase 1 §6 regression fixture `require('fs' )` and a `Math.random` planted in the assets path; `three` in `src/web` correctly EXCLUDED |
| `npm run check:plugin` | exit 0 |
| `npm test` (root smoke) | exit 0 — replay equivalence PASS, hash 919868270 unchanged from Phase 1 |
| `npm run test -w @claude-engine/assets` | exit 0 — 28/28: per-generator same-seed identical, cross-seed differing, all committed goldens matched |
| `npm run harness --silent -- smoke` | exit 0; verdict has `checkpoints[]` at ticks 10/50/100, each with `tick`/`stateHash`/`entityCount`/`eventCount` and a `snapshot` with `v: 1` and full component stores |
| `npm run harness --silent -- demo-walk` | exit 0; verdict has **no** `checkpoints` field (additivity confirmed) |
| `npm run harness --silent -- failing-example` | exit 1 as designed (Phase 1 scenario unmodified) |
| `npm run harness --silent -- smoke --verify-replay` | exit 0, `verified: true` |
| `smoke --out v.json` → `--replay v.json` | exit 0, `verified: true`, final + all 3 checkpoint hashes match |
| `--replay` with a tampered command payload (`dx: 3→9`) | **exit 3**, `verified: false`, all 3 checkpoints and final hash reported mismatched |
| `--replay` with `scenarioModule` pointed at a missing file | **exit 2**, clear stderr |
| `--replay` after editing smoke's `setup()` (hp 100→99; reverted after) | **exit 2**, `setupDrift: true`, stderr says "drifted … stale evidence, not replay divergence" — the drift path is real, not just documented |
| `assets:import good-texture.png --validate-only` | exit 0, JSON `ImportReport`, 4 gates passed |
| `assets:import bad-texture-oversized.png` | exit 1, failing gate named: `dimensions` ("4096x4096 (max 2048)") |
| `assets:import good-mesh.glb` | exit 0 |
| `assets:import bad-mesh-overtris.glb` | exit 1, failing gate named: `triCount` ("100000 triangles (max 20000)") |
| `scaffold gate-probe --template 3d-world` + `npm install` + workspace build | all exit 0 |
| `harness apps/gate-probe/scenarios/first-run.scenario.mjs` | exit 0, both assertions pass |
| same `--browser` | exit 0; `consoleErrors`/`pageErrors` empty, both screenshots captured at requested ticks, `fps.avg` ≈ 60 feel check passed |
| pixel check `tick-10.png` (3d) | procedural hilly terrain, tree/rock/crystal props, yellow player cube displaced to the terrain edge by the held-key input — not blank |
| `scaffold gate-probe-2d --template topdown-2d` + install + build + headless + `--browser` | all exit 0 |
| pixel check `tick-10.png` (2d) | flat orthographic grid, six generated icon sprites, player square 6 tiles right of origin — genuinely top-down, no perspective |
| probe apps deleted, `npm install` re-run | `git status --short` empty — tree clean |
| `npm run harness --silent -- demo-visual --browser --out …` | exit 0; `browser` block: zero console/page errors, both screenshots exist, `fps` + `input-latency` probes numeric, both feel checks passed |
| pixel check demo-visual `tick-2.png` vs `tick-15.png` | player cube center-ish at tick 2, at the right edge of the green plane by tick 15 — **live WASD movement, the Phase 1 §6 outstanding evidence, now mechanical** |
| feed demo-visual browser verdict to `--replay` | **exit 0, `verified: true`, hashes 1810513518/1810513518** — a browser session is headlessly reproducible; the Scope E bridge is real |
| flip `fps.avg` target to `min: 10000`, re-run `--browser` (reverted after) | **exit 1**, `feelChecks` names `fps.avg` with `passed: false` |
| `git diff main..phase-2 -- packages/core/src/types.ts` | **empty** |
| `git diff main..phase-2 -- CLAUDE.md` | **empty** |

## 3. Exit criteria checklist

1. **Plugin valid + installable — MET (with a scoping note).** `check:plugin`
   exits 0; `plugin/.claude-plugin/plugin.json` (name `worldforge`, v0.1.0)
   and root `.claude-plugin/marketplace.json` are well-formed; SKILL.md
   frontmatter is complete and all five `references/` files exist and are
   linked. This reviewer runs as a sandboxed gate agent and cannot launch a
   literal fresh interactive Claude Code session to perform the marketplace
   add + install; the criterion is assessed by mechanical validation plus
   content inspection (SKILL.md's guidance matches as-built behavior the
   reviewer verified live — scaffold command, `--replay` exit-code semantics,
   `--browser` workflow, the Rng-fork pattern; `references/renderer-api.md`
   spot-checked signature-by-signature against `three-host.ts`/`test-hook.ts`
   and found accurate, *including* honestly documenting the fix-list-item-1
   camera surface). Residual risk is confined to install plumbing, which
   `check-plugin.mjs` covers structurally.
2. **Scaffold → verified 3D game, unedited — MET.** Exact command sequence
   run; all exit 0; pixel check confirms terrain + props + player.
3. **Same for topdown-2d — MET.** Orthographic top-down confirmed in pixels.
4. **Assets deterministic — MET.** 28/28 including committed goldens.
5. **Purity gate extended and proven — MET.** Assets-path violation caught by
   self-test; line-76 regex fix confirmed by the `require('fs' )` fixture;
   build + lint pass.
6. **Import pipeline gates both ways — MET.** Good fixtures exit 0, bad
   fixtures exit 1 with `dimensions` / `triCount` named.
7. **Checkpoints in verdicts — MET.** Full shape verified; additivity
   verified via demo-walk (no field).
8. **Replay-from-verdict — MET.** All four paths verified live: match → 0,
   tamper → 3, missing module → 2, setup drift → 2 with the drift diagnostic.
9. **Browser mode green with evidence — MET.** Clean verdict, screenshots
   show scripted-WASD displacement, and the verdict replays headlessly with
   matching hashes.
10. **Feel probes report and gate — MET.** Numeric probes, passing checks,
    and the impossible-bound flip fails exit 1 naming the target.
11. **One-sitting E2E — MET BY PROXY (reviewer judgment, stated openly).**
    A literal fresh-session run is not performable from inside this gate
    (same constraint as criterion 1). The substance was verified piecewise:
    an unedited scaffold reaches green headless + browser verdicts (criteria
    2–3), and the skill's documented workflow for "make at least one gameplay
    change and re-verify" is exactly the harness loop the reviewer exercised
    repeatedly. The first genuine fresh-session E2E should be treated as an
    acceptance step at merge time by the session owner, not re-gated here.
12. **Contracts untouched — PARTIALLY MET (fix-list item 1).**
    `types.ts` zero-diff ✓; CLAUDE.md zero-diff ✓ (no repeat of Phase 1's
    annotation slip); `Scenario`/`Verdict`/replay-bundle changes additive ✓ —
    `scripts/smoke.mjs` and all three Phase 1 scenarios pass unmodified, and
    `runScenario`/`verifyReplay` signatures are unchanged in
    `packages/harness/src/index.ts` ✓; renderer-three limited to the two
    named additive items ✗ — three additional items shipped (section 5).

## 4. Invariant / contract check

- **Invariant #1 (sim purity)**: enforcement extended by config exactly as
  specified — `check-purity.mjs` and the ESLint restricted-import block now
  cover `packages/assets/src/**` minus `src/web/**`; CLAUDE.md text untouched.
  Both templates' `game.ts` import only `@claude-engine/core` + the assets
  pure root.
- **Invariant #2 (determinism)**: generators are Rng-fed and golden-tested;
  browser runs honestly report `deterministic: false` while emitting the
  captured command log as their replay bundle.
- **Invariant #3 (replayability)**: strengthened, not weakened — checkpoints
  make divergence localizable (the tamper test showed per-checkpoint
  mismatches), and `--replay` makes a serialized verdict a runnable
  reproduction with the module-drift caveat the spec itself decided.
- **Invariant #4 (hosts render, sims decide)**: `installTestHook` audited as
  the spec directed: its only sim-affecting capability is the wrapped
  `submit(Command)` (`test-hook.ts` — the hook object holds `world: IWorld`,
  the recording `submit`, `commandLog()`, `info`; nothing else). The browser
  harness drives real keyboard events and reads via the hook; no new
  mutation channel. `scenery()` is host-owned display state, not sim state.
- **Invariant #5**: no netcode/persistence/auth was hand-rolled anywhere in
  templates or scaffold output.
- **`Sim.snapshot()`**: on the concrete `Sim`, not `IWorld`, per the spec's
  recorded decision; plain-JSON, insertion-ordered, `v: 1`, no Rng state, no
  `restore()` — matches the evidence-not-restore-point contract exactly.
- **`replayVerdict` drift/divergence logic** (`packages/harness/src/index.ts`)
  reviewed for misdiagnosis risk: drift is only declared when the verdict
  *carries* a `setupStateHash` and the re-run setup hash differs — a
  command/checkpoint/finalHash tamper leaves setup untouched and correctly
  reaches exit 3; a missing `setupStateHash` (old verdict) skips the check
  rather than false-positiving. Sound. Two minor edges noted in section 6.
- **Templates' Rng discipline**: confirmed in source, not just comments —
  `generateWorldTerrain`/`generateWorldProps` (3d) and `generateWorldItems`
  (2d) all derive from `new Rng(seed).fork(label)`; `main.ts` in both
  templates regenerates independently; the only live-`sim.rng` use is the
  sim-side `hazard` fork inside `setup()`, which is correct.

## 5. The renderer-three camera surface (fix-list item 1, judged on merits)

The contested diff (`three-host.ts`): `createOrthographicCamera(viewHeight,
near?, far?)`, optional `ThreeHostOptions.camera`, `SceneContext.camera`
widened to `THREE.Camera`, and a projection-aware `resize()`.

(a) **Technical claim — TRUE.** `createThreeHost` defaults to the identical
`new THREE.PerspectiveCamera(60, 1, 0.1, 1000)` when `camera` is omitted, so
`apps/demo` and the 3d-world template (neither passes `camera`) get
byte-identical behavior. A repo-wide grep for `ctx.camera` / `.camera.` finds
exactly six call sites (demo + both templates), all using `position.set` and
`lookAt` — `Object3D` members available on `THREE.Camera` — so the type
widening breaks no consumer. Engine packages are unpublished (DESIGN
non-goal), so no out-of-repo consumer exists to break.

(b) **Justification — SOUND.** The host constructs, owns, and renders with
the camera; there is no way for a game's `syncScene` to substitute an
orthographic projection without either this option or grotesque hacks
(mutating a PerspectiveCamera's projection matrix by hand every frame).
Scope A's "orthographic camera on renderer-three — no new renderer package"
therefore *required* a renderer-three surface change the spec's own
contract-impact section failed to anticipate. The implementer chose the
minimal additive shape and flagged it prominently in the commit message.

(c) **Process — addendum required, escalation satisfied here.** WORKFLOW.md's
escalation rule literally names `IWorld`/`HostPort` and CLAUDE.md invariants;
this change is neither, so implementation latitude was arguable. But
PHASE-2.md's API-contracts preamble ("capability changes require a spec
addendum (a planning turn)") and exit criterion 12's enumeration are
explicit, and this gate blocked Phase 1 over a far smaller unflagged delta.
Consistency demands the same bar: the spec must be amended to match what
shipped. Since this review is itself the Fable turn, the addendum described
in fix-list item 1 is pre-approved — writing it is the entire remaining work.

## 6. Non-blocking observations

- **Ogg-Opus always takes the inconclusive path** (`gates/audio.ts`): the
  duration estimator requires a *Vorbis* identification header, so `.ogg`
  files carrying Opus (common) pass duration unchecked, capped only by
  `maxBytes`. Acceptable v0 once fix-list item 3's documentation is honest;
  revisit when audio assets become load-bearing.
- **`replayVerdict` edge cases** (`packages/harness/src/index.ts`): (1) in
  the drift branch, `actualFinalHash` actually carries the *setup* hash —
  labeled by `setupDrift: true` but mildly misleading as a field name; (2) a
  checkpoint whose tick exceeds `replay.ticks` is silently never compared
  (the final-hash comparison still gates, so this is theoretical). Neither
  is exploitable for a false `verified: true` on an untampered-ticks verdict.
- **3d-world player does not visually ground-follow**: `heightAt` informs the
  `moved` event payload, but the sim's `pos` is 2D and `main.ts` renders the
  player at fixed `y = 0.5`, so the cube floats where terrain rises. Scope
  A's "heightAt for ground-following" is only half-realized. The exit
  criterion's pixel check (terrain + player) passes regardless. Worth a
  template polish pass; not gating.
- **DEP0190 deprecation warning** on stderr in every `--browser` run
  (`browser.ts` spawns with `shell: true` + args). stdout purity is
  preserved, but Node is signaling a future behavior change and the pattern
  is injection-prone in general; switch to shell-free spawn when next
  touching the file.
- **`npm install` reports 2 vulnerabilities (1 moderate, 1 high)** in dev
  tooling — present on `main` too, not introduced by this phase; triage
  alongside the next dependency bump.
- **ROADMAP.md Phase 2 checkboxes**: tick at merge time (same reminder as
  Phase 1).

## 7. Resubmission

Address items 1–3 (item 1 and the item-3 decision can land as a single
PHASE-2.md addendum commit; item 2 is one small file plus an optional
`check-plugin.mjs` line — or a descoping line in the same addendum). Re-run:
`npm run build && npm run lint && npm run check:purity && npm run check:plugin && npm test`,
confirm `git diff main..phase-2 -- CLAUDE.md packages/core/src/types.ts`
is still empty, then return to this gate. No harness or browser re-runs are
required unless code beyond comments/docs changes.
