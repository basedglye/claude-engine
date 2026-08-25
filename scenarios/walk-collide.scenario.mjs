// Phase H0 exit criterion 2 ("walk-collide", docs/PHASE-H0.md). Runs the
// exact same compiled module the browser hotel app uses (apps/hotel/src/
// game.ts -> apps/hotel/dist-game/game.js via `npm run build:game -w
// @claude-engine/hotel`), headless, proving collision/sliding logic is
// agent-verifiable without a browser.
//
// Coordinates below were derived, not guessed: a throwaway node script (run
// from the scratchpad dir, outside this repo) first imported the built
// packages/interiors dist and printed generateGroundFloor("hotel-h0-walk-1")
// for this scenario's seed, then imported apps/hotel/dist-game/game.js and
// simulated candidate command sequences against a real Sim, printing
// position/cell/solid-flag every tick until the ram/slide/walk segments
// below produced the intended behaviour. Key derived facts for seed
// "hotel-h0-walk-1":
//   - spawn: { xMm: 5875, zMm: 1625, yawMdeg: 0 }.
//   - the lobby's west wall (a column of SOLID cells) sits at cx=0; a
//     player of collider radiusMm=300 walking due west (yaw 270000) from
//     spawn comes to rest pinned at xMm=675 by roughly tick 28 and stays
//     there under continued westward pressure -- verified xMm===675 for
//     every tick in [30,69] (the wall-ram segment).
//   - continuing to submit forwardMilli=1000 (still pinned against the
//     wall) together with strafeMilli=1000 sends dz through unblocked
//     while dx stays blocked at 0 -- axis-separated wall-slide, verified by
//     the same script.
//   - backing off (forwardMilli=-1000) and walking east re-traverses the
//     lobby toward its east side; verified never to enter a SOLID cell for
//     the whole 200-tick run, ending at { xMm: 10875, zMm: 2625 }, cell
//     { cx: 43, cz: 10 } (not SOLID), 5099mm from the tick-1 position.
//   - separately verified (and NOT used by this scenario -- reported in the
//     phase implementation notes instead): with PLAYER_RADIUS_MM=300 and
//     CELL_SIZE_MM=250, this seed's single-cell-wide doors (250mm cell,
//     less than the player's 600mm diameter) are mathematically
//     impassable via space.moveCircle even once door.open===true. This
//     scenario therefore demonstrates wall-ram/slide/open-lobby travel
//     rather than a literal doorway crossing; see the phase report for
//     details (a packages/space + packages/interiors interaction issue,
//     out of this scope's packages/** boundary, not patched here).
import { setup, cellAt, cellOfMm, CELL, PLAYER_ENTITY, faceCommand, moveCommand } from "../apps/hotel/dist-game/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";

const commands = [
  faceCommand(1, 270_000), // face due west
  ...Array.from({ length: 69 }, (_, i) => moveCommand(i + 2, 1000, 0)), // ticks 2..70: ram the west wall head-on
  ...Array.from({ length: 40 }, (_, i) => moveCommand(i + 71, 1000, 1000)), // ticks 71..110: slide south along the wall
  ...Array.from({ length: 90 }, (_, i) => moveCommand(i + 111, -1000, 0)), // ticks 111..200: back off and walk east across the lobby
];

// The wall-ram segment used for assertion (c): ticks 30..69 inclusive are
// fully inside the blocked stretch (derivation script confirmed xMm===675,
// unchanged, for every tick in this range).
const RAM_SEGMENT_START_TICK = 30;
const RAM_SEGMENT_END_TICK = 69;

// Pure function of the seed alone (same call game.ts's setup() makes
// internally) -- safe to re-derive here for the scenario's own assertions
// and recording system, per docs/PHASE-H0.md determinism rule 5.
const grid = generateGroundFloor("hotel-h0-walk-1").grid;

// Recorded by the extra setup's per-tick system below; read by assertions
// after the run. This is scenario-local instrumentation (never part of
// apps/hotel/src/game.ts), so it may hold plain per-tick history the sim
// itself must not.
const tickPositions = [];

/** Wraps the game's setup() with one extra recording system (per
 *  docs/PHASE-H0.md exit criterion 2(b)): emits a `stuck-in-wall` event any
 *  tick the player's current cell has the SOLID bit set, and records every
 *  tick's position for this scenario's own assertions. */
function setupWithRecording(sim) {
  setup(sim);
  sim.addSystem((s) => {
    const pos = s.getComponent(PLAYER_ENTITY, "pos");
    if (!pos) return;
    tickPositions.push({ tick: s.tick, xMm: pos.xMm, zMm: pos.zMm });
    const cell = cellOfMm(grid, pos.xMm, pos.zMm);
    const cellValue = cellAt(grid, cell.cx, cell.cz);
    if (cellValue & CELL.SOLID) {
      s.emit("stuck-in-wall", { xMm: pos.xMm, zMm: pos.zMm, cx: cell.cx, cz: cell.cz });
    }
  });
}

export default {
  name: "walk-collide",
  seed: "hotel-h0-walk-1",
  ticks: 200,
  setup: setupWithRecording,
  commands,
  assertions: [
    {
      description: "noStuckAgents: final pos differs from tick-1 pos and total displacement >= 5000mm",
      check: (s) => {
        const tick1 = tickPositions.find((p) => p.tick === 1);
        const final = s.getComponent(PLAYER_ENTITY, "pos");
        const dx = final.xMm - tick1.xMm;
        const dz = final.zMm - tick1.zMm;
        const displacementMm = Math.sqrt(dx * dx + dz * dz);
        const differs = final.xMm !== tick1.xMm || final.zMm !== tick1.zMm;
        return differs && displacementMm >= 5000;
      },
    },
    {
      description: "final position's cell has no SOLID bit set",
      check: (s) => {
        const final = s.getComponent(PLAYER_ENTITY, "pos");
        const cell = cellOfMm(grid, final.xMm, final.zMm);
        const cellValue = cellAt(grid, cell.cx, cell.cz);
        return (cellValue & CELL.SOLID) === 0;
      },
    },
    {
      description: "no stuck-in-wall event was ever emitted (per-tick SOLID-cell recording system)",
      check: (s) => s.eventsSince(0).every((e) => e.type !== "stuck-in-wall"),
    },
    {
      description: "the wall-ram segment (ticks 30..69) moved the player 0mm on the blocked (x) axis",
      check: () => {
        const segment = tickPositions.filter(
          (p) => p.tick >= RAM_SEGMENT_START_TICK && p.tick <= RAM_SEGMENT_END_TICK
        );
        return segment.length === RAM_SEGMENT_END_TICK - RAM_SEGMENT_START_TICK + 1 &&
          segment.every((p) => p.xMm === segment[0].xMm);
      },
    },
  ],
};
