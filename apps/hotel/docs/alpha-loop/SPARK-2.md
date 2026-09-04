# SPARK-2 — making rule escalation LAND as an event

For the CEO. One page of what-ifs. No grading, no cost — Ballast does that.
Does not repeat SPARK-1's shipped picks (desk stamp/sound, audit ritual).

**What I confirmed by reading source, not guessing**: the sim already
escalates. `rules.ts` ships every H1 row live from `minStars: 1`, then
`plantableRules`/`rulesForStars` gate a `blacklist` row (`listed` check) to
`minStars: 2` — comment: "the first row the star tier actually gates"
(`rules.ts` line 87-88). `mailbox-app.ts`/`game.ts:2468-2476` already queue a
real `mail.bulletin` letter with the blacklisted name and emit
`mail.bulletinDelivered` the day the list goes non-empty — the sim-side event
exists. But `reserva-app.ts:188-197` (the procedures card) renders
`rulesForStars(H1_RULES, data.stars)` as one flat list, same color (14) for
every row, no distinction between a rule that's been active since day one and
one that just landed. **The escalation is real; the arrival is invisible on
the surface the player actually reads mid-shift.** That gap is this page's
focus, per DESIGN's thesis that escalating verification rules ARE the
difficulty curve.

## What if we added ___?

- What if the procedures card **flagged new rows**: for N days (or until
  first ACCEPT/DENY against that rule) the newest active row renders in a
  different color/blink with a `[NEW]` tag, so the card itself is the
  teaching moment, not just a static reference? Needs sim (track
  `ruleActivatedDay` per row, already have `hotel.day` and `minStars`). ★
- What if `mail.bulletinDelivered` (already emitted, `game.ts:2476`) drove a
  **terminal boot-up notice** the next time RESERVA opens — "PROCEDURE UPDATE:
  see MAILBOX" — one line, unmissable, before the queue even renders? Needs
  sim (a flag on world state, host-paint reads it).
- What if the blacklist bulletin's letter (`bodyFor` in `mailbox-app.ts` line
  78-80) got a **physical prop**: an in-tray icon at the desk that visibly has
  mail waiting, so a player who never opens MAILBOX still sees "something
  changed" without reading text? Host-paint only — the unread state already
  exists (`MailboxState.openMailEntity`/read boolean).
- What if the **daily objectives** (DESIGN §6, three sim-derived objectives
  per audit) got their own on-screen tracker visible DURING the shift, not
  just settled at audit — a corner HUD strip with the three cards live-ticking
  as they complete? Host-paint only (the objective completion data already
  exists per-day in econ state).
- What if a **buzz/streak bonus** existed at all: consecutive days with zero
  missed frauds (data already tracked via `desk.fraudCaught` vs. chargebacks
  in `reviewSystem`) pays a small escalating bonus at audit, visibly counting
  up — "3 days clean" — giving the escalation curve a carrot to match its
  stick? Needs sim (new counter + payout in `economy.ts`).
- What if the **blacklist itself became a rolodex prop** at the desk you can
  flip through between guests — not required, but lets a player who suspects
  a name double-check without holding it in their head? Needs sim exposure
  (read-only view of `ctx.lists.blacklist`) + host paint.
- What if guest **archetype flavour** (segment: family/leisure/business, per
  `guestSpawnSystem`'s filter) changed how a violation READS, not just whether
  it exists — a business guest's fraud tell phrased differently on their
  papers than a leisure guest's, so repeat players start pattern-matching by
  segment the way Papers Please players learn by nationality? Needs sim (flavor
  text keyed by segment+failFlag, i18n table).
- What if the **star-tier-up moment itself** (2 stars unlocking blacklist,
  per `rules.ts` minStars:2) got a distinct one-time cutscene-lite beat
  separate from RENOVATE — "NEW PROCEDURE IN EFFECT" stamped across the
  screen the instant stars cross the threshold — so the escalation's arrival
  is as loud as its consequence? ★

## What if we did more of / less of ___?

- **More of** the plant/evaluate escalation cadence itself: `rules.ts` only
  ships two tiers (H1 baseline + blacklist at minStars:2) — what if a third
  row landed at minStars:3+ (crossRef or billingCode, both scaffolded in the
  type comments at line 34 but unbuilt), so the curve has more than one step
  across the whole campaign?
- **Less of** the procedures card's flat sameness: every rule row is color 14
  regardless of age or how often the player has missed it — what if rows the
  player has recently gotten WRONG (missed that fraud type) rendered
  distinctly, turning the card into an adaptive cheat-sheet?
- **More of** MAILBOX as the escalation herald specifically: right now a
  bulletin is one letter among complaints/applications/spam in the same flat
  list (`subjectFor` in `mailbox-app.ts`) — what if procedure-change mail got
  a visually distinct row style (icon, red flag) so it doesn't get lost
  between routine correspondence?
- **Less of** silent star-tier crossings: stars move at the audit already
  (SPARK-1 territory) but nothing there currently calls out "and this is why
  your job just got harder" — tie the audit's star-delta beat directly to a
  one-line "new procedure" callout when the crossing unlocks a rule row.

## What if we looked at ___ for fresh ideas?

- **Papers Please**: its whole addiction engine is a literal manual insert —
  a new rule page physically slaps onto your desk the instant it's active,
  and you must reference it mid-interrogation. GRAND FOYER has the rule
  escalation but not the manual-insert moment; the procedures card is the
  manual, it just never announces its own updates. ★
- **This repo's `rules.ts` doc comments (lines 34, 87-88)**: the code itself
  already names the target shape — "Phase 3+ adds variants: crossRef,
  loyaltyTier, billingCode — additive" and "the first row the star tier
  actually gates" — read as a roadmap the sim author left for exactly this
  page, not speculation.
- **Balatro's "new blind" announcement card**: a full-width interstitial
  naming what's different about the next round, shown once, unskippable —
  apply the same shape to a rule landing, distinct from the audit ritual so
  it doesn't get buried in that beat's own spectacle.

## The boldest single move

Make the star-tier crossing that unlocks a new rule row (today: silent —
`rulesForStars` just includes more rows) fire its own one-time, unskippable
"NEW PROCEDURE" interstitial the moment stars cross the threshold, then have
the procedures card carry a `[NEW]` mark on that row for the rule's first
few real appearances at the desk — so the escalation curve DESIGN.md is
betting the whole difficulty arc on is something the player is handed, not
something they have to notice happened.
