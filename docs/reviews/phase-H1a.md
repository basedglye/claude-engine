# Phase H1a review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `hotel-phase-1` at `31d9647`, diffed against `main` (4 commits, spec first).
Spec: [docs/PHASE-H1.md](../PHASE-H1.md) — **H1a scope only.** H1b's surfaces (`surface-ui`, `save-web`, the terminal, `screenClick`, the readability probe) are correctly absent and were not treated as missing.

All verification below was re-run or re-derived by the reviewer. None of the six implementation-time defect fixes, and none of the implementer-flagged judgment calls, were taken on trust.

## Verdict: PASS (0 blocking; 5 non-blocking items recorded for H1b's first commit)

The substance holds under attack. The four new gates are genuinely non-vacuous — two were perturbation-tested by the reviewer and went red on exactly the targeted assertion. The no-closure-state rule survives the hardest snapshot boundary this phase can produce (mid-queue, a guest `presenting` with an undecided reservation, documents held by the clerk, planted fraud in flight, and post-restore guest spawns continuing hash-identically off the registered forks). Determinism, the rule-table keystone, actor-binding, and the deferral ledger all check out. Nothing blocks merge.

### Non-blocking items (land with H1b; none needs a re-review round)

1. **[NON-BLOCKING] `ScenarioConfig.spawnTickMax` is dead config** — `apps/hotel/src/sim/game.ts`. Confirmed: `guestSpawnSystem` schedules `nextGuestAtTick = tick + 50 + rng.int(0,100)` and never reads `spawnTickMax`. The spec's "8 guests over ticks 100–900" holds only empirically for these seeds (derived arrivals 100–737), not by construction. Fix: enforce the cap in `guestSpawnSystem` or delete the field and the scenarios' `spawnTickMax: 900` lines — either way, stop shipping config that silently does nothing.
2. **[NON-BLOCKING] The spec's temporary desk keys were never wired** — `apps/hotel/src/main.ts` contains no `desk.decision` binding at all (the "TEMP DESK KEY" marker exists only in `game.ts`'s factory comment). A live player can walk to the queue head, trigger `presenting`, and inspect the held documents, but has no way to accept or deny — live-app check-in cannot complete without the harness clerk. The spec's goal reads "player key **or** `clerkBot`", the one validated `desk.decision` path is real and fully exercised, and H1b's terminal replaces the keys anyway, so this does not block; but H1b must note there is nothing to delete, and the terminal is now the *first* player-facing decision input, so its wiring gets no temp-key fallback to hide behind.
3. **[NON-BLOCKING] `plantViolation`'s `listed`/`mustBe:"absent"` branch plants a violation that `evaluateRules` does not flag** — `apps/hotel/src/sim/rules.ts:281`: it writes `"__unreachable-h1-listed-present__"`, a value guaranteed *not* on any list, so the rule passes and the plant/evaluate round-trip property is false for that branch. Unreachable with `H1_RULES` (no `listed` row ships) and self-documented as such, but it is committed wrong code guarding a Phase-3 feature. Fix when the first list lands: plant by *adding the value to the list* (which means `plantViolation` needs `ctx`), and extend the round-trip property test to `listed` rows — it currently cannot cover them.
4. **[NON-BLOCKING] `corridor-headon`'s mirrored-pair rationale overclaims** — the scenario comment says the flipped id/direction relation exercises the "sidestep-repath" branch; reviewer instrumentation shows the fixture's two `nav.yield`s are both the *wait* branch (`18 blocked by 17`, ticks 6–7). The sidestep branch **is** exercised — once, in `checkin-rush` (reviewer-measured branch histogram: headon `{wait:2}`, rush `{sidestep:1, wait:3}`, fraud `{}`) — so coverage exists across the gate set, but no assertion pins it. Correct the comment, and consider asserting at least one sidestep yield somewhere before Phase 3 crowds rely on that branch.
5. **[NON-BLOCKING] `moveSystem` rebuilds the open-cell set inside the player command loop** — `game.ts:703`: `buildOpenCellSet` runs per `move` command rather than once before the loop. One player, one command per tick — harmless today, and determinism rule 6 only demands per-tick locals, which these are. Hoist it when Phase 2's `indexSystem` refactor touches this file.

## Verification battery (all executed by the reviewer)

| Command | Result |
|---|---|
| `npm run build` | exit 0 |
| `npx eslint .` | exit 0 |
| `node scripts/check-purity.mjs` | exit 0 — seven roots clean, `apps/hotel/src/sim` scanned |
| `node scripts/check-purity.mjs --self-test` | exit 0 — plants CAUGHT, negative controls intact |
| `npm test` (smoke) | exit 0, hash **919868270** unchanged, replay PASS |
| core / space / interiors / assets / bots / hotel suites | all exit 0. Interiors: golden re-pinned, 100-seed H1a sweep (queue chain walkable+adjacent, terminal anchor, bedroom reachability, street connectivity, risk-1 leave-path-avoids-queue) all 100/100. Hotel: rules unit tests incl. the plant/evaluate round-trip property, despawn baseline. Bots: clerkBot cadence + Rng-isolation tests |
| `corridor-headon --verify-replay` | exit 0, 5/5, verified (2315821051), avgTickMs 0.036 |
| `checkin-rush --verify-replay` | exit 0, 7/7, verified (1452997889), **avgTickMs 0.027 / p95 0.029 — the ≤ 2 ms budget met with ~75× headroom** |
| `fraud-catch --verify-replay` | exit 0, 7/7, verified (166801783) — 2 planted, 2 caught, 0 missed, 0 falseDeny |
| `fraud-catch-b --verify-replay` | exit 0, 6/6, verified (3560365532) — both plants missed, missed-fraud guests check in, clean guests falsely denied; the failure path is a real path |
| `walk-collide --verify-replay` | exit 0 |
| `fps-look-interact --browser --verify-replay` ×2 Chromium, ×1 Firefox | all exit 0, 2/2, verified, and a **byte-constant command stream** (`face`×2, `move`×9 ticks 1–9, `interact`×1) on all three runs — the re-derived literals for the new topology hold at the round-3 constancy bar |
| `smoke`, `demo-walk`, `demo-visual --browser`, `bots-headless`, `net-*`, `soak-ci --soak` | all exit 0 |

`git status --porcelain` empty at review end (all perturbations were applied to gitignored build outputs and reversed by a clean `build:game`; every gate re-run green after restore).

## What the reviewer tried to break and could not

- **No-closure-state, at the spec's own sharp edges.** Scratchpad repro against shipped dist (seed `hotel-h1-fraud-1`, fraud 500‰, clerk driving): ran to tick 145 — a guest `presenting` at slot 0, its reservation undecided, both its documents `heldBy` the clerk, five guests queued behind it, two planted violations in the pipeline — `snapshot()`, then 600 input-free ticks on both the continuous sim and a fresh `setupWithConfig` + `restore()` sim. **3256355615 == 3256355615**; guest states, queue indices, reservations and planted-violation strings identical — including *guests spawned after the snapshot*, which proves the `guest-spawn`/`guest-fraud` fork streams are captured, not merely re-seeded. A second repro at a checkout-in-flight boundary was also hash-equal. The queue really is derived (scan + compact each tick), the repath cursor really is the `navSchedule` component, and `config` capture is legal because restore re-runs the same `setupWithConfig`.
- **Gate vacuity, by perturbation (the two-gate minimum, met).** (1) The yield rule deleted from the compiled `moveSystem`: `corridor-headon` exits 1 with exactly assertion 4 red — "the conflict was real: the yield rule fired". The other four stayed green, because the agents still arrive by ghosting through each other, which is precisely why the `nav.yield` assertion is load-bearing. (2) `evaluateRules` neutered to `return []`: `fraud-catch` exits 1 with the fraudCaught-count, zero-fraudMissed and denied-guests-left assertions red. Both restored via clean rebuild — note `tsc` incremental silently *skips* rebuilding when only dist is mutated, so the first restore attempt was a no-op; `rm -rf dist-game` first.
- **Determinism.** `jitter` is a committed xorshift-mix hash of `(agentSeed, cell)` — zero Rng draws at query time; `agentSeed` assigned once at spawn from the registered fork. No `Math.` transcendentals, no `Math.random`, no `Date` anywhere in the sim roots (mechanically confirmed). clerkBot's error roll draws from its own bot Rng, always on a decision tick regardless of `invert` wiring — stream position cannot depend on caller configuration. Every gate replayed to its live hash.
- **Actor-binding.** `deskSystem` resolves `c.actor` through a `player`-component scan and range-checks *that entity* against the desk anchor; the clerk is a second actor with its own entity, and the whole fraud pipeline runs through it with the player standing idle at spawn. Nothing in the decision path reads `PLAYER_ACTOR` or `PLAYER_ENTITY`. Multiplayer is configuration.
- **The ledger.** `checkin-rush`'s balance assertion re-totals every `ledgerEntry` signed both ways from scratch (net must be exactly 0) and cross-checks `hotel.cash` and the event log; the "non-zero occupied rooms" floor in the occupancy assertion is the anti-vacuity guard the `STAY_TICKS` retune exists to satisfy. Verified honest: at 2400 ticks no day rollover occurs (`DAY_TICKS` 6000), so the expense term is legitimately zero and the scenario comment says so out loud.
- **The interiors property tests.** Diff-checked: the only removed lines are the old golden constant and the old door-count literal — the bijection/traversal/connectivity logic is unmodified, exactly as deferral item 3 requires, with the five new H1a properties layered on top at 100/100 seeds.

## Rulings on the implementer-flagged items

1. **The hotel-local `isOccupiable`/`findJitteredPath` instead of `space.findPathCells`** — **upheld, with a named deferral.** The reasoning is correct on both counts: `findPathCells` has no cost hook (so jitter cannot live there without changing `space`, which spec §F forbids), and the 8-neighbour clearance rule is genuinely a radius-policy question (300 mm collider on 250 mm cells), not geometry. The fix is *not* door-specific — it is radius-vs-grid-specific — and the honest cost (one cell of margin everywhere) is covered by the interiors clearance properties. But `findJitteredPath` mirrors `findPathCells`'s algorithm by hand, and `space.findPathCells` remains a footgun for any radius-aware caller: **deferral — Phase 2/3 must either add a clearance/cost-aware variant to `space` or extract this A* into it when a second game needs crowds, and until then no new caller may use raw `findPathCells` for a collider-bearing agent.**
2. **`nav.yield` beyond the spec's event vocabulary** — **approved.** Additive, sim-meaningful, and existing precisely to satisfy the H0 review's non-vacuity standard: the reviewer's perturbation run is direct proof it is the only thing standing between a deleted yield rule and a green gate. An event vocabulary that cannot prove its own mechanisms fired is the vacuous-gate defect wearing a different hat.
3. **`STAY_TICKS` 500 → 1600** — **approved.** Open question 4 grants the tuning; the documented reason (occupancy assertions comparing 0 against 0 at 500) is the hardcoded-`[]` lesson applied correctly, and the constant's comment records the arithmetic against the gate's fixed numbers.
4. **`spawnTickMax` dead config** — confirmed, recorded as item 1.
5. **`temp-font-painter.ts`** — **acceptable as shipped.** Canvas `fillText` nondeterminism does not matter here: the painter feeds only the held-document prop texture, which no probe samples, nothing hashes, and no sim state reads; invariants 2 and 3 are untouched. The supersession is adequately forced by three tripwires (file header, `documents.ts` header, the spec's lane 10). It goes on the H1b deferral list so it cannot be missed.
6. **Absent-document semantics (a missing ID trips one flag, not three)** — **upheld.** Making `fieldMatch`/`notExpired`/`listed` pass on an absent document is what makes the plant/evaluate round-trip property exact ("exactly `[thatRule.failFlag]`, not a superset") — the property the hotel unit suite proves per row and the fraud gates lean on for their event counts. `docPresent` owns absence; cascading flags would make `desk.fraudCaught { violations }` ambiguous about what was actually planted. This is the evaluator behaving as an oracle rather than as a UI.

## The deferral ledger, audited row by row

| # | Stated disposition | What the diff actually did | Verdict |
|---|---|---|---|
| 1 | Boom clip re-deferred to Phase 2 | Camera rig untouched | honoured |
| 2 | `isOpenAt` cost fixed in H1a | `portalCellsByDoorIndex` precomputed at setup; `buildOpenCellSet` built per tick as a local. Note the *planner* sidesteps the question entirely (`isOpen = () => true`, guests open doors just-in-time in `moveSystem`) — the open-set is load-bearing only for `moveCircle`, which is where it is built | honoured |
| 3 | Golden re-pinned, property logic unchanged | Verified by diff: only the hash constant and door-count literal changed | honoured |
| 4 | Keep as-is | Kept; the street strip extends the same 2D grid via a `marginZ` reshape | honoured |
| 5 | Don't copy the closure pattern | `corridor-headon` explicitly writes its observations into a `headonLog` *component* with a comment citing this rule; the other gates read only the Sim | honoured, exemplary |
| 6 | No new wall-clock steps | H1a adds no browser scenarios; `fps-look-interact` literals re-derived once (risk 6 satisfied) | honoured |
| 7 | `pollUntilTick` trigger unchanged | No trip observed (constant command streams in all 3 browser runs) | carried |
| 8 | Start barrier opt-in tripwire | No new browser-driven app | carried |
| — | Command stamp `world.tick + 1` | No H1a rule reads `c.tick`; convention intact | honoured |

## Foundation for H1b and Phase 2 — judged sound

- **The screen contract's sim side already exists:** `terminal` (`focusedBy` per actor, toggled through the same validated `interact` seam), `screenApp` (`{state, paintSeq}` on the terminal entity), `screen.blur`, and an explicit numbered `screenSystem` slot in the registration order with a delete-me marker. H1b's RESERVA effect re-submitting `desk.decision` will hit the same validation `clerkBot`'s decisions hit today — reviewer-confirmed there is exactly one decision path.
- **`save-web` can snapshot/restore this sim as-is:** the mid-presenting restore repro above is precisely the state a mid-day IndexedDB load must survive, and it is hash-exact, forks included.
- **The rule table is the keystone it claims to be:** rows are serializable data, `rulesForStars` is the escalation filter (tested against a planted `minStars: 2` row), descriptions and evaluation are separate code paths, and the one evaluator serves `deskSystem`, `clerkBot` and — by import path already laid out — the H1b app. Phase-3 rows append; nothing restructures. Risk 5 (kind creep) did not materialise: exactly the four specified kinds ship.
- **Scale:** measured `checkin-rush` avgTickMs **0.027** against the ≤ 2 budget (~60 entities). First to break at Phase-3 scale, in order: the O(grid) array allocations per `findJitteredPath` call (4 arrays × 1968 cells × up to 10 repaths/tick) and its O(n²) linear-scan open list; then the per-tick full-component scans (occupancy, queue derivation, `snapshotPrevSystem` over every `pos` holder). All are numbered now; the Phase-2 `indexSystem` refactor lands against 0.027 ms, not vibes.

## Consolidated deferral list for H1b and Phase 2 (start from this)

1. **Delete `render/temp-font-painter.ts`** when `surface-ui/host`'s committed-atlas `paintScreen` ships; repaint `render/documents.ts` through the one painter. **(H1b, mandatory)**
2. **No temp desk keys exist to delete** (item 2 above) — the terminal is the first player decision input; wire `desk.decision` from RESERVA's effect with no fallback assumed. **(H1b)**
3. **`spawnTickMax`**: enforce or delete. **(H1b, first commit)**
4. **`plantViolation` `listed`/`absent` branch + round-trip coverage for `listed` rows**: fix before the first list ships via MAILBOX. **(Phase 3, hard trigger)**
5. **`space.findPathCells` is unsafe for radius-aware callers**; the hotel's clearance-aware A* is the only safe path for collider agents. Extract into `space` (cost hook + clearance) when a second game or Phase-3 crowds need it; until then, ban new `findPathCells` callers for moving agents. **(Phase 2/3)**
6. **Sidestep-branch coverage**: correct `corridor-headon`'s mirror comment; assert at least one sidestep yield somewhere before crowd density rises. **(Phase 2)**
7. **Per-tick O(entities)/O(grid) scans and the A* allocation profile** — the measured refactor targets for Phase 2's `indexSystem`. **(Phase 2)**
8. **Guests never close doors** (documented judgment): revisit when heating/privacy/stealth mechanics make door state gameplay-relevant. **(Phase 3 content trigger)**
9. Carried unchanged from H0 round 3: boom clip (Phase 2), `pollUntilTick` bounded-late (trigger: a command landing one tick past its gate), start-barrier opt-in (trigger: first tick-gated scenario against a new app).

**Phase H1a is clear to merge. H1b proceeds against this list.**
