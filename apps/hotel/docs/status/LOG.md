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

## 2026-09-03 — Cycle 3: the lobby gets real depth [IN PROGRESS]

**Shipped**
- Lane 1: the lobby grows from 9-12 cells deep to **20-24 cells**
  (`packages/interiors/src/layout.ts`), a contract change under
  invariant 3 that moves every pinned hash. Every hand-authored browser
  walk (`fps-look-interact`, `reserva-readability`, `save-restore`) was
  re-derived by a new script, `apps/hotel/scripts/derive-walk.mjs`,
  rather than by hand; a follow-up (`derive-walk` W1b) tightened it to
  pick mid-band holds with a **>=200 mm interact margin**. Gate counts
  landed at **16/21/69/18** (re-pinned twice as the derivation
  tightened, 8/18/69/18 midway then final at 16/21/69/18). Fence and
  rope props no longer cast shadows.
- Lane 2: default `fraudRatePermille` set to **200** (one guest in five)
  at tier 0, unchanged across tiers for the alpha; RESERVA's ACCEPT/DENY
  moved on-screen from the standing pose; the audit screen gained its
  owed `t()` line ("The audit runs itself at midnight; this screen is
  the report").
- Lane 3: all four C2-W4 placement blockers closed — wall-surface
  occupancy now tracked so paintings stop stacking, both cart call
  sites go through the solver's omit-on-undefined contract, sconces
  placed through the shared room occupancy grid, the pilaster cleared
  off the front desk. Painted canvases now sit in frames; windows clear
  of the desk; decor builds before fixtures.
- Lane 4 (playtest re-run): re-ran with hold-T time compression, a
  corrected driver, and fraud live. Owner bot's rate-chase was found
  locking the terminal (fixed to only step toward reachable tiers).
  `alpha-loop` now runs **13/13** with live fraud and reaches **tier 2
  by day 9**.
- Lane 5 (ruling only, not yet implemented): a missed fraud will become
  a checkout skip (chargeback ledger line, no guest review, a "fraud
  loss" audit line, and a reputation hit in that guest's segment
  equivalent to one 1-star review) — CEO ruling recorded in
  `docs/alpha-loop/CYCLE-3.md`; the sim-side implementation is the open
  item.

**Verified**
- `docs/alpha-loop/reviews/C3-W1.md`: **PASS with two numbered
  follow-ups (neither blocking the merge)**.
- `docs/alpha-loop/reviews/C3-W2.md`: **FIX-LIST (2 blockers, 2 rough
  edges)** — folded into the W3-round-2 commit
  (`08adff8`) per the commit log; re-verify against the review file
  before calling it closed.
- `docs/alpha-loop/reviews/C3-W3.md`: **FIX-LIST (2 blockers open, 2
  blockers closed)** — same caveat as W2.
- Browser gate counts re-pinned and re-confirmed: **16/21/69/18**
  (`bc7d87b`, after an intermediate re-pin to 8/18/69/18 in `f6d2ffd`).
- `alpha-loop` scenario (per commit `34afbd4`): **13/13**, live fraud,
  tier 2 reached by day 9.

**Next**
- Close lane 5: implement the missed-fraud skip/chargeback/reputation
  mechanic in sim files only, re-pin `fraud-catch` / `fraud-catch-b` /
  `escalation-stars` hashes honestly, and confirm the alpha-loop
  "accept everything" perturbation goes red on solvency or stars.
- Re-verify the C3-W2 and C3-W3 FIX-LIST items are actually closed by
  the follow-up commits rather than assuming from commit messages.

**Known issues**
- **Lane 5 is not implemented yet** — a missed fraud currently has no
  in-game consequence; only the CEO ruling exists.
- C3-W2 and C3-W3 were reviewed FIX-LIST; the fix commits landed after
  but have not been re-reviewed to confirm PASS.

**Images**
- apps/hotel/docs/alpha-loop/C3-W1-shots/tier2-entrance.png
- apps/hotel/docs/alpha-loop/C3-W1-shots/tier0-lobby-east.png
