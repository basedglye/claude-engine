# Phase H2a review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `hotel-phase-2a` at `5ff5bbf`, diffed against `main` (9 commits, +6,279/−240 across 49 files).
Spec: [docs/PHASE-H2.md](../PHASE-H2.md) — **H2a scope only** (§1's split ruling; H2b is out of scope and nothing from it was reviewed here). Also reviewed against: CLAUDE.md invariants including the NEW invariant 6 (write-through), DESIGN.md's binding rulings, ARCHITECTURE.md, and the H1b round-2 consolidated deferral list.

All verification below was re-run by the reviewer; no numeric claim in any commit message was taken on trust. Perturbations were applied to built outputs only (`apps/hotel/dist-game`, gitignored) and each restore was a clean rebuild after `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game` (the tsc-incremental trap, per the H1a/H1b reviews — respected on every one of the five cycles). `git status --porcelain` empty at review end.

## Verdict: PASS (with 5 non-blocking items)

The phase's engineering claims hold under attack. Every headless gate — the eight standing plus the four new — exits 0 under `--verify-replay` with the incremental/slow hash cross-check green on both legs; every browser gate passes on Chromium, and the two-engine pair on Firefox, with the page-side hash check live (`available: true`), not duck-typed into vacuity. Five reviewer-chosen perturbations of the built output each went red on exactly the targeted assertion and nowhere else. The sidestep branch's dead-code and silent-livelock claims were both independently confirmed. The clerk has no back door: `applyDeskDecision` resolves every actor through `actorId` and applies the same range/state validation to `staff:*` that it applies to `"player"`, and my always-errs perturbation proved the skill path is load-bearing. The `desk.falseDeny` ground-truth change is a strengthening, not a weakening — the H1 fraud gates still assert their exact pre-H2 event counts and pass. The §4 deferral ledger is honest: every "Scheduled: H2a" row landed with the prescribed shape.

Nothing blocking. The one genuinely new residual this review found — the write-through detector's healing window, demonstrated empirically below — is an honest limitation of a final-tick cross-check, narrower than the code comment admits but not a defect in what shipped; it gets a fix-list entry because the comment should tell the truth about it.

### Non-blocking items

1. **[NON-BLOCKING] Daily objectives are player-invisible, the `objectives` view key is dead, and `screen-data.ts`'s budget table asserts a consumer that does not exist.** `apps/hotel/src/sim/screen-data.ts` documents the 9-key budget as "AUDIT — ledger, objectives", but `audit-app.ts` reads only `ledger`; grep confirms **no app and no host code reads `data.objectives`** — the key is built, serialized on every paint, and consumed by nothing. Objectives are sim-real (posted, progressed, settled, gate-asserted, carried in `econ.audit`'s payload) but no screen shows them, so the feature currently exists only for the event log — a mild echo of the "verified but invisible" defect shape this project keeps catching. Fix cheaply: paint them in AUDIT (the comment's claim made true) or drop the key and correct the comment; either way the H2b screen pass is the natural moment.
2. **[NON-BLOCKING] The write-through cross-check has a healing window materially wider than its documented residual.** The code comment (`replayToSim`) admits a component *created and mutated between two hash calls* is invisible. The broader truth, demonstrated by reviewer perturbation P1 below: an in-place mutation to **any** entry is silently healed by any later legitimate `setComponent` on the same (component, entity) before the next hash — I converted the check-in cash write to `hotel.cash = hotel.cash + rate` in the built sim and `checkin-rush --verify-replay` passed clean (exit 0, hashes agreeing, identical to baseline), because later writes to the `hotel` component re-digested the already-mutated object. The detector reliably bites when the violator is the entry's *last* writer (P1b, exit 3) — the most dangerous class, since those are permanent — but "the cross-check runs on every run" should not be read as "every in-place mutation is caught". Fix: extend the comment on `stateHashSlow()`/invariant 6 to state the healing window honestly; optionally add a periodic (e.g. per-audit or per-checkpoint) `hashCheck` under `--verify-replay` to shrink it. Never loosen anything.
3. **[NON-BLOCKING] `hashCheckFailed` treats a browser `available: false` as a pass.** `packages/harness/src/cli.ts` gates only on `agrees`; a page world without `stateHashSlow` reports `available: false` honestly in the JSON but nothing red-flags it. Today every app hands the hook a real `Sim` (verified: all six browser verdicts this review show `available: true`), so the check is live — but the day an app hands a wrapper IWorld, the browser leg of invariant 6 silently evaporates. One line (`if (!lc.available) exit 2` or a gate assertion) closes it; with the next harness touch.
4. **[NON-BLOCKING] The `checkin-rush ≤ 0.030` number is not reproducible by the harness's own single-run measure, and the spec should stop citing it as if it were.** Six reviewer harness runs: avgTickMs 0.0347–0.0416 — all above 0.030. A warm 11-run in-process bench at the same scenario and entity count: **median 0.0107 ms/tick** (min 0.0089), corroborating the implementer's 0.0071–0.0077 claim and the ~35–40% improvement; the single-run number is cold-start JIT noise, exactly as the lane-2 commit says. The refactor genuinely beats the number it was scheduled to beat — but by the measurement method H1b's 0.030 was written down in, this machine now reads worse, so the carried number is method-ambiguous. Record the warm-bench methodology next to the number (in ARCHITECTURE's fix-order list) so the next phase doesn't chase a phantom regression. `one-man-week` perf is unambiguous either way: reviewer-measured avgTickMs **0.446** against the spec's ≤ 1.0.
5. **[NON-BLOCKING] The incremental-hash speedup is 6.6× against the spec's stated ≥10× expectation.** Reviewer-measured at the spec's 300-entity fixture: incremental 63.6 µs/call vs slow 422.7 µs/call. Honestly recorded by the implementer in ARCHITECTURE.md as "6x, reported as measured" — this item exists only so the shortfall is in the verdict, not just the docs. Review-read, not asserted, per the spec's own framing; the end-to-end effect is what matters and it is delivered (42,000-tick `--verify-replay` at 0.45 ms/tick). No action required.

## Verification battery (all executed by the reviewer)

| Command | Result |
|---|---|
| `npm run build` / `npx eslint .` | exit 0 |
| `node scripts/check-purity.mjs` / `--self-test` | exit 0 — eight roots clean incl. `apps/hotel/src/sim`; self-test plants CAUGHT/EXCLUDED correctly |
| `npm test` (smoke) | exit 0, hash **3849639990** (the one H2a re-pin; pre-H2 919868270 recorded in the test comment), replay PASS |
| `npm run test --workspaces --if-present` | **490 PASS / 0 FAIL** incl. the four new app decision suites, registry-derived composed-shell overflow over all six apps, the `listed` round-trip property (600 seed×row pairs), the core write-through negative control, and the mid-week restore/star-recompute hash checks |
| `smoke`, `demo-walk`, `bots-headless`, `walk-collide`, `corridor-headon`, `checkin-rush`, `fraud-catch`, `fraud-catch-b` `--verify-replay` | all exit 0, replay-verified, `hashCheck` live+replay agreeing on every one |
| `zen-clean`, `first-hire`, `escalation-stars`, `one-man-week` `--verify-replay` | all exit 0, replay-verified. `one-man-week` (42,000 ticks) avgTickMs 0.446 ≤ 1.0 |
| `checkin-rush` ×6 harness runs + 11-run warm in-process bench | single-run 0.0347–0.0416 (noisy, above the 0.030 target); warm median **0.0107 ms/tick** (item 4) |
| `fps-look-interact`, `reserva-readability`, `save-restore`, `demo-visual` `--browser --verify-replay` (Chromium) | all exit 0, replay-verified, page-side `liveHashCheck.available: true`, agreeing |
| `fps-look-interact`, `reserva-readability` `--browser --verify-replay --browser-engine firefox` | both exit 0, replay-verified, 12/20-command streams as pinned |
| core hash bench @300 entities | incremental 63.6 µs / slow 422.7 µs = **6.6×** (item 5) |

## Gate non-vacuity, by reviewer perturbation (all applied to built output only; all restored by clean rebuild and re-verified green)

| # | Reviewer mutation (chosen independently of the implementer's list) | Result |
|---|---|---|
| P1 | `applyDeskDecision`'s cash write → in-place `hotel.cash += rate` (built `game.js`) | **checkin-rush exit 0 — NOT caught.** Later legitimate `setComponent`s on the `hotel` entry healed the staleness before the final-tick hash. Kept in the verdict as the honest negative result; drives item 2. |
| P1b | `moveSystem`'s NPC pos write → `Object.assign(pos, resolved)` — a violator that is the entry's last writer | **corridor-headon exit 3** on both legs: `incremental=3310549448 slow=2843227394`, divergence message naming the write-through cause. The cross-check fires, live and replayed. |
| P2 | `pathSystem`'s avoid-cell consumption forced to `avoidIdx = -1` (sidestep repath becomes the pre-H2 identical-route recompute) | **corridor-headon exit 1**: red on exactly "sidestep RESOLVED", "all six agents at goal", and "all three pairs resolved"; **"sidestep FIRED" stays green and "zero nav.stuck" stays green** — independently confirming both implementer claims: the un-avoided recompute is a livelock, and it is a *silent* one (stuckTicks resets each blocked/unblocked cycle, so nav.stuck never fires). |
| P3 | `rulesForStars` stops filtering (returns all rows) — the implementer's own control-killer, re-run as instructed | **escalation-stars exit 1**: red on exactly the pre-tier CONTROL assertion. The rebuilt control (list seeded non-empty at setup, so `minStars` is the only pre-tier excluder) genuinely discriminates the star gate now; the first draft's confound is closed. |
| P4 | Checkout mess spawn count forced to 0 (built `game.js`) | **zen-clean exit 1**: six reds — mess count 2–4, the denied-room refusal chain, wipe-by-hand, dirty-then-sold, and the idle-gap-reality assertion. The zen gate is anchored on real messes, not on the absence of penalties alone. |
| P5 | `clerkErrs` → always `true` (built `staff.js`) | **first-hire exit 1**: red on exactly "the clerk caught at least one planted fraud, attributed to staff:*". The skill path is load-bearing and the fraud-catch attribution assertion rides on the real error hash, not on scripted luck. |

## What I tried to break and could not

- **The incremental hash's cache-order coherence.** Attacked the design on paper for a size-equal-but-keys-differ or order-divergent cache: every write path touches store and cache together, `setComponent` marks dirty *without* deleting (the comment's re-insertion-order trap, correctly dodged), remove/despawn delete from both, `restore()` clears wholesale, and the rebuild-on-size-mismatch path rebuilds in store order. Component names still fold for empty stores (the created-then-emptied distinction, unit-asserted). Empirically: 18 scenario runs, headless and browser, two engines, all with incremental === slow on live and replay legs.
- **The clerk as an actor.** Source-verified: `staffBrainSystem` submits `interact`/`desk.decision` via `s.submit` as `staff:<entity>`; those are consumed by `interactSystem`/`deskSystem` later the same tick through the live `pendingCommands` array; `applyDeskDecision` resolves the actor through `findActorEntity` (an `actorId` scan — the literal `"player"` appears in no decision/validation path below the marker comment at game.ts:1137) and runs the identical desk-radius and reservation-state checks on every caller. Replay soundness: the browser command log records only hook-submitted (host input) commands — a system-submitted clerk command is never in the log, so it is re-derived, not double-applied; every `--verify-replay` leg confirms. The stand-down rule (any other focus holder) removes the race by construction.
- **Spec risk 5 (singleton-player) via grep.** `PLAYER_ACTOR`/`PLAYER_ENTITY`/`"player"` literals below the actorId migration line exist only in the player-input branches of `moveSystem`/`faceSystem` (movement is genuinely the human's input, not a decision path) and in command-factory defaults. The two scenario/test clerks gained `actorId` alongside `player`.
- **The `desk.falseDeny` ground-truth change as a fraud-gate weakening.** `wasPlanted` is now `evaluateRules(...).length > 0` against the live rule context. In the H1 gates (stars 1, lists empty) planted and actual coincide, and both fraud gates still assert their exact event counts — `fraud-catch`: fraudCaught 2, fraudMissed 0, **falseDeny 0**; `fraud-catch-b`: fraudMissed 2, falseDeny 4 — all green. The change matters only where it should: a real name on a delivered bulletin is now a true catch rather than a logged injustice.
- **The H1-gate config pins as content-hiding.** `upkeep: false` / `arrivals: "fixed"` on checkin-rush/fraud-catch/corridor-headon protect H1 semantics (STAY_TICKS was tuned against exactly that turnover; the headon fixture's committed entity ids must not shift) while the SHIPPED defaults (`upkeep: true`, `arrivals: "demand"`, verified in `DEFAULTS`) are exercised by zen-clean and the full 42,000-tick one-man-week. This is legitimate pinning, not evasion: determinism rule 8 verbatim.
- **The golden re-pin's "unmodified logic" claim.** The lane-1 diff to smoke/bots-headless/net-game/three package fixtures converts in-place mutations to write-through with identical values — behaviour-preserving by inspection, and required by the new contract, not smuggled retuning. Nothing else was re-pinned or re-tuned alongside the hash change; the H1 fraud/rush/headon streams then held byte-stable through my full battery.
- **The zen ruling, structurally.** `mess` and `prop` carry no timestamp field of any kind — nothing in the shapes can decay, compound, or expire; the refusal is `desk.denied-room{not-ready}` with nothing charged and the reservation left undecided; zen-clean's idle-gap assertion is anchored on a proven-real gap (P4 showed the anchor bites). Reviews are a pure function of integer stay facts and objectives have no penalty branch — both unit-asserted, both squarely inside DESIGN's dark-pattern avoid-list.
- **Bulletin/list mechanics.** Delivery activates (`noticeList` append + rule context rebuild per evaluation), reading only flips a boolean — asserted by escalation-stars' unread-but-live check. `isBulletinDay`/`bulletinNameFor` are stateless hashes over a salt drawn once at setup (draw-at-generation; seed-derived, so restore-safe). `RULES` is never mutated; tiers change which rows are *active*, lists change what `listed` compares against.
- **The owner bot's honesty.** IWorld-read + command-intent only; no component writes, no teleports; its `findJitteredPath` reuse shares only call-local scratch (generation-stamped, nothing survives a call — and the A* scratch refactor is therefore invisible to determinism, as the byte-stable H1 goldens confirm). `--verify-replay` replays the recorded log with no bot code, which is exactly what keeps "the bot played a week" and "the sim is deterministic" separate claims.

## The §4 deferral ledger, audited

| # | Ledger disposition | What the branch actually did | Verdict |
|---|---|---|---|
| 1 | Quick-load semantics / listGames / `"./recover"` → H2b | Untouched here; nothing landed prematurely | correctly carried |
| 2 | `resetEntityKeyedHostState` exercised → H2b | Carried — and the new `render/upkeep.ts` register-guard Set was correctly added to the reset seam *now*, so H2b's exercise will cover it | correctly carried, seam extended |
| 3 | `debug.*` server rejection → Phase 5 | Untouched | correctly carried |
| 4a | `space` A* extraction → Phase 3; standing rule: no new raw `findPathCells` caller | Clerk and candidate route via `findJitteredPath`/`setGoal`; the allocation refactor happened inside the hotel copy as the ledger prescribed | honoured |
| 4b | Sidestep-branch assertion → H2a | Landed: third corridor-headon pair, id-relation assertion (wait branch cannot satisfy it) + RESOLVED assertion; both claims (dead code, silent livelock) reviewer-confirmed via P2 | **closed** |
| 4c | indexSystem + A* scratch + `checkin-rush ≤ 0.030` → H2a | Landed; H1 goldens byte-stable through it; the 0.030 figure is method-ambiguous (item 4) but the warm like-for-like number beats it ~3× | **closed** (item 4 caveat) |
| 4d | `plantViolation` `listed` fix → H2a | Landed with the prescribed shape: `ctx` param, plantable-rows filter, pick-from-real-list, rule-table-driven field propagation, round-trip property over `listed` with a fixture list — plus a throw against planting an unviolatable row | **closed** |
| 4e | Doors → Phase 3 | Untouched | correctly carried |
| 4f | Boom clip → H2b | Untouched | correctly carried |
| 5 | Pattern obligations adopted as standing rules | All four apps carry layout()-derived both-branch + guard decision tests; the overflow loop **derives from `HOTEL_APPS`** (verified in the suite output — six apps enumerated, and the derivation caught the RESERVA stars-key regression in the process); no H2 scenario gates input at tick ≤ 5, so that tripwire carries with trigger intact | honoured |
| — | `save-restore` pinned-pose residual → `save-resume` must not inherit | H2b's scenario; the ledger row is restated in the spec for it | carried |

## Rulings on the implementer-flagged deviations

1. **`buildScreenWorldView` stays IWorld-only** (spec §12.1 suggested the tick context) — **upheld.** It is the one view builder shared by `screenSystem` and the host repaint; two builders that can disagree is precisely the H1b screen-contract bug. The single-sweep rewrite gets the perf substance without the fork.
2. **`MAX_STARS = 2`** — **upheld.** Spec §10 names 1–2 as H2's reachable range; tiers 3–5 thresholds are committed and unreachable, so a later phase raises a cap rather than inventing math.
3. **Bulletin days/content by stateless hash rather than Rng draw** — **upheld.** Delivery frequency must not perturb a stream; the salt is drawn once at setup (draw-at-generation), everything else is hash-at-decision — the spec's own rule 3 pattern, and restore-safe because the salt re-derives from the seed.
4. **The H1 gates' ScenarioConfig pins** — **upheld** as protection, not evasion (see "what I tried to break"). The spawn-interval/`startingCashMinor` additions default to H1's exact draw; the fixed-arrivals rollover re-arm defect fix is real (an absolute tick treated as an interval) and is covered by the gates that ride the fixed schedule.
5. **The known gap: no repeatable browser gate for clicking a mess/prop/candidate** — **accepted for H2a, first item of H2b's list, and it must actually land there.** The reasoning is sound (a browser scenario clicks the shipped world; the objects don't exist at reachable ticks in a cold run, and a gate that clicks a door panel is worse than none), the drive-through evidence is committed (`apps/hotel/docs/evidence/h2a-upkeep-objects.png`, verified present), and H2b — which owns browser gates and will restyle these exact objects — is the phase where a regression would otherwise ship invisibly. This is the same failure shape as H1b's blocking item; it is non-blocking *now* only because the verification debt has a named owner, a committed reason, and a phase boundary it cannot cross twice. If H2b arrives without this gate, that review should treat it as blocking.

## Consolidated deferral list for H2b (start from this)

1. **The upkeep-click browser gate** (ruling 5 above) — a repeatable gate that clicks at least a mess and a candidate in the real browser build. The implementer's stated obstacle (world state at gate tick) is an infra problem H2b's scenario work should solve, not accept — e.g. a scenario config that pre-dirties a lobby-adjacent room at setup.
2. **Objectives on a screen, or the key deleted** (item 1): make `screen-data.ts`'s budget table true either way.
3. **Write-through detector honesty** (items 2–3): document the healing window at `stateHashSlow()`/invariant 6; optionally add periodic hashCheck under `--verify-replay`; gate `available: false` in the browser hash check.
4. **Perf bookkeeping** (items 4–5): record the warm-bench methodology beside the carried numbers (checkin-rush warm median 0.0107 ms/tick as of this review; hash speedup 6.6× at the 300-entity fixture).
5. **Carried from H1b unchanged, all H2b-scheduled by the spec's own ledger:** quick-load/id-switch + `listGames`/`deleteGame` + `"./recover"` subpath + `save-resume` (no pinned-pose inheritance); `resetEntityKeyedHostState` exercised for real (now including the upkeep register guard); `player-fps` `objectToEntity` reverse-map prune; boom clip; the look-lock with its human sign-off; byte-identical H2a goldens as H2b's first check — this review's pinned values: smoke **3849639990**, checkin-rush **1978775531**, one-man-week **3423109909**.
6. **Phase 3+ carries, triggers unchanged:** `space` A* extraction (second consumer/crowd scale); doors; `debug.*` server rejection (Phase 5, before any remote actor).

**Phase H2a is clear to merge to `main`.**

---

## Post-verdict addendum (implementer, before merge)

The verdict is PASS and none of the five items blocked. Four of them were
cheap enough that carrying them would have been laziness rather than
scheduling, so they were closed on this branch before the merge. This
section is the implementer's record of what changed after the verdict
commit; the verdict above is untouched.

**Item 1 — objectives are now on a screen.** AUDIT paints the day's three
objectives with their targets, progress, rewards and a done marker, plus
the line "A missed objective costs nothing." (the no-penalty ruling, said
out loud rather than merely implemented). `screen-data.ts`'s budget table
was already claiming AUDIT read the key; it is now true rather than
corrected away, because the reviewer is right that a sim-real feature no
screen shows is the "verified but invisible" shape this project keeps
catching.

**Item 2 — the healing window is documented honestly AND narrowed.** The
comment on `stateHashSlow()` now states the limit the review measured: a
violator is caught only while its stale digest is still cached, so one that
is the entry's LAST writer is caught (the permanent, dangerous class) and
one followed by any normal write to the same entry is not. Beyond
documenting it, the harness now cross-checks every
`HASH_CROSSCHECK_INTERVAL_TICKS` (500) as well as at the end, on BOTH the
live and the replay legs, and the first divergence wins over a later
agreement. Verified against the review's own P1 — the perturbation that
went undetected: `applyDeskDecision`'s cash write converted to in-place
`hotel.cash = hotel.cash + rate` in the built sim now makes
`checkin-rush --verify-replay` exit 3 on both legs with the divergence
message, where before it exited 0 clean. Restored by clean rebuild and
re-verified green. The window is bounded to 500 ticks, not closed; closing
it means the full walk every tick, which is the cost the change exists to
remove, and the comment says so.

**Item 3 — `available: false` is now an infra failure.** The browser leg
exits 2 with a message naming the cause if the page's world does not expose
`stateHashSlow()`. "The check could not run" is no longer reported as "the
check passed".

**Item 4 — the perf methodology is recorded** in ARCHITECTURE B8, beside
the numbers: the harness's single-run `avgTickMs` is cold-start dominated,
warm in-process medians are what before/after comparisons must use, and
both the carried `checkin-rush` figure and `one-man-week`'s 0.446 are
written down with the method that produced them.

**Item 5** needed no action and stands as recorded.

The H2b deferral list above is therefore reduced to items 1, 5 and 6 —
the upkeep-click browser gate, the H1b carries, and the Phase 3+ carries.

