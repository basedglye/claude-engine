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
// z=4375 door row, and again at z=4625-4875 and z=6125-6375, by direct grid
// probe against the real compiled setup()) is only 250mm away from that
// column's centre -- inside the 300mm clearance a wobbling heading needs.
// Any follower that lets the heading (and therefore x) drift by even a few
// mm east of the centreline gets its moveCircle Z-axis resolution blocked
// solid, freezes forever, and no amount of re-aiming un-sticks it because
// re-aiming is exactly what caused the drift (confirmed by replaying a
// lookahead+hysteresis follower through the real compiled setupNamed() --
// it still wedges at (5625,3918), oscillating +-1px forever).
// The fix used here is NOT a smarter follower -- it is two long straight
// legs with a single 90-degree turn between them, walked far enough west of
// the solid column that heading noise never matters:
//   leg 1: hold yaw 0 (the spawn facing, dead centre of the x=5375 column,
//     which the grid probe confirms is clear from z=3125 all the way past
//     the door and the pillar-flanked room entrance to z=9925) for 12 move
//     ticks -> (5375, 5525).
//   leg 2: turn to face due east (yaw 90000 mdeg) and walk through the ONE
//     door in this run that actually needs threading -- the hallway/mess-
//     room doorway at x~5750, whose open band spans z=5125..5875 (grid
//     probe again) -- centred by construction on z=5525, 500mm clear of the
//     solid rows immediately above/below the band.
// This is the "aim at the door cell centre and walk straight through"
// strategy the phase brief calls for, just applied as two committed
// straight-line legs instead of a general-purpose follower, because this
// scenario only ever needs to walk this one route.
//
// DERIVATION OF THE COMMITTED LITERALS (seed hotel-h2-upkeep-1, real
// compiled setupNamed(sim,"upkeep-demo") + moveCircle, not guessed):
//   spawn (5375,3125) yaw 0; mess cluster room entrance behind a door at
//   x~5750, z-band [5125,5875]; messes at (8125,6375) (7125,6375)
//   (8875,5125) (9125,5125); broken prop coincides with the FIRST mess at
//   (8125,6375); candidates 24/26 settle "waiting" at (5375,3125) and
//   (5375,2875) by tick 13 and stay "waiting" indefinitely (checked out to
//   tick 90 with no interact).
//   leg 1 (12 ticks, yaw 0): (5375,3125) -> (5375,5525).
//   leg 2 turn: bearing due east is exactly 90000 mdeg; dxPx =
//     round(90000/220) = 409 -> camYaw becomes 89980 (20 mdeg off exact,
//     nowhere near the +/-30000 arc half-width that matters later).
//   leg 2 (11 ticks): (5375,5525) -> (7575,5525).
//
// WHICH MESS, AND WHY NOT THE NEAREST ONE
// The first live-browser run of this script clicked the mess at
// (8125,6375) -- the closest one, and the one that shares its (x,z) with
// the broken prop -- and the interact command that came back targeted the
// PROP (entity 17), not the mess (entity 19): a prop's box
// (apps/hotel/src/render/upkeep.ts PROP_H_M=0.6, centred at 0.3m) is
// taller than a mess's box (MESS_SIZE_M*0.5=0.14m, centred at 0.07m) and
// sits at the identical xz, so from directly above the prop's top face
// always occludes the mess's -- no pitch can make the mess win a raycast
// against a taller box standing on top of it. So this script targets
// (8875,5125) instead -- entity 20, the mess farthest from the broken prop
// and with a completely clear line of sight -- rather than fighting that
// occlusion.
//   turn+pitch to the mess at (8875,5125) from (7575,5525): bearing
//     107102.7 mdeg; signed delta from camYaw 89980 is +17160 mdeg -> dxPx
//     = round(17160/220) = 78 -> camYaw becomes 107140 (37 mdeg off exact).
//     Range 1360mm -- inside the 1500mm interactable radius with headroom,
//     not balanced on its edge.
//   PITCH for the mess click: mess sits at MESS_SIZE_M*0.25 = 0.07m off the
//     floor (apps/hotel/src/render/upkeep.ts), eye is at 1.6m
//     (packages/player-fps DEFAULT_EYE_HEIGHT_M), horizontal range 1360mm,
//     so the target is atan((1.6-0.07)/1.36) = 48.4 degrees BELOW the
//     reticle at dead-level pitch -- with dy 0 the raycast sails clean over
//     a lump this low. 48400 mdeg / 220 mdeg-per-px = 220px. Sign
//     convention (positive dy pitches down) and the mdeg-per-px constant
//     are the same ones reserva-readability measured; this figure is the
//     gentlest available for a floor-height target still inside interact
//     range (pushing range toward the 1500mm cap only buys another few
//     degrees), chosen deliberately less steep than the first attempt's
//     61-degree pitch to the closer mess -- steep, close-range pitches
//     amplify small aim error into large ground-plane error and that is
//     what this file avoids everywhere it can.
//   return leg (west): bearing from the post-click stance (107140 mdeg) to
//     (5375,5525) is 269940 mdeg (not exactly 270000 -- the player's actual
//     z drifted a few mm during leg 2); dxPx = round((269940-107140)/220
//     wrapped) = 740 -> camYaw becomes 269940 (exact, mod 220-px
//     quantization). Also levels pitch back to 0 (dy -220) in the same
//     look step -- pitch does not affect moveCommand's horizontal
//     direction, this is purely so the walk-back isn't spent staring at
//     the floor.
//   leg 4 (11 ticks): (7575,5525) -> (5375,5525).
//   leg 5 turn: bearing from (5375,5525) to the lobby is 179960 mdeg (due
//     north, 40 mdeg off exact); dxPx = round((179960-269940 wrapped)/220)
//     = -409 -> camYaw becomes 179960.
//   leg 5 (7 ticks, not the full 12 back to spawn): (5375,5525) ->
//     (5375,4125) -- stopping with real standoff distance rather than
//     walking up to the candidate, both so the bearing calculation never
//     degenerates (atan2(0,0) if the player ends up exactly on top of a
//     candidate, which sits at the exact spawn coordinate) and so the
//     click pitch stays gentle: distance to candidate 26 at (5375,2875) is
//     1250mm, dead north (bearing 179960, already exactly aligned with
//     camYaw -- dxPx 0, no further turn needed).
//   PITCH for the candidate click: torso centre sits at HIP_Y + TORSO_H/2 =
//     0.75m (apps/hotel/src/render/characters.ts), horizontal range
//     1250mm, so atan((1.6-0.75)/1.25) = 34.2 degrees down -> 34200/220 =
//     155px. The torso box is 0.5m tall and this is a shallower angle than
//     the mess click, giving real margin either side of this number.
//
// BONUS PROP CLICK -- DROPPED, EXPLICITLY
// The broken prop coincides exactly with the first mess at (8125,6375),
// and (see above) always wins the raycast there from any pitch that could
// also reach the mess -- the two targets cannot be independently clicked
// from the same standing spot. Reworking the walk to approach the prop
// from a second angle, after the mess a few ticks earlier is already
// clicked at (8875,5125), was judged more complexity than a bonus
// assertion is worth. Skipped; the three required assertions (mess
// cleaned, candidate interview started, no denials) are the gate.
import { setupNamed } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h2-upkeep-1";
const CONFIG = "upkeep-demo";
const MESS_X = 8875;
const MESS_Z = 5125;

const LEG1_TICKS = 12; // yaw 0, spawn -> (5375,5525)
const TURN_EAST_PX = 409; // -> camYaw 89980
const LEG2_TICKS = 11; // -> (7575,5525)
const CLICK_MESS_TICK_OFFSET = 4; // settle before clicking, mirrors reserva-readability's WALK_TICKS+4
const TURN_MESS_PX = 78; // 89980 -> 107140, bearing to (8875,5125)
const MESS_PITCH_PX = 220; // 48.4deg down, mess at 0.07m / eye 1.6m / range 1360mm
const TURN_WEST_PX = 740; // 107140 -> 269940, bearing back to (5375,5525)
const LEVEL_PITCH_PX = -220; // undo MESS_PITCH_PX
const LEG4_TICKS = 11; // -> (5375,5525)
const TURN_NORTH_PX = -409; // 269940 -> 179960, bearing toward the lobby
const LEG5_TICKS = 7; // -> (5375,4125); real standoff from candidate 24 at spawn
const CANDIDATE_PITCH_PX = 155; // 34.2deg down, torso centre 0.75m / eye 1.6m / range 1250mm
const CLICK_CANDIDATE_TICK_OFFSET = 4;

const T_LEG2_START = LEG1_TICKS;
const T_TURN_MESS = LEG1_TICKS + LEG2_TICKS;
const CLICK_MESS_TICK = T_TURN_MESS + CLICK_MESS_TICK_OFFSET;
const T_TURN_WEST = CLICK_MESS_TICK + 1;
const T_LEG4_START = T_TURN_WEST;
const T_TURN_NORTH = T_LEG4_START + LEG4_TICKS;
const T_LEG5_START = T_TURN_NORTH;
const T_TURN_CANDIDATE = T_LEG5_START + LEG5_TICKS;
const CLICK_CANDIDATE_TICK = T_TURN_CANDIDATE + CLICK_CANDIDATE_TICK_OFFSET;

export default {
  name: "upkeep-click",
  seed: SEED,
  ticks: 90,
  setup: (sim) => setupNamed(sim, CONFIG),
  assertions: [
    {
      description: `the mess at (${MESS_X},${MESS_Z}) is gone (its entity no longer carries a \`mess\` component)`,
      check: (s) => {
        for (const e of s.entities()) {
          const m = s.getComponent(e, "mess");
          const p = s.getComponent(e, "pos");
          if (m && p && Math.abs(p.xMm - MESS_X) < 10 && Math.abs(p.zMm - MESS_Z) < 10) return false;
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
      // Trailing no-op input step: the harness's input queue is what keeps
      // it polling window.__WORLDFORGE__.world.tick forward. Without
      // something scheduled after the final click, a run that reaches its
      // last input step exactly ON the click's tick (observed on Firefox --
      // Chromium happened to keep polling a few ticks further and caught
      // the resulting interact's tick+1 event, Firefox stopped dead at
      // CLICK_CANDIDATE_TICK) can end before the interact command the click
      // just submitted is even processed, losing the staff.interviewStarted
      // event this scenario asserts on. This step costs nothing (dx/dy 0)
      // and exists purely to hold the run open a few ticks past the click.
      { pointer: "look", atTick: CLICK_CANDIDATE_TICK + 5, dx: 0, dy: 0 },
    ],
    screenshotAtTicks: [T_TURN_MESS + 2, CLICK_MESS_TICK],
    probes: [{ probe: "sim-tick-ms" }],
    timeoutMs: 30000,
  },
  feelTargets: {
    "simTickMs.avgMs": { max: 10 },
  },
};
