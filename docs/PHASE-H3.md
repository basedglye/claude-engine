# Phase H3 spec — "A Real Hotel"

Status: **planned** (step-1 output of the [WORKFLOW.md](WORKFLOW.md) loop;
the step-3 review gates verdict against it, verbatim). Parent:
[PLAN-ALPHA.md](PLAN-ALPHA.md). Assessment:
[ASSESSMENT-ALPHA.md](ASSESSMENT-ALPHA.md). Predecessors:
[PHASE-H2.md](PHASE-H2.md), [PHASE-H2C.md](PHASE-H2C.md), and the review
verdicts [reviews/phase-H2a.md](reviews/phase-H2a.md) and
`reviews/phase-H2b.md`. Game context:
[apps/hotel/docs/DESIGN.md](../apps/hotel/docs/DESIGN.md),
[apps/hotel/docs/ARCHITECTURE.md](../apps/hotel/docs/ARCHITECTURE.md).

**This spec supersedes roadmap Phase 3.** The cut and merge rulings are in
[PLAN-ALPHA.md](PLAN-ALPHA.md) §3 and are not re-argued here.

> **⚠ PUBLIC CONTRACT CHANGES — read §3 before any lane starts**
> - `@claude-engine/interiors` — `generateGroundFloor(seed)` superseded by
>   `generateHotel(spec)`; `GroundFloor` becomes one `Floor` of a `Hotel`.
>   The old function survives as a wrapper for exactly one release.
> - `@claude-engine/space` — `PortalGraph` gains floor-spanning portals;
>   **clearance-aware A\* is extracted** from `apps/hotel` (the H1a standing
>   rule's deferral trigger fires here: a second consumer *and* crowd scale).
> - `@claude-engine/space` — `radiusInterest` gains a multi-floor guard.
> - `apps/hotel/src/sim/game.ts` is split along system boundaries as lane 1,
>   behaviour-preserving, gated by byte-identical goldens.
> No CLAUDE.md invariant changes.

---

## 1. The split ruling, up front

**H3 splits into H3a and H3b, each with its own review gate**, on the same
line that worked twice in H2: what changes `stateHash` and what is forbidden
from changing it.

- **H3a — "The Tower" (everything hashed).** Multi-floor generation; the
  vertical portal graph; stairs and elevators as sim entities with integer
  schedules; cross-floor nav and the extracted clearance-aware A\*;
  off-screen guest abstraction; housekeeper and maintenance staff roles;
  guest archetype behaviours; star gates and the unlock track; the three new
  RESERVA escalation rows; the PURCHASE upgrade-preset track. **Every gate
  headless, `--verify-replay`.**
- **H3b — "The Tower, Rendered" (everything forbidden from being hashed).**
  Multi-floor rendering; stair and elevator meshes and their motion; the
  atlas extended under the *locked* look; floor-transition camera and boom
  clip at stairs; upgraded-room visuals; draw-call and frame budgets
  re-derived at 3× scale; the browser click gates extended to every new
  verb. **Every gate browser-mode, and the review's first act is asserting
  every H3a-pinned golden byte-identical.**

Sequencing: **H3a merges first**; H3b's rendering lane may start in parallel
against H3a's frozen §3A contract, exactly as H2b lane 9 did. **H3b
additionally requires H2c merged** — the look must be locked before more art
is authored against it, which is the entire point of a look-lock.

*Rejected: shipping H3 unsplit.* It is larger than H2, which was correctly
split; the same review-capacity argument applies with more force, and the
H3b review's byte-identical-golden check would otherwise be checking H3a's
own diff, which makes it meaningless. *Rejected: putting the upgrade-preset
track in H3b because "it changes how rooms look".* The deltas, their prices
and their gating are sim state; only their meshes are H3b's business.

---

## 2. Goal

**H3a:** the hotel is a *building*. Three floors of thirty rooms connected
by stairs and a scheduled elevator; forty guests routing across floors
without wedging; a housekeeper and a maintenance tech hired the same way the
clerk was, working the same validated command paths, so the player's day is
finally a *choice* of what to do rather than a sprint through all of it; a
star rating that gates floors, amenities and room upgrades, and that makes
the front desk genuinely harder — cross-referenced IDs, loyalty tiers and
corporate billing codes join the blacklist as mandatory checks; ten guest
archetypes that behave differently rather than merely reading differently;
and cash spent through PURCHASE on room and amenity upgrades you can walk
into. All deterministic, all replay-verified, at three times the entity
count H2a ever measured.

**H3b:** you can see it. Stairs and an elevator you ride; a camera that
handles the vertical without burying itself in geometry; upgraded rooms that
visibly are; and the whole thing still inside the draw-call and frame
budgets, under the locked look, with every new verb reachable by a gate's
mouse click.

---

## 3. API contracts

Everything below is real exported TypeScript. **[public-contract ⚠]** marks
gate-audited surfaces.

### A. `interiors` — the hotel, not the floor **[public-contract ⚠ — supersedes `generateGroundFloor`]**

```ts
// packages/interiors/src/index.ts

/** What the caller asks for. Integers only; the generator is a pure
 *  function of the whole spec, and the spec is what a save records so a
 *  restored hotel regenerates identically. */
export interface HotelSpec {
  seed: string;
  /** 1..MAX_FLOORS. Floor 0 is the ground floor: lobby, desk, street door.
   *  Floors 1..n-1 are guest floors and have no street door. */
  floorCount: number;
  /** Rooms to attempt per guest floor; the BSP may deliver fewer and
   *  reports what it delivered. */
  roomsPerFloor: number;
  /** Applied upgrade presets, by room id -> preset ids, in the order the
   *  player bought them. Deltas are re-fed to the generator (ARCHITECTURE
   *  B6's renovation mechanism), so a hotel is fully described by its spec. */
  upgrades: readonly { roomId: number; presetIds: readonly string[] }[];
}

export const MAX_FLOORS = 4;

/** One floor. This is the old `GroundFloor` minus the fields that were only
 *  ever about being the ground floor, plus its ordinal. Field meanings are
 *  unchanged, deliberately: every consumer of `GroundFloor` should port by
 *  adding a floor index, not by relearning the shape. */
export interface Floor {
  index: number;                 // 0 = ground
  grid: NavGrid;
  rooms: number[];               // room-id per cell, parallel to grid.cells
  portals: PortalGraph;          // WITHIN this floor
  doors: DoorSpec[];
  mesh: MeshDataWithColors;
  bedrooms: { roomId: number; tier: number; goalCx: number; goalCz: number }[];
  /** Cells occupied by each vertical link's landing on THIS floor. */
  landings: { linkId: number; cells: { cx: number; cz: number }[] }[];
}

/** A stair run or an elevator shaft. Sim truth; the meshes are H3b's. */
export interface VerticalLink {
  id: number;
  kind: "stair" | "elevator";
  /** Sorted ascending; a link serves a contiguous run of floors. */
  floors: readonly number[];
  /** Traversal cost in TICKS per floor, integer. Stairs are walked (the
   *  agent occupies the landing cells and is unavailable for that many
   *  ticks); an elevator's cost is queue + car schedule, not this. */
  ticksPerFloor: number;
  /** Elevator only: car capacity in agents. Undefined for stairs. */
  capacity?: number;
}

export interface Hotel {
  spec: HotelSpec;
  floors: readonly Floor[];
  links: readonly VerticalLink[];
  /** Ground floor only, unchanged in meaning from `GroundFloor`. */
  spawn: { xMm: number; zMm: number; yawMdeg: number };
  desk: { xMm: number; zMm: number; yawMdeg: number; queueCells: { cx: number; cz: number }[] };
  entranceDoorIndex: number;
}

/** Pure function of the spec: same spec, same bytes, forever. Runs in sim
 *  setup (nav data only) and in the host (meshes) from ONE source of truth,
 *  exactly as `generateGroundFloor` did. */
export function generateHotel(spec: HotelSpec): Hotel;

/** DEPRECATED, removed in H3b. Kept for exactly one release so the H1/H2
 *  scenarios do not all re-pin in the same commit as the multi-floor
 *  change -- separating "the generator grew a dimension" from "sixty
 *  goldens moved" is the difference between a reviewable diff and an
 *  unreviewable one. Equivalent to
 *  generateHotel({ seed, floorCount: 1, roomsPerFloor: 4, upgrades: [] }).floors[0]
 *  with the Hotel-level fields folded back in. */
export function generateGroundFloor(seed: string): GroundFloor;
```

**Y is an ordinal in the sim.** No sim value is a world-Y in millimetres
derived from a floor index by multiplication in more than one place:

```ts
export const FLOOR_HEIGHT_MM = 3000;
/** The ONLY place a floor ordinal becomes a world height. Presentation
 *  reads it; sim state stores the ordinal. */
export function floorBaseYMm(floorIndex: number): number;
```

*Rejected: one flat grid with a Y bitfield.* Cells would triple and every
existing 2-D routine would need a third dimension; the portal graph already
models "you can only get there through a specific place", which is exactly
what a staircase is. *Rejected: a `Hotel` that owns entity state.* It is
generated data, not sim state; the sim stores the spec and the components.

### B. `space` — vertical portals and clearance-aware A\* **[public-contract ⚠]**

The H1a standing rule ("no new caller uses raw `findPathCells` for a
collider-bearing agent") has been carried since H1a with the trigger *"a
second consumer or crowd scale"*. **H3a is both**, and the extraction
happens here rather than being copied a third time.

```ts
// packages/space/src/portals.ts

export interface Portal {
  id: number;
  roomA: number;
  roomB: number;
  cells: { cx: number; cz: number }[];
  /** NEW. Absent for a same-floor door portal (the H0/H1/H2 shape,
   *  unchanged). Present for a vertical link: the portal connects
   *  `roomA` on `fromFloor` to `roomB` on `toFloor` through `linkId`. */
  vertical?: { linkId: number; fromFloor: number; toFloor: number };
}

/** Route across the whole hotel. Rooms are keyed (floor, roomId) because
 *  room ids are per-floor. Deterministic: ties broken by (floor, roomId,
 *  portalId) ascending, never by insertion order. */
export function findRouteAcrossFloors(
  graphs: readonly PortalGraph[],
  from: { floor: number; roomId: number },
  to: { floor: number; roomId: number }
): readonly { portalId: number; floor: number }[] | undefined;
```

```ts
// packages/space/src/route.ts

/** Clearance-aware grid A*, extracted from apps/hotel's copy (H1a review
 *  deferral 4a; trigger: second consumer AND crowd scale, both now true).
 *
 * WHY CLEARANCE IS NOT OPTIONAL: raw `findPathCells` wedges a 300mm
 * collider at doorways -- it plans through cell centres and a doorway is
 * exactly wide enough for a point. `apps/hotel/scripts/derive-walk.mjs`
 * broke on this in its first draft and its comments record it.
 *
 * WHY STRING-PULLING IS NOT OPTIONAL: 4-connected A* through an open room
 * is a staircase. Pull the path against a RADIUS-AWARE line-of-sight,
 * KEEPING door cells (a doorway is the one place the staircase is correct),
 * or the emitted route is noise.
 *
 * Determinism: module-level scratch typed arrays, generation-counter
 * stamped and fully overwritten per call -- no content survives a call, so
 * two calls with the same inputs are byte-identical regardless of what ran
 * between them. This is the H2a refactor's own proven pattern; the output
 * arrays stay freshly allocated because they live in components. */
export function findClearancePath(
  grid: NavGrid,
  from: { cx: number; cz: number },
  to: { cx: number; cz: number },
  opts: {
    radiusMm: number;
    /** Per-agent seeded cell-cost jitter (the symmetry-breaking rule,
     *  ARCHITECTURE B5). Stateless: a function of (cell, agentSalt). */
    jitterSalt: number;
    /** Cells to avoid this repath (the sidestep branch the H2a review
     *  proved is load-bearing and whose absence is a SILENT livelock). */
    avoid?: readonly { cx: number; cz: number }[];
  }
): readonly { cx: number; cz: number }[] | undefined;

/** Multi-floor world guard. `radiusInterest` is a flat XZ circle that
 *  ignores Y entirely -- for a multi-floor hotel it is both wrong and, in a
 *  game about spying, a free ESP hack (ARCHITECTURE B9). It has no SP
 *  caller today, so rather than fix it speculatively in a phase with no
 *  interest policy, it THROWS when handed a multi-floor world, so the bug
 *  cannot be inherited silently into Phase 5. */
export function assertSingleFloorInterest(floorCount: number): void;
```

**Migration obligation, gated:** `apps/hotel`'s `findJitteredPath` is
deleted and every caller moves to `findClearancePath`. The H1 goldens must
be **byte-identical** across that move; if they are not, the extraction
changed behaviour and the lane stops. This is the cheapest possible proof
that an extraction was faithful, and it is available only because the
goldens exist.

### C. `apps/hotel` — components and systems

```ts
// apps/hotel/src/sim/components.ts (additions; integers only, no floats)

/** Where an agent is, vertically. Sim state is the ORDINAL. */
export interface OnFloor { floor: number }

/** An agent traversing a vertical link. Occupies landing cells; not
 *  interactable while `ticksLeft > 0`. No timestamp, no wall clock. */
export interface Traversing {
  linkId: number;
  fromFloor: number;
  toFloor: number;
  ticksLeft: number;
}

/** Elevator car. Its schedule is an integer tick table, never wall-clock,
 *  and never a float: `atFloor` advances by a fixed cadence and the door
 *  dwell is a tick count. */
export interface ElevatorCar {
  linkId: number;
  atFloor: number;
  /** -1 down, 0 idle, +1 up. */
  dir: number;
  ticksToNext: number;
  doorDwellTicks: number;
  /** Entity ids aboard, kept sorted ascending -- iteration order over this
   *  array is sim-visible and must never be insertion order. */
  riders: number[];
}

/** A guest the sim has abstracted away (B8 fix-order item 4). Off-floor,
 *  in-room, not due to act for N ticks: the entity is despawned and its
 *  facts become a row. Round-tripping a row back to an entity MUST produce
 *  the identical stateHash the entity would have had -- gate 17. */
export interface AbstractGuest {
  guestKey: number;             // stable identity across abstract/concrete
  roomId: number;
  floor: number;
  ticksUntilDue: number;
  /** Everything the review pipeline will need at checkout, carried as
   *  integers so nothing is recomputed from a float. */
  stayFacts: { nightsPaidMinor: number; brokenNights: number; segment: number };
}

/** Role of a hired staff member. H3a adds two; the hire path, the
 *  interview, the résumé documents and the validated command routing are
 *  H2a's, unchanged. */
export type StaffRole = "clerk" | "housekeeper" | "maintenance";

/** An applied room/amenity upgrade. The delta table is committed content;
 *  this is which deltas a room has. */
export interface Upgraded { presetIds: string[] }
```

```ts
// apps/hotel/src/sim/upgrades.ts (new)

/** PURCHASE's catalogue. Committed constant, diffable data -- the same
 *  keystone rule the RESERVA rule table follows: nothing mutates it at
 *  runtime, star tiers change which presets are BUYABLE. */
export interface UpgradePreset {
  id: string;
  label: string;                 // t() key
  priceMinor: number;
  minStars: number;
  /** What it changes in the sim: nightly rate ceiling, review-score
   *  contribution, segment appeal. Integers/permille only. */
  effects: {
    rateCeilingMinor?: number;
    reviewBonusPermille?: number;
    segmentAppealPermille?: readonly { segment: number; delta: number }[];
  };
  /** What it changes in the world: a generator delta re-fed through
   *  generateHotel (ARCHITECTURE B6's renovation mechanism, at preset
   *  granularity instead of free-form -- PLAN-ALPHA.md §3.3). */
  meshDelta: { propKind: string; count: number }[];
}

export const UPGRADE_PRESETS: readonly UpgradePreset[];

/** The single validated apply path -- the RESERVA/`applyDeskDecision`
 *  shape, for the same reason: the PURCHASE screen effect and the
 *  `purchase.buy` command must reach the same function, and a staff or
 *  rival actor must be denied exactly where the player would be. */
export function applyPurchase(
  world: IWorld, actor: ActorId, roomId: number, presetId: string
): { ok: true } | { ok: false; reason: string };
```

```ts
// apps/hotel/src/sim/rules.ts (additions)

/** The three escalation rows the rule table was designed for and that have
 *  been named since H1. Shapes only; thresholds are §11 tuning.
 *
 *  `crossRef`     -- a field on document A must equal a field on document B
 *  `loyaltyTier`  -- a field must be >= the tier the reservation claims
 *  `billingCode`  -- a field must match a committed checksum shape
 *
 * plantViolation() already takes `ctx` and already filters to
 * currently-plantable rows (H2a, deferral 4d). Each new kind extends the
 * round-trip property test against a fixture, EVERY ROW EXACT -- the H1a
 * prescription, applied a second time. */
export type CheckKind = "equals" | "listed" | "crossRef" | "loyaltyTier" | "billingCode";
```

### D. `harness` — crowd assertions **[public-contract ⚠ additive]**

```ts
// packages/harness/src/index.ts
//
// `nav.stuck` IS NOT A CROWD-HEALTH SIGNAL. The H2a review's P2
// perturbation proved the worst nav failure -- an un-avoided repath
// livelock -- is SILENT under it: stuckTicks resets each blocked/unblocked
// cycle, so zero nav.stuck stays green while six agents never arrive.
// Every crowd gate from H3a on asserts arrival, and keeps nav.stuck only
// as a secondary check.

/** Every agent matching `select` reached its goal within `withinTicks`.
 *  Reports the worst offender's id, goal and final cell on failure, so a
 *  red gate names the agent instead of the count. */
export function assertAllReachedGoal(
  run: RunResult,
  opts: { select: (e: EntitySnapshot) => boolean; withinTicks: number }
): void;
```

---

## 4. Non-goals (aggressive; H3's gravity is toward H4 and the street, and it must not fall in)

- **No BLUEPRINT, no renovation editor, no contractor NPCs, no construction
  walk-through.** Cut from alpha ([PLAN-ALPHA.md](PLAN-ALPHA.md) §3.3); the
  upgrade-preset track replaces it. Do not ship a BLUEPRINT icon that opens
  nothing.
- **No incident cascade.** A broken prop is a broken prop. The cascade is
  H4a, bounded to chain depth 2, in its own `incident` component — and the
  zen components (`mess`, `repairProgress`) keep carrying **no timestamp
  field of any kind**, which is what makes the zen ruling reviewable by
  inspection.
- **No bellhop, kitchen or security roles.** Cut ([PLAN-ALPHA.md](PLAN-ALPHA.md) §3.2).
- **No CCTV, no STREETVIEW, no PURCHASE physical delivery at a loading
  dock.** PURCHASE ships as a screen app that applies presets; goods do not
  arrive as physical crates this phase. The registry grows to **seven** apps
  (the six plus PURCHASE) and stops. **STREETVIEW is app eight and is H4b's**,
  which is where the `ScreenViewData` per-app split lands — H3a must not add
  a tenth view key ([PLAN-ALPHA.md](PLAN-ALPHA.md) §4.4).
- **No role XP, mastery, prestige, contracts, inspections, loans, repo
  manager, seasonal events, rival hotels, weekly seed challenge** (H4).
- **No morale system.** `staffed.morale` still exists as unused data. Quirks
  stay data flavour with no system effects.
- **No save migration.** Still pre-alpha policy; versioning lands in H4a
  ([PLAN-ALPHA.md](PLAN-ALPHA.md) §3.7) and this phase does not pretend
  otherwise.
- **No multiplayer wiring**, but every new command stays actor-bound and
  sim-validated — H3a adds the third and fourth actor kinds, which is the
  live test of B9's rule.
- **No new audio package work.** New event types get `SoundRule` rows; the
  package is unchanged.

---

## 5. The carry ledger (the review gates audit this table)

| # | Item | Source | Disposition |
|---|---|---|---|
| 1 | `space` clearance-aware A\* extraction | H1a review 4a, re-deferred twice | **H3a lane 2.** Trigger fires: second consumer *and* crowd scale. §3B, with byte-identical H1 goldens as the faithfulness proof. |
| 2 | Guests never close doors | H1a 4e, re-deferred to Phase 3 | **H3a lane 5.** Multi-floor is the named trigger (privacy). One boolean on the guest's room-entry behaviour; `corridor-headon`'s successors must still pass. |
| 3 | `debug.*` rejection in server validation | H1b 3 | **Re-deferred, trigger unchanged (Phase 5, before any remote actor exists).** H3 has no remote actors. |
| 4 | Harness `reload` primitive stitching `commandLog()` across a navigation | H2c §6 | **Re-deferred. Trigger: the first defect attributable to cold page-load recovery, or the H4b playtest.** |
| 5 | Write-through detector healing window (bounded to 500 ticks, not closed) | H2a review item 2 + addendum | **Carried, documented, unchanged.** H3a adds no new hash machinery. Any exit 3 is still P0 and is never answered by loosening the check. |
| 6 | Warm-bench methodology beside every carried perf figure | H2a review item 4 | **Standing rule of this spec.** Every number in §9 names its method or it is not a number. |
| 7 | `ScreenViewData` at exactly 9 of 9 keys | H2a handoff | **H3a must not add a tenth.** PURCHASE reads existing keys or the view goes per-app early. Reviewer counts, as in H1 and H2. |
| 8 | `nav.stuck` is not a crowd-health signal | H2a review P2 | **Adopted as a contract** (§3D) and as a standing rule of every H3 crowd gate. |

---

## 6. Determinism rules specific to this phase

1. **All H0/H1/H2 rules stand** — integer mm/mdeg, permille with truncating
   division, LUT trig, no transcendental `Math.*` and no `Math.random` in
   any purity root, no closure state, integers across the screen boundary,
   draw-at-generation and hash-at-decision, write-through via
   `setComponent()` only.
2. **Floor is an ordinal in sim state.** `floorBaseYMm()` is the only
   conversion, and it is presentation-side. No component stores a world-Y.
3. **Elevator schedules are integer tick tables.** No wall-clock, no float
   interpolation in sim. The car's *visual* glide between floors is host-side
   interpolation of an integer sim position, exactly as walk animation is.
4. **`ElevatorCar.riders` is kept sorted ascending** and is iterated in that
   order. Bare insertion-order iteration over a rider list is an
   iteration-order divergence waiting for a replay — invariant 2's
   least-obvious clause.
5. **Cross-floor routing ties break on `(floor, roomId, portalId)`
   ascending**, never on graph insertion order.
6. **Guest abstraction is hash-neutral by construction.** Abstracting a
   guest and immediately re-concretising it must produce the identical
   `stateHash` — gate 17 asserts exactly that, at a tick chosen by the
   scenario, and the property is the whole reason the optimisation is
   allowed to exist.
7. **`findClearancePath`'s scratch arrays are generation-stamped and fully
   overwritten per call.** Nothing survives a call; documented in the
   function, and proven by the byte-identical H1 goldens across the
   extraction.
8. **Upgrade effects are integer/permille and are applied at defined
   moments** (rate ceiling at pricing, review bonus at checkout scoring,
   segment appeal at demand rollover) — never sampled mid-tick from a
   float.
9. **The H1/H2 gates' spawn streams stay sacred.** Their scenario configs
   pin single-floor, fixed-arrival worlds; the multi-floor and abstraction
   paths activate only in H3 configs. Their goldens re-pin **at most once**,
   in the generator-contract commit, and then hold through the rest of H3a.
   A second drift is a fork-ordering or stream-coupling bug, not a re-pin.
10. **The atlas and every H3b mesh change must not move a single headless
    golden** — determinism rule 4 of [PHASE-H2.md](PHASE-H2.md), applied to
    H3b, and the H3b review's first act.

---

## 7. Exit criteria

All headless scenarios `--verify-replay` (including the incremental/slow
hash cross-check every 500 ticks and at the end of both legs), exit 0; exit
3 is P0. All browser scenarios: tick-gated input, start barrier, constant
command counts. Every new screen app carries the standing pattern
obligations: a `layout()`-derived, both-branch, guard-inclusive headless
decision test, and an entry in the registry-derived composed-shell overflow
gate. **Every gate below carries a non-vacuity obligation and the lane must
report all four exit codes** (break → red on the named assertion → clean
rebuild restore → green).

### H3a gates

| # | Gate | Pass criteria | Non-vacuity obligation |
|---|---|---|---|
| 14 | **`full-house-day`** — the roadmap's own. Seed `hotel-h3-house-1`, 3 floors / 30 rooms / 12 staff / 40 guests, one in-game day, headless | exit 0 `--verify-replay`; `assertAllReachedGoal` for every guest and staff agent within the gate's tick budget; ledger balances; occupancy consistent with a mess/room scan; **`perf.avgTickMs` review-read against a warm in-process median, method quoted** (§9) | Force `findClearancePath`'s `avoid` to be ignored (the H2a P2 perturbation, at 3× scale) → the arrival assertion must red and **name the agent**. Confirm `nav.stuck` stays green while it does — that is the point of §3D. |
| 15 | **`elevator-jam`** — seed `hotel-h3-lift-1`, headless | Car capacity is respected; a full car passes waiting agents and returns; every waiting agent boards within N ticks; `riders` sorted at every tick it is read; zero agents left on a landing at the end | Set capacity to 0 → every boarding assertion reds and the arrival assertion names a landing. Then set capacity to 99 → the "full car passes and returns" assertion must red (a gate that only proves the easy direction proves nothing). |
| 16 | **`multi-floor-nav`** — seed `hotel-h3-nav-1`, headless | Cross-floor routes taken by stairs and by elevator both complete; a route with the elevator disabled falls back to stairs; a route with both disabled fails **explicitly** (a named event) rather than silently pathing through a wall | Block a landing cell → the route must fail explicitly, not wedge. Silent wedging is the failure this project has caught twice. |
| 17 | **`guest-abstraction`** — seed `hotel-h3-abs-1`, headless | Abstract-then-concretise at a scenario-chosen tick produces an **identical `stateHash`**; a full day with abstraction enabled and disabled produces identical ledger totals and identical review outcomes | Perturb one carried `stayFacts` field on the round trip → the hash assertion reds. This gate is the licence for the optimisation; without it the optimisation is a determinism risk with a perf excuse. |
| 18 | **`escalation-5star`** — seed `hotel-h3-stars-1`, headless | Star tiers reachable across H3's range; each new row (`crossRef`, `loyaltyTier`, `billingCode`) becomes active at its tier, is plantable only when active, is caught by a zero-error clerk, and has a **pre-tier control guest** for which the row is inactive, never planted, never flagged; the extended round-trip property covers every new kind against a fixture, every row exact | Stop `rulesForStars` filtering (the H2a P3 perturbation, re-run against the new rows) → each control assertion must red *individually*, so a single row's control cannot carry the others. |
| 19 | **`staff-three`** — seed `hotel-h3-staff-1`, headless | Housekeeper and maintenance are hired through the same résumé → interview → `staff.hire` path the clerk uses; both work through validated command paths with `staff:*` attribution; after all three are hired, **zero** `desk.decision` / `mess.wipe` / `prop.repair` commands from actor `"player"` exist, while the corresponding events carry staff attribution; player absence is asserted, not assumed | Give the housekeeper a back door (route its wipe around the validated apply function) → the attribution assertion reds. Reviewer greps for any staff path reaching an effect without its apply function — the H2a risk-8 check, extended to two more roles. |
| 20 | **Standing gates green, goldens re-pinned exactly once** | The generator-contract commit re-pins the affected goldens and does nothing else; every H1/H2 scenario then passes untouched through the rest of H3a except where this spec names a change | Corrupt one pin → sweep exits non-zero naming that scenario; restore. |
| 21 | **App decision-path suite + composed-shell overflow** | PURCHASE ships its `layout()`-derived both-branch guard-inclusive decision test; the overflow gate derives from the registry and covers all **seven** apps at worst-case data; `ScreenViewData` still ≤ 9 keys | Add a deliberately overflowing PURCHASE row → the overflow gate reds. Add a tenth view key → the budget assertion reds. |

### H3b gates

| # | Gate | Pass criteria | Non-vacuity obligation |
|---|---|---|---|
| 22 | **Byte-identical headless goldens** — the H3b review's **first act** | Every H3a-pinned hash unchanged by the entire H3b diff | Corrupt a pin; restore. This is the mechanical review of invariant 2 across the whole H3b art surface. |
| 23 | **`tower-look`** — browser, Chromium **and** Firefox | Tick-gated route: lobby → stairs → floor 1 corridor → bedroom → elevator → floor 2 → desk focus. Screenshots at named ticks. `screen-readability` unchanged (the B6 exemption still holds with the shader live); `surfaceContrast.sep.min` ≥ H2c's budget **on every floor**; `drawCalls.max ≤ 300`; `frameTimeP95.p95Ms ≤` the software ceiling **re-derived at 3× scale by H2c §4A's method** (a tripwire, re-derived when the scene changes materially — this is that change) | Compile the retro material without `exempt` → readability collapses. Force the bake to a constant on floor 1 only → `surface-contrast` reds **on floor 1's screenshot specifically**, proving the gate is per-floor and not averaging the tower into a pass. |
| 24 | **`vertical-camera`** — browser | Third-person boom clips correctly on stairs and in the elevator car; the camera never enters near-plane geometry at any captured tick; the floor-transition does not black-frame | The camera-buried failure is H2b's own art-lock defect, and it was found by a human looking at a screenshot. Assert it mechanically: a captured frame whose centre 10% is a single flat colour reds the gate. Perturb by disabling the boom clamp → red. |
| 25 | **`verb-click`** — browser (extends H2b's `upkeep-click`) | Every player verb is reached by a real mouse click through the reticle raycast in the shipped build, on both engines: wipe a mess, repair a prop, interview a candidate, pick up a résumé, **ride an elevator, take a stair, buy an upgrade at PURCHASE**. Scenario configs pre-place what the gate needs at setup (the H2a review's own suggested route) | Move one verb's interactable out of the reticle's reach in the built output → that verb's assertion reds and the others stay green. **A verb without a click assertion is not shipped** — R14, and the H2a review's ruling that this class is blocking if it arrives unclosed a second time. |
| 26 | **The new-surface art sign-off** (human; cannot be performed by an agent) | Chris views the `tower-look` screenshots and drives the build: stairs, elevator interior, an upgraded room. Risk 7's test applies unchanged. The review records the sign-off against the H3b commit. The look-lock constants are **not** re-opened; if they must be, that is a public-contract change and a planning turn | Inputs are the artifacts: committed screenshots, the commit SHA, a running build on port 5199 with the tab fronted. |

---

## 8. Implementation lanes (→ = dependency; ∥ = parallel; five concurrent maximum)

Lane boundaries are **by file** and are exclusive. Contested files are
orchestrator-only: `package.json`, `docs/ROADMAP-HOTEL.md`,
`apps/hotel/docs/HANDOFF.md`, `docs/reviews/**`, `CLAUDE.md`. All
[PLAN-ALPHA.md](PLAN-ALPHA.md) §6.2 rules apply verbatim in every brief,
including the two learned the hard way.

### H3a

| Lane | Tier | Files (exclusive) | Depends | Verification |
|---|---|---|---|---|
| **1. Split `game.ts`** | Haiku | `apps/hotel/src/sim/game.ts` → `apps/hotel/src/sim/systems/*.ts` | **first, alone** | Behaviour-preserving. `npm run check:goldens` **12/12 byte-identical** is the entire gate: if a hash moves, the split changed behaviour and the lane reverts. `npm run build`, `npx eslint .`, `node scripts/check-purity.mjs`. **No other H3a lane starts until this merges** — [PLAN-ALPHA.md](PLAN-ALPHA.md) §4.8, risk R20 |
| **2. `space` extraction** | Sonnet | `packages/space/src/route.ts`, `portals.ts`, `index.ts`, `packages/space/scripts/test.mjs` | → 1 | Byte-identical H1 goldens across the `findJitteredPath` → `findClearancePath` move; the guard throws on a multi-floor world |
| **3. `interiors` multi-floor** | Sonnet | `packages/interiors/src/**`, `packages/interiors/scripts/test.mjs` | → 1; ∥ 2 | `generateHotel` pure and byte-identical per spec; the one-release wrapper reproduces `generateGroundFloor` exactly (unit-asserted against a committed fixture) |
| **4. Verticals + nav** | Sonnet | `apps/hotel/src/sim/systems/{move,path,elevator}.ts`, `apps/hotel/src/sim/components.ts` | → 2, 3 | Gates 15, 16 |
| **5. Guests, archetypes, doors, abstraction** | Sonnet | `apps/hotel/src/sim/{guests,nav}.ts`, `systems/guest*.ts` | → 4 | Gate 17; carry-ledger item 2 |
| **6. Staff roles 2–3; escalation rows; upgrades + PURCHASE** | Sonnet | `apps/hotel/src/sim/{staff,rules,upgrades}.ts`, `apps/hotel/src/sim/purchase-app.ts`, `apps/hotel/src/sim/screen-data.ts` | → 1; ∥ 4, 5 | Gates 18, 19, 21 |
| **7. Harness crowd assertion + scenarios** | Sonnet | `packages/harness/src/index.ts`, `scenarios/{full-house-day,elevator-jam,multi-floor-nav,guest-abstraction,escalation-5star,staff-three}.scenario.mjs` | → all | Gates 14–20. **H3a review gate.** |

Concurrency: lane 1 alone; then **2 ∥ 3 ∥ 6** (three); then **4 ∥ 6**; then
**5 ∥ 6 ∥ 7**. Peak four, not five — the tree does not offer five disjoint
sim regions after the split, and manufacturing a fifth would mean sharing a
file, which is the boundary that made this pattern work.

### H3b (may start against the frozen §3A contract; requires H2c merged to *merge*)

| Lane | Tier | Files (exclusive) | Depends | Verification |
|---|---|---|---|---|
| **8. Multi-floor + vertical meshes** | Sonnet | `packages/interiors/src/{mesh-gen,stair-mesh,lift-mesh}.ts` | → 3 (contract) | Atlas unchanged (locked); mesh golden re-pins once |
| **9. Host wiring + floor-transition camera + boom** | Sonnet | `apps/hotel/src/render/**`, `packages/player-fps/src/**` | → 8 | Gate 24 |
| **10. Upgraded-room visuals** | Haiku | `apps/hotel/src/render/upkeep.ts`, `apps/hotel/src/render/props.ts` | → 8; ∥ 9 | Visible per preset; every preset has a visual or the preset is cut |
| **11. Budgets re-derived at 3× scale** | Haiku | `apps/hotel/docs/ARCHITECTURE.md` + `feelTargets` text supplied to lane 12 | → 9 | H2C §4A's five-run median method, quoted |
| **12. Browser gates** | Sonnet | `scenarios/{tower-look,vertical-camera,verb-click}.scenario.mjs`, `apps/hotel/scripts/derive-walk.mjs` | → 9, 10, 11 | Gates 22–25. **H3b review gate**, then gate 26. |

Concurrency: **8**, then **9 ∥ 10 ∥ 11**, then **12**. Peak three.

---

## 9. Performance — what must change, and how it is measured

The carried numbers, with their methods, from the H2a review and
ARCHITECTURE B8:

- `one-man-week`, 42,000 ticks at ~195 entities: **0.446 ms/tick**, harness
  single-run — unambiguous at that margin by either method.
- `checkin-rush`: **warm in-process median 0.0107 ms/tick**. The harness's
  single-run `avgTickMs` reads 0.035–0.042 on this machine and is cold-start
  JIT dominated. **Never compare a warm number to a cold one.**
- Incremental vs slow hash at a 300-entity fixture: **6.6×**.

H3a roughly triples entity count. The levers, in order:

1. **Off-screen guest abstraction** (B8 fix-order item 4) is *scope*, not a
   later optimisation. Forty guests, most of them asleep in rooms on other
   floors, is precisely the case the item was written for. Gate 17 is what
   makes it safe.
2. **`findClearancePath`'s scratch arrays** carry H2a's allocation refactor
   into the extracted function; the byte-identical goldens prove it did not
   change behaviour.
3. **Per-tick O(entities) scans** — `indexSystem`'s per-tick context already
   exists; every new system reads it rather than sweeping.

**Measurement gates:** `full-house-day` verdict `perf.avgTickMs` review-read
against a **warm in-process median at the gate's own entity count**, with
the method quoted beside it, and the pre-abstraction number recorded next to
the post-abstraction number so the optimisation's effect is a measurement
and not a claim. Browser: `sim-tick-ms ≤ 5`; `draw-calls ≤ 300`;
`frame-time-p95` against the re-derived software ceiling.

**The honest ceiling:** nothing on this project has been measured above ~195
entities. Every figure above is an extrapolation until gate 14 runs.

---

## 10. Risks (with early warning signs)

1. **The generator contract change lands badly under concurrent lanes.**
   *Mitigation:* §3A is frozen before any lane starts; the one-release
   wrapper separates "the generator grew a dimension" from "sixty goldens
   moved". *Early sign:* a lane proposing a signature change mid-flight —
   escalate to a planning turn, never decide it in a lane.
2. **`game.ts` blocks parallelism.** *Mitigation:* lane 1, alone, first.
   *Early sign:* two lanes queued behind the same file, or a lane asking to
   edit `game.ts` after the split.
3. **Perf collapses at 3× scale** (roadmap risk 5, finally testable).
   *Early sign:* `full-house-day`'s warm median above ~1.0 ms/tick before
   abstraction lands. *Response:* abstraction first, then draw-call work —
   never loosen the gate.
4. **The elevator becomes a deadlock generator** (roadmap risk 4's shape at
   a new choke point). *Early sign:* gate 15's arrival assertion failing
   while `nav.stuck` stays green — the exact signature §3D exists for.
5. **The extraction changes A\* behaviour subtly.** *Early sign:* any H1
   golden moving in lane 2's commit. That is a stop, not a re-pin.
6. **Escalation rows make the desk tedious rather than deeper** (risk 3
   inverted). *Early sign:* the row set requiring more than one document
   cross-reference per guest at tier 3 — the difficulty should come from
   *which* check applies, not from clicking more. Observable only at H4b's
   playtest; note it as a playtest question now.
7. **The upgrade presets read as a menu, not as a hotel improving** (this is
   the compensating risk for cutting BLUEPRINT). *Early sign:* a preset with
   an economic effect and no `meshDelta` — every preset must be walkable-in,
   or it is a number and it is cut.
8. **A tenth `ScreenViewData` key.** *Early sign:* PURCHASE's decision test
   needing data no key carries. *Response:* split the view per app in H3a
   rather than borrowing against H4b.
9. **The two human sign-offs stall the chain** (gates 12 in H2c, 26 here).
   *Mitigation:* H4a runs in parallel with H3b and needs neither.
   *Early sign:* H4a nearing its gate with a sign-off unscheduled.

---

## 11. Open questions (deliberate implementer judgement)

1. `floorCount` at alpha (3 is the roadmap's number; 3–4 is the range,
   decided by gate 14's measured result, never by taste) and
   `roomsPerFloor`.
2. Elevator car count, `capacity`, `ticksPerFloor`, dwell, and the schedule
   discipline (sweep vs nearest-call) — content, within §6's rules.
3. Which of the ten archetypes get distinct *behaviours* versus flavour, and
   what those behaviours are.
4. `UPGRADE_PRESETS` contents, prices and `minStars` — tuned against
   solvency in gate 14 and later `campaign-month`, never against an
   assertion.
5. Star-tier thresholds across the H3 range and which unlocks sit at which
   tier.
6. The exact `crossRef` / `loyaltyTier` / `billingCode` field shapes and
   their document layouts.
7. The abstraction trigger predicate (`ticksUntilDue` threshold, floor
   distance, or both) and whether staff are ever abstracted.
8. Whether the optional bellhop "carry a bag" activity ships at all.
9. Whether the elevator is one link serving all floors or one per shaft.
