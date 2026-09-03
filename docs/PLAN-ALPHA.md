# Plan — GRAND FOYER to ALPHA

Written 2026-09-02. Deliverables (b) and (c) of the alpha planning turn
(input: [BRIEF-ALPHA-PLAN.md](BRIEF-ALPHA-PLAN.md); the assessment that
justifies every ruling here is [ASSESSMENT-ALPHA.md](ASSESSMENT-ALPHA.md)).

**ALPHA is defined as the end of roadmap Phase 4 "The Campaign": a real
single-player game with content depth and a progression arc, before any
multiplayer.** Roadmap Phases 5–7 are out of scope and are not planned here.

> **⚠ THIS DOCUMENT CHANGES PUBLIC CONTRACTS AND ONE ROADMAP-LEVEL
> COMMITMENT.** Read §4 first if you read nothing else.
> - `@claude-engine/interiors` — `generateGroundFloor(seed)` is superseded
>   by `generateHotel(spec)`; `GroundFloor` becomes one `Floor` of a `Hotel`.
> - `@claude-engine/space` — `PortalGraph` gains floor-spanning portals;
>   clearance-aware A* is extracted from `apps/hotel` (the H1a standing
>   rule's deferral trigger fires in H3a).
> - `@claude-engine/persistence` — saves become **versioned**. The current
>   pre-1.0 policy ("a `RestoreError` means no save; start fresh") is
>   acceptable up to alpha and **not** acceptable at alpha.
> - `@claude-engine/harness` — one new probe family (`surface-contrast`),
>   and a `reload` input step is registered as engine debt with a trigger.
> - **Roadmap Phase 3's BLUEPRINT / renovation editor is CUT from alpha**
>   (§3.3). This is the single largest scope decision in this document.

---

## 1. The plan in one table

Five units to alpha. Each has one verification shape, its own review gate,
and its own spec.

| Unit | Name | Shape | Spec | Depends on | May start |
|---|---|---|---|---|---|
| **H2c** | The Look, Closed | mixed but tiny; finishes H2b | [PHASE-H2C.md](PHASE-H2C.md) | the H2b branch as it stands | **now** |
| **H3a** | The Tower | headless sim, `--verify-replay` | [PHASE-H3.md](PHASE-H3.md) §A | `main` at the H2a merge | **now, in parallel with H2c** (disjoint files) |
| **H3b** | The Tower, Rendered | browser + goldens-byte-identical | [PHASE-H3.md](PHASE-H3.md) §B | H2c merged (art is locked before more art is authored) **and** H3a merged | after both |
| **H4a** | The Campaign | headless sim, `--verify-replay` | [PHASE-H4.md](PHASE-H4.md) §A | H3a merged | in parallel with H3b |
| **H4b** | The Campaign, Rendered + ALPHA LOCK | browser + human playtest | [PHASE-H4.md](PHASE-H4.md) §B | H3b and H4a merged | after both |

Two parallel tracks, converging twice:

```
        H2c (host/art) ─────┐
                            ├──> H3b (browser) ──┐
  H3a (sim) ────┬───────────┘                    ├──> H4b (browser + PLAYTEST) = ALPHA
                └──> H4a (sim) ──────────────────┘
```

### Why five, and why this cut

Applying the [PHASE-H2.md](PHASE-H2.md) §1 ruling — **cut by verification
shape, not by feature count** — to roadmap Phases 3 and 4:

- Roadmap Phase 3 mixes multi-floor sim (hashed, headless) with elevator
  meshes, floor-transition camera and new art (forbidden-to-hash, browser).
  That is the H2a/H2b line again, and it is drawn again: **H3a / H3b**.
- Roadmap Phase 4 mixes the campaign economy and rival AI (hashed, headless)
  with STREETVIEW, contract surfaces and the thing alpha actually needs — a
  human playing for hours (browser + human). **H4a / H4b**.
- H2b is not a phase; it is an unfinished one. It gets a *closing* spec
  rather than a new phase number, so the H2b review gate is not skipped: the
  gate reviews the H2b branch **including** H2c's fixes, as one diff, and
  its verdict is written to `docs/reviews/phase-H2b.md`.

Predicted total: 5 gates for 2 remaining roadmap phases plus one carry —
consistent with the measured ~1.7 gates per roadmap phase.

**No estimate in weeks is given, deliberately.** The measured unit is
`(lanes × review rounds)`: H2c ≈ 4 lanes / 1–2 rounds, H3a ≈ 6 lanes / 1–2,
H3b ≈ 5 lanes / 1–2, H4a ≈ 6 lanes / 1–2, H4b ≈ 5 lanes / 1–2, plus the
human steps in §5 which have their own turnaround and are not agent time.

---

## 2. What alpha contains

The pitch a player would read: *You start as a one-man 1-star flophouse. You
work the desk, wipe the rooms, fix the radiators, and read every ID yourself.
You hire a clerk, then a housekeeper, then a maintenance tech. You open the
second and third floors. Your star rating rises and the front desk gets
harder — loyalty tiers, corporate billing codes, cross-referenced IDs,
blacklist bulletins. Contracts arrive: a conference, a film crew, a health
inspection where you are the one being scrutinised. You take a loan and
nearly lose the building to a repo manager. Thirty in-game days later you
sell up, keep your mastery, and start again on a bigger lot.*

Mapped to units:

| Alpha feature | Unit |
|---|---|
| Multi-floor hotel; stairs and elevators | H3a (sim) / H3b (render) |
| Housekeeper and maintenance NPC staff (roles 2 and 3) | H3a |
| Guest archetype behaviours (10+) | H3a |
| Star gates + unlock track; per-tier RESERVA escalation rows (`crossRef`, `loyaltyTier`, `billingCode`) | H3a |
| Room/amenity upgrade track via PURCHASE presets (replaces BLUEPRINT — §3.3) | H3a (sim) / H3b (render) |
| Off-screen guest abstraction; clearance-aware A* extraction; perf at 3× scale | H3a |
| Role XP + mastery; prestige as setup-ritual compression | H4a |
| Contracts + inspections | H4a (sim) / H4b (surfaces) |
| Loans, failure spiral, repo manager | H4a |
| Seasonal events; bounded incident cascade | H4a |
| SP rival hotels (`rivalAiSystem`) | H4a |
| Versioned saves + migration | H4a |
| STREETVIEW (app seven) + the `ScreenViewData` per-app split | H4b |
| Weekly seed challenge with exportable verdict | H4b |
| Pager | H4a (sim) / H4b (surface) |
| **The alpha playtest, ≥2 hours, by a human** | H4b — a gate, not a nicety |

---

## 3. Cut, merged and re-ordered — the rulings

### 3.1 Merged: Phase 3's "role minigames" collapse into staffed activities

Roadmap Phase 3 says *housekeeping / maintenance / bellhop as full minigames
(each declaring pressure-vs-zen) + NPC staff for each*. Risk 6's own trigger
("a phase spec where one role exceeds a third of the phase") is met three
times by that sentence.

**Ruling: alpha ships two deep roles and the rest as activities.** Front
desk (deep, done in H1/H2a) and Owner/terminal (deep, done and deepening
through escalation) are the deep roles. Housekeeping and maintenance stay
the *zen activities* H2a shipped, and what H3a adds is **the staff who do
them** — reusing `staffBrainSystem` and the validated command path the clerk
already proved. Depth for housekeeping/maintenance (carts, routes, mess
triage, diagnose-before-cascade) is a post-alpha phase.

Rationale: DESIGN pillar 2 ("every job is a real game") is a shipped-game
promise, not an alpha promise, and pillar 4 ("delegation *is* the
progression") is the one alpha must deliver — which needs *hireable roles*,
not deep ones. Hiring your third employee is the arc; the minigame under it
is content.

### 3.2 Cut: bellhop, kitchen and security as roles

- **Bellhop** — luggage stacking is a physics-shaped game and ARCHITECTURE
  B5 refuses rigid-body physics in the sim. Cut. (A "carry a bag to a room"
  activity may ship in H3a as flavour if a lane has room; it is explicitly
  optional and gate-free.)
- **Kitchen** — cut as a role. Breakfast service ships in H4a as an
  *amenity*: an economy line and a star-gate unlock, no minigame.
- **Security** — cut from alpha. Its value is suspicion AI and CCTV, both of
  which exist to serve rival players. Phase 5+.

### 3.3 Cut: BLUEPRINT and the renovation/construction loop

This is the biggest cut and it is deliberate. BLUEPRINT is a floorplan
editor plus a construction simulation plus a live nav-grid and mesh rebuild
plus contractor NPCs plus a walk-through sign-off. It is a second game. Its
roadmap exit criterion (`renovation`: a BLUEPRINT change updates nav grid
and meshes consistently) is a whole phase's verification on its own.

**Replaced for alpha by a PURCHASE-driven upgrade track.** Room and amenity
upgrades are *spec-delta presets* — a committed table of deltas (better bed,
minibar, ensuite tier, lobby seating, a second desk terminal) applied to
existing rooms and re-fed through the same generator ARCHITECTURE B6 already
describes for renovations. Star gates gate presets rather than gating
free-form construction.

What this preserves: the hotel visibly improves, progression is physical and
diegetic, money buys something you can walk into, and the generator-delta
mechanism BLUEPRINT would need is built and gated at a fraction of the cost.
What it defers: player-authored floorplans. Say so out loud to players; do
not ship a BLUEPRINT icon that opens nothing.

### 3.4 Re-ordered: the incident cascade moves from Phase 3 to H4a, bounded

The roadmap puts the cascade in Phase 3. It belongs with the campaign, and
it must be bounded, for a design reason the roadmap did not notice: **an
escalating leak is a pressure loop growing out of a system DESIGN declared
zen.** Maintenance/repair is a zen completion loop with no timer and no
decay, structurally enforced in H2a by the fact that `mess` and
`repairProgress` carry no timestamp field.

**Ruling:** the cascade never lives in the zen components. It lives in its
own `incident` component, is capped at chain depth 2, and is declared a
*pressure* activity in its own right. The zen shapes stay unable to express
decay — which is what makes the ruling reviewable by inspection, exactly as
H2a's was. See [PHASE-H4.md](PHASE-H4.md) §A.

### 3.5 Re-ordered: CCTV out of alpha; pager in

CCTV's payload is interest-policy work for multiplayer (ARCHITECTURE B9);
cut to Phase 5. The pager is one line of push text and it directly answers
"chained to the desk" — keep, in H4a/H4b.

### 3.6 Kept in full, and moved earlier

**Protocol escalation** (`crossRef`, `loyaltyTier`, `billingCode` rule rows)
moves from "Phase 3, alongside everything else" to **H3a, early**, because
it is the mitigation for risk 3 — the risk most likely to make alpha
unfun — and it is cheap: the rule table, the plant/evaluate round-trip
property and the star-tier activation machinery all already exist. This is
the best depth-per-token item remaining in the roadmap, and the same is true
of **contracts and inspections** in H4a, which reuse the document entity and
rule-table machinery wholesale.

### 3.7 The alpha requirement the roadmap never had: versioned saves

H2's non-goals said "no save migration; H1 saves fail `Sim.restore()`'s
label check by design; the boot path treats a `RestoreError` as no save and
starts fresh. Pre-1.0, this is policy." That policy is correct up to alpha
and **wrong at alpha**: an alpha is a thing people play across sessions, and
every phase that registers a new `forkRng` label silently deletes their
hotel. H4a ships a save version stamp, a refusal-to-load path that *says so*
rather than starting fresh silently, and a migration hook. See
[PHASE-H4.md](PHASE-H4.md) §A.

---

## 4. Cross-cutting engineering decisions, decided here so no lane decides them

1. **`generateGroundFloor(seed)` → `generateHotel(spec)`.** Full contract in
   [PHASE-H3.md](PHASE-H3.md) §3A. The one-floor function is kept as a thin
   wrapper for exactly one release so H1/H2 scenarios do not all re-pin in
   the same commit as the multi-floor change; the wrapper is deleted in H3b.
2. **Floors are an ordinal in the sim and metres only in presentation.**
   No sim value is ever a world-Y in millimetres derived from a floor index
   by multiplication in more than one place. One exported function.
3. **`radiusInterest` is Y-blind and becomes actively wrong the moment a
   second floor exists.** It is not used in SP today. H3a adds a guard that
   throws if it is called against a multi-floor world, so the bug cannot be
   inherited silently into Phase 5. (ARCHITECTURE B9 already names it as
   "both wrong and, in a game about spying, a free ESP hack".)
4. **`ScreenViewData` is at exactly 9 of its 9-key budget.** App seven
   (STREETVIEW) does **not** get key ten. H4b splits the view per app. The
   H2a handoff already flagged that a tenth key is the moment to ask the
   question; this plan answers it in advance.
5. **`nav.stuck` is not a crowd-health signal.** The H2a review proved the
   worst nav failure is silent under it. Every crowd gate from H3a on
   asserts **goal arrival within N ticks for every agent**, and keeps `zero
   nav.stuck` only as a secondary check.
6. **Every new probe refuses rather than reports zero.** The
   `frame-time-p95` / `draw-calls` precedent is now a stated rule for
   `surface-contrast` and anything after it.
7. **The frame-time budget is re-based, not relaxed.** Two numbers replace
   one: a **software ceiling** measured on SwiftShader with a stated method
   and a stated purpose (regression detection only), and a **hardware
   number** measured once by a human on real GPU hardware. Neither is
   allowed to be picked to make a gate pass. [PHASE-H2C.md](PHASE-H2C.md) §4.
8. **`apps/hotel/src/sim/game.ts` is 122 KB and is the biggest structural
   risk to lane disjointness.** It is the file every sim lane wants. H3a's
   lane 1 splits it along system boundaries **before** any other H3a lane
   starts — this is a mechanical, behaviour-preserving move whose gate is the
   golden sweep going byte-identical. Without it, H3a cannot run five
   concurrent lanes.

---

## 5. What genuinely cannot be one-shot

The ask was a `/goal` of building this game in one shot. The plan is
designed to run end-to-end with minimal turnaround, and the honest list of
steps that break the chain is longer than one item. Each is scheduled, not
hand-waved.

| # | Step | Why no agent can do it | Scheduled at |
|---|---|---|---|
| 1 | **The look-lock sign-off.** Chris views the four committed screenshots, drives the build himself, and the review records `LOOK-LOCKED: <commit>`. | "Charming, not programmer art" has no probe. The spec says so rather than faking one. | H2c, before the H2b review can PASS |
| 2 | **A hardware frame-time measurement.** | No agent here has a GPU. Headless SwiftShader measured 108 ms against a 16.7 ms budget; the pairing is meaningless. Someone must run the built game on real hardware once and report `frameStats()`. | H2c §4 |
| 3 | **A second, smaller art sign-off for new surfaces.** | The look-lock freezes the *style constants*, not the judgement of new content. H3b adds stairs, elevators, upgraded rooms — none of them covered by a signature on H2c's four screenshots. | H3b |
| 4 | **Listening to the audio, once.** | `audio-coverage` asserts event-table completeness and that nodes are scheduled. No gate asserts audible output, and the spec is honest that none can. | H2c, alongside step 1 |
| 5 | **The alpha playtest, ≥2 hours, recorded.** | Risks 3 and 8 have warning signs *defined* as human experience: "a session where the terminal is opened only to click confirm"; "playtest sessions shortening while the hotel keeps growing". No bot can observe either. | **H4b — this is the alpha gate** |
| 6 | **Any invariant or public-contract change discovered mid-implementation.** | WORKFLOW routes it to a planning turn. That is a model switch and a document, not a human, but it is a hard stop in the chain and it will happen at least once. | Anywhere; §7 says how to spot it early |
| 7 | **The H4 contract-resolution planning turn.** | H4's economy and rival-AI contracts depend on numbers H3a has not measured yet (perf at 3× scale, star-gate thresholds against real occupancy). Specifying them now would be a figure without a method — the thing this project forbids. [PHASE-H4.md](PHASE-H4.md) marks each `[planning-turn @ H3b merge]` with the exact inputs it needs. | at the H3b merge |
| 8 | **The push decision.** | `origin/main` is 48 commits behind local `main` and carries one commit local does not. Nothing in this project has ever been pushed. That is a person's call, not an agent's. | before alpha is called done |

Everything else in this plan is agent-executable end to end.

---

## 6. Subagent execution design (deliverable c)

### 6.1 The shape

**One orchestrator, at most FIVE concurrent subagents, lanes disjoint by
file.** This is the pattern that worked in H2b: five concurrent lanes (atlas,
audio, persistence, boom clip, golden sweep), each with an explicit
verification command list and an explicit non-vacuity obligation; all five
landed usable work. Lanes were drawn by *file*, and the one shared file
(`package.json`) was flagged contested in every brief.

Per-unit lane tables — with the actual file globs — live in each phase spec
([PHASE-H2C.md](PHASE-H2C.md) §7, [PHASE-H3.md](PHASE-H3.md) §8,
[PHASE-H4.md](PHASE-H4.md) §7). This section is the constitution they all
inherit.

### 6.2 The orchestration rules (non-negotiable)

Rules 1 and 2 were learned the hard way and appear **verbatim in every
subagent brief**, not by reference:

1. **"Do this work yourself. Do not spawn subagents."** Two agents in H2b
   spent their entire budget re-delegating and returned having done nothing —
   roughly 140k tokens for zero output.
2. **"Do not run any `git` command. Do not commit, do not `git add`, do not
   stash."** The orchestrator commits. In H2b one agent's uncommitted edits
   were swept into another lane's commit; nothing was lost but the
   attribution was wrong. During this planning turn a *second session* was
   found live-editing the same worktree, which is the same hazard from the
   other side.

And the rest:

3. **The orchestrator runs `git status --porcelain` immediately before every
   commit** and stages **explicitly named paths only** — never `git add -A`,
   never `git commit -a`. If a modified path is not in the lane's declared
   globs, the orchestrator stops and reconciles before committing.
4. **One commit per lane**, message naming the lane and the gates it moved.
5. **A lane may not edit a file outside its declared globs.** If it needs
   to, it stops and reports the need. The orchestrator either extends the
   glob (if no other live lane owns it) or serialises the two lanes.
6. **Contested files are orchestrator-only**, always: `package.json`,
   `package-lock.json`, `docs/ROADMAP-HOTEL.md`, `apps/hotel/docs/HANDOFF.md`,
   `CLAUDE.md`, `docs/reviews/**`. A lane that needs a script added asks for
   it in its report.
7. **Every lane brief carries a verification command list and a non-vacuity
   obligation.** The obligation is specific: *break this exact thing, confirm
   the gate reds on this exact assertion, restore by clean rebuild, confirm
   green, report all four exit codes.*
8. **Every lane brief carries the rebuild discipline verbatim:** before any
   perturbation claim, `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game` then rebuild — otherwise the "restore" is a no-op.
   This trap has bitten four times.
9. **Verdict JSON is written inside the repo.** Git Bash `/tmp` paths do not
   round-trip to the Node process on this machine. (This bit me once during
   this planning turn.)
10. **`npm run harness --silent -- <scenario>`** — `--silent` or npm's banner
    pollutes the verdict JSON.
11. **Report format, fixed:** files touched; every command run with its exit
    code; the perturbation performed and the exact assertion that went red;
    **and what you did NOT do**. A lane that could not finish says so; a lane
    that skipped a verification step says so, unprompted.
12. **The orchestrator re-runs every gate claim itself before the review
    gate.** Subagents have reported "all green" on this project when it did
    not reproduce.
13. **A finished lane does not pick up new work.** It reports and stops; the
    orchestrator issues a fresh brief with fresh context.
14. **The orchestrator holds no lane of its own while five are live.** Its
    job is integration, commits, and re-verification.

### 6.3 Model tiering

Cheapest tier fully capable of the task, under the standing ceiling:

| Work | Tier | Why |
|---|---|---|
| Mechanical edits against a written contract; file splits; fixture and table generation; doc passes | **Haiku** | Fully specified; the spec is the judgement |
| Scenario and gate authoring; probe implementation; system implementation; perturbation campaigns | **Sonnet** | Measured as the hardest and slowest work on this project (R12); it is not mechanical |
| Phase specs; review gates | **Fable** | Planning and review only, never a lane |

Never spend Fable inside a lane. Never spend Haiku on a browser gate — that
is where three of five units lost their schedule.

### 6.4 The lane-shape rule that makes five concurrent lanes possible

A unit can run five concurrent lanes only if it has five file-disjoint
regions. That is a property of the tree, not of the plan, and it is why
§4.8 (splitting `game.ts`) is scheduled as H3a lane 1 rather than as
housekeeping. **Check disjointness before promising parallelism**; where the
tree does not allow five, run fewer and say so in the phase spec's lane
table.

---

## 7. Risk register v2 (the alpha-relevant set)

Carried risks keep their original numbers so existing docs still resolve.

| # | Risk | Mitigation | Early warning sign |
|---|---|---|---|
| 1 | Determinism erosion (now: write-through violations) | Every `--verify-replay` cross-checks incremental vs slow hash every 500 ticks and at the end, both legs | Any exit 3. P0, always; never answered by loosening |
| 3 | The management layer is shallow | Escalation rows moved early into H3a; contracts/inspections in H4a | **H4b playtest**: the terminal opened only to click confirm |
| 4 | NPC nav jank at 3× scale | Goal-arrival assertions replace `nav.stuck` as the primary signal (§4.5); clearance-aware A* extracted in H3a | Any agent failing to reach its goal within the gate's tick budget |
| 5 | Perf collapse at Phase 3 scale | Off-screen guest abstraction (B8 item 4) is H3a scope, not a later fix; `full-house-day` measures with the warm-bench method | `one-man-week`-class avgTickMs trending above 1.0 as entity count rises past ~300 |
| 6 | Scope explosion in roles | §3.1–3.3 cut it out of alpha | Any H3 lane in which one role exceeds a third of the lane's diff |
| 7 | Programmer art | H2c adds a **mechanical value-separation gate** (`surface-contrast`) so the caught-by-eye regression becomes caught-by-gate; look-lock ends iteration | A screenshot that needs a caption to parse |
| 8 | 12-hour fatigue | Prestige as setup-ritual compression (H4a) | **H4b playtest**: sessions shortening while the hotel grows |
| 9 | MP retrofit pain | Actor-bound commands hold; `radiusInterest` guarded (§4.3) | Any sim code reading "the player" as a singleton |
| R12 | Verification-authoring cost dominates | Gate authoring is Sonnet-tier lane work with its own lane, never a tail task; `derive-walk.mjs` is assumed and extended in H2c | A browser gate in its second session without a green run |
| R13 | Vacuous gates | Perturbation obligation in every lane brief and every gate spec | A gate that has never been seen red |
| R14 | Verified but invisible | Every new sim feature names its player-visible surface in the spec, or is cut | A view key no app reads; a verb no gate clicks |
| R17 | Concurrent agents and git | §6.2 rules 2, 3, 6 | A `git status` showing paths no live lane declared |
| R18 | Budgets for absent hardware | §4.7 two-number rule | Any budget edited in the same commit as the code it measures |
| **R19** | **The generator contract change lands under five concurrent lanes** | `generateHotel` is contract-frozen in [PHASE-H3.md](PHASE-H3.md) §3A before any lane starts; the one-floor wrapper keeps H1/H2 scenarios pinned for one release | A lane proposing a signature change mid-flight — escalate, do not decide |
| **R20** | **`game.ts` blocks parallelism** | §4.8: split it as H3a lane 1, gated by byte-identical goldens | Two H3a lanes queued behind the same file |

---

## 8. Open questions left to implementer judgement

Deliberately not decided here; the specs name more within each phase.

1. Floor count at alpha (3 is the roadmap's number; 3–4 is the range, gated
   by `full-house-day`'s perf result, not by taste).
2. Elevator car count, capacity and schedule shape — content, within the
   determinism rules.
3. The upgrade-preset table's contents and prices (H3a), tuned against
   `campaign-month` solvency, never against a gate assertion.
4. Archetype trait composition and how many of the ten get distinct
   behaviours versus flavour.
5. Whether the optional bellhop "carry a bag" activity ships at all.
6. Contract kinds beyond conference / film crew / health inspection.
7. Prestige carry-over set (which unlocks survive) — audited against
   DESIGN's dark-pattern list, which is the only hard constraint.
8. Whether `surface-contrast` samples fixed screen rectangles or
   mesh-projected ones ([PHASE-H2C.md](PHASE-H2C.md) §3 states the
   trade-off and leaves the choice).

---

## 9. Documents this plan supersedes or amends

- [ROADMAP-HOTEL.md](ROADMAP-HOTEL.md) Phases 3 and 4 are **superseded** by
  this document and the H3/H4 specs. Phases 5–7 stand unchanged. The roadmap
  should gain a pointer here; the orchestrator makes that edit (contested
  file, §6.2 rule 6) at the H2c merge.
- [PHASE-H2.md](PHASE-H2.md) is **not** superseded. H2b's spec stands;
  [PHASE-H2C.md](PHASE-H2C.md) amends four of its numbers and adds one gate,
  and says so in place.
- `apps/hotel/docs/HANDOFF.md` is refreshed at every unit boundary, per
  standing practice.
