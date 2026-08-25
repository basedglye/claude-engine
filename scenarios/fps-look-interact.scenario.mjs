// Phase H0 exit criterion 1 ("fps-look-interact", docs/PHASE-H0.md) — the
// cross-engine determinism gate. Drives real pointer-lock look + WASD +
// click input against the live @claude-engine/hotel browser app via the
// harness's browser mode (packages/harness/src/browser.ts), then verifies
// the captured command log replays headlessly to the same final state
// (--verify-replay). `setup` is imported from apps/hotel/dist-game/sim/game.js
// -- the exact compiled module the browser bundles (docs/PHASE-H0.md, "The
// synthetic-input contract").
//
// --- Determinism fix (phase-H0 review item 1, BLOCKING) -------------------
// The original version of this scenario scheduled every input step on
// wall-clock atMs offsets, including the KeyW hold (downMs:400, upMs:850).
// Real scheduling jitter (page.waitForTimeout, event-loop scheduling, CI
// machine speed) meant that window landed on 8 OR 9 sim ticks depending on
// timing, but the corrective look below was derived for the 9-tick rest
// position only -- on an 8-tick run the reticle ends up off the door panel
// and the click's raycast resolves nothing (reviewer repro: 1 of 6 runs,
// zero interact commands captured). Per docs/PHASE-H0.md risk 4's own
// stated mitigation ("if flake persists, gate the click step on world.tick
// instead of wall clock"), every input step below now uses the harness's
// tick-gated InputStep form (packages/harness/src/browser.ts) instead of
// atMs: each step waits for window.__WORLDFORGE__.world.tick to reach a
// declared tick (the same pollUntilTick polling the harness already uses
// for screenshot capture) before firing. The KeyW hold itself is also
// tick-gated (downAtTick/upAtTick) rather than wall-clock timed, which
// removes the 8-vs-9-tick variance at its source instead of merely coping
// with whichever count wall-clock scheduling happens to produce: the hold
// now spans deterministically exactly ticks 1..9 on every run, on every
// engine. Because that is exactly the N=9 rest position the corrective
// look below was already derived for, the derived deltas themselves did
// not need to change -- only how the hold is scheduled.
//
// --- Pointer-delta derivation (committed as literals, not guessed) --------
// RE-DERIVED for Phase H1a (docs/PHASE-H1.md): the interiors generator now
// adds a street strip north of the lobby (desk/queue/entrance-door), which
// shifts every lobby/corridor coordinate south by a constant offset -- the
// comment below previously cited the PRE-H1 numbers and had gone stale
// even though (by luck: the shift is a pure Z-translation, so bearings and
// the resulting look-deltas are unchanged) the scenario still passed. A
// throwaway node script (apps/hotel, importing the built
// @claude-engine/interiors + @claude-engine/space + the compiled
// dist-game/sim/game.js) printed generateGroundFloor("hotel-h0-look-1")'s
// CURRENT spawn and doors[0] (the lobby<->corridor doorway; still
// doorIndex 0 -- door generation order is unchanged, the entrance door is
// appended last -- roomA=1=lobby):
//   spawn = { xMm: 5375, zMm: 2875, yawMdeg: 0 }
//   door0 = { xMm: 5000, zMm: 4125, roomA: 1 (lobby), roomB: 2 (corridor) }
//
// createFpsController (packages/player-fps/src/index.ts) initializes its
// free-look camYawMdeg to the sim's spawn yaw (0) on the first onTick, then
// applyLook adds `dxPx * mouseSensitivityMdegPerPx` (default 220 mdeg/px)
// to camYawMdeg per look step -- the exact function real mousemove and
// synthetic `pointer:"look"` steps both call (the synthetic-input contract).
// At yaw 0 the sim's forward direction is +Z, and bearing is computed the
// same way the sim's interactSystem computes it: atan2Mdeg(dx, dz) where
// dx/dz are (target - player). So, with the RE-DERIVED (current) spawn/door0:
//   bearing1 = atan2Mdeg(door0.xMm - spawn.xMm, door0.zMm - spawn.zMm)
//            = atan2Mdeg(-375, 1250) = 343_400 mdeg
//   signed delta from camYaw=0 (wrap to (-180_000,180_000]): -16_600 mdeg
//   dx1Px = round(-16_600 / 220) = -75  (-> camYaw becomes 343_500 mdeg,
//     100 mdeg of quantization error off the exact bearing -- comfortably
//     inside the interactable's +/-30_000 mdeg arc half-width)
// The street strip's addition shifted spawn and door0 by an IDENTICAL
// (dx=0, dz=+1500) offset -- lobby geometry translated wholesale, not
// reshaped -- so this bearing, and every delta derived from it below, come
// out byte-identical to the pre-H1 numbers. That is a property of this
// particular seed/generator change, not something to assume holds for a
// future layout change; re-derive again if the generator moves the lobby
// relative to itself (not just translates the whole floor).
// The corrective look re-derives the bearing from the player's ACTUAL
// resting position after the KeyW hold, not the straight spawn->door line
// -- walking at a ~16.5deg angle for N=9 ticks against a still-closed door
// (see the KeyW-duration derivation below) leaves the player short of and
// off to the side of the door, at (4871, 3639) (found the same way as the
// duration below: replaying the real compiled setup()/moveCircle):
//   bearing2 = atan2Mdeg(door0.xMm - 4871, door0.zMm - 3639)
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
//     KeyW is held for exactly 9 sim ticks here, gated on tick number
//     (downAtTick:0, upAtTick:9, not wall-clock) so the count is exact on
//     every run rather than landing on 8 or 9 depending on scheduling --
//     see "Determinism fix" above.
import { setup } from "../apps/hotel/dist-game/sim/game.js";

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
// The click targets door0 -- doorIndex 0, the lobby<->corridor doorway
// this whole file's derivation walks/aims the player toward. Pinning the
// assertions to THIS doorIndex (rather than "some door") matters as of
// H1a: the generator now creates six doors on this seed (H0 had one), so
// "some entity's door component has open===true" is true at setup-adjacent
// ticks for reasons that have nothing to do with the click under test --
// exactly the vacuous-gate failure mode the H0 review round blocked on.
const CLICKED_DOOR_INDEX = 0;

export default {
  name: "fps-look-interact",
  seed: SEED,
  ticks: 60,
  setup,
  assertions: [
    {
      description: `doorIndex ${CLICKED_DOOR_INDEX} (the lobby<->corridor door this scenario's click targets) has open === true -- the flip happened in sim state, on the SPECIFIC door under test`,
      check: (s) => {
        for (const e of s.entities()) {
          const door = s.getComponent(e, "door");
          if (door && door.doorIndex === CLICKED_DOOR_INDEX) return door.open === true;
        }
        return false; // the door entity itself must exist
      },
    },
    {
      description: `a "door" event with { doorIndex: ${CLICKED_DOOR_INDEX}, open: true } was emitted (not just scenery, and not some OTHER door)`,
      check: (s) =>
        s
          .eventsSince(0)
          .some(
            (e) => e.type === "door" && e.payload && e.payload.doorIndex === CLICKED_DOOR_INDEX && e.payload.open === true,
          ),
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    // Tick-gated input (see "Determinism fix" above): each step waits for
    // window.__WORLDFORGE__.world.tick to reach the declared tick, in this
    // declaration order, instead of a wall-clock atMs offset. This makes
    // the KeyW hold span exactly ticks 1..9 on every run.
    input: [
      { pointer: "lock", atTick: 0 },
      { pointer: "look", atTick: 0, dx: -75, dy: 0 }, // turn toward the lobby door (see derivation above)
      { key: "KeyW", downAtTick: 0, upAtTick: 9 }, // exactly 9 move ticks: stops inside the doorway's x-span
      { pointer: "look", atTick: 9, dx: 142, dy: 0 }, // corrective look, re-aims onto the door (derivation above)
      { pointer: "click", atTick: 9 },
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
