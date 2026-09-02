# Phase H4 spec — "The Campaign" (ALPHA)

Status: **planned, with named contract resolutions deferred to one planning
turn at the H3b merge** (§3 marks each). Step-1 output of the
[WORKFLOW.md](WORKFLOW.md) loop. Parent: [PLAN-ALPHA.md](PLAN-ALPHA.md).
Predecessor: [PHASE-H3.md](PHASE-H3.md). Assessment:
[ASSESSMENT-ALPHA.md](ASSESSMENT-ALPHA.md).

**This spec supersedes roadmap Phase 4, and its end is ALPHA.**

> **Why some contracts here are deliberately unresolved.** H4's economy,
> failure-spiral and rival-AI contracts depend on numbers H3a has not
> measured yet — perf at 3× scale, star-gate thresholds against real
> occupancy, and what a day of a three-floor hotel actually earns.
> Specifying them now would be a figure without a method, which is the one
> thing this project's standard forbids ([ASSESSMENT-ALPHA.md](ASSESSMENT-ALPHA.md)
> §4.5). Each is marked **[planning-turn @ H3b merge]** with the exact
> inputs it needs, so the turn is a bounded resolution pass, not a re-plan.

> **⚠ PUBLIC CONTRACT CHANGES**
> - `@claude-engine/persistence` — **saves become versioned** ([PLAN-ALPHA.md](PLAN-ALPHA.md) §3.7).
>   This is an alpha requirement, not a nicety.
> - `apps/hotel` — `ScreenViewData` is **split per app**; the 9-key
>   monolith ends here rather than growing a tenth key.
> No CLAUDE.md invariant changes.

---

## 1. The split ruling

**H4a — "The Campaign" (everything hashed).** Role XP and mastery; prestige
as setup-ritual compression; contracts and inspections; loans, the failure
spiral and the repo manager; seasonal events; the bounded incident cascade;
SP rival hotels via `rivalAiSystem`; breakfast as an amenity; the pager's
sim side; versioned saves and migration. **Every gate headless,
`--verify-replay`.**

**H4b — "The Campaign, Rendered + ALPHA LOCK" (everything else).**
STREETVIEW as app eight and the `ScreenViewData` per-app split; contract and
inspection surfaces; the pager's surface; the weekly seed challenge with an
exportable verdict; the browser gates for every new verb; **and the alpha
playtest** — a human playing for at least two hours, which is a gate, not a
nicety, because roadmap risks 3 and 8 have warning signs defined as human
experience and no bot can observe either.

Sequencing: H4a may start against H3a's merge and run in parallel with H3b.
H4b requires both H3b and H4a merged.

---

## 2. Goal

Thirty in-game days are a *campaign*. You take a conference contract and a
film crew, and a health inspector arrives to scrutinise **you** — Papers
Please in reverse, reusing the document entities and the rule table
wholesale. You borrow to open the third floor and nearly lose the building;
a repo manager follows you around and repossesses in reverse unlock order,
never the front desk, and the floor of the spiral is a recoverable one-man
show. A leak becomes a puddle becomes a complaint — bounded, twice, never a
cascade without end. Two rival hotels down the street price against you and
you read their rates through STREETVIEW. At the end you sell up, keep your
mastery, and start on a bigger lot with your unlocked apps and your
re-hirable staff. Your save survives all of it, and if a future version
cannot load it, it says so instead of silently starting you over.

---

## 3. API contracts

### A. `persistence` — versioned saves **[public-contract ⚠]**

The current policy — *"H2a registers new `forkRng` labels, so H1 saves fail
`Sim.restore()`'s label check by design; the boot path treats a
`RestoreError` as 'no save' and starts fresh; pre-1.0, this is policy"* — is
correct up to alpha and wrong at alpha. An alpha is played across sessions,
and every phase that registers a new label silently deletes somebody's
hotel.

```ts
// packages/persistence/src/index.ts

/** Stamped into every record on write. Bumped by any change that makes
 *  older records unloadable -- a new forkRng label, a component rename, a
 *  changed hash scheme. */
export const SAVE_FORMAT_VERSION: number;

export interface SaveMeta {
  gameId: string;
  formatVersion: number;
  /** The seed and the HotelSpec: a save is (seed, spec, command log), and
   *  the spec is what makes a renovated hotel regenerate identically. */
  seed: string;
  createdAtTick: number;
}

/** Explicit outcomes. The point of this type is that "cannot load" is a
 *  VALUE the boot path must handle, not an exception it may swallow into a
 *  fresh game. */
export type LoadOutcome =
  | { kind: "loaded"; sim: Sim }
  | { kind: "none" }
  | { kind: "tooOld"; meta: SaveMeta; migratedTo?: number }
  | { kind: "tooNew"; meta: SaveMeta }
  | { kind: "corrupt"; meta?: SaveMeta; detail: string };

export function loadGame(store: GameStore, gameId: string): Promise<LoadOutcome>;

/** Registered migrations, applied in order. A migration that cannot be
 *  written honestly returns undefined and the outcome stays `tooOld` --
 *  refusing to load is a correct outcome; pretending is not. */
export function registerMigration(from: number, to: number, fn: MigrationFn): void;
```

**Boot behaviour, decided here so no lane decides it:** `tooOld` /
`tooNew` / `corrupt` show a **diegetic one-line notice** and start fresh —
the player is told, in the fiction, that the building's records are
unreadable. Silent fresh start is forbidden from alpha on. (H2's ruling left
this to `main.ts`'s judgement; alpha revokes that latitude.)

### B. `apps/hotel` — the campaign systems

```ts
// apps/hotel/src/sim/components.ts (additions; integers only)

/** Role XP and mastery. Permille everywhere; mastery perks are unlocks,
 *  never multipliers on a float. */
export interface RoleXp { byRole: readonly { role: StaffRole | "owner"; xp: number }[] }

/** A signed contract: a conference, a film crew, a health inspection.
 *  Reuses the document entity and rule-table machinery -- an inspection is
 *  a rule set evaluated against YOUR hotel instead of a guest's papers. */
export interface Contract {
  kind: string;                    // committed content id
  signedOnDay: number;
  dueOnDay: number;
  /** Requirements evaluated at settlement; integer facts only. */
  requirements: readonly { key: string; atLeast: number }[];
  rewardMinor: number;
  penaltyMinor: number;
}

/** Debt. The spiral's floor is recoverable by construction: repossession
 *  runs in REVERSE UNLOCK ORDER and the front desk is never repossessed. */
export interface Loan {
  principalMinor: number;
  /** Permille per day, truncating division. No compounding float. */
  interestPermille: number;
  /** Set when the repo manager spawns; cleared when cured. */
  inDefaultSinceDay?: number;
}

/** The bounded cascade. It lives HERE and never in `mess` or
 *  `repairProgress`, which continue to carry no timestamp field of any
 *  kind -- that is what keeps the zen ruling reviewable by inspection
 *  (DESIGN "pressure vs zen"; PLAN-ALPHA.md section 3.4). An incident is a
 *  declared PRESSURE activity in its own right. */
export interface Incident {
  sourcePropEntity: number;
  /** 0 or 1. Chain depth is CAPPED AT 2 by construction: a depth-1
   *  incident can spawn a depth-2 consequence and a depth-2 one cannot
   *  spawn anything. The cap is in the type's documentation and in the
   *  system's only spawn call site, and the gate asserts it. */
  depth: number;
  ticksUntilConsequence: number;
}

/** Prestige = setup-ritual compression (DESIGN section 6), audited against
 *  the dark-pattern list. Nothing here is a currency and nothing decays. */
export interface Prestige {
  runs: number;
  carriedAppIds: readonly string[];
  carriedStaffKeys: readonly number[];
  startingLotTier: number;
}
```

```ts
// apps/hotel/src/sim/rivals.ts (new)

/** SP rival hotels are the same `hotel` entities MP players will own,
 *  driven by a system MP simply does not register (ARCHITECTURE B9). This
 *  is the MP prep Phase 5 needs, delivered as SP content.
 *
 *  Determinism: one forked Rng per rival, drawn at generation moments
 *  only; every per-day decision is a stateless hash of (day, rivalId,
 *  salt), so decision frequency can never perturb a stream. */
export function rivalAiSystem(world: IWorld, ctx: TickContext): void;

/** What STREETVIEW may show. Read-only, and deliberately the same shape the
 *  MP interest policy will be allowed to send: a rival's posted rate and
 *  visible queue, never their finances. Pre-building this surface in SP is
 *  the point. */
export interface RivalIntel {
  rivalId: number;
  postedRateMinor: number;
  visibleQueueLength: number;
  starTier: number;
}
```

### C. Marked for the planning turn

| Contract | Blocked on | Inputs the turn needs |
|---|---|---|
| **Economy constants for a 30-day campaign** — loan terms, interest, contract rewards/penalties, the spiral's floor, breakfast margins | `[planning-turn @ H3b merge]` | Gate 14's measured day economics at 3 floors / 30 rooms / 40 guests; the H3a star-gate thresholds as shipped |
| **`rivalAiSystem`'s pricing policy** | `[planning-turn @ H3b merge]` | The shipped demand curve's price sensitivity at H3 occupancy; a rival that undercuts into a demand curve nobody has measured is a tuning fiction |
| **Mastery perk list and XP curve** | `[planning-turn @ H3b merge]` | Which roles exist as shipped (H3a ships three staff roles; the perk set is defined against that, not against the roadmap's eight) |
| **`ScreenViewData` per-app split shape** | `[planning-turn @ H3b merge]` | The seven shipped apps' actual key usage after H3a; the split should follow measured usage, not a guess |
| **Prestige carry-over set** | `[planning-turn @ H3b merge]` | The unlock track as shipped in H3a — you cannot define what survives a run before you know what a run unlocks |

Everything else in §3 is fixed now and no lane may change it.

---

## 4. Non-goals

- **No multiplayer, no netcode, no server work of any kind.** `rivalAiSystem`
  is SP content that happens to pre-build an MP surface; it is not MP.
- **No CCTV, no espionage, no sabotage, no suspicion AI, no presence blips.**
  Phase 5–6.
- **No BLUEPRINT** (cut for alpha, [PLAN-ALPHA.md](PLAN-ALPHA.md) §3.3), no
  bellhop / kitchen / security **roles** ([PLAN-ALPHA.md](PLAN-ALPHA.md) §3.2).
- **No cascade beyond depth 2.** The cap is structural, not tuned.
- **No new floors beyond H3's `MAX_FLOORS`.**
- **No live-service anything.** The weekly seed challenge is explicitly
  no-penalty and no-streak, per DESIGN §6's dark-pattern list, and the
  review audits it against that list by name.
- **No `debug.*` command hardening** — trigger unchanged (Phase 5, before
  any remote actor exists).

---

## 5. Determinism rules specific to this phase

1. **All prior rules stand.**
2. **Interest, XP, contract settlement and rival pricing are integer /
   permille with truncating division.** No float lands in a component.
3. **One forked Rng per rival, drawn at generation moments only**;
   per-decision values are stateless hashes of `(day, rivalId, salt)` with
   the salt drawn once at setup — restore-safe because it re-derives from
   the seed. This is H2a's proven bulletin pattern, applied to rivals.
4. **Seasonal events are a committed calendar**, not a random roll: a
   function of the day index, so a seed challenge is reproducible by
   construction.
5. **The cascade's chain depth is capped at 2 at its single spawn call
   site**, and the gate asserts no `Incident` with `depth > 1` ever exists.
6. **`mess` and `repairProgress` still carry no timestamp field.** The
   review checks the component shapes, as it did in H2a. If the cascade
   needed to add one, the cascade is wrong.
7. **A migration must be hash-honest**: a migrated save that resumes must
   produce the same `stateHash` a save written by the new version at the
   same tick would produce, or the migration returns undefined and the
   outcome stays `tooOld`.
8. **Prestige carries no state that can desync a new run's stream.**
   Carried unlocks are set at setup, before the first tick, and are part of
   the new run's seed-derived setup.

---

## 6. Exit criteria — this is the alpha bar

### H4a gates

| # | Gate | Pass criteria | Non-vacuity obligation |
|---|---|---|---|
| 27 | **`campaign-month`** — 30 in-game days, bots across roles, headless | exit 0 `--verify-replay`; double-entry ledger balances **every day**, not only at the end; economy invariants hold; `assertAllReachedGoal` throughout; at least one contract signed and settled, one seasonal event, one incident chain; warm-median perf recorded with its method | Force one ledger entry to post single-sided → the daily balance assertion reds on that day and names it. A soak that only balances at the end can hide a day that cancels out. |
| 28 | **`inspection`** — headless | An inspection evaluates a committed rule set against the hotel's real integer facts; a passing and a **failing** hotel both assert; the failing branch's penalty posts to the ledger | Make the inspector always pass → the failing-branch assertion reds. One-branch inspection gates are the vacuity shape H2a caught twice. |
| 29 | **`bankruptcy-recovery`** — headless | The spiral is entered deliberately, the repo manager spawns, repossession runs **in reverse unlock order and never takes the front desk**, and the run then climbs back to solvency from the one-man-show floor | Reverse the repossession order → the "front desk survives" assertion reds. DESIGN's promise is that the floor is recoverable; the gate is what makes it a promise. |
| 30 | **`prestige-carry`** — headless | A completed run's carried set is exactly the defined set; the new run's `stateHash` at tick 0 is a pure function of (seed, carried set) — asserted by running two identical prestige carries and comparing | Carry one extra unlock → the tick-0 hash assertion reds. |
| 31 | **`save-version`** — headless + unit | `tooOld` / `tooNew` / `corrupt` each produce their outcome and **never** silently start fresh; a registered migration round-trips hash-honestly (rule 7); an unmigratable save stays `tooOld` | Make the migration lie (return a sim whose hash differs) → the hash-honesty assertion reds. Point the boot path at a `tooNew` record → the diegetic-notice assertion reds if it starts fresh instead. |
| 32 | **`rival-week`** — headless | Two rivals price against the player over a week; their decisions are reproducible across two identical runs; a rival's finances **never** enter any player-readable view | Read a rival's cash into `RivalIntel` → the leak assertion reds. This is the SP rehearsal of the anti-wallhack property Phase 5 will assert on the wire. |
| 33 | **Standing gates green; goldens re-pinned at most once** | Same discipline as every prior phase | Corrupt a pin; restore. |

### H4b gates

| # | Gate | Pass criteria | Non-vacuity obligation |
|---|---|---|---|
| 34 | **Byte-identical headless goldens** — the H4b review's first act | Every H4a-pinned hash unchanged by the entire H4b diff | Corrupt a pin; restore. |
| 35 | **`campaign-surfaces`** — browser, Chromium **and** Firefox | STREETVIEW, the contract and inspection surfaces and the pager all render and are readable at the focused pose; `screen-readability` thresholds unchanged; the composed-shell overflow gate derives from the registry and covers **all eight** apps at worst-case data; **`ScreenViewData` is per-app and the 9-key monolith is gone** | Overflow one STREETVIEW row → the overflow gate reds. Reintroduce the monolith → the per-app assertion reds. |
| 36 | **`verb-click` extended** — browser, both engines | Every player verb added by H4 is reached by a real mouse click through the reticle raycast in the shipped build: sign a contract, accept an inspection, take a loan, buy breakfast service, read the pager, open STREETVIEW | Move one interactable out of reach in the built output → only that verb reds. **A verb without a click assertion is not shipped.** |
| 37 | **`seed-challenge`** — browser + headless | A weekly seed produces an exportable verdict; the exported verdict **replays** to the identical result headlessly; it is no-penalty and no-streak, audited by name against DESIGN §6's dark-pattern list | Tamper with one command in an exported verdict → the replay check reds. A cheat-checkable leaderboard whose replay check is vacuous is worse than none. |
| 38 | **THE ALPHA PLAYTEST** (human; cannot be performed by an agent) | Chris plays **at least two hours in one sitting**, on real hardware, from a fresh save, and records: session length; whether he opened the terminal for anything other than clicking confirm (**risk 3's warning sign, verbatim**); whether the session shortened relative to how much hotel there was (**risk 8's warning sign**); whether any screenshot he would take needs a caption (**risk 7's**); every place he was confused, stuck, or bored, with the in-game time it happened. The findings become a fix-list in `docs/reviews/phase-H4b.md` exactly like a review's | The inputs are a running build on real hardware and a fresh save. **This gate cannot pass by assertion and must not be reported as passed by an agent.** If it finds the game shallow or tiring, that outranks every green gate above it — which is the whole reason it exists: risks 3 and 8 have been carried unobserved since the roadmap was written. |
| 39 | **The H4b review gate + ALPHA declaration** | Fable reviews the diff into `docs/reviews/phase-H4b.md`, including gate 38's findings as first-class items. PASS + gate 38 findings addressed = **ALPHA**. The handoff and the roadmap are updated; the push decision ([PLAN-ALPHA.md](PLAN-ALPHA.md) §5.8) is put to Chris explicitly | Reviewer re-runs everything and applies its own perturbations. |

---

## 7. Implementation lanes (five concurrent maximum)

All [PLAN-ALPHA.md](PLAN-ALPHA.md) §6.2 rules apply verbatim in every brief.
Contested files orchestrator-only, as always.

### H4a

| Lane | Tier | Files (exclusive) | Depends | Gates |
|---|---|---|---|---|
| **1. Versioned saves + migration** | Sonnet | `packages/persistence/src/**`, `packages/save-web/src/**`, `apps/hotel/src/main.ts` | — | 31 |
| **2. Contracts + inspections** | Sonnet | `apps/hotel/src/sim/contracts.ts`, `documents.ts`, `rules.ts` | — ∥ 1 | 28 |
| **3. Loans, spiral, repo manager, breakfast** | Sonnet | `apps/hotel/src/sim/economy.ts`, `systems/repo.ts` | — ∥ 1, 2 | 29 |
| **4. XP, mastery, prestige, seasonal calendar, bounded cascade** | Sonnet | `apps/hotel/src/sim/{progression,seasons,incidents}.ts` | — ∥ 1–3 | 30 |
| **5. Rivals** | Sonnet | `apps/hotel/src/sim/rivals.ts` | — ∥ 1–4 | 32 |
| **6. Scenarios** | Sonnet | `scenarios/{campaign-month,inspection,bankruptcy-recovery,prestige-carry,save-version,rival-week}.scenario.mjs` | → 1–5 | 27, 33. **H4a review gate.** |

Peak concurrency: **five** (lanes 1–5), which is the cap. This is the one
unit in the plan that genuinely offers five disjoint regions, because the
campaign systems are naturally separate files.

### H4b

| Lane | Tier | Files (exclusive) | Depends | Gates |
|---|---|---|---|---|
| **7. `ScreenViewData` per-app split** | Sonnet | `apps/hotel/src/sim/screen-data.ts`, every `*-app.ts` | — | 35 (structural half) |
| **8. STREETVIEW + contract/inspection/pager surfaces** | Sonnet | `apps/hotel/src/sim/{streetview,contract}-app.ts`, `screens.ts` | → 7 | 35 |
| **9. Seed challenge + export** | Sonnet | `apps/hotel/src/sim/challenge.ts`, `scenarios/seed-challenge.scenario.mjs` | ∥ 7, 8 | 37 |
| **10. Browser gates** | Sonnet | `scenarios/{campaign-surfaces,verb-click}.scenario.mjs`, `apps/hotel/scripts/derive-walk.mjs` | → 8 | 34, 36. **H4b review gate**, then gate 38, then 39. |

Peak concurrency: three.

---

## 8. Risks (with early warning signs)

1. **The campaign is a spreadsheet.** Thirty days of numbers with no
   physical act attached. *Early sign:* a lane shipping an economic system
   whose only surface is a screen line. Every H4 system must name the
   physical thing the player does — sign a paper, meet an inspector, watch
   the repo manager take the espresso machine. *This is R14 (verified but
   invisible) in its most dangerous form, because economies are easy to
   simulate and easy to leave unseen.*
2. **The failure spiral is not actually recoverable.** *Early sign:* gate 29
   needing a tuned rescue to climb out. The floor must be recoverable by
   construction, not by a constant.
3. **Prestige becomes a dark pattern.** *Early sign:* any carried item that
   is a currency, or any carry that decays. Audited by name against DESIGN
   §6.
4. **The cascade breaks the zen ruling by the back door.** *Early sign:* any
   proposal to add a timestamp to `mess` or `repairProgress`. Refuse; the
   cascade lives in `Incident` or it does not ship.
5. **Rivals are noise.** *Early sign:* the player cannot describe what a
   rival did to them. STREETVIEW must make a rival's price *legible* or
   rivals are cut to Phase 5.
6. **The planning turn at the H3b merge slips** and lanes start against
   unresolved contracts. *Early sign:* a lane inventing an economy constant.
   The turn is a hard gate before H4a lane 3 starts; lanes 1, 2, 4 and 5 do
   not depend on it and may start first.
7. **Gate 38 is skipped or reported by an agent.** *Early sign:* any
   completion report that claims the playtest without a human record.
   [PLAN-ALPHA.md](PLAN-ALPHA.md) §5 item 5; verification honesty is
   non-negotiable and this is the gate most tempting to fake, because it is
   the only one no command can produce.
8. **Alpha is declared on green gates alone.** *Mitigation:* gate 39 makes
   gate 38's findings first-class review items. A green board and a boring
   game is the outcome this whole plan is arranged to prevent.

---

## 9. Open questions (deliberate implementer judgement)

1. Contract kinds beyond conference / film crew / health inspection.
2. Seasonal event calendar contents.
3. Whether the repo manager is a follower NPC (DESIGN's comedy framing) or a
   scheduled visitor; DESIGN prefers the follower — cost decides.
4. Pager unlock condition and how many alert kinds it carries (one line
   each; the count is the judgement).
5. Rival count at alpha (two is the working assumption; the perf and
   legibility costs decide).
6. Whether the seed challenge's exportable verdict is JSON in the clipboard
   or a downloadable file.
7. Mastery perk *kinds* — unlocks only; anything shaped like a multiplier
   goes back to the planning turn.
8. How long the alpha playtest's fresh save should be seeded to run before
   the first contract, so two hours reaches the interesting part.
