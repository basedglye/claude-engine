// Soak scenario (docs/PHASE-3.md Scope F): 50 bots, 60s — the local/
// exit-criterion load test. Not wired into CI (soak-ci covers the required
// step); run manually with:
//   npm run harness --silent -- soak-50 --soak
import { createBot, randomWalk } from "../packages/bots/dist/index.js";
import { setup, moveRule } from "./lib/net-game.mjs";

export default {
  name: "soak-50",
  seed: "claude-engine-soak-50-1",
  ticks: 0,
  setup,
  assertions: [],
  net: {
    commands: { move: moveRule },
  },
  soak: {
    clients: 50,
    durationMs: 60_000,
    bot: (i) =>
      createBot({
        actor: `soak-50-client-${i}`,
        seed: `soak-50-bot-${i}`,
        behavior: randomWalk({ commandType: "move", payloadFor: (dx, dz) => ({ dx, dz }), every: 2 }),
      }),
  },
  soakTargets: {
    "clients.connected": { min: 50 },
    "clients.disconnected": { max: 0 },
    "server.tickP95Ms": { max: 50 }, // the full 20Hz tick budget
  },
};
