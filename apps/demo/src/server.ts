/**
 * Demo net server entry (docs/PHASE-3.md Scope G). Runs the exact same
 * setup() the offline demo and demo-walk/demo-visual scenarios use — proof
 * that net mode is the same game, not a fork of it.
 *
 * Uses devAuth() and a permissive move rule: apps/demo has no production
 * build (the standing Phase 2 note), so CLAUDE.md's no-dev-in-prod
 * convention is untriggered here. A real deployment would use ticketAuth
 * (see @claude-engine/server) instead — documented in the skill's
 * references/net-api.md.
 */
import { startGameServer, devAuth, type CommandRule } from "@claude-engine/server";
import { setup } from "./game.js";

const port = Number(process.env.PORT ?? 8787);

const moveRule: CommandRule = {
  validate: (payload: unknown): boolean => {
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as { dx?: unknown; dy?: unknown };
    return typeof p.dx === "number" && typeof p.dy === "number";
  },
  maxPerTick: 4,
  maxPerSecond: 40,
};

const server = await startGameServer({
  seed: "claude-engine-demo-net-1",
  setup,
  auth: devAuth(),
  commands: { move: moveRule },
  port,
});

console.log(`apps/demo net server listening on ws://localhost:${server.port}`);

let lastConnected = 0;
setInterval(() => {
  const { connected } = server.stats();
  if (connected !== lastConnected) {
    console.log(`connected clients: ${connected}`);
    lastConnected = connected;
  }
}, 1000);

process.on("SIGINT", () => {
  void server.stop().then(() => process.exit(0));
});
