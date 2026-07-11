import { WebSocketServer, WebSocket } from "ws";
import { Sim, TICK_MS, TICK_RATE_HZ, type Command, type EntityId, type GameEvent, type IWorld } from "@claude-engine/core";
import {
  PROTOCOL_VERSION,
  DEFAULT_LIMITS,
  encodeMessage,
  decodeClientMessage,
  isReservedIntentType,
  type ProtocolLimits,
  type RejectReason,
  type CloseCode,
  type ServerMessage,
} from "@claude-engine/net";
import type { GameStore } from "@claude-engine/persistence";
import type { AuthProvider } from "./auth.js";
import { allEntities, type InterestPolicy } from "./interest.js";
import { TokenBucket } from "./rate-limit.js";

export interface CommandRule {
  validate(payload: unknown): boolean;
  maxPerTick?: number; // per session; over-limit intents reject "rate-limited"
  maxPerSecond?: number; // token bucket, per session
}

export interface GameServerOptions {
  seed: string;
  /** Same game-module contract as scenarios: registers systems (including
   *  handlers for the reserved "@net/join" / "@net/leave" commands). */
  setup: (sim: Sim) => void;
  auth: AuthProvider;
  /** The validation boundary: unknown/invalid/over-rate intents never reach
   *  the sim. "@"-prefixed types are engine-reserved and unregisterable. */
  commands: Record<string, CommandRule>;
  interest?: InterestPolicy; // default allEntities()
  filterEvent?: (event: GameEvent, actor: string, world: IWorld) => boolean;
  port?: number; // default 0 = ephemeral
  stateEveryTicks?: number; // default 1
  limits?: Partial<ProtocolLimits>;
  /** Persistence (Scope D). Both present => write-ahead command log +
   *  periodic snapshots; existing gameId => recover and resume. */
  store?: GameStore;
  gameId?: string;
  snapshotEveryTicks?: number; // default 600
}

export interface ServerStats {
  connected: number;
  ticks: number;
  tickP95Ms: number;
  tickMaxMs: number;
  commandsAccepted: number;
  commandsRejected: number;
  rejectionsByReason: Record<RejectReason, number>;
  bytesOut: number;
  entities: number;
}

export interface GameServer {
  readonly port: number;
  readonly world: IWorld; // read-only view of the live sim
  stats(): ServerStats;
  /** The authoritative command log (incl. @net/join/leave) — soak verdicts' replay bundle. */
  commandLog(): readonly Command[];
  stop(): Promise<void>;
}

interface SessionState {
  ws: WebSocket;
  actor: string;
  playerId: string;
  /** Highest client-submitted seq this session has finished processing
   *  (accepted or rejected) — reported back as ackSeq. */
  lastProcessedSeq: number;
  lastInterestSet: Set<EntityId>;
  rateBuckets: Map<string, TokenBucket>;
  tickCounts: Map<string, number>;
  protocolStrikes: number;
  open: boolean;
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

/** Every component of every entity, grouped by entity id. Built from
 *  Sim.snapshot() (Scope A) rather than a new IWorld/HostPort capability —
 *  IWorld only exposes single-named getComponent(), with no "list every
 *  component on this entity" accessor; snapshot() already assembles exactly
 *  that data (deep-cloned, so replicated state never aliases live objects)
 *  for the harness's checkpoints, and reusing it keeps types.ts zero-diff. */
function snapshotByEntity(sim: Sim): Map<EntityId, [string, unknown][]> {
  const snap = sim.snapshot();
  const byEntity = new Map<EntityId, [string, unknown][]>();
  for (const [componentName, entries] of Object.entries(snap.components)) {
    for (const [entityId, value] of entries) {
      let list = byEntity.get(entityId);
      if (!list) {
        list = [];
        byEntity.set(entityId, list);
      }
      list.push([componentName, value]);
    }
  }
  return byEntity;
}

export async function startGameServer(opts: GameServerOptions): Promise<GameServer> {
  const {
    seed,
    setup,
    auth,
    commands: commandRules,
    interest = allEntities(),
    filterEvent,
    port = 0,
    stateEveryTicks = 1,
    limits,
    store,
    gameId,
    snapshotEveryTicks = 600,
  } = opts;

  for (const type of Object.keys(commandRules)) {
    if (isReservedIntentType(type)) {
      throw new Error(`GameServerOptions.commands: "${type}" is engine-reserved and cannot be registered`);
    }
  }

  const protocolLimits: ProtocolLimits = { ...DEFAULT_LIMITS, ...limits };

  let sim: Sim;
  if (store && gameId) {
    const existing = await store.getGame(gameId);
    if (existing) {
      const { recoverSim } = await import("@claude-engine/persistence");
      sim = (await recoverSim(store, gameId, setup)).sim;
    } else {
      await store.createGame({ id: gameId, name: gameId, seed });
      sim = new Sim(seed);
      setup(sim);
    }
  } else {
    sim = new Sim(seed);
    setup(sim);
  }

  const sessions = new Map<WebSocket, SessionState>();
  const sessionsByPlayerId = new Map<string, SessionState>();
  const fullCommandLog: Command[] = [];

  let commandsAccepted = 0;
  let commandsRejected = 0;
  const rejectionsByReason: Record<RejectReason, number> = {
    "unknown-type": 0,
    "invalid-payload": 0,
    "rate-limited": 0,
  };
  let bytesOutTotal = 0;
  const tickDurationsMs: number[] = [];
  let lastBroadcastEventTick = 0;
  let stopped = false;

  function send(ws: WebSocket, msg: ServerMessage): void {
    const raw = encodeMessage(msg);
    bytesOutTotal += Buffer.byteLength(raw, "utf8");
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  }

  function closeSession(session: SessionState, code: CloseCode, message: string): void {
    if (!session.open) return;
    session.open = false;
    send(session.ws, { t: "close", code, message });
    session.ws.close();
    sessions.delete(session.ws);
    if (sessionsByPlayerId.get(session.playerId) === session) sessionsByPlayerId.delete(session.playerId);
  }

  function submitReserved(type: "@net/join" | "@net/leave", actor: string, payload: unknown): void {
    sim.submit({ tick: sim.tick + 1, actor, type, payload });
  }

  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    let session: SessionState | undefined;

    ws.on("message", (data: Buffer) => {
      let msg;
      try {
        msg = decodeClientMessage(data.toString(), protocolLimits);
      } catch (err) {
        if (session) {
          session.protocolStrikes++;
          if (session.protocolStrikes >= 3) {
            closeSession(session, "protocol-error", err instanceof Error ? err.message : String(err));
          }
        } else {
          ws.close();
        }
        return;
      }

      if (msg.t === "hello") {
        void (async () => {
          const result = await auth.authenticate(msg.token);
          if (!result) {
            send(ws, { t: "close", code: "auth-failed", message: "Invalid or expired token" });
            ws.close();
            return;
          }
          const actor = `player:${result.playerId}`;
          const existing = sessionsByPlayerId.get(result.playerId);
          if (existing) {
            closeSession(existing, "superseded", "A new connection for this player has superseded this one");
          }

          session = {
            ws,
            actor,
            playerId: result.playerId,
            lastProcessedSeq: 0,
            lastInterestSet: new Set(),
            rateBuckets: new Map(),
            tickCounts: new Map(),
            protocolStrikes: 0,
            open: true,
          };
          sessions.set(ws, session);
          sessionsByPlayerId.set(result.playerId, session);
          submitReserved("@net/join", actor, { playerId: result.playerId });

          const byEntity = snapshotByEntity(sim);
          const visibleIds = [...interest.entitiesFor(sim, actor)];
          session.lastInterestSet = new Set(visibleIds);
          send(ws, {
            t: "welcome",
            proto: PROTOCOL_VERSION,
            playerId: result.playerId,
            actor,
            seed: sim.seed,
            tick: sim.tick,
            tickRateHz: TICK_RATE_HZ,
            state: {
              tick: sim.tick,
              stateHash: sim.stateHash(),
              entities: visibleIds.map((id) => [id, byEntity.get(id) ?? []] as [EntityId, [string, unknown][]]),
              removed: [],
            },
          });
        })();
        return;
      }

      if (!session) return; // input/ping before a completed hello handshake

      if (msg.t === "ping") {
        send(ws, { t: "pong", sentAt: msg.sentAt, serverTick: sim.tick });
        return;
      }

      if (msg.t === "input") {
        for (const intent of msg.intents) {
          session.lastProcessedSeq = Math.max(session.lastProcessedSeq, msg.seq);

          let reason: RejectReason | undefined;
          const rule = commandRules[intent.type];
          if (!rule) {
            reason = "unknown-type";
          } else if (!rule.validate(intent.payload)) {
            reason = "invalid-payload";
          } else if (rule.maxPerTick !== undefined && (session.tickCounts.get(intent.type) ?? 0) >= rule.maxPerTick) {
            reason = "rate-limited";
          } else if (rule.maxPerSecond !== undefined) {
            let bucket = session.rateBuckets.get(intent.type);
            if (!bucket) {
              bucket = new TokenBucket(rule.maxPerSecond, rule.maxPerSecond);
              session.rateBuckets.set(intent.type, bucket);
            }
            if (!bucket.tryConsume()) reason = "rate-limited";
          }

          if (reason) {
            commandsRejected++;
            rejectionsByReason[reason]++;
            send(ws, { t: "reject", seq: msg.seq, type: intent.type, reason });
            continue;
          }

          session.tickCounts.set(intent.type, (session.tickCounts.get(intent.type) ?? 0) + 1);
          commandsAccepted++;
          sim.submit({ tick: sim.tick + 1, actor: session.actor, type: intent.type, payload: intent.payload });
        }
      }
    });

    ws.on("close", () => {
      const s = sessions.get(ws);
      if (!s) return;
      s.open = false;
      sessions.delete(ws);
      if (sessionsByPlayerId.get(s.playerId) === s) sessionsByPlayerId.delete(s.playerId);
      submitReserved("@net/leave", s.actor, { playerId: s.playerId });
    });
  });

  function broadcastState(): void {
    const byEntity = snapshotByEntity(sim);
    const hash = sim.stateHash();
    const newEvents = sim.eventsSince(lastBroadcastEventTick + 1);
    lastBroadcastEventTick = sim.tick;

    for (const session of sessions.values()) {
      if (!session.open) continue;
      const visibleIds = [...interest.entitiesFor(sim, session.actor)];
      const visibleSet = new Set(visibleIds);
      const removed = [...session.lastInterestSet].filter((id) => !visibleSet.has(id));
      session.lastInterestSet = visibleSet;
      const events = filterEvent ? newEvents.filter((e) => filterEvent(e, session.actor, sim)) : newEvents;
      send(session.ws, {
        t: "state",
        state: {
          tick: sim.tick,
          stateHash: hash,
          entities: visibleIds.map((id) => [id, byEntity.get(id) ?? []] as [EntityId, [string, unknown][]]),
          removed,
        },
        ackSeq: session.lastProcessedSeq,
        events,
      });
    }
  }

  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let nextTickAt = Date.now() + TICK_MS;

  function scheduleTick(): void {
    if (stopped) return;
    tickTimer = setTimeout(doTick, Math.max(0, nextTickAt - Date.now()));
  }

  async function doTick(): Promise<void> {
    const tickStart = Date.now();
    for (const session of sessions.values()) session.tickCounts.clear();

    // Write-ahead: persist (and record in the in-memory log) this tick's
    // accepted commands BEFORE stepping — a crash can lose an unexecuted
    // tail, never produce state ahead of the log.
    const thisTickCommands = [...sim.commands()];
    if (thisTickCommands.length > 0) {
      fullCommandLog.push(...thisTickCommands);
      if (store && gameId) await store.appendCommands(gameId, thisTickCommands);
    }

    sim.step();
    tickDurationsMs.push(Date.now() - tickStart);

    if (sim.tick % stateEveryTicks === 0) broadcastState();
    if (store && gameId && sim.tick % snapshotEveryTicks === 0) {
      await store.saveSnapshot(gameId, sim.snapshot());
    }

    nextTickAt += TICK_MS;
    scheduleTick();
  }

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  scheduleTick();

  const address = wss.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    get port() {
      return actualPort;
    },
    world: sim,
    stats(): ServerStats {
      return {
        connected: sessions.size,
        ticks: sim.tick,
        tickP95Ms: percentile(tickDurationsMs, 0.95),
        tickMaxMs: tickDurationsMs.reduce((m, v) => Math.max(m, v), 0),
        commandsAccepted,
        commandsRejected,
        rejectionsByReason: { ...rejectionsByReason },
        bytesOut: bytesOutTotal,
        entities: [...sim.entities()].length,
      };
    },
    commandLog: () => fullCommandLog,
    async stop(): Promise<void> {
      stopped = true;
      if (tickTimer) clearTimeout(tickTimer);
      for (const session of [...sessions.values()]) {
        closeSession(session, "server-shutdown", "Server shutting down");
      }
      if (store && gameId) await store.saveSnapshot(gameId, sim.snapshot());
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
