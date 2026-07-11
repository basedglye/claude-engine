// Soak scenario (docs/PHASE-3.md Scope F): two clients connect over real
// WebSockets and wander; proves both connect, nothing gets rejected, and
// each replicates the other (default allEntities() interest).
import { createBot, randomWalk } from "../packages/bots/dist/index.js";
import { setup, moveRule } from "./lib/net-game.mjs";

export default {
  name: "net-walk",
  seed: "claude-engine-net-walk-1",
  ticks: 0, // soak mode drives its own ticking via the server's timer
  setup,
  assertions: [],
  net: {
    commands: { move: moveRule },
  },
  soak: {
    clients: 2,
    durationMs: 3000,
    bot: (i) =>
      createBot({
        actor: `net-walk-client-${i}`,
        seed: `net-walk-bot-${i}`,
        behavior: randomWalk({ commandType: "move", payloadFor: (dx, dz) => ({ dx, dz }), every: 1 }),
      }),
  },
  soakTargets: {
    "clients.connected": { min: 2 },
    "server.commandsRejected": { max: 0 },
    "clients.avgReplicatedEntities": { min: 2 },
  },
};
