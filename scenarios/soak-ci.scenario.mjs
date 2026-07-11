// Soak scenario (docs/PHASE-3.md Scope F): 10 bots, 10s — cheap enough to
// run in CI as a required step, still real load (real WebSockets, real
// server, real per-tick validation).
import { createBot, randomWalk } from "../packages/bots/dist/index.js";
import { setup, moveRule } from "./lib/net-game.mjs";

export default {
  name: "soak-ci",
  seed: "claude-engine-soak-ci-1",
  ticks: 0,
  setup,
  assertions: [],
  net: {
    commands: { move: moveRule },
  },
  soak: {
    clients: 10,
    durationMs: 10_000,
    bot: (i) =>
      createBot({
        actor: `soak-ci-client-${i}`,
        seed: `soak-ci-bot-${i}`,
        behavior: randomWalk({ commandType: "move", payloadFor: (dx, dz) => ({ dx, dz }), every: 2 }),
      }),
  },
  soakTargets: {
    "clients.connected": { min: 10 },
    "clients.disconnected": { max: 0 },
    "server.tickP95Ms": { max: 50 }, // the full 20Hz tick budget
  },
};
