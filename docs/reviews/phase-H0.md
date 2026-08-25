# Phase H0 review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `hotel-phase-0` at `e485502`, diffed against `main` (5 commits, spec first).
Spec: [docs/PHASE-H0.md](../PHASE-H0.md).

All verification below was re-run by the reviewer. Nothing was taken on trust, including the four defects fixed during implementation.

## Verdict: FIX-LIST (1 blocking, 4 non-blocking)

The engineering substance of this phase is sound and verified: the integer/LUT determinism discipline genuinely holds everywhere sim state is computed, the synthetic-input seam is real (one shared path, verified in source and exercised live), `Sim.restore()` reproduces the hotel sim hash-exactly across a door-open snapshot boundary (reviewer repro below), all four prior-round defects are confirmed fixed by test evidence and a live screenshot, and every one of the six browser-gate runs executed — including a *failing* one — replayed headlessly to its live hash on both Chromium and Firefox.

But the flagship gate is **flaky at roughly 1-in-5**. A determinism gate that intermittently reds trains everyone to re-run it, which is how the last four defects shipped green. That is the one thing blocking merge.

### 1. [BLOCKING] `fps-look-interact` is flaky — 1 of 6 browser runs failed with zero `interact` commands captured

`scenarios/fps-look-interact.scenario.mjs`. Failing run (first attempt, Chromium): `passed: false`, `ticks: 101`, both assertions false; command log was 8 `move` + 2 `face` with **no `interact`**, where a passing run has 9 moves + 1 interact.

Cause: the wall-clock `KeyW` window (400–850 ms) lands on 8 or 9 sim ticks depending on scheduling, and with an unlucky move/tick composition the committed corrective look (`dx: 142`, derived for the 9-tick rest position 4871,2139) leaves the reticle off the door panel at click time, so `applyClick`'s raycast resolves nothing.

Note `replayCheck.verified` was `true` even on the red run (429032564 == 429032564) — the determinism half held; the *aim* half is what flakes. The spec anticipated this precisely, in risk 4: *"if flake persists, gate the click step on `world.tick` instead of wall clock (small harness change)."* It persists.

**Fix**: implement the spec's own mitigation — an optional tick-gated form of pointer step (e.g. `{ pointer: "click", atTick: N }`, scheduled off `__WORLDFORGE__.world.tick` like `pollUntilTick`) used for the look/click steps, with deltas re-derived for a deterministic tick count; or any equivalent change that makes the click fire from a known sim pose. Re-verify with ≥5 consecutive green runs per engine.

### 2. [NON-BLOCKING] Live commands are stamped one tick before their execution tick

`apps/hotel/src/main.ts` (`tickSim` → `controller.onTick`) and `packages/player-fps/src/index.ts` (`onTick` uses `world.tick`) stamp commands with the pre-step tick T; `sim.step()` then executes them in the step producing T+1. Headless replay (`replayToSim`) executes a stamped-T command in the step producing T.

The shift is uniform, so replay equivalence holds exactly for H0's command set (all six captured browser logs verified). But this is the same stamp≠execution-tick class that the phase-3 resubmission spent two rounds eliminating from the server (`sim.tick + 1` at drain), and any H1 rule that reads `c.tick`, correlates events to commands, or checkpoints per tick will be off by one. Also, a command stamped tick 0 is silently dropped by the replay loop (`t = 1..ticks`).

**Fix**: stamp `world.tick + 1` in the `onTick` pump (or have the factories stamp at submit), matching the server convention. Hashes here are stamp-shift-invariant, so nothing needs re-pinning.

### 3. [NON-BLOCKING] The `math-transcendental` ban does not cover `apps/hotel/src/game.ts`

The one sim-code file living outside `packages/` is exactly the file agents will edit most in H1. It is clean today (grep: only `Math.trunc/abs/max/min`, plus comments), but nothing mechanical keeps it so.

**Fix**: move the sim module to its own directory (e.g. `apps/hotel/src/sim/`) and add it as a `banTranscendentals` purity root, or extend `check-purity.mjs` to accept file-level roots. Do this before H1 adds NPC systems to that file.

*(An independent blind verification of this phase flagged the same gap unprompted.)*

### 4. [NON-BLOCKING] `check-purity.mjs` now silently skips missing roots

Previously a missing `PURITY_ROOTS` directory was exit 2; this phase changed it to `(skip) … not found` and continue, justified as a concurrent-development convenience. That convenience is over — both new roots exist on every checkout that will run this again — and the current behaviour means a future rename of `packages/space/src` silently disables its entire purity coverage while CI stays green.

**Fix**: restore exit-2-on-missing-root now that the phase has landed.

### 5. [NON-BLOCKING] The self-test's transcendental fixture is planted in `packages/core/src`, not `packages/space/src` as the spec specifies

Enforcement is equivalent (both are `banTranscendentals` roots scanned by the same code path, and the real scan covers space/interiors), and the assets not-flagged fixture is present as required. Either move the fixture to the spec's named root or record the substitution in the spec.

## Verification battery (all executed by the reviewer)

| Command | Result |
|---|---|
| `npm run build` | exit 0 (new core→space→assets→interiors→sweep ordering works from clean dist) |
| `npx eslint .` | exit 0 |
| `node scripts/check-purity.mjs` | exit 0 — all six roots clean, `space` and `interiors` listed |
| `node scripts/check-purity.mjs --self-test` | exit 0 — `Math.atan2` CAUGHT, `Math.floor` control NOT flagged, `Math.cos` in assets NOT flagged |
| `npm test` (smoke) | exit 0, hash **919868270** unchanged |
| `npm run test -w @claude-engine/core` | exit 0 — despawn, componentsOf, eventsSince binary-search vs reference filter, retention, pinned-hash stability |
| `npm run test -w @claude-engine/space` | exit 0 — **LUT regeneration byte-identical** (drift in generator or file fails); sinMdeg max error **1** Q16.16 unit (bound 3); atan2 max error **99** mdeg (bound 100); boundary angles, moveCircle slide/corner/door/never-inside-SOLID, losClear, roomAt, findPathCells, findRoute |
| `npm run test -w @claude-engine/interiors` | exit 0 — golden byte-identical (0xe96201ca); one-source-of-truth bijections with exact counts (338 wall quads == 338 boundaries; 40 door boundaries == 80 header quads); **doorway traversal 500/500 passable open, 500/500 blocked closed across 100 seeds**; connectivity 100/100 |
| `npm run test -w @claude-engine/assets` | exit 0 |
| `harness -- walk-collide --verify-replay` | exit 0 — 4/4 assertions, `replayCheck.verified: true` |
| `harness -- fps-look-interact --browser --verify-replay` ×5 | **4× exit 0 / 1× exit 1** (item 1). Passing verdict: both assertions true, `sim-tick-ms.avgMs` ≈0.028, `fps.avg` ≈31.8, feel checks pass, 0 console/page errors, screenshots at exactly ticks 5 and 50, `replayCheck.verified: true` on **every** run including the failing one |
| `… --browser-engine firefox` | exit 0 — both assertions pass, `replayCheck.verified: true`, fps.avg ≈240, sim-tick-ms ≈0.014 |
| `smoke` / `demo-walk` / `bots-headless` / `demo-visual --browser` | all exit 0 |
| `net-walk` / `net-interest` / `net-abuse` / `soak-ci --soak` | all exit 0 |

## Things the reviewer tried to break and could not

- **`Sim.restore()` on the hotel sim.** Repro against shipped dist: face+walk toward door0, `interact` opens it at tick 4, `snapshot()` at tick 5, walk *through the open doorway* ticks 6–20, versus fresh `setup()` → `restore(snap)` → same tail. Continuous 1714861700 == restored 1714861700; positions identical (`{4591,4622}`, physically past the door row); door open on both sides. A second repro toggling open-then-closed across the boundary was also hash-equal (1427772265). The mutable `open` crossing the snapshot boundary is exactly the state a closure would have dropped. **The no-closure-state rule is genuinely honoured** — `game.ts` captures only `floor`/`grid` (pure functions of `sim.seed`) and the setup-spawned player id; `isOpenAt` re-derives door cells from seed-pure `floor.portals` joined against `withComponent("door")` at call time.
- **The synthetic-input contract.** `syntheticPointer.lock/look/click` call `applyLockChange/applyLook/applyClick` — the identical functions the real pointer handlers call. Sensitivity, yaw accumulation, drift thresholding, the raycast against the real scene, command construction and the trace recorder are all downstream and shared. No code path exists that synthetic input takes and real input does not, or vice versa.
- **The four prior-round fixes, re-verified rather than trusted.** Door width confirmed by the 100-seed traversal test plus a live sim walk through door0. The vacuous-assertion fix is provably non-vacuous *because* the reviewer's failing run reported both assertions false and `passed: false` — the replay-evaluated assertions did the job the old hardcoded `[]` could not. Winding confirmed by the quad↔boundary bijections and a sealed-corridor screenshot. Headers confirmed at exactly 80/40 with the 2100 mm band visible above the open door. No trace of the old `player-fps` workarounds remains; the shipped `camera.rotation.y = yawRad + Math.PI` checks out against `moveSystem`'s `dz = fw·cos(yaw)` convention and `interactSystem`'s `atan2Mdeg(dx, dz)` bearing.
- **The cross-engine gate's actual strength.** The Chromium leg is V8-live vs V8-replay, so it proves the capture/replay plumbing, not trig portability. The **Firefox leg is the real proof**: a SpiderMonkey-live session replayed in V8 to an identical hash would break on any `Math.sin`-class divergence the session's angles touched. The spec's argument that the two live hashes need not match each other holds (observed finalTick 89 vs 71, different hashes, both self-consistent). Honest caveat: the gate's sensitivity is probabilistic in the angles a run exercises — the mechanical ban plus the LUT are the load-bearing guarantee, and the gate is executable defence in depth. That is the right layering, and both layers were verified independently.
- **Public contracts.** `verifyReplay`'s new 4th parameter is optional with a `scenario.ticks` fallback; the pre-existing 3-arg headless call behaves identically. `Sim`'s constructor options object is optional and retention defaults off; the pinned pre-change hash passes and every pre-existing scenario is green. `MeshDataWithColors` is a derived type so no existing consumer changes. `ThreeHostOptions`/`WorldforgeHook`/`installTestHook` additions are all optional. CLAUDE.md's diff is exactly the escalated invariant-2 wording, nothing else.
- **Scope discipline.** Held. No NPCs, textures, UVs, net wiring, stairs, save/load, or `screenClick` implementation. `findPathCells`/`findRoute` ship tested-but-uncalled exactly as ordered. The only unforced addition is the KeyV view toggle, which is within the phase goal and open question 5's latitude.

## Deferred into H1 (explicitly accepted, so they are not re-litigated)

- **Third-person boom clips through walls** — spec open question 4, documented in-source as accepted jank.
- **`isOpenAt` is O(doors × portal-cells) per blocked-cell probe** — nothing at 5 doors; when H1 guests run `findPathCells` with `isOpen` across many doors, index portals by cell (still derivable from the seed-pure `floor`).
- **Fixed-topology floorplan and the pinned golden hash `0xe96201ca`** — H1's bedrooms and front desk will change the generator; the golden is *supposed* to be re-pinned then, with the topology-agnostic property tests doing the real work.
- **Zero-thickness paired wall quads, 2D single-floor grid, `roomAt` via the rooms layer** — all correctly shaped for H1; nothing here needs tearing out.
- **`walk-collide`'s module-level recording closure** — scenario-local instrumentation, harmless today. Keep it out of any pattern documentation.
- **Wall-clock scheduling for keyboard steps generally** — item 1 fixes the click; the residual 8-vs-9-tick move variance is inherent to browser mode and is what headless replay exists to absorb.

## Resubmission

Address item 1 (the spec's own tick-gating mitigation) and re-run `fps-look-interact --browser --verify-replay` ≥5× consecutively on Chromium and ≥2× on Firefox — all exit 0, both assertions true, `replayCheck.verified` true in each verdict — plus one `walk-collide --verify-replay` and `npm test` for the smoke hash. Items 2–5 may land in the same pass (2 and 4 are one-liners) or be carried as recorded debt into H1's spec; but if item 2 is deferred, H1's spec must say so before any tick-reading rule is written.

---

## Round 2

*(appended after the fix pass)*
