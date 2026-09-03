// Phase H0 exit criterion 1 ("fps-look-interact", docs/PHASE-H0.md) — the
// cross-engine determinism gate. Drives real pointer-lock look + WASD +
// click input against the live @claude-engine/hotel browser app via the
// harness's browser mode (packages/harness/src/browser.ts), then verifies
// the captured command log replays headlessly to the same final state
// (--verify-replay). `setup` is imported from apps/hotel/dist-game/sim/game.js
// -- the exact compiled module the browser bundles (docs/PHASE-H0.md, "The
// synthetic-input contract").
//
// --- Cycle 3 re-derivation (lobby deepened 9-12 -> 20-24 cells) -----------
// The interiors golden was re-pinned (packages/interiors/scripts/test.mjs)
// after packages/interiors/src/layout.ts's lobbyDepth changed; this is NOT
// a pure translation this time (lobbyDepth's own range moved, and spawn/
// door0 sit at different fractions of a much deeper room), so the old
// pointer-delta literals below were re-derived from scratch, not reused.
// apps/hotel/scripts/derive-walk.mjs (new this cycle) computed and PROVED
// this by replaying the exact script into a fresh Sim built from the
// CURRENT compiled setup()/generateGroundFloor:
//   node apps/hotel/scripts/derive-walk.mjs hotel-h0-look-1 corridor-door
//   spawn pose: (5375, 4375, yaw 0); door0 (doorIndex 0, lobby<->corridor):
//     bearing1 = atan2Mdeg(door0.x-5375, door0.z-4375) = 351_500 mdeg
//     dx1Px = round(angleDeltaMdeg(351_500, 0)/220) = -39
//   KeyW held (moveCommand forwardMilli=1000) at camYaw=351_420 (0 + -39*220,
//   wrapped): the script probes hold durations 1..20 ticks through the real
//   compiled sim.
//
// --- C3-W1b re-derivation (selection rule change, not a geometry change) --
// The C3-W1 pick above (N=6, 1333mm from a 1500mm radius -- 167mm of
// margin) was reviewed in docs/alpha-loop/reviews/C3-W1.md item W1-2: it is
// the FIRST hold that clears the interact radius, which is by construction
// the marginal one, and 167mm is under this lane's 200mm floor. derive-walk.mjs
// was changed to select from the contiguous band of accepted holds (here
// N=6..20) the one closest to the band's middle among candidates with
// >=200mm of margin, rather than the first. Re-running the SAME command
// above under the new rule:
//   band N=[6..20], mid=13 -> chose N=13, landing at (4998, 6345), 530mm
//   from door0 (970mm margin, comfortably clear of the 1500mm radius).
//     bearing2 = atan2Mdeg(door0.x-4998, door0.z-6345) = 200 mdeg
//     dx2Px = round(angleDeltaMdeg(200, 351_420)/220) = 40 -> camYaw 220
//   PROOF: replaying face(351_420)+move(1000,0) for ticks 1..13, then
//   face(220) and interact(doorEntity) at tick 14, into a FRESH Sim
//   produced event {tick:14, type:"door", payload:{doorIndex:0,
//   open:true}} -- the click's raycast/interact resolves onto door0 and
//   the sim accepts it (in-arc, in-range), exactly like the pointer-lock
//   version below is expected to when the harness replays its own capture.
//
// KeyW is held for exactly ticks 1..13 walltime->tick-gated (downAtTick:0,
// upAtTick:13, matching the derived N=13 above). Everything else about the
// tick-gating rationale (docs/PHASE-H0.md risk 4, the "Determinism fix"
// note) is unchanged and not repeated here.
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
    // the KeyW hold span exactly ticks 1..13 on every run.
    input: [
      { pointer: "lock", atTick: 0 },
      { pointer: "look", atTick: 0, dx: -39, dy: 0 }, // turn toward the lobby door (derive-walk.mjs, see header)
      { key: "KeyW", downAtTick: 0, upAtTick: 13 }, // exactly 13 move ticks: derived rest position is 970mm inside interact range/arc
      { pointer: "look", atTick: 13, dx: 40, dy: 0 }, // corrective look (derivation above)
      { pointer: "click", atTick: 13 },
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
