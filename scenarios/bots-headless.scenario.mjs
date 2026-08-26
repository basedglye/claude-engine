// Bot-driven scenario (docs/PHASE-3.md Scope E): a single wandering bot
// moves an entity every tick. Proves bots are deterministic, headless
// harness citizens — the verdict's replay.commands records the bot's
// emitted commands, so --verify-replay / --replay work without bot code.
import { createBot, randomWalk } from "../packages/bots/dist/index.js";

function setup(sim) {
  const entities = new Map();
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      let entity = entities.get(c.actor);
      if (entity === undefined) {
        entity = s.spawn();
        s.setComponent(entity, "pos", { x: 0, z: 0 });
        entities.set(c.actor, entity);
      }
      const pos = s.getComponent(entity, "pos");
      // Write-through, never in-place (Sim.stateHash()'s Phase-H2 contract).
      const next = { x: pos.x + c.payload.dx, z: pos.z + c.payload.dz };
      s.setComponent(entity, "pos", next);
      s.emit("moved", { actor: c.actor, x: next.x, z: next.z });
    }
  });
}

const wanderer = createBot({
  actor: "bot:wanderer",
  seed: "bots-headless-wanderer",
  behavior: randomWalk({
    commandType: "move",
    payloadFor: (dx, dz) => ({ dx, dz }),
    every: 1,
  }),
});

export default {
  name: "bots-headless",
  seed: "claude-engine-bots-headless-1",
  ticks: 50,
  setup,
  bots: [wanderer],
  assertions: [
    {
      description: "bot moved its entity away from the origin",
      check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos !== undefined && (pos.x !== 0 || pos.z !== 0);
      },
    },
    {
      description: "movement events were emitted",
      check: (s) => s.eventsSince(0).some((e) => e.type === "moved"),
    },
  ],
};
