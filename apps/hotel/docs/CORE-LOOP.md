# GRAND FOYER — the core game loop, current vs. planned

Written 2026-09-03 against branch `claude/grand-foyer-game-alpha-50b07d`.
This is a reader's map of the loop, not a spec — every number below is cited
to the file that actually holds it. Read alongside
[DESIGN.md](DESIGN.md) (the bible), [VISION-ALPHA.md](VISION-ALPHA.md) (the
alpha's own definition of done) and [ALPHA-LOOK.md](ALPHA-LOOK.md) (verified
state).

## 1. The pitch

You inherit a two-bit roadside motel and work the front desk yourself: read
every ID, check guests in against RESERVA, wipe rooms, fix the radiator.
Every night the audit tells you where you stand. Once you've earned enough,
you RENOVATE at the terminal and the hotel visibly grows — motel to hotel to
Grand Foyer — while the guests who can afford it start walking in the door.
That's the whole arc: a five-minute desk shift repeats into a thirty-minute
day, and days repeat into a ten-to-forty-hour campaign that ends when the
Grand Foyer opens (VISION-ALPHA.md "The pitch"; DESIGN.md §2, "the three
loops").

## 2. THE SHIFT LOOP — minute to minute

**What you do today, physically, at the desk** (`apps/hotel/src/sim/game.ts`,
`apps/hotel/src/sim/reserva-app.ts`):

1. A guest waits at the head of the queue. Walk up and **click them** — you
   have to be in range and roughly facing them, not a magic-distance check —
   and they hand over their papers (`interactSystem`, walked through in
   WALKTHROUGH.md §3).
2. **Click the terminal** to open the CRT and switch to RESERVA
   (`reserva-app.ts`). It shows two panels side by side: the queue head's raw
   ID/reservation fields (left, from `document`/`reservation` components) and
   a "procedures card" — the currently-active rule descriptions, never a
   verdict (`reserva-app.ts` lines 1-13: "RESERVA... NEVER an evaluation
   result... comparing them by eye... is the whole game").
3. You compare the two by eye and pick a room, then press **ACCEPT** or
   **DENY**. The sim re-validates everything server-side in
   `applyDeskDecision` (`game.ts:1828`) — range, room vacancy, room
   readiness — and the ground truth for "was this fraud" is the live rule
   table (`evaluateRules`), not whether a violation was deliberately planted.
4. **Fraud**: `guestSpawnSystem` plants exactly one rule violation on
   `fraudRatePermille` = **200 per mille, i.e. 1 in 5**, of spawned guests
   (`game.ts` `DEFAULTS.fraudRatePermille`, set to 200 by the Cycle-3 CEO
   ruling so the shipped game actually spawns fraud — it shipped at 0
   before). If you **catch** it (DENY a violating guest) that's
   `desk.fraudCaught`, and it is also one of the day's objectives, paying
   $25 per catch (`economy.ts` `OBJECTIVE_KINDS`, `catch-fraud`
   perUnitReward 2500 minor units). If you **miss** it (ACCEPT a violating
   guest), the guest checks in normally, then at their checkout
   `reviewSystem` (`game.ts:2504`) reverses the room charge as a chargeback
   (`expense:chargeback`, `economy.ts` `CHARGEBACK_ACCOUNT`) and posts a
   synthetic 1-star review in that guest's segment — "a reputation hit
   equivalent to one 1-star review," which is what actually costs you a
   star at the next audit (WALKTHROUGH.md §4).

**Implemented vs. DESIGN's fuller shift.** DESIGN.md §2 describes the shift
as "match ID to reservation, spot fraud, assign rooms, upsell, defuse
complaints." Today's desk loop covers the first three (ID matching, fraud
spotting, room assignment via the vacant-room list in RESERVA) and stops
there:
- **Upselling** is not a desk verb anywhere in `game.ts` or `reserva-app.ts`
  — there is no upgrade offer, no add-on.
- **Complaint defusing** does not exist as a desk interaction; complaints are
  one-way (`guest.complained` → a MAILBOX letter, `queueMail` in
  `reviewSystem`), never a thing you can walk up and resolve in the moment.
- **Room assignment nuance** (matching a guest's stated preference, upgrading
  them, etc.) is absent — RESERVA lists every vacant room by tier and you
  pick any of them; there's no scoring for the "right" pick.
- **PRICER's** "deliberately fuzzy demand graph" from DESIGN §4 exists as a
  rate-setting command (`applyPricerRate`) but the fuzziness/sharpening
  mechanic itself is not built — PRICER sets a flat number against
  `MAX_RATE_BY_TIER_MINOR` (`economy.ts`), no graph.
- **Desk feedback** (a stamp/sound on ACCEPT/DENY) does not exist yet in the
  sim or renderer — this is the #1 item picked for the *current* cycle (see
  §6 below), not shipped.

**Pressure vs. zen.** The desk is DESIGN's declared *pressure* loop (§6): the
queue visibly backs up if you're slow, and the fraud/review consequences are
real cash and stars, not flavour.

## 3. THE DAY LOOP

**Checkout, upkeep, audit, save** — what's real today:

- **Checkout**: a guest whose stay ends leaves; `reviewSystem` fires on
  `guest.checkedOut` and scores the stay 1–5 (`reviews.ts` `scoreReview`) on
  objective facts only — wait time, broken-prop nights, price vs. baseline —
  never on the guest's personality, "so a given stay always scores the
  same" (`reviews.ts` header, an explicit anti-dark-pattern ruling). A score
  ≤ 2 triggers `guest.complained` and a MAILBOX letter.
- **Messes**: a checkout leaves 2–4 discrete mess objects
  (`MESS_MIN`/`MESS_MAX`, `game.ts`), one click each to clean
  (WALKTHROUGH.md §5). Gated by `config.upkeep` (on by default in the
  shipped app).
- **Broken props**: one breakable prop per bedroom (`tv`/`radiator`/`lamp`/
  `icebox`, `PROP_KINDS`), rolled at the day rollover, 150 permille (15%)
  chance per prop per night (`BREAKAGE_PERMILLE`, `upkeepSystem`,
  `game.ts:2597`). Repair is a fixed **3 interact presses**
  (`REPAIR_STEPS`), no failure state, no consumables — the "zen completion"
  loop DESIGN §6 calls for (no per-room timer, consequences only at day
  granularity). An occupied room's broken prop accrues a "broken-night" on
  the guest, cashed out at their checkout review, not mid-day.
- **Night audit**: runs itself automatically at midnight
  (`dayPhaseSystem`, `game.ts:2712`) — AUDIT (`audit-app.ts`) is "a readout,
  not a set of buttons" by explicit H1 ruling; there is no "run audit"
  button, the terminal just shows the result. It prints revenue, expenses,
  fraud loss, closing cash, stars, and the day's three objectives
  (check-in/clean/catch-fraud, `economy.ts` `OBJECTIVE_KINDS`) with a
  same-day settle: completed objectives pay, missed ones "cost nothing" —
  printed on-screen verbatim (`audit-app.ts` line 78).
- **Save**: IndexedDB via F5/F9 (WALKTHROUGH.md controls); a memory
  `GameStore` fallback when IndexedDB is denied (ALPHA-LOOK.md cycle-3
  summary).

**Implemented vs. planned this cycle.** DESIGN §2 frames the audit as "the
session's ritual close, the save point, and the 'one more day' hook" and
specifically wants it to "forecast tomorrow's threats." Today's audit is
real but plain: a static text readout with none of that ceremony, and no
forward-looking threat forecast line exists in `econ.audit`'s payload
(`game.ts:2776` — day/revenue/expense/fraudLoss/closingCash/stars/
repBySegment only, no forecast). `docs/alpha-loop/DECISIONS.md` (cycle 4,
2026-09-03) explicitly picks **"Desk feedback + night-audit ritual"** as
this cycle's #1 item: ACCEPT/DENY/RENOVATE get an immediate stamp+sound
reaction, and the audit becomes "a proper end-of-day summary that reads as
the day's ritual close" — called out as "the loop's current weakest beat."
This is design intent being built now, not yet verified state.

## 4. THE CAMPAIGN LOOP

- **Tiers**: `hotel.tier` runs 0 (Motel) → 1 (Hotel) → 2 (Grand Foyer),
  capped at `MAX_HOTEL_TIER = 2` (`economy.ts`). The renderer reads the tier
  and never writes it (VISION-ALPHA.md "the renderer READS the tier... and
  never writes it").
- **RENOVATE**: a button inside LEDGER (`ledger-app.ts`), backed by
  `applyRenovate` (`game.ts:2171`). Costs, indexed by target tier:
  `RENOVATE_COST_MINOR = [0, 80_000, 150_000]` minor units — **$800 to
  reach tier 1, $1,500 to reach tier 2** — and `RENOVATE_STAR_REQ = [0, 2,
  2]`, i.e. **2 stars required for either renovation** (`economy.ts`). The
  sim re-checks desk range, tier ceiling, star requirement and cash on every
  attempt regardless of what the LEDGER UI already greyed out.
- **Tier-scaled demand/rates**: `TIER_DEMAND_MULT_PERMILLE = [1000, 1300,
  1600]` multiplies capture rate by tier, and `MAX_RATE_BY_TIER_MINOR =
  [6_000, 6_500, 7_500]` caps PRICER's ceiling per tier (`economy.ts`).
  `SEGMENT_MIN_HOTEL_TIER` gates which guest segments can even book: family
  and leisure book from tier 0, but **business guests — the highest payers
  — require tier 2** and literally cannot spawn before then
  (`guestSpawnSystem`'s archetype filter in `game.ts`, closing the loop that
  demand modeling alone would leave open).
- **Clerk hire**: unlocks once cash crosses `HIRE_THRESHOLD_MINOR = 60_000`
  ($600) — printed every day in LEDGER's "STAFF BUDGET" line even while
  locked (`ledger-app.ts`, `economy.ts`). Candidates are drawn 2 per round
  (`CANDIDATES_PER_ROUND`, `staff.ts`) with a wage band $20–$35/day
  (`MIN_WAGE_MINOR`/`MAX_WAGE_MINOR`) and a skill band 65–95%
  (`MIN_SKILL_PERMILLE`/`MAX_SKILL_PERMILLE`) that governs how often the
  hired clerk misjudges a desk decision (`clerkErrs`, `staff.ts`). Once
  hired, the clerk runs the exact same validated `desk.decision` /
  `interact` command path as the player or a bot — "there is no clerk back
  door" (`staffBrainSystem` comment, `game.ts:2251`).
- **End card**: firing at tier 2, "The Grand Foyer opens," with day count and
  cash (WALKTHROUGH.md §11); dismissing it doesn't end anything, play
  continues.

**Alpha delivers vs. the fuller roadmap.** The alpha's whole campaign is
three tiers, one renovate button, one hire slot, and demand math — that's
it. DESIGN.md's broader campaign layer (§3 "roles as first-person
minigames" beyond front desk — housekeeping, maintenance, bellhop, kitchen,
security, manager as playable jobs; §6 role XP, mastery perks, contracts,
prestige/sell-up; §8 the multiplayer street) is entirely out of scope for
this alpha and not present in the sim at all — no role other than "owner
working the desk" is playable, there is no contract system, no prestige, no
multiplayer. VISION-ALPHA.md is explicit that the alpha stops at "One-Man
Show" (owner and only employee, until the single clerk hire) — the full
roadmap's role/contract/prestige layers are future phases, not alpha scope.

## 5. What's real vs. inferred

**Proven, mechanically, end-to-end**: the headless `alpha-loop` scenario
bot — a bot that keeps working the desk continuously rather than idling —
plays the entire arc and reaches tier 1 by day 5, tier 2 by day 9, closes
solvent by day 14, with 14/14 scenario assertions passing and 33/33 planted
frauds caught across the referenced runs (ALPHA-LOOK.md "Alpha loop, cycles
1–3"; WALKTHROUGH.md §8, re-derived directly from
`scenarios/alpha-loop.scenario.mjs`'s event log). Every headless and browser
gate (`fps-look-interact`, `reserva-readability`, `save-restore`,
`demo-visual`) passes with replay verified.

**Not yet proven**: a continuous *human* sitting through the whole loop in
one session. The scripted playtest driver (`apps/hotel/dev/playtest.mjs`)
proved beats 1–5 and 7 of the walkthrough by eye on the real built artifact
(two real frauds caught, named field mismatches) but, per ALPHA-LOOK.md's
own honest accounting, **"could not keep the desk served continuously"** —
so the tier-1/tier-2 and end-card screenshots in WALKTHROUGH.md come from
dev-tool renders (the tour page, the HUD harness) at those tiers, not from a
live playthrough that actually reached them by playing. `H4b`'s gate — a
person doing the whole loop, unaided, in one sitting — "is still owed by a
person" (ALPHA-LOOK.md). `docs/alpha-loop/DECISIONS.md` (cycle 4) confirms
this is the acknowledged gap: "No human has run door-to-end-card in one
sitting; only the headless bot has... A live dev server is up for the owner
to do exactly that."

## 6. Loop beat, at a glance

| Loop beat | Implemented? | Key file | Gap |
|---|---|---|---|
| Take guest's papers (click) | Yes | `game.ts` (`interactSystem`) | — |
| RESERVA: docs vs. reservation vs. procedures card | Yes | `reserva-app.ts` | No upsell offer, no complaint-defuse interaction |
| ACCEPT / DENY, sim-validated | Yes | `game.ts:1828` `applyDeskDecision` | No visual/audio feedback yet (this cycle's #1 pick) |
| Fraud, 1-in-5 (200 permille) | Yes | `game.ts` `DEFAULTS.fraudRatePermille` | — |
| Missed fraud → chargeback + star hit | Yes | `game.ts:2504` `reviewSystem`, `economy.ts` `CHARGEBACK_ACCOUNT` | — |
| Room assignment | Yes (pick any vacant room) | `reserva-app.ts` | No "right room" scoring/nuance |
| Checkout mess (2–4 objects, 1 click each) | Yes | `game.ts` `MESS_MIN/MAX` | — |
| Broken prop (15%/night, 3-press repair) | Yes | `game.ts:2597` `upkeepSystem` | Not guaranteed early — cash/day gated |
| Night audit | Yes, but plain readout | `audit-app.ts`, `game.ts:2712` `dayPhaseSystem` | No ceremony, no forecast line — this cycle's #1 pick |
| Save/restore | Yes | IndexedDB + memory `GameStore` fallback | — |
| RENOVATE ($800→tier1, $1,500→tier2, 2 stars) | Yes | `ledger-app.ts`, `economy.ts` `RENOVATE_COST_MINOR` | No ritual/montage yet |
| Tier-scaled demand & rate ceilings | Yes | `economy.ts` `TIER_DEMAND_MULT_PERMILLE`, `MAX_RATE_BY_TIER_MINOR` | — |
| Business segment gated to tier 2 | Yes | `economy.ts` `SEGMENT_MIN_HOTEL_TIER` | — |
| Clerk hire (unlock $600, 2 candidates/round) | Yes | `economy.ts` `HIRE_THRESHOLD_MINOR`, `staff.ts` | — |
| End card at tier 2 | Yes | `game.ts` / `src/render/walkthrough.ts` | — |
| Upsell | No | — | Not in `reserva-app.ts` at all |
| Complaint defusing (in-the-moment) | No | — | Complaints are one-way to MAILBOX only |
| PRICER fuzzy demand graph | No (flat rate only) | `economy.ts` `applyPricerRate` | Graph/sharpening mechanic unbuilt |
| Roles beyond front desk (housekeeping, maintenance, etc. as first-person minigames) | No | — | Out of alpha scope per VISION-ALPHA.md |
| Contracts, prestige, multiplayer | No | — | Roadmap, not alpha |
| Continuous human playthrough, door to end card | Not yet | — | Proven only by the headless bot; owed by a person |
