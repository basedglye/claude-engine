// Soak scenario (docs/PHASE-3.md Scope F): one hostile bot cycles through
// unknown command types, invalid payloads, and a flood of valid-shaped
// commands (to trip maxPerTick/maxPerSecond) every tick. Proves the
// boundary holds: rejects are counted by reason and the server's tick loop
// never stalls or lets a bad intent through to the sim.
import { createBot } from "../packages/bots/dist/index.js";
import { setup, moveRule } from "./lib/net-game.mjs";

function hostileBehavior(_world, tick) {
  const phase = tick % 3;
  if (phase === 0) return [{ type: "no-such-command" }];
  if (phase === 1) return [{ type: "move", payload: { dx: "not-a-number", dz: 0 } }];
  // Flood: far more than moveRule's maxPerTick (1) / maxPerSecond (30) in one burst.
  return Array.from({ length: 10 }, () => ({ type: "move", payload: { dx: 1, dz: 0 } }));
}

export default {
  name: "net-abuse",
  seed: "claude-engine-net-abuse-1",
  ticks: 0,
  setup,
  assertions: [],
  net: {
    commands: { move: moveRule },
  },
  soak: {
    clients: 1,
    durationMs: 3000,
    bot: (i) => createBot({ actor: `net-abuse-client-${i}`, seed: `net-abuse-bot-${i}`, behavior: hostileBehavior }),
  },
  soakTargets: {
    "clients.connected": { min: 1 },
    "server.rejectionsByReason.unknown-type": { min: 1 },
    "server.rejectionsByReason.invalid-payload": { min: 1 },
    "server.rejectionsByReason.rate-limited": { min: 1 },
    // ~3000ms @ 20Hz ~= 60 ticks — the hostile traffic must never stall the loop.
    "server.ticks": { min: 50 },
  },
};
