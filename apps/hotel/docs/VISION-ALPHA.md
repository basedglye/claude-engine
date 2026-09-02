# GRAND FOYER — Alpha vision: "From Motel to Grand"

CEO statement, 2026-09-02. Binding for the alpha loop on branch
`claude/grand-foyer-game-alpha-50b07d`. Read with
[DESIGN.md](DESIGN.md) (the bible), [ALPHA-LOOK.md](ALPHA-LOOK.md) (what
already renders, verified) and `CLAUDE.md` at the repo root (invariants).

## The pitch

You inherit a two-bit roadside motel on the edge of a big, loud city at
dusk: stained carpet, a buzzing VACANCY sign, one flickering tube light over
a laminate counter, a CRT running HOTELSOFT '95. You work the desk yourself,
read every ID, wipe every room, fix the radiator. Guests are odd. Money is
tight. Every night the audit tells you where you stand. When you have
enough, you RENOVATE: the carpet goes, the marble comes in, the chandelier
goes up, the sign changes from VACANCY to GRAND FOYER — and the city's
better guests start to arrive. The alpha ends when the motel has become the
Grand Foyer.

Aesthetic references: *RV There Yet?* (chunky, cosy, saturated, physical
comedy; props you can read from across the room) and a GTA-6-flavoured
world outside the door (neon at dusk, a skyline, a strip-mall street, a
seedy-charming tone). The realistic PBR look already built is the TOP
tier; the starting tier is deliberately cheap, tired and a little funny.

## The three tiers (host-side look, sim-side number)

| `hotel.tier` | Name | Look |
|---|---|---|
| 0 | Motel | stained beige carpet in every room, flat scuffed paint, drop-ceiling tiles with fluorescent tubes (one flickers), laminate counter with a chipped edge, folding chairs and a vending machine in the lobby, cheap mismatched bedroom furniture, a chain-link and asphalt lot outside, neon VACANCY sign, a dumpster. |
| 1 | Hotel | clean carpet, painted walls with a chair rail, warm can lights, a wooden desk, matching furniture, awning outside. (Interpolate between 0 and 2; do not author a third full set — swap materials and fixtures.) |
| 2 | Grand Foyer | exactly what ALPHA-LOOK.md renders today: marble, coffered ceiling, chandelier, sconces, the GRAND FOYER sign. |

Rule: the renderer READS the tier from sim state and never writes it. A
tier change rebuilds the scenery group (architecture, decor, fixtures,
exterior) and the light rig; the sim, nav grid and every command are
identical across tiers. Everything the motel tier needs must be
**procedural** (canvas-generated textures, box/lathe geometry): the
deliverable is a single-file artifact that cannot fetch anything.

## The full game loop (alpha definition of done)

A person can, in one sitting and with no outside help:

1. Enter, read a one-line objective, walk to the desk (walkthrough step).
2. Check in guests at the desk by reading documents and using RESERVA;
   catch at least one fraud.
3. Clean a room after a checkout and repair a broken prop.
4. Run the night audit at the terminal and see cash and stars change.
5. Earn enough over several days to **RENOVATE** at the terminal
   (a new action in LEDGER: cost, star requirement, one press) and watch
   the hotel change around them from tier 0 to 1, then 1 to 2.
6. Hire the clerk (already shipped) so they are no longer chained to the desk.
7. Reach tier 2: an end card ("The Grand Foyer opens") with the day count
   and cash; play continues.

Sim additions are allowed and expected (this is a sim change, so
`stateHash` moves; every headless gate must be re-run with
`--verify-replay` and the smoke test's pinned hash is for the engine demo,
not the hotel). The registry still stops at six apps: renovation lives
inside LEDGER. Demand and the room-rate ceiling scale with tier so the loop
has an economy: tier 0 fills only with the cheap segment; tier 2 unlocks
the premium one. Numbers are tuned against a headless `alpha-loop`
scenario that plays the whole arc with bots and must end at tier 2 and
solvent within 14 in-game days.

## The walkthrough

Host-side, event-driven, no HUD chrome beyond one line of text and the
reticle prompt: each step names the next physical act ("Walk to the desk",
"Click the guest to take their ID", "Use the terminal", "Clean room 2",
"Open LEDGER and run the audit", "You can afford to renovate"). Steps
advance from sim events and state, never from timers. It can be skipped and
never blocks input. Strings go through `t()`.

## Deliverable

1. **Artifact**: one HTML file (≤ 16 MB, no external fetches except scripts
   from cdnjs/jsdelivr) built from the app by a script, with pointer lock
   requested and a hover-look fallback when the sandbox refuses it. Saves
   in IndexedDB.
2. **Hosted**: the same build on Netlify as the fallback.
3. `apps/hotel/docs/WALKTHROUGH.md`: the playthrough with screenshots,
   written by driving the real build.

## Non-negotiables

- CLAUDE.md invariants; sim purity; write-through; integers in sim state.
- Mouse look is pointer-lock free-look; never click-drag.
- Every new gate must be shown red once (perturbation) before it counts.
- The realistic tier-2 look stays as verified; do not regress ALPHA-LOOK.
- Lobby depth stays as the generator makes it (sim-side, out of scope).
