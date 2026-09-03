# Creative-org decisions — GRAND FOYER alpha, cycle 4 (2026-09-03)

Inputs: SPARK-1.md (what-ifs), BALLAST-1.md (grounding).

## Picked (this cycle)
1. **Desk feedback + night-audit ritual** (Spark ★). ACCEPT/DENY and RENOVATE
   land with an immediate readable reaction (a stamp mark + a short sound via
   the existing event stream); the night audit becomes a proper end-of-day
   summary that reads as the day's ritual close, not a plain list. This is the
   "one more day" hook DESIGN.md promises and the loop's current weakest beat.
2. **W3-3 empty painting canvases** (Ballast KEEP — the one genuinely-open,
   host-only, cheap item). Paintings at tier 2 render as bare frames; put a
   deterministic procedural canvas inside the frame.

## Cut (logged so not re-pitched)
- Painting/window overlap, fixtures-before-decor order, tier-2 desk pose:
  **already fixed** in commit 08adff8 (Ballast). Do not re-touch.
- MAILBOX physical in-tray drop (Spark): bigger; next cycle.
- B4 (no broken prop observed) / B5 (no candidate): **park** — real RNG/cash
  -gated mechanics, not defects; a continuous human sitting will hit them.

## The honest gap (Ballast)
No human has run door-to-end-card in one sitting; only the headless bot has.
A live dev server is up for the owner to do exactly that. Everything else is
individually verified. This cycle sharpens the beats that sitting will feel.

# Cycle 5 (2026-09-03) — escalation is visible

Inputs: SPARK-2.md, BALLAST-2.md. Ballast confirmed the star-tiered rule
escalation + MAILBOX bulletins are ALREADY built and firing; the only real gap
is the moment-of-change signal, which the sim key budget (9/9) blocks.

## Picked
- **"New procedure" notice** (Spark ★, Ballast's cheap host-only version):
  a host-side HUD notice on `hotel.starsChanged` (tier up → blacklist rule
  activates) and `mail.bulletinDelivered`, deferred until the player leaves
  the terminal. Same event-stream pattern as the cycle-4 desk stamp — zero
  goldens, no sim change. render/hud.ts + main.ts only.

## Cut (logged)
- The in-RESERVA "NEW" tag on freshly-active rows, archetype-flavoured
  violation text, streak/buzz bonus, crossRef/loyaltyTier/billingCode:
  all need sim state / a new ScreenViewData key (moves all goldens) or are
  post-alpha roadmap. Not this cycle.
