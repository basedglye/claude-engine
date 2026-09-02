# Phase H2b review — step-3 gate verdict

Reviewer: Fable 5.1 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `hotel-phase-2b` at `44549ef`, diffed against `main` at `28e554a` (10 commits, +8,124/−205 across 57 files).
Spec: [docs/PHASE-H2.md](../PHASE-H2.md) — **H2b scope only** (§1's split ruling; H2a is merged and was not re-reviewed except through its goldens). Also reviewed against: CLAUDE.md's six invariants including invariant 6 (write-through), the H2a review's consolidated H2b deferral list, and [docs/PHASE-H2C.md](../PHASE-H2C.md) (written by a concurrent planning session — its now-moot items are ruled on below).

All verification below was re-run by the reviewer. No numeric claim in any commit message, handoff, or scenario comment was taken on trust; where this review quotes a number, this review measured it. Perturbations were chosen independently of the implementer's list. **Every perturbation was applied to SOURCE, not to built output** — see non-blocking item 6 for why the H2a review's dist-perturbation method no longer works on browser gates — and every restore was `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game` followed by a clean rebuild and a re-verified green run. `git status --porcelain` empty at review end.

## Verdict: FIX-LIST — 1 blocking item, 7 non-blocking

**The engineering in this phase is sound, and I could not break it.** Every mechanical gate I attacked bit precisely and on exactly the assertion it was built to protect. The invariant-2 assertion that §1 makes this review's first act passes completely, and I verified it two levels deeper than the branch claims it (below). Purity, determinism, the audio boundary, the `ScreenViewData` budget, the deferral ledger, and both public-contract deviations are all clean or defensible.

**What blocks is the one deliverable a machine cannot check and this phase must hand to a human: the four look-lock screenshots.** §11 makes them the input to Chris's sign-off, and PHASE-H2C item 1 already scheduled them for re-capture. They have not landed in a signable state — two of the four do not depict the subjects the spec names, and three of the four are not reproducible run to run. Asking for a sign-off against them would spend Chris's turn on artifacts that fail §11's own stated test. That is the whole of the fix-list; everything else is non-blocking.

This is not a quality judgement on the look, which is Chris's call and not mine. It is that the evidence package the sign-off consumes does not yet show what it claims to show.

---

## The review's first act — byte-identical headless goldens (spec §1, gate 10)

`npm run check:goldens` — **12/12 OK, exit 0**, every scenario under `--verify-replay`:

| scenario | hash | scenario | hash |
|---|---|---|---|
| smoke | **3849639990** | fraud-catch | 1548146672 |
| checkin-rush | **1978775531** | fraud-catch-b | 2021951628 |
| one-man-week | **3423109909** | zen-clean | 312638063 |
| demo-walk | 1289360534 | first-hire | 4132986008 |
| bots-headless | 4146301557 | escalation-stars | 2672628845 |
| walk-collide | 2817230563 | corridor-headon | 2843227394 |

The three bolded values are the ones the H2a review pinned and the handoff restates. All three are exact.

**I did not stop at running the sweep, for two reasons, and both checks came back clean.**

1. **The sweep is not self-certifying.** `scripts/golden-sweep.mjs` genuinely compares against a `PINS` table and exits 1 on any mismatch (verified by reading it, and independently by the perturbation in P2 below, which reds a pinned hash). It is not a script that prints whatever it computes.

2. **Nine of the twelve pins were self-declared as "measured at the H2b boundary", not carried from the H2a review record** — and the file header's honesty about that is undercut by the commit graph: `golden-sweep.mjs` was introduced in `eded0c8`, *the same commit that first edits `apps/hotel/src/sim/game.ts`*. The working-tree ordering the header describes is not in git, so the record cannot prove those nine were measured against an unmodified sim. **So I measured them myself.** I installed and built the H2a merge commit `28e554a` in a separate worktree and ran all eleven fast scenarios there under `--verify-replay`:

   > demo-walk 1289360534 · bots-headless 4146301557 · walk-collide 2817230563 · corridor-headon 2843227394 · fraud-catch 1548146672 · fraud-catch-b 2021951628 · zen-clean 312638063 · first-hire 4132986008 · escalation-stars 2672628845 · smoke 3849639990 · checkin-rush 1978775531

   **All eleven match the pins exactly.** The nine "measured" pins are hereby upgraded to H2a-committed truth, verified against the merge commit rather than asserted from a comment. `golden-sweep.mjs`'s header should be corrected to say so (non-blocking item 5).

### The mesh / non-mesh separation — the proof that the art diff carried zero sim-visible data

The interiors MESH golden re-pinned three times this phase (`0x752bc750` → `0xbf2459e0` → `0xef96f6ec` → `0x95618e02`), each re-pin documented with its cause. That is expected and named in the spec. The load-bearing claim is that `NON_MESH_GOLDEN_HASH` — covering `grid`/`rooms`/`portals`/`doors`/`spawn`/`desk`/`entranceDoorIndex`/`bedrooms` — did not move across any of them.

**Verified independently, not from the comment.** I computed `serializeNonMeshFields` over `generateGroundFloor("hotel-h0-look-1")` on the **pre-H2b tree at `28e554a`**:

```
BASELINE(28e554a) non-mesh hash: 0x3ea4ca5
H2b pinned NON_MESH_GOLDEN_HASH:  0x03ea4ca5
```

Identical. The entire H2b art diff — planar UVs, the vertex-colour lighting bake, the per-face directional term, the half-texel gutter, three mesh re-pins — provably carried **zero** sim-visible data. This is the strongest single result in the phase, and it is now established against the baseline rather than against a commit message.

**Invariant 2 is intact for the whole art/audio surface.**

---

## BLOCKING

### 1. [BLOCKING] The four look-lock screenshots do not depict their spec'd subjects, and three of the four are not reproducible. The §11 sign-off cannot be performed against them.

Spec §11 names the four shots: **lobby wide, corridor, bedroom with mess props, focused terminal**. PHASE-H2C item 1 recorded that the committed screenshots "are not yet the four poses the sign-off signs" and put the re-capture in lane 3, "before any sign-off". `art-lock` is now green on both engines — the *gate* is fixed — but the *evidence package* was not brought with it.

**(a) Two of the four do not show their subject.** I viewed all four committed PNGs and the freshly captured equivalents from my own runs:

- `h2b-look-1-lobby.png` — **passes.** Reads immediately as a room: ceiling, wall and floor as three distinct value planes, exactly as the implementer's own note claims.
- `h2b-look-4-terminal.png` — **passes**, and is the only one that reproduces byte-exactly (md5 `2b1460d6…` in both the committed file and my fresh `tick-74.png`).
- `h2b-look-2-corridor.png` — **fails.** An abstract arrangement of flat brown polygons with the camera inside or clipping geometry. Nothing in the frame identifies a corridor.
- `h2b-look-3-bedroom.png` — **fails.** A close-up of a doorway and wall edges. **No bedroom floor and no mess props are visible** — and the `look-lock` config sets `preDirty: true`, so the messes exist in that world and simply are not in shot. My freshly captured `tick-26.png` is, if anything, worse: an unreadable jumble of flat planes looking up into a ceiling/wall junction.

  This is §11's own stated human test, failed on its own terms: *"if a screenshot needs a caption to parse, it fails."* Shots 2 and 3 need a caption.

**(b) Three of the four are not reproducible, because the capture tick drifts.** The harness requests fixed ticks but records what it got:

| run | requested → actual |
|---|---|
| art-lock chromium | 3→3, 16→**17**, 26→**32**, 74→74 |
| art-lock firefox | 3→3, 16→16, 26→26, 74→74 |
| two later chromium runs | 3→3, 16→16, 26→**29**, 74→74 |

Only `tick-74` is stable. md5 of the committed shots 1–3 matches nothing my runs produced. A six-tick slip at shot 3 is ~0.3 s of walking, which is more than enough to change the framing — and the evidence above shows it does. **The four screenshots therefore cannot serve as a regression baseline**: nothing can later be diffed against them to detect that the look moved, which is precisely what "look-lock" is supposed to buy.

**(c) A measured corroboration, offered as data rather than as taste.** I decoded the atlas and the screenshots directly. The atlas is genuinely polychrome — 31 colours (≤32 ✓), 10 material regions, per-region luminance sd ≈ 12–15, spanning tan, blue-grey, blue, magenta, green, grey, cream and brown, with real value separation between classes (floors ≈ 123–146, wall 184, ceiling 216, door 100). But the three *world* screenshots occupy **a single hue bucket (30°, orange-brown) at 100.0 %** of pixels above 15 % saturation, mean saturation 0.22–0.26. Only the exempt terminal quad carries hue variety (240° at 62.7 %, max saturation 1.00).

  I am **not** claiming a rendering bug: the most likely explanation is simply that the four chosen poses never frame a coloured room floor, which is the same defect as (a) rather than a separate one. I record the measurement because it is the objective form of the implementer's own honest note that "the palette is narrow", and because **no gate measures it** — see non-blocking item 7.

**The fix.** Re-derive the four poses (`apps/hotel/scripts/derive-walk.mjs` exists for exactly this) so each frames its named subject — in particular shot 3 must show a bedroom floor with mess props in it — make the capture tick-exact so the committed PNGs reproduce, re-commit them, and then request the sign-off. Nothing else on this branch needs to move.

---

## Non-blocking items

2. **[NON-BLOCKING] The `draw-calls` and `frame-time-p95` budgets are measured only on the emptiest world the game can build.** Both probes run exclusively in `art-lock`, whose `look-lock` config is `{ preDirty: true, preDirtyCandidates: false, arrivals: "fixed", guestCount: 0 }`. The scenario's comment justifies the cleared set for *photographic* reasons and that reasoning is sound (see the ruling below), but it means the perf budgets are gated with **zero guests, zero staff and zero candidates in the scene**. Measured `drawCalls.max` = **3** against a ≤ 300 budget — a 100× margin, and true (I verified the probe reads the renderer's real `info.render.calls` after `render()`, and P5 proves it refuses a stub). A budget with a 100× margin on the lightest possible scene will not detect the regression it exists to detect. Cheapest fix: add the two probes to `upkeep-click`, which already runs a populated world on both engines, and keep `art-lock`'s copies for continuity.

3. **[NON-BLOCKING] `retroFlagsOf` is exported, documented as the gate's exemption check, and read by nothing.** `packages/renderer-three/src/retro.ts:67` calls `RetroMaterialFlags` a *"Marker read by tests and by the `art-lock` gate's page-side assertions"*. Grep across the repo: the only references are its own definition, its own writer, and its own accessor. **No test, no scenario and no page-side assertion calls `retroFlagsOf`.** The exemption is genuinely proven — but by the readability probe, not by this marker. This is the same shape as the H2a review's item 1 (a budget table asserting a consumer that does not exist), caught again. Fix: either have `art-lock` assert `retroFlagsOf(screenMaterial).exempt === true` page-side, or correct the comment. Relatedly, `unlit` is **not** a member of `RetroMaterialFlags`, so a regression that made world surfaces unlit would leave no runtime trace — adding it is one line (see the ruling on deviation 3).

4. **[NON-BLOCKING] The B6 exemption gate rests on one of its three targets.** My P1 (un-exempting the screen quad) moved `calibContrast` 241.32 → **179.04** and `calibPitchErr` 0 → **0.258**. The gate red-flagged **only `calibPitchErr`**: the contrast threshold is `≥ 60`, and 179 clears it comfortably. The `≥ 60` figure is inherited from H1b, where the failure mode was mip filtering (which took contrast to 41); under jitter and affine warp the failure mode moves *pitch*, not contrast. The gate is non-vacuous — but a single assertion carries it, and the other two are decorative against this threat. Consider tightening `calibContrast` toward the observed 241 (e.g. `≥ 200`) so two independent targets discriminate.

5. **[NON-BLOCKING] `golden-sweep.mjs`'s header understates what is now known about nine of its pins.** Its "MEASURED / not H2a-committed truth" caveat was appropriate when written and is no longer accurate: this review measured all nine against `28e554a` and they match exactly (see the first-act section). Update the comment to record that, so the next reader does not re-do the work or, worse, treat a real drift in one of them as an unpinned baseline.

6. **[NON-BLOCKING] The H2a review's perturbation method silently no longer works for browser gates, and the traps list should say so.** `packages/harness/src/browser.ts:954` runs `npm run build --workspace <app>` before serving. **Any perturbation applied to `apps/hotel/dist` is overwritten before the gate sees it.** I confirmed this the expensive way: patching `drawCalls` to `0` in the served bundle produced a completely green run reporting the honest value 3, which would have been read as "the probe is vacuous" by anyone who trusted the method. The same edit applied to *source* produced the correct exit 2. This is a near-miss of exactly the "restore was a no-op, so you drew the wrong conclusion" trap that has bitten this project four times, in a new disguise. Add it to HANDOFF's traps: **browser-gate perturbations must be source-level.**

7. **[NON-BLOCKING] The value/hue separation is fixed but ungated; PHASE-H2C's `surface-contrast` probe (§3.3, gate 11) is not built.** `packages/harness/src/surface-contrast.ts` does not exist and nothing implements `surfaceRects()`. The H2C-diagnosed regression *was* fixed on this branch (the third mesh re-pin's per-face directional term), and the lobby screenshot shows three genuine value planes — but the fix rests on a mesh golden that will happily re-pin again for a good reason and carry a bad one with it. The measurement in blocking item 1(c) is what such a probe would have asserted automatically. Carry gate 11 into the next phase with its trigger intact.

8. **[NON-BLOCKING] One command-count excursion on `demo-visual`.** Enforced rule 8 pins it at 18. Across eight runs I observed **19 once** (Firefox), 18 on the other seven (5 Firefox, 3 Chromium — re-run three times each way to check). Tick count and final hash vary run to run by design for this gate (`deterministic: false`, wall-clock bounded), but the command count is the pinned invariant and it is not perfectly constant. `demo-visual` is a standing H1 gate, not H2b work, so this is inherited rather than introduced — but "a green streak over a varying count is not a pass" is a standing rule and this is a varying count.

---

## Verification battery (all executed by the reviewer)

| Command | Result |
|---|---|
| `npm run check:workspace` | exit 0 — `@claude-engine/*` resolve inside the review worktree (run **first**, per the brief; a fresh worktree resolving to the other checkout's dist is the H2b-opening trap) |
| `npm run build` | exit 0 |
| `npx eslint .` | exit 0 |
| `node scripts/check-purity.mjs` | exit 0 — **8 roots clean**, incl. `packages/interiors/src` and `apps/hotel/src/sim` |
| `node scripts/check-purity.mjs --self-test` | exit 0 — 14 planted violations, all CAUGHT or correctly EXCLUDED; the checker bites |
| `npm test` (smoke) | exit 0, hash **3849639990**, replay PASS, `hashCheck` incremental === slow |
| `npm run test --workspaces --if-present` | **553 PASS / 0 FAIL** across 14 packages (H2a's baseline was 490; +63 from `audio`, `persistence`, `player-fps`, `save-web` and the new interiors atlas/UV gates) |
| `npm run check:goldens` (12 scenarios, `--verify-replay`) | **12/12 byte-identical**, exit 0 — table above |
| Goldens re-measured at baseline `28e554a` (11 scenarios) | **11/11 identical to the pins** — the nine "measured" pins verified as H2a truth |
| Non-mesh interiors hash at `28e554a` | `0x3ea4ca5` — **identical** to the pinned `NON_MESH_GOLDEN_HASH`; the art diff carried zero sim-visible data |
| Soaks `net-walk`, `net-interest`, `net-abuse`, `soak-ci` (`--soak`) | all **exit 0** — hashes 3997275108 / 3709402827 / 2041091190 / 1565950482 |
| Browser gates ×7, **Chromium**, `--browser --verify-replay` | `art-lock`, `upkeep-click`, `save-resume`, `reserva-readability`, `fps-look-interact`, `save-restore`, `demo-visual` — **all exit 0**, replay verified, page-side `liveHashCheck.available: true` and agreeing on every one |
| Browser gates ×7, **Firefox**, `--browser --verify-replay --browser-engine firefox` | **all exit 0**, same checks |
| Command counts (chromium / firefox) | `art-lock` **70/70** · `upkeep-click` **47/47** · `save-resume` **29/29** · `reserva-readability` **20/20** · `fps-look-interact` **12/12** · `save-restore` **69/69** · `demo-visual` 18/18 (one 19 excursion, item 8) — every count matches the handoff's claim |
| `art-lock` probes (chromium) | `screen-readability` texelScale **1.38** / calibContrast **241.32** / calibPitchErr **0** — byte-for-byte H1b's numbers with the shader live everywhere else; `draw-calls` max **3**; `frame-time-p95` p95 **64.3 ms**; `sim-tick-ms` avg **0.104** |
| `art-lock` probes (firefox) | identical readability numbers; `draw-calls` **3**; `frame-time-p95` p95 **8.0 ms** over 600 samples |
| Atlas, decoded directly | palette **31** (≤32 ✓), **10** regions, per-region luminance sd 12.0–14.9, material value separation floors 123–146 / wall 184 / ceiling 216 / door 100 |

Frame-time, measured by me: **64.3 ms (Chromium) / 8.0 ms (Firefox)** against the gate's 170 ms software ceiling — both comfortably inside, and both *below* the implementer's five-run range of 86.5–114.7 ms. Machine load, not a discrepancy. Noted for the ruling below: **Firefox's software path is already inside the spec's real 16.7 ms hardware budget.**

---

## Gate non-vacuity, by reviewer perturbation

Chosen independently of the implementer's list. All applied to **source**; all restored by `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game` + clean rebuild, each restore re-verified green.

| # | Reviewer mutation | Result |
|---|---|---|
| **P1** | `screens.ts`: the terminal quad's `exempt: true` → `false` — the B6 exemption removed, PS1 jitter+warp now compiled onto the screen | **`art-lock` exit 1.** `calibContrast` 241.32 → **179.04**, `calibPitchErr` 0 → **0.258**; red on `screenReadability.calibPitchErr` **and no other target**. Independently reproduces the implementer's claimed numbers to 3 s.f. The exemption is load-bearing and the gate measures it. (Drives item 4: only pitchErr actually reds.) |
| **P2** | `interiors/dist/layout.js`: `spawn.xMm` shifted by **1 mm** — a single sim-visible field, the smallest leak I could construct | **interiors suite exit 1**, 2 checks red: the full golden **and** `NON_MESH_GOLDEN_HASH` (`0x3ea4ca5` → `0x3494e262`). The separation gate genuinely detects sim-visible data escaping a presentation-only change — it is not a hash that only tracks mesh bytes by construction. |
| **P3** | `main.ts`: `sim.restore(loaded.snapshot())` removed from `recoverFromGames` — recovery still *runs*, but restores no state | **`save-resume` exit 1**, red on **exactly one** assertion: *"restoredHash === savedHash"*. The other five stayed green, correctly — including "a boot-path recovery actually ran", which did. The gate asserts the **reconstructed state**, not merely that recovery fired. This is precisely the H1b deferral row's demand ("assert through the recovered hash, not through replay of a discarded branch") and it is satisfied. |
| **P4** | `render/upkeep.ts:105`: the **mess** `registerInteractable` call removed, leaving props/documents/candidates registered | **`upkeep-click` exit 1**, red on exactly the two mess assertions ("the mess is gone", "a `room.messCleaned` event fired"); **green** on the candidate-interview click and on "no interact-denied". Surgical. The H2a review's blocking carry is closed with a gate that genuinely clicks a mess in the real browser build. |
| **P5** | `three-host.ts`: `lastDrawCalls = renderer.info.render.calls` → `= 0` — the probe's data source stubbed | **`art-lock` exit 2** (infra failure, not a pass): *"The draw-calls probe read no non-zero draw count in 500ms (11 reads) … a zero here means the page is not rendering or the slot is stubbed, not that the budget was met."* The anti-vacuity refusal is real; `max: 0` cannot sail through `≤ 300`. |

`art-lock`'s screen-readability numbers returned to exactly 1.38 / 241.32 / 0 after the P1 restore, and `upkeep-click` / `save-resume` to exit 0 after P4 / P3.

---

## What I tried to break and could not

- **Invariant 2 across the entire art surface.** Attacked from three directions: the sweep script itself (it genuinely compares and exits 1 — P2 proves it), the nine self-declared "measured" pins (re-measured at `28e554a`; all nine exact), and the mesh/non-mesh separation (re-computed at `28e554a`; identical). Three mesh re-pins moved mesh bytes and nothing else. I could not find a byte of sim-visible data in the art diff.
- **The sim-side surface of an art phase.** `apps/hotel/src/sim/game.ts` gained 304 lines in a phase forbidden from moving hashes — the diff's single highest-risk file. It is `preDirty`/`preDirtyCandidates` (both `false`/guarded in `DEFAULTS`), a `SCENARIO_CONFIGS` registry, and the extraction of `spawnCandidateRound` out of `mailSystem`. The extraction preserves Rng draw order (`generateCandidate(staffRng, i)` in the same loop, `queueMail` in the same place); `first-hire` **4132986008** and `one-man-week` **3423109909** — the two goldens that exercise the hire beat end-to-end — are byte-identical, which is the empirical proof the paper argument wanted. The `arrival` parameter is the only behavioural addition and the shipped beat still passes `"arriving"`.
- **The new `findPathCells` import in a purity root.** The H1a standing rule bans new raw callers *for collider-bearing agents*. This caller routes **no agent**: it computes which doors lie on a lobby→bedroom route at setup so the pre-dirtied room's doors stand open, and it is inside the `config.preDirty` guard. Letter and spirit both honoured — recorded here because a future reader will grep this and need the answer.
- **The audio boundary (spec §3, "no audio in the sim, ever").** Zero matches for `@claude-engine/audio` in `packages/{core,space,interiors,surface-ui,bots,net}/src` and `apps/hotel/src/sim`. The only consumer is `apps/hotel/src/render/sounds.ts`, and it is `import type` only. No sound fact can reach a component.
- **The transcendental ban in `packages/interiors/src`** — and here the branch is *better* than its own spec. PHASE-H2.md §5.D states outright that "Math.sin/random are fine here" for atlas synthesis. **That is wrong**: `check-purity.mjs:194` registers `packages/interiors/src` with `banTranscendentals: true`. The implementer noticed and did not follow the spec — `atlas.ts:9` carries a comment saying they are banned, and the only `Math.*` in the root is two `Math.sqrt` calls in `mesh-gen.ts`, which is deliberately outside the ban list (IEEE-754 requires correctly-rounded `sqrt`, so it is platform-stable, unlike `sin`/`cos`). **The spec has an erratum; the code is correct.** Recorded so the erratum is fixed rather than obeyed later.
- **The `ScreenViewData` key budget (spec risk 3).** Counted by hand: `queue, rooms, stars, ledger, ledgerDays, objectives, pricing, mail, staff` = **exactly 9 of 9**. H2b added no key. Still at budget, as H2a left it.
- **The `save-resume` recovery path as a fake.** Source-verified that `recoverOnBoot()` (`main.ts:385`) and the F6 trigger `recoverViaBootPathAgain()` (`:415`) both delegate to the same `recoverFromGames()` body (`:359`), differing only in which game list they pass. The substantive recovery — `listGames()` → `recoverSim()` → `sim.restore()` → `resetEntityKeyedHostState()` → the replay-visible marker command — is genuinely shared and genuinely exercised. P3 confirms the gate asserts its result rather than its occurrence.
- **The `unlit` deviation as an exemption leak.** Every one of the twelve `createRetroMaterial` call sites was read. `unlit: true` appears at exactly **two**, `screens.ts:94` and `documents.ts:130`, and **both also pass `exempt: true`**. Every world surface — floor mesh, doors, characters, messes, props, tray documents, monitor housings — omits it and is `MeshLambertMaterial`. The field cannot currently make a lit surface unlit.
- **The draw-call count as a lie.** The count of 3 is *true*: `three-host.ts` reads `renderer.info.render.calls` immediately **after** `renderer.render()` (with a comment explaining that sampling before would report the previous frame), and P5 proves a stubbed zero is refused as infra failure rather than passed as a met budget. Three is genuinely plausible for one merged static mesh plus instanced scenery. The problem is not truthfulness but margin and scene population (item 2).
- **The `preDirty` config as a production reachability hole.** `SCENARIO_CONFIGS` is a committed record selected by name; `setupNamed` throws on an unknown name. The host can pick one of a fixed few worlds, never invent one — CLAUDE.md's "no dev/debug commands reachable from production builds" applied to world construction, the same way `?worldforgeSeed` already was. `preDirty: false` in `DEFAULTS`, and every Rng draw it makes sits inside its own guard, which is why no pinned golden can see it (and none moved).
- **The write-through invariant under the new code.** Every `--verify-replay` leg of all 12 headless scenarios, all 4 soaks and all 14 browser runs reported `incremental === slow`, live and replayed, with the H2a addendum's 500-tick periodic cross-check live throughout. No new in-place mutation was introduced by 8,124 lines of diff.

---

## The §4 deferral ledger, audited row by row

| # | Ledger disposition | What the branch actually did | Verdict |
|---|---|---|---|
| 1 | Quick-load id-switch, `listGames()`/`deleteGame()`, `"./recover"` subpath → **H2b** | All three landed. `listGames`/`deleteGame` implemented in **all four** stores (`store.ts`, `sqlite-store.ts`, `postgres-store.ts`, `save-web/web-store.ts`); `package.json` exports carry a real `"./recover"` subpath → `dist/recover.js`; `main.ts` does the fresh-derived-id switch on quick-load and boot-recovers the most recent id. `save-resume` green both engines, 29/29 commands, and P3 proves it asserts the recovered hash. | **closed** |
| 2 | `resetEntityKeyedHostState()` exercised for real; `player-fps` `objectToEntity` reverse-map prune → **H2b** | Both landed. The prune is at `player-fps/src/index.ts:314` (`objectToEntity.delete(prevObject)`) with the stale-mapping hazard in the comment. `save-resume`'s final assertion — a guest that spawned *after* the restore is clicked and moves to `presenting` — is the H1b item-6 hazard exercised end to end, and it survived P3 (correctly staying green while only the hash assertion red-flagged). | **closed** |
| 3 | `debug.*` command rejection in server validation → **Phase 5**, trigger unchanged | `git diff 28e554a..HEAD -- packages/server/` is **empty**. Untouched; no remote actor exists yet. | correctly carried, trigger intact |
| 4a | `space` clearance-aware A* extraction → **Phase 3**; standing rule: no new raw `findPathCells` caller for a collider-bearing agent | One new `findPathCells` import in `game.ts` — audited above: it selects doors on a route at setup and routes no agent. No collider-bearing agent was given a raw path. | correctly carried, standing rule honoured |
| 4e | Guests never close doors → **Phase 3** | Untouched. The `preDirty` config's door-opening is explicitly justified *by* this ruling (a checked-out room genuinely has its doors standing open), not in spite of it. | correctly carried, trigger intact |
| 4f | Third-person boom clip (H0 item 1, twice-deferred "to the art/feel pass") → **H2b** | Landed as `boomClip?()` on the player-fps controller options — a spring-arm occlusion query returning a clamped boom **distance**, with the near-plane straddle guard. Optional slot; absent ⇒ pre-H2b naive behaviour. | **closed** |
| — | `save-restore`'s pinned-pose no-op residual must not be inherited by `save-resume` | Not inherited, and the scenario argues it explicitly: F5/F6 land 5 ticks apart in a window with **zero** commands and **no guest yet spawned**, so there is no discarded branch to replay through; the assertion runs through the recovered hash. P3 confirms that hash assertion is the one carrying the gate. | **closed** |

---

## Rulings on the three escalated deviations

### 1. The frame-time budget is scoped to software rendering (170 ms ceiling) rather than the spec's 16.7 ms — **UPHELD as scoped, with the hardware number assigned to the sign-off.**

Accepted, and the way it was done is the reason. The spec's 16.7 ms is explicitly a *hardware* 60 fps promise; the harness renders through headless SwiftShader because that is the only configuration in which Three's shaders compile at all in CI. Asserting an unreachable number would produce a permanently red gate that everyone learns to ignore — which is strictly worse than an honest narrower one. The gate now states, in the file, exactly what it claims ("software render cost has not regressed") and exactly what it cannot ("that the game hits 60 fps on a GPU"), and assigns the missing claim to the sign-off, where a real machine is already in the loop.

That is the correct shape for this project: a gate that overstates its reach is the failure mode this process exists to catch, and scoping-with-disclosure is the opposite of loosening. **A hardware run is not required before PASS** — but it *is* required before the phase's perf claim is complete, and it belongs in the sign-off drive alongside the screenshots, not in a later phase.

One observation that strengthens the case rather than weakening it: I measured **Firefox at p95 = 8.0 ms**, already inside the spec's real hardware budget, and Chromium at 64.3 ms. The 8× spread between two software rasterisers on one machine is itself the proof that no single CI number can stand in for the hardware target.

*Recommended, not required:* the ceiling is calibrated to one machine's five runs. Record the machine alongside the number (ARCHITECTURE B8 already holds the warm-bench methodology), so a future reader on different hardware does not read a green 170 ms gate as a portable claim.

### 2. `save-resume` substitutes an F6 re-invocation for a real `location.reload()` — **ACCEPTED with the named trigger, non-blocking.**

The constraint is real and structural: `installTestHook`'s command log lives in page memory, and it is the artifact the harness replays for both its assertions and `--verify-replay`. A genuine `location.reload()` destroys it, and the run would silently truncate to "whatever happened after the reload" — exit 0, green, proving nothing about the half of the run that mattered. That is a worse outcome than the substitution, and it is the same trade H1b already made deliberately for F9.

I verified the substitution's load-bearing claim rather than accepting it: both entry points delegate to the same `recoverFromGames()` body, so the recovery logic under test **is** the boot path's, and P3 shows the gate fails when that body stops doing its job.

**What gate 8 therefore does not prove, and the verdict records it plainly:** module top-level re-execution (`void recoverOnBoot()` at import time), fresh page globals, and a cold IndexedDB reopen. That is a bounded, named gap, not a fig leaf. Closing it needs a reload-preserving primitive in `packages/harness` — the scenario file says so, and the file correctly notes that building one was out of its scope.

**Carried to the next phase with an explicit trigger:** *the first defect traced to boot-time module initialisation, or any change to `main.ts`'s top-level recovery invocation, obligates the harness reload primitive.* Until then the substitution stands.

### 3. `createRetroMaterial` gained an additive `unlit?: boolean` not in the spec's signature — **UPHELD as a legitimate additive public-contract change.**

It is additive, optional, defaults `false`, and every existing call site is unaffected — the same shape as the `MeshData.uvs` and `frameStats` additions this spec pre-approved. The justification is sound and is the *anti*-drift choice: the screen quad must render its CanvasTexture unmodulated or the readability probe measures the lighting rig instead of the texture (H1b shipped it as `MeshBasicMaterial` for exactly this reason). The alternative — letting the screen keep a separately-constructed material — is precisely the mechanism by which an exemption silently drifts, which is what routing everything through one factory was meant to prevent. Choosing the base class *inside* the factory keeps one place where the effects can be turned on.

I verified containment rather than trusting the default: `unlit: true` appears at two call sites, both already `exempt: true`; every world surface is lit. The deviation is disclosed in the file's own header comment, which is the standard this project asks for.

**One defect, folded into non-blocking item 3:** `unlit` is absent from `RetroMaterialFlags`, so unlike `jitter`/`affine`/`exempt` it leaves no runtime-readable trace. Since the flags are already the intended mechanism for making the exemption checkable rather than greppable, `unlit` should join them — one line, and it closes the gap before a third call site ever exists.

---

## Rulings on PHASE-H2C.md — which items this branch has made moot

`docs/PHASE-H2C.md` was written by a concurrent planning session against the branch's *pre-fix* state. Its §2 table dispositions six items; the branch has since overtaken most of it.

| H2C item | Status after this branch |
|---|---|
| **1** — `art-lock` committed RED; focus click unreliable; the four screenshots are not the poses the sign-off signs | **Half moot.** The gate half is **done**: `art-lock` is exit 0 on both engines, 70/70 commands, and its subject (the B6 exemption) is proven — 1.38 / 241.32 / 0 under the live shader, with P1 confirming the gate reds when the exemption is removed. H2C's warning "do not 'fix' the exemption" was correctly heeded. **The screenshot half is NOT done** and is this review's blocking item 1. |
| **2** — frame-time measured 108 ms against a 16.7 ms budget written for hardware | **Moot.** Re-based to a documented 170 ms software ceiling with the method and the disclaimer in the gate file, and the hardware number reassigned to the sign-off. Ruled acceptable above. H2C §4's two-number derivation is a reasonable alternative shape, but the shipped one-ceiling-plus-sign-off form satisfies the same requirement; no further work needed. |
| **3** — floor/wall/ceiling have lost value separation | **Fixed, NOT gated.** The regression is genuinely repaired (the third mesh re-pin's per-face directional term; the lobby screenshot shows three distinct value planes; I measured atlas material separation at floors 123–146 / wall 184 / ceiling 216). But H2C §3.3's `surface-contrast` probe and gate 11 are **not built** — no `packages/harness/src/surface-contrast.ts`, no `surfaceRects()` implementation. The fix currently rests on a mesh golden that will re-pin again for good reasons. **Gate 11 is live work; it carries forward** (non-blocking item 7). |
| **4** — `save-resume` "may or may not have landed"; untracked in the tree | **Moot.** Committed (`0d0a8e5`), green on both engines, 29/29 commands, and P3-verified non-vacuous. H2C §6's ruling was written without knowing this; it is superseded by the ruling on deviation 2 above. |
| **5** — the look-lock human sign-off (gate 12) | **Live, and now gated behind blocking item 1.** Cannot be performed by an agent, and should not be requested until the screenshots depict their subjects. |
| **6** — no H2b review gate has run (gate 13) | **This document.** H2C's own text notes the upkeep-click gate "is present and green on both engines, so the review's job is to re-verify that, not to accept it" — re-verified, and P4 proves it non-vacuous. |

**Net:** H2C items 2 and 4 are fully moot; item 1 is moot on the gate and live on the screenshots; item 3 is moot on the fix and live on the gate; items 5 and 6 stand. **A separate H2c phase is not warranted** — what survives is blocking item 1 (hours, not a phase) plus one probe that belongs in the next phase's scope.

---

## The look-lock sign-off (§11) — status

**This review cannot perform it and does not.** §11 assigns it to Chris: view the four committed screenshots *and drive the build himself* (`.claude/launch.json`, port **5199** — not 5173), against roadmap risk 7's test: *if a screenshot needs a caption to parse, it fails.*

**`LOOK-LOCKED:` is deliberately not recorded in this document.** It must be added, with the commit SHA, only after Chris gives the sign-off — and per blocking item 1, only after the four screenshots are re-captured, because two of them currently fail §11's test on their own terms and one shows neither the bedroom nor the mess props it is supposed to show.

The implementer's own read is carried forward verbatim so the sign-off is not asked to guess, and my measurements corroborate rather than contradict it: *the look is adequate and coherent — three distinct value planes, legible rooms — but not yet charming; the atlas dither does not resolve at gameplay distance and the palette is narrow.* My objective form of that: the atlas is a real 31-colour dithered polychrome asset (sd 12–15 per region, ten materials, genuine value separation), and the three world frames render in a single 30° hue bucket at mean saturation 0.24.

**After sign-off, any change to `apps/hotel/src/render/look-lock.ts` or `packages/interiors/src/atlas.ts` is a public-contract change requiring a review turn.** That is what "freeze" means here.

---

## Consolidated deferral list for the next phase (start from this)

1. **The look-lock screenshots** (blocking item 1) — re-derive four poses that frame their named subjects, make the capture tick-exact so the committed PNGs reproduce, re-commit, then request the sign-off. **Then record `LOOK-LOCKED: <commit>` in this file.**
2. **Perf budgets on a populated world** (item 2) — add `draw-calls` and `frame-time-p95` to `upkeep-click`; a 100× margin measured at `guestCount: 0` will not catch what it exists to catch. Record the machine beside the 170 ms ceiling.
3. **`surface-contrast` probe / H2C gate 11** (item 7) — the value-separation fix is currently ungated; H2C §3.3 already specifies the probe and its three non-vacuity obligations. Trigger: the next mesh golden re-pin.
4. **Make the exemption marker true** (items 3, 4) — have `art-lock` actually read `retroFlagsOf` page-side (or fix the comment that claims it does), add `unlit` to `RetroMaterialFlags`, and tighten `calibContrast` so more than one target discriminates.
5. **Harness reload primitive** (deviation 2) — trigger: the first defect traced to boot-time module initialisation, or any change to `main.ts`'s top-level recovery invocation. Until then `save-resume`'s F6 substitution stands, with its gap named.
6. **Bookkeeping** (items 5, 6, 8) — correct `golden-sweep.mjs`'s header (nine pins now verified against `28e554a`); add "browser-gate perturbations must be source-level, because `browser.ts:954` rebuilds the app before serving" to HANDOFF's traps; investigate `demo-visual`'s 1-in-8 command-count excursion.
7. **Spec erratum** — PHASE-H2.md §5.D says `Math.sin`/`Math.random` "are fine" in `packages/interiors/src`. They are banned there by `check-purity.mjs`. The code is right and the spec is wrong; fix the spec before someone obeys it.
8. **Phase 3+ carries, triggers unchanged and verified untouched:** `space` clearance-aware A* extraction (second consumer or crowd scale); guests never close doors; `debug.*` rejection in server validation (Phase 5, before any remote actor exists).

---

**Phase H2b is NOT yet clear to merge.** One blocking item stands, and it is the artifact the next required step consumes. Everything else on this branch is verified, non-vacuous, and merge-ready: fix item 1, obtain the sign-off, record `LOOK-LOCKED`, and merge.

---

## Post-verdict addendum — blocking item 1 worked, and what it did and did not fix

Written after the verdict above, by the same session acting as implementer at
Chris's instruction ("fix the screenshots"). The verdict is untouched; this
records what changed and, more importantly, what the work established that the
verdict could only suspect.

### The reproducibility half: FIXED, and proven the only way that counts

`scenarios/art-lock.scenario.mjs` was re-derived so the walk **stops and holds
still** at each of the three world poses, with each shot near the start of a
~60-tick hold. Two causes of drift were found, not one:

1. **Shots were taken mid-stride.** Obvious in hindsight; the walk held `KeyW`
   almost continuously from tick 0 to 60 and all three world shots landed
   inside that.
2. **Capturing is itself slow, and the capture loop is serial.**
   `browser.ts:396` polls to a tick then calls `page.screenshot()` in order, and
   under SwiftShader one capture costs **27–37 ticks of wall clock** — so each
   capture pushes the *next* request late. A first attempt using ~10-tick holds
   still drifted 54 → 70, straight through the hold into the next leg. This is
   why the holds are long rather than the ticks merely re-spaced.

A third instance of the same class showed up in the terminal shot: `focusEase`
is per-**rendered frame** (`FOCUS_EASE_STEP = 0.12`), so on hardware it settles
in ~0.15 s but at this gate's ~10 fps it takes ~18 ticks. Capturing 7 ticks
after the focus click produced a half-eased camera and `calibContrast` **0** —
a red gate caused entirely by capture timing, with the sim assertions all green.
`SHOT_TERMINAL` now sits ~47 ticks after the click.

**Proof, which is byte comparison rather than an argument:** two consecutive
Chromium runs produced **four byte-identical PNGs** —

| shot | md5 | run A tick | run B tick |
|---|---|---|---|
| `tick-10` lobby | `99e6478a…` | 10 | 10 |
| `tick-85` corridor | `e2c522df…` | 85 | 85 |
| `tick-165` bedroom | `6a593b80…` | **166** | 165 |
| `tick-345` terminal | `2b1460d6…` | 345 | 345 |

Run A's bedroom capture drifted a tick **and produced the same image anyway**,
which is precisely the property the holds exist to buy. Before this change only
the terminal shot reproduced. Gate re-verified: **exit 0 on Chromium and
Firefox**, `--verify-replay`, command count constant at **72** on both engines
(was 70; the input script changed), `screen-readability` unchanged at
texelScale **1.38** / calibContrast **241.32** / calibPitchErr **0**,
`draw-calls` 3, `frame-time-p95` 74.0 / 84.7 ms Chromium and **16.0 ms**
Firefox. `npm run build`, `npx eslint .`, `check-purity`, and
`npm run check:goldens` (**12/12**) all still green — no sim code was touched.

### The subject half: two of four fixed; the other two are art, and that is now established rather than suspected

- **Shot 1 (lobby)** — fixed. Chosen by measurement, not taste: a scouting run
  photographed all four cardinal directions from the spawn. South is the only
  one that reads, because it looks *through* the corridor doorway and the frame
  therefore carries a door frame, a receding floor and a ceiling edge. East is a
  bare corner, north a flat door panel, and west — down the lobby's 10 m length,
  which is what "lobby wide" naively suggests — is a near-featureless field.
- **Shot 4 (terminal)** — unchanged and still perfect.
- **Shot 3 (bedroom)** — the mess is now genuinely in frame, and the earlier
  1831 mm pose was diagnosed: it stands at x3986, **outside room 3's east wall**
  (the room spans x375..3875), so the wall occluded the mess entirely. The pose
  is now inside the room at 1292 mm.
- **Shots 2 and 3 still do not read** as a corridor and a bedroom.

**This is not a pose problem, and the search that establishes it is the useful
output.** Roughly a dozen framings were photographed and inspected. With no
surface detail at gameplay distance, a frame reads only when it contains an
opening and layered depth; flat-on views of large surfaces render as untextured
fields whatever the room is, and oblique multi-surface views render as polygon
soup. The legible band is narrow: **moving 600 mm forward from shot 1's pose
destroys it.** And the mess in shot 3 renders as a dark brown box
indistinguishable from architecture — confirmed by pitch-tracking the same dark
slab across pitches 210/175/140 and watching it leave frame as predicted.

The fixes are art-side: atlas contrast, surface/edge definition, and the mess's
own colour (`hashedColor(kind, 0.4, 0.3)` lands dark against a dark floor).
Those belong to the sign-off and to non-blocking item 7's missing
`surface-contrast` probe, not to another pose iteration.

### Verdict status

**Blocking item 1 is discharged as far as engineering can take it**, and the
part that remains is now correctly located: it is the *look*, which is Chris's
call at the §11 sign-off, not a defect in the gate. The four committed
screenshots are an honest, reproducible record of what the build currently looks
like — which is what a sign-off needs, whether the answer is "lock it" or "the
art needs another pass first".

`LOOK-LOCKED:` remains deliberately unrecorded.

### One correction, recorded because this project's rules require it

While investigating, this session ran the app's dev server through
`preview_start` and found the page world contained **no messes**, and briefly
treated that as a product bug. It was not. `preview_start` launches in the
*session's* worktree, which sits at `28e554a` (pre-H2b, no `setupNamed`, no
`SCENARIO_CONFIGS`) — the wrong tree, the same trap family as the fresh-worktree
resolution failure that opened H2b. Re-checked against a dev server started in
the review worktree, the page has both messes, the broken lamp and two open
doors, exactly as designed. **Nothing was wrong with `preDirty`.** Worth adding
to HANDOFF's traps: *`preview_start` ignores which worktree you are reviewing;
verify the served tree before believing anything it shows you.*

---

## Second addendum — the rooms did not read because the texture pipeline was never uploaded

Chris's report was "fix the atlas contrast so the rooms read, there's no
contrast". Chasing it found a one-line rendering bug that made the whole of
H2b's art lane invisible, and the review above (mine) attributed the symptom
to a narrow palette without finding it. Recorded in full, because the way it
hid is more instructive than the fix.

### The measurement that located it

The first suspicion was the value structure, and that was measurable. Sampling
the atlas per material and the baked vertex light per surface class, over the
same mesh the engine ships:

| surface | atlas albedo | baked light | product |
|---|---|---|---|
| floor | 130.2 | x0.888 | **0.454** |
| wall | 194.4 | x0.653 | **0.497** |
| ceiling | 210.4 | x0.568 | **0.468** |

The albedo ladder climbs 1.62x; the bake's light ladder descends 1.56x,
because a ceiling faces away from `SUN_DIR` and a floor faces into it. They
are near-reciprocal, so the product is flat: a **1.09x spread** across floor,
wall and ceiling. Not "low contrast" — *cancellation*. Fixing that (see the
palette comment now in `atlas.ts`) took the modelled spread to **2.97x**.

### But the fix changed nothing on screen, which is what exposed the real bug

Re-running `art-lock` after the palette change produced frames that were
statistically identical to the old ones: dynamic range 1.37-1.48x before and
after, and 100% of saturated pixels still in a single 30-degree hue bucket —
even though the atlas now had cool blue-grey walls (hue 213) and a 2.97x
ladder. An atlas that cannot move the pixels is not being sampled.

`packages/assets/src/web/geometry.ts`'s `toBufferGeometry` sets `position`,
`normal`, `color` and the index — and **never set `uv`**, although H2b added
`MeshData.uvs` as the spec's own additive change (§5D). Three.js with a `map`
and no `uv` attribute does not fail loudly: it samples texel (0,0) for every
fragment. Texel (0,0) sits in `floor:lobby` — warm, saturation 0.30 — so the
entire hotel rendered in one flat tan, modulated only by the vertex-colour
light bake. That is precisely the measured signature: one hue, and an
on-screen dynamic range equal to the light ladder alone.

**The whole H2b texture lane was invisible from the day it landed**: atlas
synthesis, planar UVs, the half-texel gutter, and all three mesh-golden
re-pins. It also explains an entry in the branch's own history — the second
re-pin's note that moving albedo out of vertex colours and into the atlas
made "the entire hotel render as uniform dark mud". Of course it did: that
commit moved the colour into a texture nothing was sampling.

The fix is one line, `if (mesh.uvs) geometry.setAttribute("uv", ...)`.

### Why every gate stayed green

This is the defect shape this project keeps catching, and it beat the whole
battery, including my own review:

- `interiors`' texel-density test asserts UVs exist and are correctly scaled
  **in the mesh data** — true, and irrelevant to whether they reach the GPU.
- The atlas unit tests assert the atlas is well-formed — also true, also
  irrelevant.
- `art-lock`'s `screen-readability` probe measures the one surface in the
  game that is deliberately **exempt** from the atlas, so it was never going
  to notice.
- The `draw-calls` and `frame-time` probes are indifferent to what a texture
  samples.
- And the human half — the look-lock sign-off, the one step that would have
  caught it in a second — had not happened yet.

Non-blocking item 7 of the verdict above (the missing `surface-contrast`
probe, PHASE-H2C §3.3) is now upgraded in importance: a probe that measured
rendered floor/wall/ceiling separation would have failed on day one. It
should be treated as the phase's outstanding gate, not a nice-to-have.

### State after the fix

`npm run build`, `npx eslint .`, `check-purity`, **553 tests**, and
`check:goldens` **12/12** all green — no sim code was touched, and the
interiors mesh golden did **not** move (the atlas change alters no mesh
bytes; UV regions are assigned by index). `art-lock` exits 0 on both engines
with `screen-readability` unchanged at 1.38 / 241.32 / 0, and the four
screenshots still reproduce byte-identically across runs.

The rooms now read: tiled floors with grout lines in perspective, cool
panelled walls against warm floors, a dark ceiling, and per-room accent
floors (the bedrooms are visibly blue, magenta and green).

### What is still outstanding

**The four screenshot compositions want re-tuning for a textured world.**
Every pose in this file was derived while the hotel was an untextured field,
and two of them were chosen specifically to work around that — the "only
frames with a doorway and layered depth read" rule in the header was a
consequence of the bug, not a property of the art. Shots 2 and 3 now show
real tiled surfaces but are still framed against a near wall at a steep
pitch. Re-deriving them against the fixed renderer is quick and is the
natural next step before the sign-off.

A browser-testable demo of the fixed look was published for the sign-off, so
Chris can walk the real ground-floor mesh and toggle the bug on and off
rather than judge from four fixed frames.
