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

Reviewer: Fable 5. Resubmission reviewed: `1d1cc58` ("Phase H0 fix-list round 1: all five items"), diffed against `f359eb7`. All numbers below re-run by the reviewer; nothing taken from the resubmission's own report.

### Verdict: FIX-LIST (round 2) — 1 blocking item

Items 2–5 are confirmed fixed with reviewer-generated evidence, and no regression exists anywhere in the battery. But item 1 is **not fixed on Firefox**: the reviewer's Firefox runs went red 2 of 5, a worse rate than the round-1 Chromium flake this fix was meant to remove. The tick-gating pinned the *end* of the KeyW window and left the *start* floating, so the walk length still varies with page-startup latency. Chromium happens to start fast enough that this never shows; Firefox does not.

### Run-by-run table (`fps-look-interact --browser --verify-replay`)

| # | Engine | Exit | Assertions | replayCheck | move cmds | interact | move ticks |
|---|---|---|---|---|---|---|---|
| 1–8 | Chromium | 0 | 2/2 | true | 9 | 1 | 1–9 |
| 1 | Firefox | 0 | 2/2 | true | 7 | 1 | 3–9 |
| 2 | Firefox | **1** | **0/2** | true | **3** | 1 | **7–9** |
| 3 | Firefox | 0 | 2/2 | true | 7 | 1 | 3–9 |
| 4 | Firefox | **1** | **0/2** | true | **4** | 1 | **6–9** |
| 5 | Firefox | 0 | 2/2 | true | 6 | 1 | 4–9 |

Every run, red or green, replayed to its live hash — the determinism half continues to hold perfectly. The Chromium leg is a genuinely identical command stream across all 8 runs (`face@1`, `move@1..9`, `face@10:14740`, `interact@10`); final-hash differences trace solely to run-length `ticks` 86/88/90, which replay absorbs.

### 1. [BLOCKING] Tick-gating pins the up-edge of the KeyW hold but not the down-edge; on Firefox the hold starts 2–6 ticks late and the gate reds ~2-in-5

**What the fix actually did, mechanically.** `pollUntilTick` (`packages/harness/src/browser.ts:298`) returns on `last >= tick`, so an overshot tick fires the step *late* rather than never — the silent-skip failure mode does not exist; every step always fires. Good. But the whole tick-event queue begins executing whenever `runInputScript` starts, and `{downAtTick: 0}` returns *immediately* with whatever tick the world has already reached. On Chromium the page is interactive before tick 1 every time (8/8). On Firefox the world is at tick 2–5 before the first dispatch lands: the first `face` was stamped at tick 3 or 6 across these runs, while `upAtTick: 9` is absolute — so the hold is *truncated* to 7, 6, 4 or 3 move ticks depending on startup latency. The scenario comment's claim of "exactly ticks 1..9 on every run, on every engine" is true only on Chromium, by luck of fast startup, not by construction.

**On the margin question.** The resubmission's arc-margin argument is wrong in kind. The passing Firefox runs walked 6–7 ticks instead of 9 — the click was aimed from rest positions hundreds of mm short of the derived one, and passed anyway because the reticle at that distance still lands on the door panel and the rest position is still inside the interactable's `radiusMm: 1500`. The failing runs (3–4 moves) *did* capture an `interact` command — the visual raycast still resolved the door — but the sim's revalidation rejected it out of range, so the door never opened and both assertions failed. The gate is passing on **range margin, not determinism**, and the variance window (3–9 moves observed) is far wider than the margin. This is the round-1 defect in a new coat: the aim/range half flakes while the replay half is perfect.

**Fix.** The floating edge must be eliminated, not narrowed. Two acceptable shapes: (a) a start barrier — the app's test hook holds the sim at tick 0 (or the harness delays sim start) until the input script signals armed, so `downAtTick: 0` genuinely means tick 0 on every engine; or (b) key steps become span-relative (`holdTicks: 9` from the *observed* dispatch tick) **and** the corrective look is issued relative to the observed rest state — but (b) reintroduces derivation coupling, so (a) is strongly preferred and is a small hook/harness change. Re-verify with at least 8 consecutive greens on Chromium and 5 on Firefox, and the Firefox runs must show a **constant** move count, not a green streak over a varying one.

### Items 2–5: confirmed fixed (reviewer's own evidence)

- **Item 2 (stamp tick).** All three `submit(opts.make…(world.tick + 1, …))` sites confirmed in `packages/player-fps/src/index.ts`; `apps/hotel/src/main.ts` still orders `onTick` before `sim.step()`, so `world.tick + 1` is the true execution tick, matching the server drain convention. Observed live: the first command is now stamped tick 1, so nothing can land in the tick-0 slot that `replayToSim`'s `t = 1..ticks` loop drops. Smoke hash 919868270 unchanged, as a uniform stamp shift predicts.
- **Item 3 (hotel sim purity root).** `apps/hotel/src/sim` appears in the real scan output. Adversarial plant against a mirrored copy: the checker named it by file and line and exited 1. Repo untouched.
- **Item 4 (exit 2 on missing root).** Confirmed by mirroring the script with no roots present: exit code 2, root named.
- **Item 5 (self-test fixture location).** `testTranscendentalBan('packages/space/src')` at `scripts/check-purity.mjs:352`; `--self-test` passes with the fixture CAUGHT in the spec's named root and the `Math.floor` / assets negative controls intact.

### Regression battery (all re-run, all green)

`npm run build` 0; `npx eslint .` 0; `check-purity` 0 (seven roots including the new one); `--self-test` 0; `npm test` hash 919868270; core/space/interiors/assets suites all 0; `walk-collide --verify-replay` 0 (4/4, verified); `smoke`, `demo-walk`, `bots-headless`, `net-walk`, `net-interest`, `net-abuse`, `soak-ci --soak` all 0; `demo-visual --browser` (the untouched wall-clock scheduler) 0.

The mixed-queue design (`Promise.all([runMsEvents(), runTickEvents()])`) was read for starvation: both loops await only their own timers/polls plus per-event dispatch, neither blocks the other, and the sequential tick queue's declaration-order processing is correct for repeated same-tick gates. `git status --porcelain` empty at review end.

### Deferrals added to the H1 list

None beyond round 1's. The Firefox variance is **not** deferred — it is the blocking item, because this gate is the phase's flagship and a 2-in-5 red on one of the two engines it explicitly claims is exactly the re-run-until-green training that round 1 blocked on. Had the rate been a rare tail rather than 40%, deferral-with-trigger might have been defensible; it is not.

### Resubmission

Fix item 1's floating down-edge (start barrier preferred). Re-run the gate at least 8× Chromium and 5× Firefox, all exit 0, all with a constant move count and one interact; plus one `walk-collide --verify-replay` and `npm test`. Items 2–5 are closed.

---

## Round 3

Reviewer: Fable 5. Resubmission reviewed: `1c591a0` ("Phase H0 fix round 2: close the start-barrier race properly"), diffed against `c7a1256`. Given that two prior attempts reported all-green tables that did not reproduce, every number below was re-generated by the reviewer; the submission's own 6+8 table was not counted toward the bar.

### Verdict: PASS

The blocking item is fixed, and fixed at the level round 2 demanded: 20 of 20 reviewer runs (10 Chromium, 10 Firefox) produced a **byte-identical command stream** — 9 `move` commands spanning exactly ticks 1–9, `face@1`, corrective `face`, one `interact@10` — not a green streak over a varying count. Items 2–5 remain closed, the full regression battery is green, and `git status --porcelain` is empty. The phase is clear to merge to `main`.

### Run-by-run table (`fps-look-interact --browser --verify-replay`)

| # | Engine | Exit | Assertions | replayCheck | move cmds | move ticks | interact | runTicks / final hash |
|---|---|---|---|---|---|---|---|---|
| 1–10 | Chromium | 0 ×10 | 2/2 ×10 | true ×10 | **9 ×10** | **1–9 ×10** | 1 @10 ×10 | 87–95; hash varies with run length only |
| 1–10 | Firefox | 0 ×10 | 2/2 ×10 | true ×10 | **9 ×10** | **1–9 ×10** | 1 @10 ×10 | 70 or 71; exactly two hashes, one per run length |

Final-hash variation traces solely to how many idle ticks elapse after the door opens before shutdown, which replay absorbs — the input-driven prefix is identical in all 20 runs, on both engines. Firefox, previously the 40%-red engine, is now the *more* stable of the two.

### Mechanism judgment: correct by construction at tick 0, bounded-late elsewhere

Read in full: `runInputScript` (`packages/harness/src/browser.ts:422`), the barrier in `packages/renderer-three/src/test-hook.ts`, and the pause guard in `apps/hotel/src/main.ts` (`tickSim` returns before `controller.onTick` while `startBarrier` is unreleased).

- **Tick-0 ordering is now structural, not probabilistic.** The sim provably cannot step before release (the app's `tickSim` is a no-op while paused; the accumulator drains empty ticks, so no catch-up burst on release), and `runInputScript` dispatches every `atTick`/`downAtTick === 0` step **and awaits each round-trip** before calling `releaseBarrier`. There is no window in which the sim runs and the tick-0 state has not landed. This is the round-2 defect eliminated in kind, not narrowed.
- **All paths checked.** Empty input → release-and-return. Wall-clock-only steps → `needsStartBarrier` is false, no query flag, app never pauses (verified live: `demo-visual --browser` and `demo-walk` both exit 0; `demo-visual`'s URL gets no param). Tick-gated-only and mixed → tick-0 split runs first, release exactly once, remainder via the unchanged ms/tick queues. No path releases twice (single call site, guarded by `needsStartBarrier` ⇒ non-empty input) and no path never-releases short of a thrown `page.evaluate`, which aborts the run rather than hanging it.
- **No state smuggled past replay.** While paused, `controller.onTick` never runs, so pre-release input produces zero commands; DOM/controller key state is host-side only. The first step after release stamps `world.tick + 1 = 1` — every captured log begins at tick 1 (observed in all 20), nothing lands in the tick-0 slot replay drops, and `replayCheck.verified` was true on all 20. Replay equivalence is untouched.
- **The missing-barrier path fails fast.** Reviewer-built probe scenario (scratchpad, repo untouched): a tick-gated step against `@claude-engine/demo`, whose hook has no barrier → `BrowserInfraError` naming the flag and the fix, exit 2, in 7 seconds. Not a hang.
- **Honest residual.** Non-zero tick gates (`upAtTick: 9`, the corrective look and click) still ride `pollUntilTick`'s 16 ms polling against 50 ms ticks — late-not-never, so a pathological GC pause could in principle land the key-up at tick 10 and produce a 10-move run. That would *fail the constancy bar visibly*, not silently pass on margin, which is the correct failure shape; 0 occurrences in 20 runs. So: **tick 0 is correct by construction; ticks ≥1 are bounded-late with roughly 3× sampling margin.** The next session should know the distinction, but it does not block — the down-edge race that produced variable walk lengths is gone structurally.

### Items 2–5: remain closed

Item 2: all three `world.tick + 1` stamp sites present in `packages/player-fps/src/index.ts` (lines 247/262/270); first captured command tick 1 in all 20 runs. Item 3: `apps/hotel/src/sim` scanned in the real purity run. Item 4: `check-purity.mjs:435–437` exits 2 on a missing root. Item 5: `--self-test` shows `Math.atan2` planted in `packages/space/src` CAUGHT, with the `Math.floor` and assets negative controls intact.

### Regression battery (all re-run, all green)

`npm run build` 0; `npx eslint .` 0; `check-purity` 0 (seven roots); `--self-test` 0; `npm test` hash 919868270; core/space/interiors/assets suites 0; `walk-collide --verify-replay` 0 (4/4, verified); `smoke`, `demo-walk`, `bots-headless`, `net-walk`, `net-interest`, `net-abuse`, `soak-ci --soak` all 0; `demo-visual --browser` 0. `git status --porcelain` empty at review end.

### Final consolidated H1 deferral list (write the H1 spec from this)

1. **Third-person boom clips through walls** — accepted jank, documented in-source (spec open question 4).
2. **`isOpenAt` is O(doors × portal-cells) per blocked-cell probe** — index portals by cell before H1 guests run `findPathCells` with `isOpen` across many doors.
3. **Fixed-topology floorplan / golden hash `0xe96201ca`** — H1's generator changes re-pin the golden; the topology-agnostic property tests carry the real weight.
4. **Zero-thickness paired wall quads, 2D single-floor grid, `roomAt` via the rooms layer** — correctly shaped for H1, keep.
5. **`walk-collide`'s module-level recording closure** — harmless; keep it out of pattern documentation.
6. **Wall-clock scheduling for keyboard steps generally** — inherent browser-mode variance; headless replay absorbs it. Any *future* scenario needing per-tick exactness must use tick gating plus the start barrier, per this round.
7. **`pollUntilTick`'s bounded-late dispatch for non-zero tick gates** (new this round). Recorded debt. Trigger: if any tick-gated scenario ever shows a command landing one tick after its declared gate (e.g. a 10-move run of this gate), replace polling with an in-page tick-subscription hook rather than tightening the poll interval.
8. **The start barrier is opt-in per app via the `worldforgeStartPaused` query flag** (new this round). Recorded debt. Trigger: the first H1 app or scenario that adds tick-gated input against an app other than hotel must wire `startPaused` at that moment — the harness's exit-2 guard (verified live) will name the omission.

**Phase H0 is clear to merge to `main`.**
