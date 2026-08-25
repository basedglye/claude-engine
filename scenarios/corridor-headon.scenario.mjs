// Phase H1a exit gate 1, "corridor-headon" (docs/PHASE-H1.md, "Exit
// criteria"). Two head-on navAgent pairs, on the two axes, with swapped
// starts and goals, driven by the same compiled sim module the browser
// hotel app runs (apps/hotel/dist-game/sim/game.js).
//
// WHAT MAKES THIS GATE NON-VACUOUS (H0 review round 1's "a gate must be
// provably non-vacuous" item). A head-on scenario proves nothing if the
// two agents never actually want the same cell at the same time. The
// first version of the fixture did exactly that: with per-agent
// `jitterSeed`s the two agents saw different A* cost fields, picked
// different lanes across the open lobby, and sailed past each other --
// zero contention, and the gate would have gone green on a sim with the
// yield rule deleted. The fixture now gives both members of a pair ONE
// shared `jitterSeed`, so they see one identical cost field and the
// cheapest route from A to B is the reverse of the cheapest route from B
// to A. Contention is structural, and assertion 4 below proves it fired
// by requiring a `nav.yield` event (emitted by `moveSystem` exactly when
// the yield rule blocks an agent) naming two fixture agents.
//
// DERIVATION. A throwaway node script (scratchpad, outside the repo)
// imported the built packages/interiors dist and printed
// generateGroundFloor("hotel-h1-headon-1"), then imported
// apps/hotel/dist-game/sim/game.js, ran `setupWithConfig(sim, { fixture:
// "headon" })` for 300 ticks and printed, per tick and per agent, the
// entity id, cell, goal cell, path index and `stuckTicks`, plus the whole
// event log. Key derived facts for seed "hotel-h1-headon-1":
//   - grid 48x41; lobby rows cz 7..16; the desk's FURNITURE row is cz 12
//     and the queue row is cz 10 (cells cx 2..9); the lobby spawn cell is
//     (24,12).
//   - the fixture spawns exactly four navAgents, entity ids 15..18 (the
//     player is 1, the six doors 2..7, the four rooms 8..11, the terminal
//     12, the hotel singleton 13, the navSchedule singleton 14):
//       15 start (2,10)  goal (9,10)   pair 1, X axis, lower id at the WEST end
//       16 start (9,10)  goal (2,10)
//       17 start (24,15) goal (24,9)   pair 2, Z axis, lower id at the SOUTH end
//       18 start (24,9)  goal (24,15)     (the mirror: id/direction flipped)
//   - both pairs resolve and every agent lands exactly on its goal cell:
//     arrival ticks 15@18, 16@18, 17@16, 18@14 -- all <= 200, with plenty
//     of the 300-tick budget left over as headroom.
//   - the event log for the run is exactly {"nav.yield": 2} -- two yields
//     (entity 18 blocked by 17 at cell (24,12), ticks 6 and 7) and ZERO
//     `nav.stuck`.
//   - per-tick cell printout confirming real contention rather than a
//     wide-corridor fly-by: pair 1 shares 8 of its cells between the two
//     agents, and at tick 9 agent 15's next path cell was (5,9) -- agent
//     16's cell that tick -- while agent 16's next path cell was (6,9),
//     agent 15's cell. Pair 2 shares 5 cells and both agents targeted
//     (24,12) at ticks 6-7, which is the yield the event log records.
import { setupWithConfig, DEFAULTS, cellOfMm } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";

const SEED = "hotel-h1-headon-1";
const TICKS = 300;
/** Spec: "both arrived by tick <= 200". */
const ARRIVE_BY_TICK = 200;

/** The four fixture agents and their committed goal cells -- all derived,
 *  see the header. */
const AGENTS = [
  { entity: 15, pair: 1, goalCx: 9, goalCz: 10 },
  { entity: 16, pair: 1, goalCx: 2, goalCz: 10 },
  { entity: 17, pair: 2, goalCx: 24, goalCz: 9 },
  { entity: 18, pair: 2, goalCx: 24, goalCz: 15 },
];
const AGENT_IDS = new Set(AGENTS.map((a) => a.entity));

// Pure function of the seed alone -- the same call setup() makes
// internally, safe to re-derive here for the scenario's own cell math (H0
// determinism rule 5).
const grid = generateGroundFloor(SEED).grid;

/**
 * Scenario-local observation, written into a SIM COMPONENT rather than a
 * module-level array. `walk-collide`'s `tickPositions` closure is
 * explicitly not to be propagated (H0 review: "keep it out of any pattern
 * documentation"), and assertions here must read the Sim. A component is
 * re-derived identically by `--verify-replay`'s fresh setup + replay, so
 * it costs nothing in determinism and everything the assertions need is
 * recoverable from the final state plus the event log.
 *
 * `headonLog` records the agent's tick-1 cell (its start) and the tick it
 * first stood on its goal cell.
 */
function setupHeadon(sim) {
  setupWithConfig(sim, { ...DEFAULTS, fixture: "headon" });
  sim.addSystem((s) => {
    for (const [entity, agent] of s.withComponent("navAgent")) {
      const pos = s.getComponent(entity, "pos");
      if (!pos) continue;
      const cell = cellOfMm(grid, pos.xMm, pos.zMm);
      const prev = s.getComponent(entity, "headonLog");
      if (!prev) {
        s.setComponent(entity, "headonLog", { startCx: cell.cx, startCz: cell.cz, arrivedTick: 0 });
        continue;
      }
      if (prev.arrivedTick !== 0) continue;
      if (cell.cx === agent.goalCx && cell.cz === agent.goalCz) {
        s.setComponent(entity, "headonLog", { ...prev, arrivedTick: s.tick });
      }
    }
  });
}

export default {
  name: "corridor-headon",
  seed: SEED,
  ticks: TICKS,
  setup: setupHeadon,
  assertions: [
    {
      description:
        "all four fixture agents exist and each one's final pos is inside its own (committed) goal cell",
      check: (s) =>
        AGENTS.every(({ entity, goalCx, goalCz }) => {
          const pos = s.getComponent(entity, "pos");
          const agent = s.getComponent(entity, "navAgent");
          if (!pos || !agent) return false;
          if (agent.goalCx !== goalCx || agent.goalCz !== goalCz) return false;
          const cell = cellOfMm(grid, pos.xMm, pos.zMm);
          return cell.cx === goalCx && cell.cz === goalCz;
        }),
    },
    {
      description: `both pairs resolved: every agent reached its goal cell by tick <= ${ARRIVE_BY_TICK}`,
      check: (s) =>
        AGENTS.every(({ entity }) => {
          const log = s.getComponent(entity, "headonLog");
          return log !== undefined && log.arrivedTick > 0 && log.arrivedTick <= ARRIVE_BY_TICK;
        }),
    },
    {
      description: "zero nav.stuck events",
      check: (s) => s.eventsSince(0).every((e) => e.type !== "nav.stuck"),
    },
    {
      description:
        "the conflict was real: the yield rule fired (a nav.yield event between two fixture agents)",
      check: (s) =>
        s
          .eventsSince(0)
          .some(
            (e) =>
              e.type === "nav.yield" &&
              AGENT_IDS.has(e.payload.entity) &&
              AGENT_IDS.has(e.payload.blockedBy)
          ),
    },
    {
      description:
        "each pair is genuinely head-on: members start on each other's goal cell and share one jitterSeed (so they want the same lane), and the two pairs run on different axes",
      check: (s) => {
        for (const pair of [1, 2]) {
          const members = AGENTS.filter((a) => a.pair === pair).map((a) => ({
            log: s.getComponent(a.entity, "headonLog"),
            agent: s.getComponent(a.entity, "navAgent"),
          }));
          if (members.length !== 2) return false;
          const [a, b] = members;
          if (!a.log || !b.log || !a.agent || !b.agent) return false;
          if (a.agent.jitterSeed !== b.agent.jitterSeed) return false;
          if (a.log.startCx !== b.agent.goalCx || a.log.startCz !== b.agent.goalCz) return false;
          if (b.log.startCx !== a.agent.goalCx || b.log.startCz !== a.agent.goalCz) return false;
        }
        const p1 = AGENTS.filter((a) => a.pair === 1);
        const p2 = AGENTS.filter((a) => a.pair === 2);
        const p1AlongX = p1[0].goalCz === p1[1].goalCz && p1[0].goalCx !== p1[1].goalCx;
        const p2AlongZ = p2[0].goalCx === p2[1].goalCx && p2[0].goalCz !== p2[1].goalCz;
        return p1AlongX && p2AlongZ;
      },
    },
  ],
};
