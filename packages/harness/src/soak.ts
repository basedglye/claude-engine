/**
 * Soak mode (docs/PHASE-3.md Scope F) — boots a real GameServer in-process
 * and drives it with real bot clients over real WebSockets. Mirrors the
 * browser-mode pattern (browser.ts): this module is only imported
 * (dynamically) by the CLI when --soak is passed, so headless harness runs
 * never load server/net-web machinery.
 *
 * Determinism note: wall-clock client pumps over real sockets are NOT
 * reproducible by re-running — but the server's authoritative command log
 * (including @net/join/@net/leave) becomes this run's replay bundle, so a
 * soak session is reproducible *headlessly* via --replay, the same bridge
 * browser mode established for the renderer.
 */
import type { Command, GameEvent, IWorld } from "@claude-engine/core";
import { createClientSession, type ClientSession } from "@claude-engine/net";
import { webSocketTransport } from "@claude-engine/net/web";
import type { BotDriver } from "@claude-engine/bots";
import type { Scenario } from "./index.js";

export interface SoakSpec {
  clients: number;
  durationMs: number;
  bot: (clientIndex: number) => BotDriver;
  intentEveryMs?: number; // client pump cadence, default TICK_MS
  timeoutMs?: number; // infra abort (exit 2), default durationMs + 30_000
}

export interface NetSpec {
  commands: Record<string, import("@claude-engine/server").CommandRule>;
  interest?: import("@claude-engine/server").InterestPolicy;
  filterEvent?: (event: GameEvent, actor: string, world: IWorld) => boolean;
}

export interface SoakReport {
  clientCount: number;
  durationMs: number;
  /** Wall-clock + real sockets. Reproduce headlessly via the verdict's
   *  replay bundle (the server's authoritative command log) + --replay. */
  deterministic: false;
  server: {
    ticks: number;
    finalTick: number;
    finalStateHash: number;
    tickP95Ms: number;
    tickMaxMs: number;
    commandsAccepted: number;
    commandsRejected: number;
    rejectionsByReason: Record<string, number>;
    bytesOut: number;
    entities: number;
  };
  clients: {
    connected: number;
    disconnected: number;
    avgRttMs: number;
    avgReplicatedEntities: number;
    corrections: number;
  };
  soakChecks: { target: string; value: number; passed: boolean }[];
}

/** Thrown for infra failures (port/serve/connect/timeout) — CLI maps this to exit 2. */
export class SoakInfraError extends Error {}

export interface SoakRunResult {
  soak: SoakReport;
  commands: readonly Command[];
  eventCount: number;
  entityCount: number;
  passed: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOpen(session: ClientSession, deadline: number): Promise<void> {
  while (session.status === "connecting") {
    if (Date.now() > deadline) {
      throw new SoakInfraError("Timed out waiting for a client session to open");
    }
    await sleep(10);
  }
  if (session.status !== "open") {
    throw new SoakInfraError(`Client session ended up "${session.status}" instead of "open"`);
  }
}

function getPath(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "number" ? cur : undefined;
}

/** repoRoot is unused today (soak boots an in-process server, not a built
 *  app) but kept in the signature for symmetry with runBrowserScenario and
 *  in case a future soak scenario needs to resolve workspace paths. */
export async function runSoakScenario(scenario: Scenario, repoRoot: string): Promise<SoakRunResult> {
  void repoRoot;
  const net = scenario.net as NetSpec | undefined;
  const spec = scenario.soak as SoakSpec | undefined;
  if (!spec || !net) {
    throw new SoakInfraError(`Scenario "${scenario.name}" has no soak/net spec (scenario.soak + scenario.net are required for --soak).`);
  }

  const { startGameServer, devAuth } = await import("@claude-engine/server");
  const { TICK_MS } = await import("@claude-engine/core");

  const timeoutMs = spec.timeoutMs ?? spec.durationMs + 30_000;
  const deadline = Date.now() + timeoutMs;
  const intentEveryMs = spec.intentEveryMs ?? TICK_MS;

  const server = await startGameServer({
    seed: scenario.seed,
    setup: scenario.setup,
    auth: devAuth(),
    commands: net.commands,
    port: 0,
    ...(net.interest ? { interest: net.interest } : {}),
    ...(net.filterEvent ? { filterEvent: net.filterEvent } : {}),
  });

  const url = `ws://127.0.0.1:${server.port}`;
  const sessions: ClientSession[] = [];
  const pumpTimers: ReturnType<typeof setInterval>[] = [];

  try {
    for (let i = 0; i < spec.clients; i++) {
      const session = createClientSession({
        transport: webSocketTransport(url),
        token: `dev:soak-client-${i}`,
        pingIntervalMs: Math.min(2000, Math.max(500, intentEveryMs * 4)),
      });
      sessions.push(session);
      await waitForOpen(session, deadline);

      const bot = spec.bot(i);
      const timer = setInterval(() => {
        if (session.status !== "open") return;
        for (const intent of bot.act(session.world, session.world.tick)) {
          session.submitIntent(intent);
        }
      }, intentEveryMs);
      pumpTimers.push(timer);
    }

    await sleep(spec.durationMs);

    // Capture per-client connectivity/stats BEFORE we deliberately close
    // anything, so "disconnected" reflects drops that happened during the
    // run, not our own teardown.
    const clientSnapshots = sessions.map((s) => ({ status: s.status, stats: s.stats() }));

    for (const timer of pumpTimers) clearInterval(timer);
    for (const s of sessions) s.close();

    const serverStats = server.stats();
    const connected = clientSnapshots.filter((c) => c.status === "open").length;
    const disconnected = clientSnapshots.filter((c) => c.status !== "open").length;
    const rtts = clientSnapshots.map((c) => c.stats.rttMs).filter((v): v is number => v !== null);
    const avgRttMs = rtts.length > 0 ? rtts.reduce((s, v) => s + v, 0) / rtts.length : 0;
    const avgReplicatedEntities =
      clientSnapshots.length > 0
        ? clientSnapshots.reduce((s, c) => s + c.stats.replicatedEntities, 0) / clientSnapshots.length
        : 0;
    const totalCorrections = clientSnapshots.reduce((s, c) => s + c.stats.corrections, 0);

    const report: SoakReport = {
      clientCount: spec.clients,
      durationMs: spec.durationMs,
      deterministic: false,
      server: {
        ticks: serverStats.ticks,
        finalTick: server.world.tick,
        finalStateHash: server.world.stateHash(),
        tickP95Ms: serverStats.tickP95Ms,
        tickMaxMs: serverStats.tickMaxMs,
        commandsAccepted: serverStats.commandsAccepted,
        commandsRejected: serverStats.commandsRejected,
        rejectionsByReason: serverStats.rejectionsByReason,
        bytesOut: serverStats.bytesOut,
        entities: serverStats.entities,
      },
      clients: {
        connected,
        disconnected,
        avgRttMs,
        avgReplicatedEntities,
        corrections: totalCorrections,
      },
      soakChecks: [],
    };

    for (const [key, bounds] of Object.entries(scenario.soakTargets ?? {})) {
      const value = getPath(report, key);
      const passed =
        value !== undefined &&
        (bounds.min === undefined || value >= bounds.min) &&
        (bounds.max === undefined || value <= bounds.max);
      report.soakChecks.push({ target: key, value: value ?? Number.NaN, passed });
    }

    return {
      soak: report,
      commands: server.commandLog(),
      eventCount: server.world.eventsSince(0).length,
      entityCount: [...server.world.entities()].length,
      passed: report.soakChecks.every((c) => c.passed),
    };
  } finally {
    for (const timer of pumpTimers) clearInterval(timer);
    for (const s of sessions) s.close();
    await server.stop();
  }
}
