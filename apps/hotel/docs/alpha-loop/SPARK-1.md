# SPARK-1 — making the desk/day loop compulsive

For the CEO. One page of what-ifs. No grading, no cost — Ballast does that.
Focus: the "one more day" hook DESIGN.md promises, concentrated on the
shift → night-audit ritual since that's where a human sits the longest.

## What if we added ___?

- What if the **night audit** (LEDGER, already the "session's ritual close"
  per DESIGN.md §2) got a forced full-screen sequence — cash counted up
  digit by digit with a ticking sound, star delta shown as a physical
  gauge needle move, tomorrow's forecast line ("3 VIPs, boiler at 12%")
  typed out letter-by-letter like a teletype? ★
- What if **RESERVA's ACCEPT/DENY** (already on-screen per ALPHA-LOOK) got
  a stamp-thunk: a physical rubber stamp swings down on APPROVED/DENIED,
  with a sound and a half-second screen-shake, Papers-Please style? ★
- What if the **cash drawer** got a literal chime + a visible drawer-slide
  animation on every successful check-in — the "ka-ching" is the moment
  a shift becomes money, not a number changing in a corner?
- What if we added a **guest reaction beat**: after check-in resolves, the
  guest NPC does one of three readable animations (delighted nod / neutral
  shrug / annoyed huff) tied to how well you handled them (right room,
  right rate, no delay)? Instant, wordless feedback per guest.
- What if **MAILBOX** (currently listed as an app but under-exploited per
  the brief) delivered one new letter every audit — a complaint, a vendor
  come-on, a rival taunt, a plot hook — that visibly plops into a physical
  in-tray prop you have to walk over and open, Papers-Please dossier style? ★
- What if the **daily objectives** (DESIGN.md §6: "three sim-derived
  objectives") got a visible on-screen tracker — three cards that flip
  face-up with a check or an X at the audit, not just a passive tally?
- What if a missed-fraud chargeback (already penalizes a star) triggered a
  distinct escalation VFX — the CRT flickers red, a "FRAUD DETECTED (LATE)"
  stamp slaps down — so the punishment reads as loud as the reward?
- What if the **pager** (DESIGN.md: "late-unlock… one-line push alerts")
  got its debut moment staged as a small ceremony — first buzz, first
  time you're not chained to the desk — rather than a quiet unlock?
- What if we added a **day-count/streak counter** visible only at the audit
  screen (not a login-punishment streak, a simulation-intrinsic "consecutive
  profitable days" per DESIGN.md's own buzz-bonus idea) rendered as a
  physical tally-mark scratch on the desk counter?
- What if a **radio or muzak loop** at the desk subtly intensifies (tempo,
  layering) as the shift's guest queue backs up, then resets calm at audit
  close — an ambient pressure dial with no numbers?
- What if **RENOVATE** (LEDGER, already one press) got its own mini-ritual
  separate from the audit — a "before" photo freeze-frame, a construction
  montage, an "after" reveal — since it's the biggest dopamine beat in the
  whole arc and currently fires as a plain state flip?

## What if we did more of / less of ___?

- **More of** the escalation cadence Papers Please uses: rules stack (ID
  check → reservation match → fraud tell → blacklist row) one at a time
  across the early days rather than all being live from day one, so the
  desk shift gets visibly harder and the player feels their own growing
  expertise.
- **More of** the **demand graph** in PRICER — DESIGN.md calls it
  "deliberately fuzzy… sharpens with upgrades." What if that fuzziness
  itself became a daily read-the-tea-leaves ritual players get better at,
  with a visible "sharper today" moment tied to renovation tiers?
- **More of** the **blacklist rule row** — surface a running list of who's
  been caught/banned as a physical rolodex or corkboard prop at the desk,
  so repeat-offender fraud carries narrative memory, not just a stat.
- **Less of** silence between check-ins during a quiet shift — the empty
  desk time is currently dead air; fill it with ambient business (a phone
  ring you can ignore, a guest wandering the lobby) so downtime isn't dead.
- **More of** stars-as-feedback: right now stars move at the audit; what if
  a star *near-miss* (barely avoided losing one) got its own tension beat
  mid-shift, not just a end-of-day reveal?
- **Less of** the audit as a passive report — DESIGN.md already frames it
  as "the session's ritual close, the save point, and the one more day
  hook" but ALPHA-LOOK doesn't yet describe it as an event; make it an
  unmissable 10-15s beat you can't skip through, every single night.

## What if we looked at ___ for fresh ideas?

- **Papers Please**: the escalation cadence (new rule each day), the stamp
  thunk, and the end-of-day "how much did you make vs. rent due" tension —
  apply the last one directly: show cash vs. next renovation cost as a
  visible countdown bar at every audit. ★
- **Cook, Serve, Delicious! / Diner Dash**: the escalating-orders adrenaline
  curve within a single shift — could the desk queue visibly speed up
  toward shift's end the way their dinner rush does, instead of a flat rate?
- **Balatro's "run" screen**: a single, satisfying full-screen number-count-up
  moment between rounds is the entire reason people call it addictive —
  the night audit is GRAND FOYER's obvious analog and currently the least
  spectacular event in the loop per ALPHA-LOOK's plain description.
- **This repo's own `docs/alpha-loop/BREAKDOWN-2.md` and `mailbox-app.ts`**:
  both exist and are wired but the walkthrough/verified-state notes never
  mention a player actually reading a letter — check what's already coded
  before building new plumbing.

## The boldest single move

Turn the night audit from a report screen into the game's Balatro moment:
a forced, unskippable 10-15 second full-screen ritual — cash counting up
with sound, a stamped star-delta, a typed-out tomorrow-forecast, and (when
it lands) a mailbox letter physically dropping in — so every single day
ends on the loop's single highest-craft beat, not its plainest one.
