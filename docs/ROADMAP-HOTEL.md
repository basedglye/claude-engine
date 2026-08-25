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

## Phase 0 — "Walk the Lobby" (~3–5 days) [F]

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

Retro texture pipeline (quantize + dither atlas, UVs, instancing,
vertex-colour lighting, PS1 shader look-lock excluding screen quads);
`audio`; LEDGER / PRICER / MAILBOX / STAFF apps; complaints → reviews →
reputation; housekeeping + maintenance as *zen-loop* player activities
(dirty rooms block check-in, props break); demand curve + pricing; daily
objectives; incremental `stateHash`; **the first-hire beat** — hit the
threshold, résumés print, interview in person, clerk NPC works the desk
while you watch.

*Exit:* `one-man-week` (7 in-game days, ends solvent, ≥1 hire completed,
review pipeline emits); `first-hire` (staff NPC completes a check-in
end-to-end unaided); `frame-time-p95` + `draw-calls` budgets green; art
look-lock signed off on screenshots.

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
