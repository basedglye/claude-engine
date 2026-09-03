# Cycle 3 — CEO rulings (2026-09-02, late)

## Lane 1 (first, alone on the tree): the lobby gets real depth

Christian's ruling: make the lobby bigger. Today `packages/interiors/src/layout.ts`
draws a lobby 9–12 cells (2.25–3 m) deep; every placement and look pass has
confirmed it reads as a hallway. Target: **20–24 cells (5–6 m) deep**, width as
now, the desk and queue row keeping their relative geometry (desk on the west
wall, queue two cells north of it, spawn at the lobby centre, entrance on the
north wall, corridor door on the south wall centred in the corridor's x-band).

This is a generator (sim-side) change, so it is a contract change under
CLAUDE.md invariant 3 and it moves every pinned hash. The lane must:

1. Change only `packages/interiors/src/layout.ts` (+ its test goldens in
   `packages/interiors/scripts/test.mjs`), keeping the RNG draw order of the
   seed-derived parts stable where possible and saying exactly where it moves.
2. Re-derive the browser gates' hand-authored walks (`fps-look-interact`,
   `reserva-readability`, `save-restore`) — the walk scripts encode tick
   counts to the corridor door and the desk; re-derive them with a script,
   never by hand, and prove each by replaying into a fresh sim (the H2b
   `derive-walk.mjs` pattern; it is not on this branch, so write one).
3. Re-run all 13 headless scenarios with `--verify-replay` and the 5 browser
   gates; record every new hash in the review. `alpha-loop` must still pass
   9/9 with the same day table shape (tier 2 by day ≤ 10).
4. Then, in the same lane: re-run the placement solver's screenshots (the
   lobby seating group, plants, paintings and the tier-0 vending machine
   must now sit against walls with open floor between them) and the tier
   0/2 lighting poses; the 2.25 m constraint is gone, so any "cramped"
   excuse is gone with it.

No other lane runs while lane 1 is on the tree. Cycle 3 lanes 2+ (fraud
legibility fix if C2-W1's review demands one; turned-away reviews; `MAX_STARS`
question) are briefed after lane 1 merges.

## Lane 2 (after lane 1): the desk beat must exist in the product

COO review of C2-W1 found `apps/hotel/src/sim/game.ts` sets `fraudRatePermille: 0`
in the app's default setup, so the shipped game never spawns a fraudulent guest;
the scenarios pass because they set their own rate. CEO ruling: **the default is
200‰ (one guest in five) at tier 0**, unchanged across tiers for the alpha (the
escalation rows already make catching harder as stars rise). This moves the
browser gates' hashes (they run the app's setup) but not the headless ones; the
lane re-runs the five browser gates and records the new hashes. Also in this lane:
RESERVA paints ACCEPT/DENY at y=440, off the surface from the standing pose — move
them inside the visible surface and prove it with the readability gate's
screenshot; add the one `t()` line the audit screen owes ("The audit runs itself
at midnight; this screen is the report") so the walkthrough's "run the audit" step
is honest; the entry overlay's controls line already mentions T.

## Lane 3 (after lane 1, parallel with lane 2): placement fix-list

C2-W4's COO review (reviews/C2-W4.md) has four blockers: `placeOnWallSurface`
marks no occupancy so paintings stack; both cart call sites bypass the solver's
omit-on-undefined contract; sconces are placed outside the solver; a pilaster
bisects the front desk. Fix all four against the NEW lobby geometry, re-shoot the
C2-W4 pose set at tiers 0 and 2, and LOOK.

## Lane 4 (after lanes 2–3): playtest re-run

C2-W1 re-runs its 11 beats on the integrated build with hold-T time compression,
a corrected driver (read every document, compare by procedure rule, not by
same-named keys), and the fraud rate live; reaches tier 2 and the end card in one
session; rewrites WALKTHROUGH.md with real tier-2 frames.
