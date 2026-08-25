// Phase H0 exit criterion 1 ("fps-look-interact", docs/PHASE-H0.md) — the
// cross-engine determinism gate. Drives real pointer-lock look + WASD +
// click input against the live @claude-engine/hotel browser app via the
// harness's browser mode (packages/harness/src/browser.ts), then verifies
// the captured command log replays headlessly to the same final state
// (--verify-replay). `setup` is imported from apps/hotel/dist-game/game.js
// -- the exact compiled module the browser bundles (docs/PHASE-H0.md, "The
// synthetic-input contract").
//
// --- Pointer-delta derivation (committed as literals, not guessed) --------
// A throwaway node script (run from the scratchpad dir) imported
// packages/interiors/dist/index.js and packages/space/dist/index.js and
// printed generateGroundFloor("hotel-h0-look-1")'s spawn and doors[0] (the
// lobby's only door -- the lobby<->corridor doorway, roomA=1=lobby):
//   spawn = { xMm: 5375, zMm: 1375, yawMdeg: 0 }
//   door0 = { xMm: 5000, zMm: 2625, roomA: 1 (lobby), roomB: 2 (corridor) }
//
// createFpsController (packages/player-fps/src/index.ts) initializes its
// free-look camYawMdeg to the sim's spawn yaw (0) on the first onTick, then
// applyLook adds `dxPx * mouseSensitivityMdegPerPx` (default 220 mdeg/px)
// to camYawMdeg per look step -- the exact function real mousemove and
// synthetic `pointer:"look"` steps both call (the synthetic-input contract).
// At yaw 0 the sim's forward direction is +Z, and bearing is computed the
// same way the sim's interactSystem computes it: atan2Mdeg(dx, dz) where
// dx/dz are (target - player). So:
//   bearing1 = atan2Mdeg(door0.xMm - spawn.xMm, door0.zMm - spawn.zMm)
//            = atan2Mdeg(-375, 1250) = 343_400 mdeg
//   signed delta from camYaw=0 (wrap to (-180_000,180_000]): -16_600 mdeg
//   dx1Px = round(-16_600 / 220) = -75  (-> camYaw becomes 343_500 mdeg,
//     100 mdeg of quantization error off the exact bearing -- comfortably
//     inside the interactable's +/-30_000 mdeg arc half-width)
// The corrective look re-derives the bearing from the player's ACTUAL
// resting position after the KeyW hold, not the straight spawn->door line
// -- walking at a ~16.5deg angle for N=9 ticks against a still-closed door
// (see the KeyW-duration derivation below) leaves the player short of and
// off to the side of the door, at (4871, 2139) (found the same way as the
// duration below: replaying the real compiled setup()/moveCircle):
//   bearing2 = atan2Mdeg(door0.xMm - 4871, door0.zMm - 2139)
//            = atan2Mdeg(129, 486) = 14_800 mdeg
//   signed delta from camYaw=343_500 (after look1): +31_300 mdeg -- already
//   OUTSIDE the interactable's +/-30_000 mdeg arc half-width, confirmed by
//   an actual run: the interact command WAS submitted (proving the reticle
//   raycast/click plumbing works) but the sim rejected it with
//   interact-denied{reason:"out-of-arc"} at this delta. This is *why* the
//   spec calls for a corrective look at all -- walking closes most of the
//   distance but changes the required facing enough to need re-aiming:
//   dx2Px = round(31_300 / 220) = 142  (-> camYaw becomes 14_740 mdeg, 60
//     mdeg off the exact bearing, comfortably inside the arc)
//
// Distance spawn->door0 is ~1305mm, already inside the door's
// interactable.radiusMm=1500mm from a dead stop, so the KeyW hold is not
// load-bearing for reaching interact range -- it is included because the
// spec's script always walks up to the door.
//
// KeyW hold duration was ALSO derived, not copied from the spec's example
// verbatim, because a naive 1000ms hold overshoots badly here: moveSystem
// resolves X and Z axis-separated per tick (space.moveCircle, X first), so
// while the door is still closed the player's Z progress stops dead at the
// wall (~7 ticks in) but X keeps drifting every tick for as long as KeyW is
// held (the open lobby never blocks X alone) -- a throwaway script that
// replayed faceCommand(343_500) + N ticks of moveCommand(1000,0) through
// the real compiled setup()/moveCircle for N=2..20 found:
//   N=9  -> pos (4871, 2139)   -- inside the doorway's x-span [4500,5500]
//   N=20 -> pos (4255, 2139)   -- OUTSIDE the x-span (west of 4500):
//     this is exactly what an unmodified 1000ms hold produces, and exactly
//     why the first working version of this scenario had the click's
//     reticle raycast miss the door entirely (recorded 0 interact
//     commands) even though the player was well within the interactable's
//     radiusMm=1500 the whole time -- proximity was never the problem,
//     aim was. N=9 leaves comfortable margin on both sides of the span, so
//     KeyW is held ~450ms (9 ticks at the sim's 20Hz) here: downMs=400,
//     upMs=850.
import { setup } from "../apps/hotel/dist-game/game.js";

// NOTE on "player ended up through the doorway" (docs/PHASE-H0.md exit
// criterion 1's optional extra assertion): deliberately NOT added.
// Distance spawn->door0 is ~1305mm, inside the interactable's 1500mm
// radius from a dead stop, so the click can legitimately open the door
// before -- or shortly after -- the player has physically crossed the
// 1000mm-wide opening; whether the replayed command log shows the player
// on the far side by tick 60 depends on exactly which wall-clock ticks the
// scripted KeyW hold landed on in a given browser/engine run (risk 4 in
// docs/PHASE-H0.md: "wall-clock pointer scheduling ... flaky gate"). A
// room-membership assertion here would either be so loose it asserts
// nothing, or occasionally flake on a passing run for reasons unrelated to
// the defect this gate exists to catch (cross-engine trig determinism).
// The two assertions below are what the exit criterion actually requires:
// the door flipped in sim state, backed by a sim event.
const SEED = "hotel-h0-look-1";

export default {
  name: "fps-look-interact",
  seed: SEED,
  ticks: 60,
  setup,
  assertions: [
    {
      description: "some entity's door component has open === true (the flip happened in sim state)",
      check: (s) => {
        for (const e of s.entities()) {
          const door = s.getComponent(e, "door");
          if (door && door.open === true) return true;
        }
        return false;
      },
    },
    {
      description: 'a "door" event with open: true was emitted (not just scenery)',
      check: (s) => s.eventsSince(0).some((e) => e.type === "door" && e.payload && e.payload.open === true),
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    input: [
      { pointer: "lock", atMs: 100 },
      { pointer: "look", atMs: 300, dx: -75, dy: 0 }, // turn toward the lobby door (see derivation above)
      { key: "KeyW", downMs: 400, upMs: 850 }, // ~9 ticks: stops inside the doorway's x-span, see derivation above
      { pointer: "look", atMs: 1500, dx: 142, dy: 0 }, // corrective look, re-aims onto the door (derivation above)
      { pointer: "click", atMs: 1800 },
    ],
    screenshotAtTicks: [5, 50],
    probes: [{ probe: "fps" }, { probe: "sim-tick-ms" }],
    timeoutMs: 20000,
  },
  feelTargets: {
    "fps.avg": { min: 5 },
    "simTickMs.avgMs": { max: 10 },
  },
};
