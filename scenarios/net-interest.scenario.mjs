// Soak scenario (docs/PHASE-3.md Scope F): radiusInterest with far-flung
// static landmarks in the world; proves interest management measurably
// filters — each client's replicated entity count stays well below the
// server's total entity count.
import { createBot, randomWalk } from "../packages/bots/dist/index.js";
import { setupWithLandmarks, moveRule } from "./lib/net-game.mjs";
import { radiusInterest } from "../packages/server/dist/index.js";

const LANDMARK_COUNT = 40;
const LANDMARK_SPREAD = 500; // world units — far outside the interest radius below
const INTEREST_RADIUS = 20;

export default {
  name: "net-interest",
  seed: "claude-engine-net-interest-1",
  ticks: 0,
  setup: (sim) => setupWithLandmarks(sim, LANDMARK_COUNT, LANDMARK_SPREAD),
  assertions: [],
  net: {
    commands: { move: moveRule },
    interest: radiusInterest({ positionComponent: "pos", ownerComponent: "owner", radius: INTEREST_RADIUS }),
  },
  soak: {
    clients: 2,
    durationMs: 3000,
    bot: (i) =>
      createBot({
        actor: `net-interest-client-${i}`,
        seed: `net-interest-bot-${i}`,
        behavior: randomWalk({ commandType: "move", payloadFor: (dx, dz) => ({ dx, dz }), every: 2 }),
      }),
  },
  soakTargets: {
    "clients.connected": { min: 2 },
    // 2 players see each other + themselves (<= ~4 entities within radius);
    // server.entities is landmarks (40) + players (2) = 42 — interest must
    // keep the replicated count far below that.
    "clients.avgReplicatedEntities": { max: 10 },
  },
};
