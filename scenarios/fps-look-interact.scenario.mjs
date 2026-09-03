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
//   compiled sim and takes the first whose rest position is inside door0's
//   interact range (radiusMm=1500) AND arc (+/-30_000 mdeg) after a
//   corrective look -- that is N=6 ticks, landing at (5201, 5557), 1333mm
//   from door0.
//     bearing2 = atan2Mdeg(door0.x-5201, door0.z-5557) = 351_400 mdeg
//     dx2Px = round(angleDeltaMdeg(351_400, 351_420)/220) = 0 (already
//     aimed correctly after look1 -- the corrective look step is kept in
//     the script, as 0px, because the spec's shape always issues it)
//   PROOF: replaying face(351_420)+move(1000,0) for ticks 1..6, then
//   face(351_420) again and interact(doorEntity) at tick 7, into a FRESH
//   Sim produced event {tick:7, type:"door", payload:{doorIndex:0,
//   open:true}} -- the click's raycast/interact resolves onto door0 and
//   the sim accepts it (in-arc, in-range), exactly like the pointer-lock
//   version below is expected to when the harness replays its own capture.
//
// KeyW is held for exactly ticks 1..9 walltime->tick-gated (downAtTick:0,
// upAtTick:6, matching the derived N=6 above -- shorter than H1a's N=9
// because the deeper lobby puts the player's rest position closer to
// door0's interact range sooner along the same +Z-ish walk). Everything
// else about the tick-gating rationale (docs/PHASE-H0.md risk 4, the
// "Determinism fix" note) is unchanged and not repeated here.
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
      { pointer: "look", atTick: 0, dx: -39, dy: 0 }, // turn toward the lobby door (derive-walk.mjs, see header)
      { key: "KeyW", downAtTick: 0, upAtTick: 6 }, // exactly 6 move ticks: derived rest position is inside interact range/arc
      { pointer: "look", atTick: 6, dx: 0, dy: 0 }, // corrective look: already aimed after look1 (derivation above)
      { pointer: "click", atTick: 6 },
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
