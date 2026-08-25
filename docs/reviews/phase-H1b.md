# Phase H1b review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `hotel-phase-1b` at `61188ee`, diffed against `main` (7 commits).
Spec: [docs/PHASE-H1.md](../PHASE-H1.md) — **H1b scope only** (surface-ui, save-web, the HOTELSOFT shell with RESERVA and AUDIT, screen focus/input routing, harness `screenClick` + readability probe, gates 4 and 5). H1a is merged and was not re-litigated except where this diff touches it.

All verification below was re-run or re-derived by the reviewer. None of the seven implementation-time defect fixes, and none of the four implementer-flagged judgment calls, were taken on trust. Perturbations were applied to gitignored build outputs only and reversed by clean rebuilds (`rm -rf dist` first — `tsc` incremental skips dist-only mutations, per the H1a review's note, and it bit once here too). `git status --porcelain` empty at review end.

## Verdict: FIX-LIST (1 blocking, 6 non-blocking)

The engineering substance is real and holds under attack: the readability probe's headline number is **honest** (reviewer-measured 1.3797 against reported 1.3800), both new gates went red under reviewer perturbation on exactly the targeted assertion, the synthetic/real screen-click seam is one code path in source, the tick-queue fix answered H0 deferral 7's named trigger with exactly the prescribed shape, command streams are byte-constant across engines at the round-3 bar, and every scenario in the repo — headless and browser, Chromium and Firefox — replays to its live hash.

But the phase's own goal sentence — the player "clicks ACCEPT/DENY/room assignment on the screen" — describes a code path that **no test or gate anywhere exercises**. Given that this very phase's defect 2 was "screen clicking had never worked for a human while every gate stayed green," shipping the flagship decision path with zero repeatable verification is the same failure shape waiting to recur. It works today (reviewer repro below proves it); nothing keeps it working. That is the one blocking item, and it is cheap to close.

### 1. [BLOCKING] RESERVA's decision path — room click → ACCEPT/DENY → `desk.decision` effect → check-in — has zero test coverage anywhere

`apps/hotel/src/sim/reserva-app.ts`, `apps/hotel/scripts/test.mjs`. Grep-verified: `reservaApp.reduce` is imported by the hotel test suite **only** for `paintSpec` (the overflow gate); no test and no scenario ever submits a `screen.click` that lands on a room row or the ACCEPT/DENY rects, and `screenSystem`'s effect-application branch (`effect.type === "desk.decision"` → `applyDeskDecision`) never executes under any verification. `reserva-readability` clicks only taskbar buttons, at a tick when "No guest presenting" is on screen (confirmed in the gate's own screenshot). The H1a fraud/rush gates drive `applyDeskDecision` only through the `deskSystem` command form, bypassing the shell, the app's hit-testing, and the effect plumbing entirely.

The reviewer drove the path by hand against the shipped dist (scratchpad, repo untouched): seed `hotel-h1-rush-1`, guest reaches `presenting` at tick 157, an operator actor focuses the terminal via `interact`, then two `screenClickCommand`s at rects taken from `hotelShell.layout()` (`app:room:8` at {8,220,150,18}, `app:accept` at {8,440,96,18}) → `screen.actionTaken` ×2, `guest.checkedIn@160`, reservation `{decided:true, accepted:true, room:8}`, `selectedRoomEntity` reset to 0. **The path works.** It is merely unguarded — a regression in `hitRect` wiring, `layoutRects`, the accept-guard, or the effect re-application would ship with every gate green.

**Fix:** a headless test in `apps/hotel/scripts/test.mjs` doing exactly the reviewer's repro (spawn an operator with a `player` component in range/arc, focus, click via `layout()`-derived coordinates — never hardcoded pixels — assert `guest.checkedIn`, the reservation fields, and the DENY branch symmetric with `desk.fraudCaught` on a planted guest). This also finally exercises the flagged direct-call design under test. No browser run needed; the seam from synthetic click to `screen.click` is already certified by gate 5.

### Non-blocking items

2. **[NON-BLOCKING] The shell's own calibration glyph row overflows the surface, and the overflow gate never scans shell chrome** — `packages/surface-ui/src/shell.ts` paints `"AaBbCc123"` at `x = CALIB_RECT.x = 600`; 9 glyphs × 8 px = 72 px, running to x = 672 on a 640-wide surface. Visible in the gate's own screenshot: the row reads "AaBbC". `findOverflowingNodes` — written *because* clipped text on this terminal is a gameplay defect — is run over `reservaApp.paintSpec` and `auditApp.paintSpec` worst cases but never over the composed `hotelShell.paintSpec` tree, which is the only place shell chrome exists. The probe is unaffected (it samples only the checkerboard, fully on-surface at 600–632). Fix: run the overflow gate over the composed shell tree, and shorten or move the reference row.
3. **[NON-BLOCKING] `save-restore`'s replay equivalence rests on an undocumented coincidence, and a quick-load leaves the persisted log a two-branch chimera.** The captured log contains moves 43–80 that the live sim *discarded* at restore; replay (which never restores) applies them. `replayCheck.verified` is true only because the player is pinned against a wall by tick 10, making those moves state no-ops — the scenario comment records the pinning but not that replay equivalence *depends* on it. Any future save scenario with effective post-save input will exit 3 with no warning why. Separately: after F9 the pump keeps appending to `GAME_ID` at rewound ticks interleaved with the abandoned branch's records, so `recoverSim(GAME_ID)` would reconstruct a state that is neither branch. **Latent today** — `main.ts` never recovers at boot — but Phase 2's load menu is exactly the trigger. Fix then: switch the live game id to the imported one on quick-load (or truncate), and document the no-op dependency in the scenario now. Also add `--verify-replay` to CI's `save-restore` line (it passes; the reviewer ran it three times) so a future violation fails loudly in CI.
4. **[NON-BLOCKING] The in-page tick queue is installed *after* the start barrier releases, and an undrained queue is not an error** — `packages/harness/src/browser.ts`: `releaseBarrier()` runs at the tick-0 boundary, then `runTickEvents()` installs `__WORLDFORGE_TICK_QUEUE__` via a separate round trip. A step gated on tick 1–2 could be installed after its tick has passed and fire late — the round-2 race's shape, currently masked by margin (earliest non-zero gate in any scenario is tick 16). Install the queue before release; it is independent of tick-0 dispatch. Also, the drain check throws only on `errors` — an app that wires the barrier but forgets `hook.notifyTick` gets silently undispatched input and a misdiagnosed assertion failure instead of an exit-2 `BrowserInfraError` naming the omission. One `if (pending > 0) throw` closes it.
5. **[NON-BLOCKING] `debug.saveRestoreRecord` is a hash-affecting command reachable in the production sim** — `saveRestoreDebugSystem` accepts it from any actor with no validation; CLAUDE.md says no dev/debug commands reachable from production builds. Accepted for H1b (see the ruling); the hard trigger is MP wiring: the server's command validation must reject `debug.*` types before any remote actor exists. Recorded in the Phase-5 preconditions.
6. **[NON-BLOCKING] `registeredGuestInteractables` survives a quick-load with stale ids** — `apps/hotel/src/main.ts`. `Sim.restore()` rewinds `nextEntity`, so post-load spawns reuse ids already in the Set; the new guest's rig is created but `registerInteractable` is skipped, leaving the controller's raycast list pointing at a pruned `Object3D` — a real player cannot click that guest to trigger `presenting`. Host-only. Fix: clear entity-keyed host registries in `quickLoad()`.
7. **[NON-BLOCKING] Stale comment in `render/screens.ts`** — a paragraph describing a mesh nudge that no longer exists; the fix correctly moved into the generator. Delete it — it documents the rejected approach as if it shipped, which is exactly the two-sources-of-truth confusion the real fix eliminated.

## Verification battery (all executed by the reviewer)

| Command | Result |
|---|---|
| `npm run build` / `npx eslint .` | exit 0 |
| `node scripts/check-purity.mjs` | exit 0 — eight roots clean incl. `packages/surface-ui/src (excluding src/host)` |
| `check-purity --self-test` | exit 0 — `Math.random` planted in `surface-ui/src` CAUGHT; `three` planted in `src/host` correctly EXCLUDED |
| `npm test` (smoke) | exit 0, hash **919868270** unchanged |
| all package suites | exit 0. Interiors golden re-pinned `0x752bc750`, terminal-anchor property rewritten to "at the desk, clear on all four sides", 100/100 seeds. surface-ui: font atlas byte-identical regeneration. save-web: fake-indexeddb round-trip against the real compiled hotel sim incl. slow-store wrapper. harness: PNG decoder exact, `analyzeReadability` on synthetic blurred/blank images |
| the four H1a gates + `walk-collide`, `--verify-replay` | all exit 0, all replay-verified. Hash changes vs H1a trace to `screenApp.state = hotelShell.init()`, as expected |
| `reserva-readability --browser --verify-replay` ×4 Chromium, ×1 Firefox | all exit 0, 5/5, replay-verified; **byte-identical 20-command stream on all five runs, both engines**. Probe: texelScale 1.3800, calibContrast 241.3, calibPitchErr 0 |
| `save-restore --browser --verify-replay` ×3 | all exit 0, 3/3, replay-verified; constant 69-command stream |
| `fps-look-interact --browser --verify-replay` ×2 Chromium, ×1 Firefox | all exit 0, replay-verified, constant 12-command stream |
| `demo-visual --browser --verify-replay` | exit 0 — survives `--verify-replay` for the first time; it previously ran a different world than it declared |
| `smoke`, `demo-walk`, `bots-headless`, `net-*`, `soak-ci --soak` | all exit 0 |

## The probe honesty check (done independently)

The one gate that reports a number was measured against reality, not read back from itself. The reviewer decoded `tick-38.png` with the harness's own `decodePng` and scanned raw pixels: the RESERVA panel spans screen x 198–1080 on both a mid and a high row → 883 px / 640 = **1.3797** against the hook's reported **1.3800** (0.02%, projection rounding). The calibration checkerboard was located independently at x 1027–1070 (predicted from `rect.x + 600·1.38 = 1026`) with 32 full-amplitude luma alternations.

Defect 5's failure mode — a `screenRect` reporting a texelScale the pixels contradict — is not present. Note the probe does not *independently* derive texelScale from pixels; but a lying texelScale mis-pitches the checkerboard sampling and fails `calibPitchErr`, so a large lie cannot pass. That cross-check plus this manual measurement is adequate.

## Gate non-vacuity, by reviewer perturbation (both restored)

1. **Gate 5, illegible-not-blank:** the built `screen-quad.js` edited to `LinearMipmapLinearFilter` + mipmaps — the classic "colourful but unreadable" screen. Exit 1, `calibContrast` 241.3 → **40.8** against the 60 floor, texelScale untouched at 1.38. The gate fails on exactly the illegibility axis its design argument predicts.
2. **Gate 4, no-op load:** `core`'s `restore()` neutered browser-side only. Exit 1 with assertions 1–2 green and **exactly assertion 3 red** (`savedHash !== restoredHash`), replay still verified — the marker was recorded but the load did nothing, and the gate saw it. Two-undefined-hashes vacuity is impossible by construction: assertion 1 requires the component, assertion 2 requires both hashes to be numbers before assertion 3 compares them.
3. **Gate 5's default-app trap:** RESERVA is `apps[0]`, so `openAppId === "reserva"` from cold start — the AUDIT-first/RESERVA-second click order plus the two pinned `screen.appOpened { appId }` assertions mean the final state can only read "reserva" because both in-world clicks landed. Sound.

## What the reviewer tried to break and could not

- **The synthetic/real screen-click seam.** Source-verified end to end: `main.ts`'s canvas click handler raycasts and calls `controller.applyScreenClick(u, v)`; `syntheticPointer.screenClick` calls the same function; both flow through the one `uvToPixel` + `makeScreenClick` pair, queued and submitted from `onTick` **before** the `!locked` gate (defect 2's fix, with movement and world-interact correctly still behind it). No path exists that one kind of click takes and the other does not.
- **Determinism.** `screenApp.state` is integers and strings all the way down; `uvToPixel` floors host-side so no float crosses the boundary; `paintSeq` is a counter, never a content hash; iteration is insertion-ordered over deterministically-built records. Purity scan clean over `surface-ui/src` with the host exclusion self-tested. Every gate replayed to its live hash, including Firefox legs.
- **Persistence.** `GameStore` unchanged; `[gameId, tick, idx]` keys with the idx counter maintained inside the append transaction; `commandsSince` order structural via the bound cursor; `apps/hotel/src` contains zero IndexedDB references (mechanical grep). Write-ahead is real: `pump.submit` pushes to the in-memory WAL synchronously *before* handing the command to the sim, appends serialized on a flush chain, `snapshotNow` flushes first so a snapshot never precedes its own commands.
- **The tick queue.** Drain is in-page and synchronous; entries run at-most-once; late entries run late rather than never. Exact by construction for steps whose gate tick exceeds the install latency — the install-after-release ordering (item 4) is the honest residual, same class as H0 round 3's "tick 0 structural, ≥1 bounded" note, one line from closure.
- **H0 deferral 7's trigger response.** The trigger fired in `save-restore` exactly as round 3 predicted, and the response is the prescribed fix verbatim — an in-page tick subscription, not a tightened poll.
- **The harness seed guard.** Verified in-page (mismatch → exit-2 naming the wiring), and it immediately caught the pre-existing `demo-visual` seed lie. The right pattern: the fix that makes the whole class unshippable, not the instance patch.

## Rulings on the implementer-flagged items

1. **`screenSystem` calls `applyDeskDecision` directly instead of re-submitting the effect** — **upheld.** The stated impossibility is real: `commands()` returns the live `pendingCommands` array and `step()` clears it, so a command pushed by system 9 is gone before system 8 could see it. Replay-exactness is verified structurally (the `screen.click` is in the log; replay re-runs `screenSystem`, which deterministically re-derives the effect) and the browser gates replay green. The shared function *is* the one validated path. The spec's wording was wrong about the engine's drain semantics; the deviation is the correct engineering. **But see blocking item 1: this path ships untested.**
2. **`SaveRestoreDebug` in the sim** — **accepted for H1b, with a hard MP trigger.** A hook-only probe is structurally invisible to replay-evaluated assertions, so gate 4 genuinely needs replay-visible state, and the lazily-created singleton perturbs nothing (all H1a goldens re-verified with the system registered). The CLAUDE.md tension is real: in SP the only submitter is `quickLoad()` and a local user can submit anything anyway; in MP it is a griefable ingress. Server command validation must reject it before any remote actor exists.
3. **`recoverSim` via deep subpath** — **upheld.** The barrel genuinely top-level-imports `better-sqlite3`/`pg`; `recover.ts` imports only core plus type-only store types; persistence has no `exports` map, so the subpath is legal and works. Still a brittle spelling of a real fact: add an `"./recover"` exports subpath when Phase 2 next touches that package.
4. **`registeredGuestInteractables` not purged across restore** — confirmed real, recorded as item 6. Credit for flagging it unprompted.

## The H1a items and deferral list, audited

| # | H1a item | What H1b did | Verdict |
|---|---|---|---|
| deferral 1 | Delete `temp-font-painter.ts`, one painter | Deleted; documents repaint through the committed-atlas painter; zero `fillText` anywhere | **closed** |
| deferral 2 | Terminal is the first decision input, no fallback | True, and it works — but shipped with no coverage (blocking item 1) | **closed with a defect** |
| deferral 3 | `spawnTickMax`: enforce or delete | Deleted, with correct reasoning that enforcement would perturb golden-verified spawn streams | **closed** |
| H1a item 3 | `plantViolation` `listed` branch | Untouched — Phase-3 trigger, correctly carried | carried |
| deferrals 5–8 | space A* extraction, sidestep coverage, indexSystem targets, doors | Untouched, correctly carried | carried |
| H0 item 7 | `pollUntilTick` bounded-late | **Trigger fired; fixed with the prescribed in-page tick subscription**; residual in item 4 | closed (residual recorded) |

## Foundation for Phase 2 — sound, with named seams

- **Retro texture pipeline:** the screen texture already carries its exclusion flag — the exemption seam exists before the pipeline does. Correct order.
- **More HOTELSOFT apps:** the shell's registry plus `available(appId, view)` is the escalation surface the spec designed; a new app is a `ScreenAppDef`, one registration and an overflow-gate entry. `ScreenViewData` held to 3 keys against a ≤5 budget; the kitchen-sink risk did not materialise.
- **First-hire beat:** `clerkBot`'s `decide` is game-supplied and `focusedBy` is per-actor through the same validated seams — a hired clerk NPC is an actor plus nav, not a rearchitecture.
- **Audio:** binds to `eventsSince` as B8 plans; this phase's new events are already assertion vocabulary, so sound triggers get gate-tested facts for free.
- **Save UI / load-on-boot:** needs `listGames`/`deleteGame`, the `"./recover"` subpath, the quick-load branch-mixing fix, and a host-registry reset seam. All four named, none structural.

## Consolidated deferral list for Phase 2 (start from this)

1. **Blocking item 1's test lands before merge** — thereafter it is the pattern for every new screen app's decision coverage.
2. **Quick-load persistence semantics** (item 3): before any load-on-boot or save UI, switch the live game id on quick-load (or truncate), add `listGames()`/`deleteGame()` (⚠ additive, review turn), and an `"./recover"` exports subpath. Add `--verify-replay` to CI's `save-restore` line now.
3. **Host caches vs `Sim.restore()`** (item 6): a general "reset entity-keyed host state" seam, exercised the first time a load menu exists.
4. **Tick-queue hardening** (item 4): install before barrier release; throw on undrained `pending`. Trigger: the first scenario gating a step at tick ≤ 5, or the first tick-gated scenario against a non-hotel app.
5. **`debug.*` command rejection in server validation** (item 5). Trigger: MP wiring, Phase 5 preconditions.
6. **Shell-chrome overflow coverage + the clipped glyph row** (item 2) — with the next surface-ui touch.
7. **Carried from H1a unchanged:** `space` clearance-aware A* extraction; sidestep-branch assertion before crowd density rises; per-tick scan and A*-allocation refactor targets for `indexSystem` (`checkin-rush` avgTickMs now 0.030 at ~60 entities — the number to beat); `plantViolation` `listed` branch before MAILBOX; guests-never-close-doors; boom clip.
8. **Scenario comments as load-bearing docs:** `save-restore` must state the pinned-pose no-op dependency; the stale offset paragraph in `render/screens.ts` deleted.

## Resubmission

Land item 1's headless decision-path test (assert both ACCEPT and DENY branches, coordinates derived from `layout()`), plus whichever of items 2–7 land cheaply in the same pass. Re-run: the hotel suite, `npm test`, one `reserva-readability --browser --verify-replay` per engine, one `save-restore --browser --verify-replay`. Items not landed carry to the Phase 2 list.
