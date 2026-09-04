# BALLAST-1 — grounding verdict on the open-item list

Ballast, 2026-09-03, branch `claude/grand-foyer-game-alpha-50b07d`, HEAD
`703d449`. Read-only: VISION-ALPHA.md, root CLAUDE.md, ALPHA-LOOK.md,
C2-W1-blockers.md, reviews C2-W1/C3-W1/C3-W2/C3-W3, and the current source
(`main.ts`, `render/architecture.ts`, `render/fixtures.ts`,
`render/placement.ts`, `render/decor.ts`, `sim/game.ts`, `sim/staff.ts`).
Every "buildable" claim below is checked against code actually present at
this commit, not against what a doc says was planned.

Goal test uses VISION-ALPHA.md's loop steps 1–7 and the non-negotiable "the
realistic tier-2 look stays as verified; do not regress ALPHA-LOOK."

---

## 1. Painting / fake-window frame overlap on the lobby east wall

- **Serves the goal?** Yes if real — non-negotiable "do not regress
  ALPHA-LOOK" and the tier-2 look is the graded end-state (loop step 7).
- **Do we have the data/surface today?** The claim is STALE. Commit
  `08adff8` ("Cycle 3 W3 round 2: sconces through the shared room
  occupancy, painted canvases in frames, windows clear of the desk") added
  a named guard in `architecture.ts` (`tryWindowX`/`tryWindowZ`,
  `deskWindowMarginM = 1.0`) whose comment states in terms that this is the
  fix for the exact defect COO review C3-W3 (W3-2) found: a fake-window
  frame — not a pilaster — was the "full-height pale column" bisecting the
  desk. `reviews/C3-W3.md` §4 W3-2 (blocker, open at review time) is the
  finding this commit closes; there is no later review re-scoring it, but
  the fix is on the named guard the review demanded and the reasoning in
  the comment (0.65 m clearance was too tight, 1.0 m chosen) reads as a
  real measured correction, not a rename. I did not find any code path
  that still overlaps a painting frame with a fake-window frame — paintings
  and windows are placed by different modules (`decor.ts` paintings vs
  `architecture.ts` windows) and neither queries the other's placement, so
  "overlap" was never a wall-plane collision between the two; it was the
  desk-occlusion case W3-2 named, now guarded.
- **Buildable?** N/A — already built, on a host-render-only root
  (`apps/hotel/src/render/**`), no purity/golden cost when it landed
  (confirmed by `reviews/C3-W3.md` §6: "no `setComponent` path is touched,"
  no RNG introduced).
- **Verdict: CUT (from this cycle's list).** Nothing to fix; if the brief's
  author saw this on an older screenshot, re-shoot `tier2-lobby-east.png`
  before re-litigating it. Real residual issue in the same area is R1/W3-3
  below (empty painting canvases), which is a different bug.

## 2. Fixtures-before-decor order in `main.ts` (sconces claim wall space before paintings)

- **Serves the goal?** Yes if real — same non-negotiable as above; a
  sconce landing on a painting is a legibility regression on the verified
  tier-2 look.
- **Do we have the data/surface today?** STALE, and I verified this
  directly by reading `main.ts:711-729` (`syncScene`) as instructed:
  ```
  // Decor before fixtures: both share one RoomOccupancy per room
  // (placement.ts), and paintings must claim wall space before sconces.
  g.add(buildDecor(floor, hotelTier));
  g.add(buildFixtures(floor, hotelTier));
  ```
  `buildDecor` is called before `buildFixtures`, and the comment names the
  exact ordering rule the brief describes as broken. This landed in
  `08adff8`'s title text: "...windows clear of the desk; decor builds
  before fixtures." `fixtures.ts:159-203` sconces now route through
  `placeOnWallSurface(corridorOcc, ..., 0.6)` against the SAME
  `RoomOccupancy` paintings claim in `decor.ts`, closing review C3-W3's
  W3-1 (sconces bypass the solver) as well — a second, related finding
  from the same review that the brief's list conflates with this one.
- **Buildable?** N/A — already built. Host-render-only, no purity impact.
- **Verdict: CUT.** Re-verify by screenshot only if there's a specific
  frame showing a collision; I found none in the committed shots
  (`C2-W4-shots/desk-t0/t1/t2.png`, `lobby-east-t2.png`, all re-shot in the
  same commit).

## 3. Tier-2 desk pose reads badly — camera artifact (C3-W3) or real?

- **Serves the goal?** Yes if real — desk-pose legibility gates loop steps
  2/3 (reading documents, catching fraud) at the exact station the player
  spends the most time at.
- **Do we have the data/surface today?** This is the SAME finding as items
  1/2 above, not a separate one — `reviews/C3-W3.md` W3-2 explicitly rules
  it "not a pilaster... a fake window's frame," i.e. it was real geometry
  occluding the desk, not a camera-pose or rendering artifact. It is
  guarded by the same `deskWindowMarginM = 1.0` fix in item 1. No open
  review re-scores this after `08adff8`; I did not find a newer C3-Wx
  review that inspects `desk-t2.png` again.
- **Buildable?** N/A — same fix as item 1.
- **Verdict: CUT as a separate item — fold into item 1's "already fixed."**
  If the CEO's brief is reading an older `desk-t2.png`, the file was
  overwritten by `08adff8` (binary diff in that commit's stat); pull HEAD's
  copy before judging.

## 4. B4 — no broken prop observed in the playtest window

- **Serves the goal?** Loop step 3 ("repair a broken prop") needs this
  mechanic to exist and fire; it is one of two half-closed exit-criteria
  rows (BREAKDOWN-2 §4 row 4, per `reviews/C2-W1.md` §5).
- **Do we have the data/surface today?** The mechanic is real and present:
  `sim/game.ts:253-255` (`REPAIR_STEPS = 3`, "bounded, no consumables"),
  `:842-843` (`broken: false, repairProgress: 0` on the Prop component),
  `:1732-1746` (interact handler advances repair, emits `prop.repaired`),
  `:2591-2613` (comment: "prop from `forkRng("upkeep")`... a broken prop
  accrues one integer broken-night"). This is RNG-gated per the "upkeep"
  fork, not guaranteed every session — the blocker log's own text says
  "plausibly pacing/RNG for this seed's early game," and C2-W1-blockers.md
  marks it "note, not blocker," unchanged across two playtest re-runs
  (C2-W1 original, C3-W6 re-run). Neither re-run's window was long enough
  or served-desk-continuous enough to force a broken-prop tick with any
  confidence (the C3-W6 session itself flags B9: the driver switches to
  blind hold-T waiting with nobody serving the desk after ~5000 ticks, so
  its ~10-minute "active" window is not representative of a served day).
- **Buildable?** N/A — nothing to build; this is a driver-coverage gap,
  not a missing feature.
- **Verdict: PARK.** Real game mechanic, unconfirmed by observation only
  because no playtest session has run long enough under continuous
  service to force it. Do not spend build budget here this cycle; the fix
  is a better driver run (an R2-shaped re-run), not code. If a headless
  gate already exercises `prop.repaired` (ALPHA-LOOK.md says
  "`prop.repaired` remains gate-verified elsewhere") that is sufficient
  proof the mechanic works; this item is purely "has a human/bot seen it
  live," which is cosmetic evidence, not a functional gap.

## 5. B5 — no staff candidate appeared during play

- **Serves the goal?** Loop step 6 ("hire the clerk") needs candidates to
  spawn; already shipped per ALPHA-LOOK.md's "hire the clerk (already
  shipped)."
- **Do we have the data/surface today?** Real and gated, verified by
  reading source: `sim/game.ts:2768` —
  `const hireUnlocked = hotel.hireUnlocked || hotel.cash >= HIRE_THRESHOLD_MINOR;`
  Candidates are drawn deterministically off `forkRng("staff")`
  (`sim/staff.ts:2-8`, `CANDIDATES_PER_ROUND = 2`) but the round is
  cash-gated. The C3-W6 session's own log records cash going
  `500 -> -4000` at the first night rollover and never recovering (B9),
  so the threshold was very plausibly never crossed in that session — this
  is not RNG bad luck, it is an arithmetic consequence of the driver
  logging a negative-cash economy. B5's own note draws the same
  conclusion ("consistent with B9... cash/day-gated candidate spawn
  threshold plausibly was never crossed").
- **Buildable?** N/A — mechanic exists; nothing to build.
- **Verdict: PARK, same reasoning as B4.** Not a game defect on present
  evidence; re-run under a driver that keeps cash positive (or the
  existing `alpha-loop` headless bot, which does serve continuously and
  reaches tier 2 solvent) before treating this as open.

## 6. R1/W3-3 — empty painting canvases at tier 2 (real residual item, not on the brief's list but adjacent to #1)

- **Serves the goal?** Yes — "do not regress ALPHA-LOOK," and an empty
  gilt frame at tier 2 reads as a bug per the review's own words.
- **Do we have the data/surface today?** `reviews/C3-W3.md` W3-3 marks this
  OPEN and unaddressed by the same commit that fixed W3-1/W3-2
  (`08adff8`'s title even lists "painted canvases in frames" as done, but
  the review's scorecard — written against that same commit — still lists
  R1 open with two named screenshots, `corridor-t2.png` and
  `tier2-lobby-east.png`). I did not find a later commit or review that
  re-scores W3-3; it is the one item from the review set genuinely still
  open on the tree. `decor.ts:209` (`paintingCanvasTexture(seed)`) does
  generate a canvas texture per painting, so the mechanism exists — the
  open question is why some seeds/rooms still render a bare frame, which
  I did not trace further (out of scope for grounding-only; needs an
  implementer to check the model-upgrade path in `decor.ts:264-270`, where
  a loaded glTF frame may be overwriting the canvas-textured artwork
  plane rather than sitting behind it).
- **Buildable?** Cheap-to-moderate, host-render-only (`decor.ts`), no
  purity/golden cost (no RNG, no sim state touched, per the same C3-W3
  invariants note that covers the whole placement track).
- **Verdict: KEEP for this cycle if capacity allows — it is the one real,
  still-open visual defect in this cluster** the brief's list missed while
  citing two items that are already fixed. Low cost, host-side only.

---

## Buildability / cost summary

| Item | Root touched | Purity/golden cost | Cost class |
|---|---|---|---|
| 1–3 (painting/window overlap, order, desk pose) | already fixed, `render/architecture.ts`, `main.ts` | none (host-only, no RNG) | already paid |
| 4 (B4 broken prop) | none — driver/observation gap | none | re-run only |
| 5 (B5 staff candidate) | none — driver/observation gap | none | re-run only |
| 6 (empty canvases, W3-3) | `render/decor.ts` (host-only) | none | cheap |

No item on the brief's list requires touching `packages/core/src/**`,
moving a golden hash, or re-deriving a browser-gate walk. None are heavy.

## Cuts — do NOT attempt this cycle

- **Items 1–3 as separate work items.** They are the same finding
  (desk-occluding fake window) and it shipped in `08adff8`. Re-verifying
  them costs one screenshot pull from HEAD, not implementation time.
  Spending a lane on them would be re-fixing a fixed bug.
- **Chasing B4/B5 as code defects.** Both mechanics exist, are gated by
  legible conditions (RNG fork / cash threshold), and both playtest
  sessions that failed to observe them also self-reported the structural
  reason (short/discontinuous service windows, negative-cash economy).
  Spending a sim-lane on "fix broken props" or "fix staff spawn" this
  cycle would be solving a problem that is not demonstrated to exist.

---

## Three biggest reality gaps

1. **The exit criteria most tied to "playable end to end" are still
   evidenced only from the tour page, not a real played session.**
   ALPHA-LOOK.md says this outright: tier-1/tier-2 and end-card frames
   come from `dev/tour.html`, not from a human or bot sitting through the
   full loop with the desk continuously served; the only continuous,
   served, solvent-to-tier-2 run on record is the *headless* `alpha-loop`
   bot, which is not the human-sitting gate VISION-ALPHA.md's "one
   sitting, no outside help" describes (H4b, called out as still owed in
   ALPHA-LOOK.md's own closing line).
2. **The playtest driver (`dev/playtest.mjs`) has now been rewritten twice
   (C2-W1, then 78bd634's "continuous service loop") and its own commit
   message says it is still incomplete** — it could not keep the desk
   served, which is the exact capability needed to produce real evidence
   for gap #1. Two rewrites without closing the capability gap is a
   pattern worth naming, not just a status line.
3. **Two "known open items" the brief listed as current are stale by one
   commit each** (items 1–3 above, fixed in `08adff8`, ~5 commits before
   HEAD). The review trail (`reviews/C3-W1..W3.md`) is the accurate record
   of what's actually open (W3-3, the empty canvases); anything summarized
   from an older doc or an out-of-date mental model will re-litigate fixed
   work.

## The one thing the CEO is most likely fooling themselves about

That "playable end to end with a full loop" is closer to done than it is.
Every individual mechanic in the loop (check-in, fraud, mess/repair,
audit, RENOVATE, hire, end card) is real and independently gate-verified —
but the only evidence of the WHOLE chain running together, in order, in
one continuous session, is a headless bot script, not a human or a
human-shaped driver. The two things that would actually prove "one person,
one sitting, no outside help" — a working continuous-service playtest
driver and a human H4b pass — are both still open, and the most recent
work on the driver (78bd634) shipped labeled "incomplete." The tier-0
motel look, the fraud mechanic, and RENOVATE are all real; whether a
person can actually sit down and walk the whole arc without an engineer's
help is not yet demonstrated, only inferred from parts.
