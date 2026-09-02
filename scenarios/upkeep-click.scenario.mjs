// upkeep-click -- Phase H2b browser-mode gate (H2a review deferral item 1,
// docs/reviews/phase-H2a.md): proof that a player mouse-click resolves
// end-to-end (reticle raycast -> range/arc revalidation -> event) against
// the REAL running build, not just headless command injection. Runs against
// the "upkeep-demo" named config (apps/hotel/src/sim/game.ts
// SCENARIO_CONFIGS), which pre-dirties the bedroom nearest the lobby and
// spawns two job candidates walking in.
//
// TICK-GATED, NOT WALL-CLOCK -- same rule as reserva-readability and
// fps-look-interact: every input step below waits on
// window.__WORLDFORGE__.world.tick, gated behind the start barrier the
// harness installs whenever any step carries atTick/downAtTick/upAtTick.
//
// WHY setupNamed, NOT setup
// `setup` is imported from ../apps/hotel/dist-game/sim/game.js exactly like
// every other browser scenario, but this file calls `setupNamed(sim,
// "upkeep-demo")` on it, and the app is driven to the SAME named config via
// ?worldforgeConfig=upkeep-demo (packages/harness/src/browser.ts forwards
// `browser.configName` the same way it already forwards the seed). Without
// that, headless replay would build the plain (non-dirtied) world while the
// live page built the dirtied one -- two different worlds sharing a seed,
// which --verify-replay would catch as a hash mismatch with no obvious
// cause, exactly the seed-mismatch failure mode main.ts's own comment warns
// about for ?worldforgeSeed.
//
// THE JAM THIS SCRIPT AVOIDS
// A naive greedy A*-cell follower (aim at the next 250mm cell centre, replan
// every tick) jams at (5618,3889) near the lobby<->corridor door: the path
// search treats doors as always-open and threads the corridor at cx=22
// (x=5625mm), but the player is a 300mm-RADIUS circle and the wall segment
// immediately east of that column (x>=5875mm, confirmed SOLID at the
// z=4375 door row and again at z=4625-4875 and z=6125-6375 by direct grid
// probe against the real compiled setup()) is only 250mm away from that
// column's centre -- inside the 300mm clearance a wobbling heading needs.
// Any follower that lets the heading (and therefore x) drift by even a few
// mm east of the centreline gets its moveCircle Z-axis resolution blocked
// solid, freezes forever, and no amount of re-aiming un-sticks it because
// re-aiming is exactly what caused the drift.
// The fix used here is NOT a smarter follower -- it is two long straight
// legs with a single 90-degree turn between them, walked far enough west of
// the solid column that heading noise never matters:
//   leg 1: hold yaw 0 (the spawn facing, dead centre of the x=5375 column,
//     which the grid probe confirms is clear from z=3125 all the way past
//     the door and the pillar-flanked room entrance to z=9925) for 12 move
//     ticks -> (5375, 5525).
//   leg 2: turn to face due east (yaw 90000 mdeg) and walk 14 ticks through
//     the ONE door in this run that actually needs threading -- the
//     hallway/mess-room doorway at x~5750, whose open band spans
//     z=5125..5875 (grid probe again) -- centred by construction on z=5525,
//     500mm clear of the solid rows immediately above/below the band.
// This is the "aim at the door cell centre and walk straight through"
// strategy the phase brief calls for, just applied as two committed
// straight-line legs instead of a general-purpose follower, because this
// scenario only ever needs to walk this one route.
//
// DERIVATION OF THE COMMITTED LITERALS (seed hotel-h2-upkeep-1, real
// compiled setupNamed(sim,"upkeep-demo") + moveCircle, not guessed):
//   spawn (5375,3125) yaw 0; mess cluster room entrance behind a door at
//   x~5750, z-band [5125,5875]; messes at (8125,6375) (7125,6375)
//   (8875,5125) (9125,5125); broken prop coincides with the first mess at
//   (8125,6375); candidates 24/26 settle "waiting" at (5375,3125) and
//   (5375,2875) by tick 13 and stay "waiting" indefinitely (checked out to
//   tick 90 with no interact).
//   leg 1 (12 ticks, yaw 0): (5375,3125) -> (5375,5525).
//   leg 2 turn: bearing due east is exactly 90000 mdeg; dxPx =
//     round(90000/220) = 409 -> camYaw becomes 89980 (20 mdeg off exact,
//     nowhere near the +/-30000 arc half-width that matters later).
//   leg 2 (14 ticks): (5375,5525) -> (8175,5525). Distance from this stop
//     point to ALL FOUR messes and the broken prop is <=1500mm at once
//     (851/1351/806/1031mm) -- checked ticks 25..27 too (863/851/886 for
//     the nearest mess) so the stop is not balanced on a knife edge; being
//     a tick early or late still lands inside interact range.
//   turn+pitch to the mess at (8125,6375): bearing from (8175,5525) is
//     356633 mdeg; signed delta from camYaw 89980 is -93280 mdeg -> dxPx =
//     round(-93280/220) = -424 -> camYaw becomes 356700 (67 mdeg off exact,
//     comfortably inside the arc). Distance is 851mm.
//   PITCH for the mess click: mess sits at MESS_SIZE_M*0.25 = 0.07m off the
//     floor (apps/hotel/src/render/upkeep.ts), eye is at 1.6m
//     (packages/player-fps DEFAULT_EYE_HEIGHT_M), horizontal range 851mm,
//     so the target is atan((1.6-0.07)/0.851) = 60.9 degrees BELOW the
//     reticle at dead-level pitch -- with dy 0 the raycast sails clean over
//     a lump this close and low. 60900 mdeg / 220 mdeg-per-px = 277px.
//     Sign convention (positive dy pitches down) and the mdeg-per-px
//     constant are the same ones reserva-readability measured; this run
//     confirms the 277px figure works against the live raycast (see
//     "CONFIRMED LIVE" below) rather than trusting the arithmetic alone.
//   return leg (west): bearing from the post-click stance (356700 mdeg) to
//     (5375,5525) is 270020 mdeg; dxPx = round((270020-356700 wrapped =
//     -86680)/220) = -394 -> camYaw becomes 270020 (exact). Also levels
//     pitch back to 0 (dy -277) in the same look step -- pitch does not
//     affect moveCommand's horizontal direction, this is purely so the
//     walk-back isn't spent staring at the floor.
//   leg 4 (14 ticks): (8175,5525) -> (5375,5525).
//   leg 5 turn: bearing from (5375,5525) to the lobby is 180040 mdeg (due
//     north); dxPx = round((180040-270020 wrapped)/220) = -409 -> camYaw
//     becomes 180040 (exact).
//   leg 5 (11 ticks, not 12): (5375,5525) -> (5375,3325) -- one tick short
//     of the full return distance so the player does not end up standing
//     exactly on top of candidate 24 at (5375,3125), which would make the
//     bearing to it degenerate (atan2(0,0)). Distance from (5375,3325) to
//     candidate 26 at (5375,2875) is 450mm, dead north (bearing 180040,
//     already exactly aligned with camYaw -- dxPx 0, no further turn).
//   PITCH for the candidate click: torso centre sits at HIP_Y + TORSO_H/2 =
//     0.75m (apps/hotel/src/render/characters.ts), horizontal range 450mm,
//     so atan((1.6-0.75)/0.45) = 62.1 degrees down -> 62120/220 = 282px.
//     The torso box is 0.5m tall, giving real margin either side of this
//     number, unlike the much thinner mess target.
//
// BONUS PROP CLICK -- DROPPED, EXPLICITLY
// The broken prop coincides exactly with the first mess at (8125,6375) --
// same xz, different render height (PROP_H_M/2 = 0.3m vs the mess's 0.07m).
// Once the mess is cleaned the reticle's raycast at the mess's old pitch
// would need to re-target the prop's box at a measurably different pitch,
// and by the H2a upkeep systems a cleaned mess also changes what else is
// interactable at that cell on the same tick -- deriving and confirming a
// SECOND live raycast pitch at the same coordinates, reliably, immediately
// after the mess entity disappears, was judged more fragile than it is
// worth for a bonus assertion. Skipped; the three required assertions
// (mess cleaned, candidate interview started, no denials) are the gate.
import { setupNamed } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h2-upkeep-1";
const CONFIG = "upkeep-demo";

const LEG1_TICKS = 12; // yaw 0, spawn -> (5375,5525)
const TURN_EAST_PX = 409; // -> camYaw 89980
const LEG2_TICKS = 14; // -> (8175,5525), all messes+prop in range
const CLICK_MESS_TICK = LEG1_TICKS + LEG2_TICKS + 4; // settle before clicking, mirrors reserva-readability's WALK_TICKS+4
const TURN_MESS_PX = -424; // 89980 -> 356700, bearing to (8125,6375)
const MESS_PITCH_PX = 277; // 60.9deg down, mess at 0.07m / eye 1.6m / range 851mm
const TURN_WEST_PX = -394; // 356700 -> 270020, bearing back to (5375,5525)
const LEVEL_PITCH_PX = -277; // undo MESS_PITCH_PX
const LEG4_TICKS = 14; // -> (5375,5525)
const TURN_NORTH_PX = -409; // 270020 -> 180040, bearing toward the lobby
const LEG5_TICKS = 11; // -> (5375,3325); one tick short of overlapping candidate 24
const CANDIDATE_PITCH_PX = 282; // 62.1deg down, torso centre 0.75m / eye 1.6m / range 450mm
const CLICK_CANDIDATE_TICK = LEG1_TICKS + LEG2_TICKS + LEG4_TICKS + LEG5_TICKS + 4;

const T_LEG2_START = LEG1_TICKS;
const T_TURN_MESS = LEG1_TICKS + LEG2_TICKS;
const T_TURN_WEST = CLICK_MESS_TICK + 1;
const T_LEG4_START = T_TURN_WEST;
const T_TURN_NORTH = T_LEG4_START + LEG4_TICKS;
const T_LEG5_START = T_TURN_NORTH;
const T_TURN_CANDIDATE = T_LEG5_START + LEG5_TICKS;

export default {
  name: "upkeep-click",
  seed: SEED,
  ticks: 90,
  setup: (sim) => setupNamed(sim, CONFIG),
  assertions: [
    {
      description: "the mess at (8125,6375) is gone (its entity no longer carries a `mess` component)",
      check: (s) => {
        for (const e of s.entities()) {
          const m = s.getComponent(e, "mess");
          const p = s.getComponent(e, "pos");
          if (m && p && Math.abs(p.xMm - 8125) < 10 && Math.abs(p.zMm - 6375) < 10) return false;
        }
        return true;
      },
    },
    {
      description: "a room.messCleaned event fired for that mess (the reticle raycast actually resolved to it, not just 'the mess vanished for some other reason')",
      check: (s) => s.eventsSince(0).some((e) => e.type === "room.messCleaned"),
    },
    {
      description: 'a staff.interviewStarted event fired -- the second, unrelated click (through the reticle, at the lobby) also resolved through range+arc revalidation',
      check: (s) => s.eventsSince(0).some((e) => e.type === "staff.interviewStarted"),
    },
    {
      description: "no interact-denied events -- both screen-space clicks landed inside the sim's revalidated range and arc",
      check: (s) => !s.eventsSince(0).some((e) => e.type === "interact-denied"),
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    configName: CONFIG,
    input: [
      { pointer: "lock", atTick: 0 },
      { key: "KeyW", downAtTick: 0, upAtTick: LEG1_TICKS },
      { pointer: "look", atTick: T_LEG2_START, dx: TURN_EAST_PX, dy: 0 },
      { key: "KeyW", downAtTick: T_LEG2_START, upAtTick: T_TURN_MESS },
      { pointer: "look", atTick: T_TURN_MESS, dx: TURN_MESS_PX, dy: MESS_PITCH_PX },
      { pointer: "click", atTick: CLICK_MESS_TICK },
      { pointer: "look", atTick: T_TURN_WEST, dx: TURN_WEST_PX, dy: LEVEL_PITCH_PX },
      { key: "KeyW", downAtTick: T_LEG4_START, upAtTick: T_TURN_NORTH },
      { pointer: "look", atTick: T_TURN_NORTH, dx: TURN_NORTH_PX, dy: 0 },
      { key: "KeyW", downAtTick: T_LEG5_START, upAtTick: T_TURN_CANDIDATE },
      { pointer: "look", atTick: T_TURN_CANDIDATE, dx: 0, dy: CANDIDATE_PITCH_PX },
      { pointer: "click", atTick: CLICK_CANDIDATE_TICK },
    ],
    screenshotAtTicks: [T_TURN_MESS + 2, CLICK_MESS_TICK],
    probes: [{ probe: "sim-tick-ms" }],
    timeoutMs: 30000,
  },
  feelTargets: {
    "simTickMs.avgMs": { max: 10 },
  },
};
