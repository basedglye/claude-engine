# Roadmap — GRAND FOYER (`apps/hotel`)

This is the phased roadmap for `apps/hotel`, GRAND FOYER — the first-person
hotel simulation built on ClaudeEngine. It runs alongside the engine's own
[docs/ROADMAP.md](ROADMAP.md) rather than replacing it: engine-level work
(kernel, harness, infrastructure packages, the `apps/living-world` flagship)
is tracked there, while this document tracks the app and the new engine
packages GRAND FOYER needs. See
[apps/hotel/docs/DESIGN.md](../apps/hotel/docs/DESIGN.md) and
[apps/hotel/docs/ARCHITECTURE.md](../apps/hotel/docs/ARCHITECTURE.md) for the
design bible and technical architecture these phases build against.

**F** = needs a Fable planning turn (contract/invariant surface). **S** =
straight Sonnet execution. Every phase ends in something walkable in a
browser and gated by harness verdicts.

## Phase 0 — "Walk the Lobby" (~3–5 days) [F] — **DONE** (merged 2026-08-25)

Spec: [PHASE-H0.md](PHASE-H0.md). Review: [reviews/phase-H0.md](reviews/phase-H0.md) — PASS at round 3.
Shipped `@claude-engine/space`, `@claude-engine/interiors`, `@claude-engine/player-fps`, and `apps/hotel`.
Gates live: `walk-collide --verify-replay`, and `fps-look-interact --browser --verify-replay` on Chromium
and Firefox. Carry the review's consolidated deferral list into the H1 spec.


Scaffold `apps/hotel`; create `space` (incl. `sim-math` fixed-point trig)
and `player-fps`; minimal `interiors` (one BSP floor — lobby + corridor + 4
rooms, vertex-colour only, untextured); core `despawn` + indexed
`eventsSince`; renderer pointer-lock + `pointerHandlers` + synthetic-pointer
test hook; harness pointer steps + `sim-tick-ms` probe; CI ban on `Math.*`
transcendentals in sim packages. Player walks (WASD + mouse), collides with
walls, toggles 1st/3rd, opens doors.

*Exit:* `fps-look-interact` passes `--browser --verify-replay` **on two
engines (headless Chromium + Firefox)** — this is the cross-machine
determinism gate; `walk-collide` headless (bot walks a scripted path,
`noStuckAgents`, never inside a solid cell); purity + Math-ban checks green.

## Phase 1 — "Front Desk & The Terminal" (~1–2 wk) [F]

Split into **H1a "The Queue"** (sim substance, headless-verifiable) and
**H1b "The Terminal"** (surfaces and persistence, browser-verified), each with
its own review gate — see [PHASE-H1.md](PHASE-H1.md) for the split ruling.

**H1a — DONE** (merged 2026-08-25). Review: [reviews/phase-H1a.md](reviews/phase-H1a.md) — PASS, zero blocking.
Guests, deterministic nav with the yield rule, the RESERVA rule table, the
desk state machine, ledger, day clock, `clerkBot`, articulated characters and
the held-document view. Gates live: `corridor-headon`, `checkin-rush`,
`fraud-catch` (A and B).

**H1b — DONE** (merged 2026-08-25). Review: [reviews/phase-H1b.md](reviews/phase-H1b.md) — PASS at round 2.
`@claude-engine/surface-ui` (pure integer layout shared between hit-testing
and painting, committed bitmap font, the calibration strip), the HOTELSOFT
shell with RESERVA and AUDIT, in-world screen focus and click routing,
`@claude-engine/save-web` (IndexedDB behind the existing `GameStore`), the
harness `screenClick` step and the `screen-readability` probe. Gates live:
`reserva-readability` (both engines) and `save-restore`.

**Phase 1 is complete.** Phase 2 is split into H2a (everything that changes
`stateHash`) and H2b (everything forbidden from changing it) — see
[docs/PHASE-H2.md](PHASE-H2.md) §1. **H2a is complete and merged**; H2b is
next.


`surface-ui` + HOTELSOFT shell + RESERVA (rule-table driven from day one);
document entities and held-item inspect; guest NPCs with portal+grid nav,
**stable-ID yield rule + RNG cell-cost jitter**, and explicit desk queue;
check-in/out state machine with accept/deny + fraud flags; basic economy +
day clock + night audit screen; `save-web`; articulated-prop characters with
walk pose.

*Exit:* `checkin-rush` (8 guests, clerkBot, occupancy + ledger asserts,
replay-verified); `fraud-catch`; `corridor-headon` (two agents, opposite
directions, 1-cell corridor — both arrive within N ticks); `save-restore`
(save at tick N, restore, `stateHash` equal); **focused-pose readability
screenshot check** on RESERVA.

## Phase 2 — "One-Man Show" (vertical slice 1) (~2–3 wk) [S, F review]

Split into H2a and H2b at the invariant-2 boundary ([PHASE-H2.md](PHASE-H2.md) §1).

### Phase 2a — "The Living Hotel" — **DONE** (merged 2026-08-26)

Everything that changes `stateHash`. Incremental `stateHash` with
`stateHashSlow()` as the cross-check on every `--verify-replay`; the
`indexSystem` per-tick context and the A*-scratch refactor; `actorId` and
the second actor kind; housekeeping + maintenance as *zen-loop* activities
(dirty or broken rooms are BLOCKED from re-letting, never punished);
complaints → reviews → reputation → stars, recomputed from a rolling window
at each audit; demand curve + pricing; daily objectives; LEDGER / PRICER /
MAILBOX / STAFF (the registry stops at six apps); the blacklist rule row and
the MAILBOX bulletins that feed it; and **the first-hire beat** — the
threshold is printed nightly, résumés print as real document entities, the
interview happens in person, and the clerk NPC then works the desk through
the same validated `desk.decision` path the player uses.

*Exit, all met:* `one-man-week` (7 in-game days, ends solvent, one hire, the
review pipeline emitting, 21 objectives, zero `nav.stuck`); `first-hire`
(the clerk completes check-ins and a fraud catch unaided, asserted from the
attribution record); `zen-clean` (the not-ready refusal, and delay costing
nothing across a real idle gap); `escalation-stars` (reviews → tier → rule
row → bulletin → a catch that was impossible a day earlier, with a pre-tier
control); the app decision-path suite and a registry-derived composed-shell
overflow gate. Verdict: [reviews/phase-H2a.md](reviews/phase-H2a.md).

### Phase 2b — "The Look & The Sound" — next

Retro texture pipeline (quantize + dither atlas, UVs, instancing,
vertex-colour lighting, PS1 shader look-lock excluding screen quads);
`audio`; `frame-time-p95` + `draw-calls` probes and budgets; load-on-boot
persistence; third-person boom clip.

*Exit:* `art-lock` (both engines) with the art look-lock signed off on
screenshots; `save-resume`; `audio-coverage`; and every headless golden
pinned at the H2a merge byte-identical afterwards.

**First item for H2b** (carried from the H2a review): there is no repeatable
browser gate for clicking a mess, a prop or a candidate. The objects render
and were verified clickable by driving the running game, but a browser
scenario's `setup` builds only the replay sim — the page runs the app's own
`setup()` — so a gate can only click what the shipped world contains at the
tick it runs, and the nearest prop is a bedroom away behind two closed
doors. H2b owns browser gates; this is the flagship-path hole to close.

## Phase 3 — "A Real Hotel" (~3–4 wk) [S]

Multi-floor generator + elevators/stairs; housekeeping/maintenance/bellhop
as full minigames (each declaring pressure-vs-zen) + NPC staff for each;
morale/quirks; incident cascade system; BLUEPRINT + renovation/construction
loop; star gates + unlock track; protocol-escalation rules per star tier;
10+ guest archetypes; PA/mischief affordances; pager.

*Exit:* `full-house-day` (30 rooms, 3 floors, 12 staff, 40 guests,
`sim-tick-ms` ≤ 5 ms, `noStuckAgents`); `cascade` (unfixed leak escalates
deterministically); `renovation` (BLUEPRINT change updates nav grid and
meshes consistently).

## Phase 4 — "The Campaign" (~3 wk) [S]

Kitchen + security roles; contracts/inspections; loans, failure spiral, repo
manager; seasonal events; role XP/mastery; prestige defined as
setup-ritual compression; SP rival hotels via `rivalAiSystem` + STREETVIEW
(read-only intel — pre-builds the MP intel surface); weekly seed challenge
with exportable verdict.

*Exit:* `campaign-month` soak (30 days, bots across roles, economy
invariants hold, ledger double-entry balances); `inspection`;
`bankruptcy-recovery` (the spiral floor is escapable).

## Phase 5 — "Street Foundations" (~2–3 wk) [F]

Snapshot-free serialisation; delta protocol v2; pluggable `InterestPolicy` +
the room/portal policy in `space`; command rule table hardening; the hotel
running under `startGameServer` with one human + AI rivals;
`GameStore.compact()`; `npm run host` + tunnel docs.

*Exit:* `net-solo` (SP behaviour identical under the server,
replay-equivalent); the **anti-wallhack gate** (bot in a corridor receives
zero components of entities behind closed doors, asserted on the wire); soak
2k entities, serialisation ≤ 3 ms/actor.

## Phase 6 — "The Street" (multiplayer) (~4–6 wk) [F plan, S execute]

2–8 players per street; shared guest-pool allocation; presence blips; CCTV
interest extension; suspicion AI; espionage/sabotage verbs with detection
and consequences; staff poaching; Cozy/Cutthroat tiers; damage caps;
lobby/auth; offline autopilot.

*Exit:* `espionage` (saboteurBot infiltrates; caught and uncaught branches
both assert; victim receives the forensic replay); `street-week` soak with 8
bots; griefing-cap asserts; `ticketAuth` end-to-end.

## Phase 7 — "The City" (ongoing) [F per feature]

Multiple streets, seed-challenge leaderboards, seasonal live events,
reputation meta, replay theatre.

**Dependencies:** 0→1→2 strictly sequential. 3 and 5 are independent after
2. 6 requires both 4 and 5.

## Top risks

1. **Determinism erosion** (float/trig creep, iteration order). Mitigation:
   integer sim math + `sim-math` LUTs + CI `Math.*` ban + `--verify-replay`
   on every scenario + two-engine gate in Phase 0. Warning: any exit-code-3
   in CI — treat as P0 immediately.
2. **The diegetic UI is unusable in practice** (illegible at angle, fiddly
   mouse-on-quad). Mitigation: exempt screen textures from the retro
   pipeline, ≥640×480 native + nearest-neighbour, generous UV hit targets,
   focus camera ease, readability gate in Phase 1. Warning: playtesters lean
   into the monitor or ask for a HUD.
3. **The management layer is shallow** (the Internet Cafe Simulator
   failure). Mitigation: rule-table RESERVA from day one, protocol
   escalation per star tier as a scheduled system. Warning: a session where
   the terminal is opened only to click "confirm".
4. **NPC nav jank** — stuck agents and queue deadlocks, the wrong kind of
   comedy. Mitigation: explicit queue slots, stable-ID yield + seeded
   jitter, `noStuckAgents` in every scenario, `corridor-headon` gate,
   repath starvation counter. Warning: `nav.stuck` events in soak verdicts.
5. **Perf collapse at Phase 3 scale.** Mitigation: budgets in verdicts from
   Phase 2, the B8 fix order (see ARCHITECTURE.md), off-screen guest
   abstraction. Warning: `sim-tick-ms` trending > 3 ms at Phase 2 scope.
6. **Scope explosion in roles** (8 minigames is 8 games). Mitigation: roles
   ship shallow as "activities" in one phase, deep as minigames in a later
   one; front desk is the only deep role until Phase 3. Warning: a phase
   spec where one role exceeds a third of the phase.
7. **Retro-procedural art lands on "programmer art"** instead of charming.
   Mitigation: palette + dither + jitter are the load-bearing style; a
   dedicated art look-lock review with screenshots at the Phase 2 gate.
   Warning: screenshots need captions to be parsed.
8. **~12-hour fatigue** — the loop stops evolving. Mitigation: protocol
   escalation (risk 3) + Phase 4 meta-progression as setup-ritual
   compression. Warning: playtest sessions shortening while the hotel keeps
   growing.
9. **MP retrofit pain** despite intentions. Mitigation: actor-bound commands
   + shared validation table from Phase 1; `net-solo` equivalence before any
   MP feature. Warning: sim code treating "the player" as a singleton.
10. **Espionage becomes griefing.** Mitigation: consent tiers, damage caps,
    presence risk, forensic replays; tune with saboteurBot economics
    (expected value of sabotage ≤ expected cost when caught). Warning:
    Cutthroat streets emptying while Cozy fills.
11. **Home-PC hosting friction** sours the first MP session. Mitigation:
    one-command `npm run host` with tunnel bootstrap and preflight; SP
    static build needs no hosting at all. Warning: a friend taking > 5
    minutes in the Phase 5 doc test.

## Immediate work (what happens on approval)

Per the repo's own workflow ([docs/WORKFLOW.md](WORKFLOW.md)), Phase 0 is a
contract-changing phase, so it gets a Fable phase spec committed to the repo
before Sonnet implements, then a Fable review gate.

1. Commit this framework spec into the repo:
   `apps/hotel/docs/DESIGN.md` (Part A), `apps/hotel/docs/ARCHITECTURE.md`
   (Part B), `docs/ROADMAP-HOTEL.md` (Part C/D). Update `docs/ROADMAP.md` to
   note `apps/hotel` alongside the unstarted `apps/living-world`.
2. Fable writes `docs/PHASE-H0.md` — the Phase 0 spec with API contracts for
   `space`, `player-fps`, the `core` additions, the `renderer-three` pointer
   contract, and the harness pointer steps.
3. Sonnet implements Phase 0 against that spec; verify locally with build +
   purity + Math-ban + the two named scenarios.
4. Fable reviews the Phase 0 diff into `docs/reviews/phase-H0.md`; fix-list
   loops until PASS; merge.
5. Chris drives the built game himself in the browser preview before
   reporting Phase 0 done — a build report is not proof.

## Verification

- `npm run build` and `npm run lint` at the monorepo root.
- `npm run check:purity --silent` plus the new `Math.*` transcendental ban.
- `npm run harness --silent -- fps-look-interact --browser --verify-replay`
  on headless Chromium **and** Firefox (headless Chromium needs
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` or
  shaders silently fail to a blank canvas with no console error).
- `npm run harness --silent -- walk-collide --verify-replay` (exit 0; exit 3
  means replay divergence).
- `npm run dev -w apps/hotel`, then drive it in the Claude Browser preview:
  pointer lock engages, mouse look is smooth, walls stop you, a door opens
  on click, `V` toggles third person. Screenshot as evidence.
- Before reporting Phase 0 complete, run the blind `skeptic` agent on the
  completion claim and relay its verdict verbatim.
