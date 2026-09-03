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
