# BALLAST-2 — grounding "make escalating desk rules VISIBLE" (cycle 5 candidate)

Read: `src/sim/rules.ts`, `src/sim/reserva-app.ts`, `src/sim/mailbox-app.ts`,
`src/sim/game.ts`, `src/sim/screen-data.ts`, `CLAUDE.md`, `docs/CORE-LOOP.md`.
Read-only; no edits made.

## 1. Does the sim already escalate rules per star tier and deliver bulletins?

Yes, fully, already shipped — this is not new ground to break.

- `H1_RULES` (`rules.ts:98-143`) is five `minStars: 1` rows (id-present,
  res-slip-present, name-match, res-code-match, id-not-expired) plus one
  `minStars: 2` row, `blacklist` (a `listed` check against `ctx.lists.blacklist`).
  `crossRef`, `loyaltyTier`, `billingCode` are **not implemented** — the file's
  own comment (line 34) names them as "Phase 3+ adds variants," i.e. planned,
  absent from code.
- `rulesForStars(rules, stars)` (`rules.ts:231-233`) is the live gate;
  `game.ts:1008`, `:1869`, `:2356` all call `rulesForStars(H1_RULES, hotel.stars)`
  before evaluating/planting, so the blacklist row genuinely turns on at 2
  stars and not before.
- MAILBOX bulletins are real, not a mock: `game.ts:2468-2476` — on a bulletin
  day, once `hotel.stars >= 2`, the sim picks a name, appends it to the
  `noticeList` component via `findOrCreateNoticeList`, and emits
  `mail.bulletinDelivered`. `mailbox-app.ts`'s `mail.bulletin` case renders
  the delivered names as a letter body ("This bulletin is already in force.").
  The rule fires from the moment of delivery, never from the moment of
  reading (`mailbox-app.ts:6-12`, `mailbox.read` sets one boolean and nothing
  else) — this determinism/no-dodge ruling is already correct and load-bearing.
- RESERVA's "procedures card" (`reserva-app.ts:186-196`) already re-derives
  `rulesForStars(H1_RULES, data.stars)` on every paint and lists descriptions
  — so the moment stars flip to 2, the very next paint of RESERVA shows a new
  procedures line without any additional plumbing. **This is the mechanism
  Spark's "make escalation visible" idea is asking for, and it already
  exists and already works.**
- **No streak/buzz bonus exists anywhere in `game.ts`** — grepped, zero
  matches for "streak" or "buzz." The brief's framing that this is part of
  today's loop is not grounded in the repo; treat it as absent, not as an
  existing system cycle 5 extends.

## 2. Is "show the player a new rule when it activates" host-paint-only, or does it need new plumbing?

**Split verdict — one part is done, one part is a real gap:**

- **The procedures card already updates live** (see §1) — that part of
  "visible escalation" needs zero new sim work. It is CEO-testable today: get
  to 2 stars on a bulletin day, open RESERVA, the blacklist rule line is
  there.
- **What's actually missing is a moment-of-change signal**, i.e. a toast/
  banner/stamp that fires the instant `hotel.starsChanged` or
  `mail.bulletinDelivered` happens, rather than the player having to notice a
  new line buried in a card they may not reopen. Both events already exist
  and are already emitted (`game.ts:2756`, `:2476`) — but nothing in the host
  or the `ScreenViewData` currently surfaces "this just happened" as opposed
  to "this is the state." Confirmed by grep: no `toast`/`notif` hit anywhere
  in `src/sim` or a `host` directory (there is no `src/host` — checked, does
  not exist at this path; the host lives elsewhere in the workspace, out of
  this ballast's scope to chase further).
- Cost of that gap, concretely: `ScreenViewData` is at the hard **9-key
  budget, fully spent** (`screen-data.ts:14-19` table). A new
  "recentEvents"/"toast" key would be a **10th key**, which the file's own
  header names as the exact moment to stop and ask whether the view should
  fork per-app rather than grow — i.e. this is not a free add, it's the
  named failure mode the budget exists to prevent. Options ranked by cost:
  1. **Cheapest**: piggyback on an existing key instead of adding one — e.g.
     stuff a `justChanged: boolean` onto `ScreenLedgerView` (stars) or
     `ScreenMailView` (bulletins) rather than a new top-level key. Needs a
     one-tick "was this different last tick" comparison in `screenSystem`
     (game.ts) — small, no golden-affecting sim state change since it's
     purely a derived view field, not a written component.
  2. **Costlier**: a genuine new `recentEvents: {kind, day}[]` key — breaks
     the stated 9-key budget and needs the CEO/DESIGN sign-off the header
     explicitly asks for before doing this.
  3. Either path stays inside `src/sim`'s existing purity root (no Math.*, no
     Date, integers only) since it's reading `hotel.starsChanged`/
     `mail.bulletinDelivered` — both already emit integer `day` fields.

## 3. The specific CUT — what NOT to attempt in cycle 5

- **Do not add `crossRef`, `loyaltyTier`, or `billingCode` check kinds.**
  They're explicitly "Phase 3+" in the rules.ts header, not an alpha-cycle
  scope item; each is new `RuleSpec.check` variant work plus new plantable-
  violation logic plus new gate coverage in `rules.test.mjs` — a multi-day
  slice, not a cycle-5 polish pass.
  - **Purity cost flag**: none of the three obviously needs
    Math.*/Date/floats to implement (loyaltyTier and billingCode are just
    more `listed`/`fieldMatch`-shaped checks against int/string fields), so
    this isn't blocked by the purity roots — it's blocked by scope size and
    the fact H2a already shipped the one new check kind (`listed`) this
    cycle needed as precedent. Building more rule kinds is post-alpha
    roadmap, not a cycle-5 "make it visible" polish task.
- **Do not touch `Sim.stateHash()`/`stateHashSlow()` invariant 6 territory**
  for this — nothing in either the toast-signal fix or new rule kinds
  requires an in-place component mutation; both go through `setComponent`,
  so there's no reason this cycle re-pins hash goldens. Flagging only
  because "escalating rules" sounds hash-adjacent and it should stay that
  way — if any implementation attempt starts mutating fetched components
  in place to save a `setComponent` call, that's the tripwire to stop at.
- **Do not invent a streak/buzz bonus.** It isn't built, the brief's mention
  of it isn't grounded in the repo (§1), and adding a new scored mechanic is
  a DESIGN-tier decision (new economy hook, new objective kind, new UI real
  estate) — squarely "post-alpha roadmap," not a visibility polish item.
- **Do not add a 10th ScreenViewData key without a CEO/DESIGN call.** The
  file's own header names that exact line as the moment to escalate rather
  than build past it — respect that gate rather than quietly spending the
  10th key on a toast.

## 4. Is there a cheap host-only version of the visible-escalation win?

Partially, but not fully "host-only" because of what §1/§2 found:

- **Cheap and real**: the procedures card growing a line is ALREADY the
  visible-escalation win for the rule-table part of the ask, and it required
  zero new work — it was built as part of H2a. If the CEO's actual want is
  "the player can see which rules are active," that is shipped and verified
  by reading `reserva-app.ts:186-196` plus the `rulesForStars` call chain
  in `game.ts`. The cheap move for cycle 5 here is a **verification/
  screenshot pass** (drive to 2 stars, capture the procedures card showing
  the blacklist line), not new code.
- **Not free**: a moment-of-change toast ("NEW BLACKLIST RULE IN EFFECT")
  is NOT host-paint-only, because the host has nothing to paint from yet —
  `starsChanged`/`bulletinDelivered` are sim events, not currently exposed
  in any `ScreenViewData` field a paint function reads per-tick. The
  cheapest real version is §2's option 1 (piggyback a `justChanged` boolean
  on an existing key) rather than a new top-level key — that is buildable
  in-cycle without a budget escalation, but it is sim-side plumbing (a
  `screenSystem` diff-against-last-tick), not pure host paint.

## Reality gaps (three biggest)

1. **The brief assumes escalation-visibility is a gap; it is mostly already
   built.** The procedures card already re-derives live from `hotel.stars`
   every paint (`reserva-app.ts`) — cycle 5 risks spending effort re-solving
   a solved problem unless it's scoped tightly to the moment-of-change
   signal specifically.
2. **`crossRef`/`loyaltyTier`/`billingCode` do not exist**, despite reading
   as "probably already there" from the rule-table's own forward-looking
   comment — any cycle-5 plan that assumes a second or third escalation
   rule already exists to make visible is planning against code that isn't
   written.
3. **The streak/buzz bonus named in the brief does not exist in the repo at
   all** — zero grep hits. If cycle 5 planning treats it as an existing
   system to layer visibility onto, that's building on a fiction.

## The one thing the CEO is most likely fooling themselves about

That "make escalation visible" is a small polish pass. The one piece that's
actually missing (a moment-of-change signal, not the live-updating card,
which already exists) collides immediately with the hard-enforced 9-key
`ScreenViewData` budget — the file's own header calls a 10th key the
named failure mode, not a rubber-stamp add. The cheap fix is real (§2
option 1) but it is still sim-side event-diffing work, not a host-only
reskin, and the CEO should not expect this to be a same-afternoon paint job.
