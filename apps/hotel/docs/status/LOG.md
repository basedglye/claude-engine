# GRAND FOYER — status log

Artifact: https://claude.ai/code/artifact/b3e32220-50ad-4fd9-ad81-e78781fb604f


Status page: (not yet published — this file is the durable source; the
orchestrator publishes `status.html` separately)

## 2026-08-25 — the engine gets a hotel: Phase H0 walks the lobby

**Shipped**
- Phase H0: the first playable slice — a first-person player can walk
  into the lobby of a procedurally generated hotel and look around.
  Merged after three review rounds.

**Verified**
- Phase H0 review gate (round 3): **PASS**, clear to merge (`99baba4`).
- Checked out text as LF on every platform, avoiding a cross-machine
  determinism trap early.

**Next**
- Phase H1: the front desk and the terminal.

**Known issues**
- None recorded at this milestone.

**Images**
- (none captured this phase)

---

## 2026-08-27 — Phase H1a: The Queue — guests, the desk, a fraud oracle

**Shipped**
- Guests arrive with documents; the front desk becomes a real state
  machine; a deterministic fraud oracle can catch a bad check-in.
- `clerkBot` — the first scripted actor driving desk decisions in a
  headless scenario.

**Verified**
- Phase H1a review gate: **PASS**, clear to merge (`57cb131`).

**Next**
- Phase H1b: get HOTELSOFT on screen and make the terminal legible.

**Known issues**
- None recorded at this milestone.

---

## 2026-08-29 — Phase H1b: The Terminal — HOTELSOFT, saves, a legibility gate

**Shipped**
- HOTELSOFT screens rendered in the world and clickable by the harness.
- Browser save/load through IndexedDB, gated on exact tick.
- A dedicated legibility gate for the CRT terminal (readability isn't
  free — this took two review rounds to actually prove).

**Verified**
- Phase H1b review gate (round 1): FIX-LIST — 1 blocking, 6 non-blocking.
- Phase H1b review gate (round 2): **PASS**, clear to merge (`c700e6c`).
- Along the way: a seed mismatch was found that made replay a lie, and
  was fixed before merge, not after.

**Next**
- Phase H2: give the hotel real work to do (housekeeping, maintenance,
  reviews, staffing).

**Known issues**
- None recorded at this milestone.

---

## 2026-09-01 — Phase H2a merged: The Living Hotel

**Shipped**
- Housekeeping and maintenance as two verbs, no timers (lane 4).
- The per-tick spatial index and A* scratch allocation made real,
  including the sidestep branch (lane 2).
- `actorId`, the H2 component set (lane 3).
- Reviews, reputation, stars, demand, and daily objectives (lane 5).
- The four HOTELSOFT apps, MAILBOX bulletins, and the game's first
  hireable staff member — the clerk (lanes 6-7).
- The owner bot and the four H2a gates (lane 8).
- Incremental `Sim.stateHash()`, cached per-(component, entity), plus
  `stateHashSlow()` as the full-walk cross-check the harness asserts
  agree on every run — this is CLAUDE.md invariant 6 (write-through),
  numbered last in the doc specifically because H2a is where it started
  mattering: an in-place mutation of a fetched component silently
  corrupts the incremental hash without this cross-check.

**Verified**
- Phase H2a review gate: **PASS** (5 non-blocking items) (`ff195b9`).
- Follow-up commit closed non-blocking items 1-4 before merge
  (`f826472`).
- Merged as `28e554a`.

**Next**
- Refresh the handoff at the H2a → H2b boundary (done same day, see
  below) — then start the alpha-look and alpha-loop work.

**Known issues**
- None blocking at merge; non-blocking review items closed pre-merge.

---

## 2026-09-02 (morning) — the CC0 real-hotel look, all gates green, mouse fixed

**Shipped**
- A real-hotel look for the existing H2a sim, built from CC0 assets
  (ambientCG PBR textures, Poly Haven glTF furniture and an HDRI, Kenney
  furniture and characters), fetched on demand — nothing under
  `apps/hotel/src/sim` changed; every headless golden stayed
  byte-identical.
- Pointer-lock free-look mouse look, click-to-enter, Esc-to-release — and
  a mouse-handedness fix: the DOM's `movementX` sign was getting crossed
  with sim yaw sign; fixed by keeping the synthetic `pointer.look(dx)`
  path in yaw-space so every hand-derived gate script stayed valid.
  (`8f32704`)
- A quality-tier split (`apps/hotel/src/render/quality.ts`): a software
  GL renderer (SwiftShader/llvmpipe) auto-selects **low** quality (no
  texture/model fetches, no shadows, no point lights) so headless browser
  gates stay fast (~200ms/frame vs 1-3s at full quality) while a real GPU
  gets the full CC0 look.
- Module map for the render layer landed: `floorplan.ts`, `assets.ts`,
  `architecture.ts`, `door-leaf.ts`, `exterior.ts`, `lighting.ts` /
  `fixtures.ts`, `decor.ts`, `characters.ts` / `upkeep.ts` / `screens.ts`,
  `hud.ts` / `i18n.ts`.

**Verified**
- `npm run build`, `npx tsc -p apps/hotel/tsconfig.json --noEmit`,
  `npx eslint .`, `node scripts/check-purity.mjs`: green.
- `npm test` smoke and `npm run test --workspaces --if-present`: green.
- Headless `--verify-replay`: `checkin-rush` 1978775531, `first-hire`
  4132986008, `one-man-week` 3423109909, `escalation-stars` 2672628845 —
  all `passed: true`.
- Browser `--browser --verify-replay`: `fps-look-interact` (Chromium and
  Firefox), `reserva-readability`, `save-restore`, `demo-visual` — all
  exit 0, replay verified, incremental/slow hash agree.

**Next**
- Cycle 1 of the alpha loop (see below): tier 0/1/2 renovation, the
  economy that pays for it, the walkthrough, and a single-file artifact
  build.

**Known issues**
- The lobby is only 2.25m deep (`lobbyDepth` 9-12 cells) — it cannot
  look properly grand at that depth. Fixing it moves every golden hash
  and is explicitly out of scope until the H3a `generateHotel(spec)`
  work.
- Guests use Kenney's blocky CC0 characters — no CC0 realistic rigged
  humans with a direct download URL were found.
- No `monitor-crt` or `radiator` CC0 models exist in the asset pack;
  both use procedural fallbacks.

**Images**
- apps/hotel/docs/evidence/alpha-look-lobby.jpg
- apps/hotel/docs/evidence/alpha-look-facade.jpg

---

## 2026-09-02 (evening) — alpha loop cycle 1: **IN PROGRESS**

The CEO (Fable) wrote a binding vision for the alpha: take the hotel from
a two-bit motel (tier 0) to the Grand Foyer (tier 2) in one sitting, via
check-in, cleaning, night audits, and a RENOVATE action, with an economy
that only lets the premium guest segment book once the hotel deserves it.
See `apps/hotel/docs/VISION-ALPHA.md`.

The COO broke this into four concurrent, file-disjoint Sonnet lanes (see
`apps/hotel/docs/alpha-loop/BREAKDOWN.md`):

| Lane | Owns | Status as of this entry |
|---|---|---|
| W1 — Sim | `hotel.tier`, RENOVATE command, tiered economy, `alpha-loop` scenario | Review round 1: **FIX-LIST, 1 blocking** (the tier-gate was gating the demand *quota*, not the guest *mix* — a business-segment guest could still book before renovation). COO retuned the constants directly in `economy.ts` in the same review pass. |
| W2 — Motel-tier look | Procedural textures + tier plumbing in `render/{architecture,decor,lighting,fixtures,exterior,procedural.ts}` | Review round 1: **FIX-LIST, 5 items, 2 blocking** (neon VACANCY sign rendered as a solid black rectangle; drop-ceiling grid rendered gold instead of tile). Round 2: **PASS** — items 1-3 confirmed fixed by the COO directly, including an independent re-check that the tier-2 look had not regressed against the committed `alpha-look-*.jpg` evidence. |
| W3 — Walkthrough + end card | `render/{walkthrough.ts,hud.ts,i18n.ts}` | Review round 1: **FIX-LIST, 4 items, 1 blocking** (the "you win" end card was firing at tier 1, not tier 2). Round 2: **PASS**, conditional on the integration re-run; the checker's PASS-line count came in off-by-one from the lane's own report both rounds (25 vs 26, then 29 vs 30) — the COO re-ran it itself rather than trusting the reported number. |
| W4 — Artifact build + pointer fallback + Netlify | `scripts/build-artifact.mjs`, `render/pointer-fallback.ts`, `netlify.toml` | Review round 1: **FIX-LIST, 3 items, 1 blocking** (`netlify.toml` could not build as written). Round 2: **PASS**, all three items closed and independently re-verified. |

**Shipped so far**
- `main.ts` wiring for the tier system, walkthrough, and pointer-lock
  fallback (`d73aca1`).
- CEO vision (`VISION-ALPHA.md`) and COO breakdown + four worker briefs
  (`e3b0c52`).

**Verified**
- W2 round 2, W3 round 2, W4 round 2: **PASS**, each independently
  re-checked by the COO (not taken on the worker's word) — see
  `apps/hotel/docs/alpha-loop/reviews/{W2,W3,W4}.md`.
- W1's `alpha-loop` headless scenario ran green on 8 of 9 assertions
  before the fix; the COO's own retune (constants below) is recorded in
  `apps/hotel/docs/alpha-loop/reviews/W1.md` but this session did not
  independently re-run `alpha-loop --verify-replay` after that retune —
  **not verified this session.**
- All four other headless scenarios (`checkin-rush`, `first-hire`,
  `one-man-week`, `escalation-stars`) plus `alpha-loop` itself came back
  replay-verified with no hash divergence, per W1's own review pass
  (twelve of thirteen total scenarios green, all thirteen replay-clean).

**The economy finding (W1)**
The first cut of the tiered economy gated only the demand *quota* by
hotel tier, not which guest *segment* could book — so a business
traveler could show up and book a tier-0 motel, which breaks the vision's
"tier 0 fills only with the cheap segment; tier 2 unlocks the premium
one." The COO's retune, done in one pass in `economy.ts`:

```
RENOVATE_COST_MINOR        [0, 80_000, 150_000]      // $800, $1,500
RENOVATE_STAR_REQ          [0, 2, 2]                 // unchanged
SEGMENT_MIN_HOTEL_TIER     family 0, leisure 0, business 2
TIER_DEMAND_MULT_PERMILLE  [1000, 1300, 1600]
MAX_RATE_BY_TIER_MINOR     [6_000, 6_500, 7_500]
```

The tuned 14-day arc (owner bot, seed `hotel-alpha-loop-1`) renovates
tier 0 → 1 on day 3 for $800. This is the COO's own tuning run recorded
in the review file — this session has not independently re-driven that
arc.

**What's NOT done — do not read this as a finished cycle**
- Cycle 1's four lanes have fix-lists at PASS or in re-review; the COO's
  BREAKDOWN.md is explicit that **cycle 2 does not start** (playtest QA
  against the built artifact, tuning against `alpha-loop` gate numbers,
  and `apps/hotel/docs/WALKTHROUGH.md` written by driving the real build)
  until every cycle-1 lane has passed the checklist and the integration
  is committed and green.
- This status entry was written from the review files and commit log,
  not from re-driving the build — treat the PASS verdicts above as
  accurately relayed, not independently re-confirmed by this session.

**Next**
- Confirm W1's retuned `alpha-loop` scenario actually passes all 9
  assertions with `--verify-replay`.
- Close out cycle 1 integration (main.ts wiring already landed in
  `d73aca1`; needs a fresh full-gate run across all four lanes together).
- Start cycle 2: playtest QA on the built single-file artifact, tuning,
  and `WALKTHROUGH.md` written by driving the real build with
  screenshots.

**Known issues**
- Same host-side limitations as the morning entry (lobby depth, guest
  models, CRT/radiator fallbacks) — none of cycle 1 touches those.
- W1's blocking fix (segment gating) was resolved by the COO editing
  `economy.ts` directly rather than the lane resubmitting; worth
  confirming the lane's own report reflects the same numbers before
  cycle 2 starts.

**Images**
- apps/hotel/docs/alpha-loop/reviews/W2-shots/round2/t0-facade.png

## 2026-09-02 (night) — Alpha loop cycle 1 lands: motel tier, RENOVATE, walkthrough, single-file build

**Shipped**
- `hotel.tier` on the hotel singleton and the `hotel.renovate` command
  (four ordered refusals), reachable from LEDGER's RENOVATE button and
  the bare command; demand, segment eligibility and rate ceilings scale
  with tier; the owner bot prices at what its eligible guests will pay
  (`a3ef444`).
- Motel-tier look: procedural canvas textures (stained carpet, scuffed
  paint, drop ceiling with fluorescents, laminate desk, chain-link lot,
  neon VACANCY), an interpolated tier 1, tier 2 unchanged; scenery and
  light rig rebuild on tier change.
- Event-driven nine-step walkthrough hint line and the tier-2 end card,
  skippable with H, hidden while a screen is focused.
- `scripts/build-artifact.mjs`: a single-file build (1.8 MB, all assets
  inlined, sealed fetch shim, freshness check), a hover-look pointer
  fallback for sandboxes that refuse pointer lock, and `netlify.toml`.

**Verified**
- `docs/alpha-loop/reviews/W1.md` round 5: **PASS**. The entrance
  deadlock (spawn cell doubling as the departure goal) is fixed with
  goal-aware yielding, region despawn and rank-allocated overflow
  parking.
- `docs/alpha-loop/reviews/W2.md`, `W3.md`, `W4.md`: **PASS** (W2 and W3
  on round 2, W4 on round 1), each independently reconfirmed by the COO
  rather than taken on the lane's own report.
- Quiet-tree run: 13 headless gates and 5 browser gates green.
- `alpha-loop` scenario: hash **402826283**, 9/9 assertions.
- The tuned 14-day arc (owner bot, seed `hotel-alpha-loop-1`): tier 0 → 1
  renovation on day 3, first hire shortly after, tier 1 → 2 renovation
  on day 7, revenue nonzero every day, closes at **$3,203.50**, zero
  stuck guests.
- Single-file artifact (1.8 MB) published:
  https://claude.ai/code/artifact/96023cbe-3604-4734-9f40-688d888dedb4

**This one hurt**
- The deadlock: guests spawn onto the same street cell that departing
  guests path to for despawn. Arrivals that missed a queue slot parked on
  that cell forever — their goal *was* the cell they stood on, so
  pathfinding returned instantly and they never yielded, never moved,
  never got reaped. They became a permanent plug that blocked every
  `leaving` guest behind them. The existing lower-id-yields rule couldn't
  break it because the blocking agent wasn't part of the ordering at
  all — an agent standing on its own goal was being treated as "about to
  leave" instead of "a wall." Round 5 fixed it with goal-aware yielding,
  a despawn region, and rank-allocated overflow parking.
- The economy: the first cut of the tiered economy gated the demand
  *quota* by hotel tier but not which guest *segment* could book, so a
  business traveler could book a tier-0 motel — the motel couldn't earn
  enough to afford renovation until leisure guests were allowed to book
  at tier 0 and the owner bot stopped pricing at the rate ceiling.

**Next**
- Start cycle 2: playtest QA on the built single-file artifact, tuning
  against the `alpha-loop` gate numbers, and `docs/WALKTHROUGH.md`
  written by driving the real build with screenshots. **Not started.**

**Known issues**
- Same host-side limitations carried from earlier entries (lobby depth,
  guest models, CRT/radiator fallbacks) — none of cycle 1 touches those.
- Overflow and candidate wait-cell pools are not deduped against each
  other (carried forward, non-blocking, W1 round 5 §6).

**Images**
- apps/hotel/docs/alpha-loop/reviews/W2-shots/round2/t0-lobby-east.png

## 2026-09-03 (small hours) — Cycle 2: playtest, polish, hosting, placement

**Shipped**
- Playtest QA lane played the shipped single-file artifact through 11
  beats and found the blockers that mattered: there was no time
  compression (hold-T fast-forward added so a day doesn't take real
  minutes), the shipped game's `fraudRatePermille` defaulted to **0** so
  no fraudulent guest ever spawned outside the scenarios' own configs,
  and RESERVA's ACCEPT/DENY buttons painted off-screen at y=440 from the
  standing pose.
- Polish lane killed the sun-shadow streaks (shadow clamped to the
  street + shadow layer, tier-0 tone pass), deduped the wait-pool, added
  a broke-renovate probe.
- Placement lane replaced ad hoc prop scatter with a real solver: wall
  runs, lanes, and an occupancy grid so furniture stops overlapping.
- Hosting lane produced `HOSTING.md`, a `build:hosted` script, and
  `--copy-to-dist` for the single-file `play.html`.

**Verified**
- `docs/alpha-loop/reviews/C2-W2.md`: **PASS**, three carries recorded
  (non-blocking).
- `docs/alpha-loop/reviews/C2-W1.md` (playtest QA): **RE-RUN REQUIRED**
  — the lane's own driver could not see the fraud-rate-0 bug because the
  bug meant fraud literally never occurred in the build it was playing;
  COO found the real defect (F1) and ruled two of the lane's three
  blocker records wrong on the facts. Re-run deferred to Cycle 3 lane 4.
- `docs/alpha-loop/reviews/C2-W4.md` (placement): **FIX-LIST** — four
  blockers open (no wall-surface occupancy so paintings stack, both cart
  call sites bypass the solver's omit-on-undefined contract, sconces
  placed outside the solver, a pilaster bisects the front desk). Carried
  into Cycle 3 lane 3.

**Next**
- Cycle 3: grow the lobby, close the placement fix-list, fix the fraud
  rate and RESERVA buttons, re-run the playtest.

**Known issues**
- Fraud rate 0 in the shipped app default (fixed in cycle 3 lane 2).
- Four placement blockers from C2-W4 (fixed in cycle 3 lane 3).
- Playtest exit criteria rows 2-9 not closed (re-run pending, cycle 3
  lane 4).

## 2026-09-03 — Cycle 3: the lobby gets real depth [DONE]

**Shipped**
- Lane 1: the lobby grows from 9-12 cells deep to **20-24 cells**
  (`packages/interiors/src/layout.ts`), a contract change under
  invariant 3 that moves every pinned hash. Every hand-authored browser
  walk (`fps-look-interact`, `reserva-readability`, `save-restore`) was
  re-derived by a new script, `apps/hotel/scripts/derive-walk.mjs`,
  rather than by hand; a follow-up (`derive-walk` W1b) tightened it to
  pick mid-band holds with a >=200 mm interact margin. Fence and
  rope props no longer cast shadows.
- Lane 2: default `fraudRatePermille` set to 200 (one guest in five)
  at tier 0, unchanged across tiers for the alpha; RESERVA's ACCEPT/DENY
  moved on-screen from the standing pose; the audit screen gained its
  owed `t()` line ("The audit runs itself at midnight; this screen is
  the report").
- Lane 3: all four C2-W4 placement blockers closed - wall-surface
  occupancy now tracked so paintings stop stacking, both cart call
  sites go through the solver's omit-on-undefined contract, sconces
  placed through the shared room occupancy grid, the pilaster cleared
  off the front desk. Painted canvases now sit in frames; windows clear
  of the desk; decor builds before fixtures.
- Lane 4 (playtest re-run): re-ran with hold-T time compression, a
  corrected driver, and fraud live. Owner bot's rate-chase was found
  locking the terminal (fixed to only step toward reachable tiles).
  `alpha-loop` reached 13/13 with live fraud and tier 2 by day 9.
- Lane 5, closed: a missed fraud is now a real in-sim consequence, not
  just a CEO ruling - a checkout skip posts a chargeback ledger line, a
  "fraud loss" line on AUDIT/LEDGER, and a one-star reputation hit in
  that guest's segment (`e11b298`, sim files only: `game.ts`,
  `economy.ts`, `components.ts`, `screen.ts`, `screen-data.ts`,
  `ledger-app.ts`, `audit-app.ts`). `4f1eefb` then changed the
  `alpha-loop` gate itself to assert desk competence directly -
  total fraud chargeback loss across the 14-day arc must stay
  <= $100 AND at least one planted violation must actually be caught
  (`desk.fraudCaught >= 1`, so it can't pass vacuously on a run that
  never saw a real violation). Measured on the same seed: a competent
  desk accrues ~$0 in chargeback loss; an accept-everything bot racks up
  ~$880 over the same arc - the new gate is red for the careless bot and
  green for the competent one.
- Playtest driver work (`78bd634`, `fba5c8a`): the driver's own bugs
  were found and fixed - it submitted `face` commands directly, which
  the real browser app's `player-fps` silently overwrites every frame
  with its own internally-tracked yaw (fixed by turning through the
  synthetic `window.__WORLDFORGE__.pointer.look(dx)` instead, matching
  how a human's mouse look actually drives the sim), and `walkTo()` had
  no door-awareness and would walk in place against a closed bedroom
  door forever (now opens doors in range en route). With those fixed,
  the re-run (`fba5c8a`) confirmed two real frauds live and legible by
  eye on the RESERVA screen in the same session
  (`res-code-mismatch`: `RC-4715~803728` vs `RC-4715`;
  `name-mismatch`: `Quinn Baptiste~557147` vs `Quinn Baptiste`), plus
  hold-T fast-forward measured live at exactly 8x (480 ticks/3000ms
  held vs 61 ticks/3000ms with a screen focused).
- A follow-up driver attempt at a continuous service loop (`78bd634`)
  is recorded as incomplete, honestly: it could not keep the desk
  served through the long `holdT()` waits (see Known issues below), so
  it does not supersede the beat-by-beat driver that produced the
  walkthrough screenshots.
- Docs: `apps/hotel/docs/ALPHA-LOOK.md` gained a "cycles 1-3 verified
  state" closing section (`1639c29`); `apps/hotel/docs/WALKTHROUGH.md`
  was rewritten with live desk frames from the fixed driver and
  tour-rendered tier comparisons (`8e93077`).

**Verified**
- `docs/alpha-loop/reviews/C3-W1.md`: PASS with two numbered
  follow-ups (neither blocking the merge).
- `docs/alpha-loop/reviews/C3-W2.md`: FIX-LIST (2 blockers, 2 rough
  edges) - folded into the W3-round-2 commit (`08adff8`).
- `docs/alpha-loop/reviews/C3-W3.md`: FIX-LIST (2 blockers open, 2
  blockers closed) - W3-2 (a tier-2 pilaster can partially occlude the
  desk terminal from some standing poses) is carried forward as a
  known, visible rough edge rather than claimed fixed (see
  `docs/WALKTHROUGH.md` §12).
- Headless gate suite: 13/13 scenarios green with `--verify-replay`,
  including `alpha-loop` (14/14 assertions, live fraud at 1-in-5, tier 1
  by day 5, tier 2 by day 9, closing cash-positive at day 14, total
  chargeback loss under $100 with >=1 fraud actually caught).
- Browser gate suite: 5 gates green at 16/21/69/20 -
  `fps-look-interact` (16 commands, Chromium+Firefox), `reserva-readability`
  (21), `save-restore` (69), `demo-visual` (20, that app's own wall-clock
  flake, not a failure). Counts re-pinned twice during Lane 1's lobby
  depth change (`f6d2ffd` 8/18/69/18 intermediate, `bc7d87b` 16/21/69/18)
  and re-confirmed once more after Lane 5/driver work landed at
  16/21/69/20.
- `npm run build`, `npx tsc -p apps/hotel/tsconfig.json --noEmit`,
  `npx eslint .`, `node scripts/check-purity.mjs`: green
  (`apps/hotel/docs/ALPHA-LOOK.md`, "Verified on this branch").
- The single-file artifact builds (`npm run build:hosted -w apps/hotel`)
  and is published: https://claude.ai/code/artifact/0161c1c4-6a33-4307-8d77-9a6762999418
  (supersedes the cycle-1 artifact, pinned separately at `96023cbe...`).

**Next**
- The human end-to-end sitting (H4b's gate: one person plays door to
  end-card in one real sitting) is still owed - no driver run so far,
  scripted or continuous-loop, has completed that arc; the tier-1/tier-2
  and end-card evidence in the walkthrough comes from the tour page and
  a direct `alpha-loop` scenario run, not a live human or bot session
  reaching tier 2.
- A driver that interleaves guest-serving with T-held waits (rather than
  treating them as separate phases) would let a scripted playtest
  produce real tier-1/tier-2 screenshots instead of tour-page renders.

**Known issues**
- The scripted playtest driver could not keep the desk served
  continuously (`C2-W1-blockers.md` B9): it serves guests in one
  active window then switches to blind `holdT()` waiting, so nightly
  expenses accrue with nobody working the desk and this session's own
  economy went cash-negative and never reached RENOVATE. This is a
  driver limitation, not a game defect - the headless `alpha-loop` bot,
  which does serve continuously, reaches tier 2 solvent on the same
  seed. The human end-to-end sitting above is the real closer for this.
- A tier-2 pilaster can partially occlude the desk terminal from some
  standing poses (`C3-W3.md` item W3-2) - real, open, visible in
  `docs/walkthrough/tier2-desk.png`.
- Some gilt picture frames render empty at tier 2 - carried-forward
  rough edge.
- No broken prop or staff candidate is guaranteed to appear early in a
  short session - both are plausibly gated on cash/day thresholds.

**Images**
- apps/hotel/docs/walkthrough/07-fraud-name.png
- apps/hotel/docs/walkthrough/tier2-lobby-east.png

## 2026-09-03 (day) — Live play fixes + cycle 4: the desk gets feel

**Shipped**
- Live-play fixes found by actually sitting at the keyboard:
  - Strafe handedness fixed — D was walking screen-left instead of right
    (`packages/player-fps/src/index.ts`, `cbc8fa4`).
  - Q quality toggle and L flicker toggle added (`apps/hotel/src/render/lighting.ts`,
    `apps/hotel/src/main.ts`, `cbc8fa4`).
  - Terminal exit fixed: click off the screen to leave and re-lock pointer,
    because Esc alone stranded the player — the browser refuses to re-lock
    the pointer for roughly 1.3s after an Escape-driven unlock, so Esc-only
    exit left the player stuck looking at the terminal with no way back in
    (`apps/hotel/src/main.ts`, `50cef98`).
- Cycle 4 (Spark/Ballast picks, `DECISIONS.md`): desk feedback + night-audit
  ritual, and the tier-2 empty-painting-canvas fix.
  - W1: night-audit reveal cadence — `audit-app.ts` gates each reveal line
    off `view.tick - state.opened` against fixed integer tick constants
    (20/40/60/80/100), replay-safe and screenshot-stable by construction;
    `opened` re-stamps on every open so reopening restarts the ritual
    (`e6bcef9`).
  - W1: host-side desk stamp — a CHECKED IN / FRAUD CAUGHT / DENIED flash on
    the terminal, driven by reading `sim.eventsSince`'s event stream in
    `desk-stamp.ts`/`main.ts`, presentation-only (no `setComponent`, no sim
    field), so it moves zero goldens (`3ab8e4b`).
  - W2: painting canvases at tier 2 — root cause was the canvas mesh pinned
    to a fixed `z = 0.025` while the loaded glTF frame's own front face
    could land past that plane; fix derives the canvas z from the same
    `footprint.d` used for the frame's own fit call so the two numbers
    can't drift apart (`decor.ts`, `befa4c4`).
  - `docs/CORE-LOOP.md` added.

**Verified**
- `docs/alpha-loop/reviews/C4.md`: **PASS**, no fix-list items. Confirms:
  sim purity/determinism/write-through untouched by the host-side stamp;
  `fraud-catch`, `fraud-catch-b`, `alpha-loop`, `reserva-readability`
  reported unmodified/still green (new open-input path only touches
  `AuditState.opened` plus existing view-key fields, no new top-level
  `ScreenViewData` key); W2 diff verified visually against
  `tier2-painting-broken.png` vs `tier2-painting-fixed.png` (diff bbox
  isolated to the painting region only).
- Two items explicitly logged as honest deferrals, not defects: the AUDIT
  star-tier line prints live `stars`, not a delta (no `previousStars` field
  exists yet); the desk stamp was deliberately kept host-side rather than
  sim-side to avoid re-pinning every golden for a decaying visual effect
  with no gameplay state.

**Next**
- The human end-to-end sitting (door to end-card, one real sitting) is
  still owed — noted again in `C4.md` item 3, not a blocker for this
  review but not yet done either.
- Star-tier night-over-night delta in AUDIT needs a `Hotel.previousStars`
  field before it can be added honestly.

**Known issues**
- Carried forward unchanged from the prior entry: driver can't keep the
  desk served continuously through long `holdT()` waits (`C2-W1-blockers.md`
  B9); tier-2 pilaster can partially occlude the desk terminal from some
  standing poses (`C3-W3.md` W3-2); no broken prop or staff candidate
  guaranteed early in a short session.
- This entry's own scope: the alpha loop is ongoing/responsive to live
  play, not closed — this cycle's fixes came directly from sitting down and
  playing it, and cycle 4's own honest gap (no human door-to-end-card
  sitting yet) is still open.

**Images**
- apps/hotel/docs/alpha-loop/C4-W1-shots/desk-stamp-checked-in.png
