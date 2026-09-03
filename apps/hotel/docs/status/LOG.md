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
