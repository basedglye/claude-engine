import type { EntityId, GameEvent, IWorld } from "@claude-engine/core";
import {
  PROTOCOL_VERSION,
  encodeMessage,
  decodeServerMessage,
  type ClientMessage,
  type CommandIntent,
  type ReplicaState,
  type ServerMessage,
} from "./protocol.js";

/** What a client session needs from its environment — injected, so the
 *  prediction/reconciliation state machine below is environment-free and
 *  unit-testable headlessly with a scripted fake transport. */
export interface ClientTransport {
  send(raw: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: (info?: { code?: string; message?: string }) => void): void;
  close(): void;
}

/** Game-supplied prediction: re-applied over fresh authority for every
 *  unacked intent. Patches are a presentation overlay — never sim state. */
export interface PredictView {
  readonly selfActor: string;
  getComponent<T>(entity: EntityId, component: string): T | undefined;
  patch<T>(entity: EntityId, component: string, value: T): void;
}
export type PredictFn = (view: PredictView, intents: readonly CommandIntent[]) => void;

/** IWorld over the replica + prediction overlay. stateHash() returns the
 *  server-reported hash from the latest state message (the interest-filtered
 *  replica cannot reproduce a full-world hash locally). */
export interface ClientWorld extends IWorld {
  /** Previous authoritative value (one state message of history) — the
   *  engine-owned interpolation data deferred from Phases 1-2, resolved
   *  here rather than on IWorld. */
  getPrevComponent<T>(entity: EntityId, component: string): T | undefined;
}

export interface ClientNetStats {
  rttMs: number | null;
  pendingIntents: number;
  replicatedEntities: number;
  /** Times fresh authority disagreed with the prediction overlay. */
  corrections: number;
  rejects: Record<string, number>;
}

export interface ClientSessionOptions {
  transport: ClientTransport;
  token: string;
  predict?: PredictFn;
  onEvent?: (event: GameEvent) => void;
  onClose?: (info: { code?: string; message?: string }) => void;
  /** Ping cadence for RTT measurement, in ms. Default 2000. Set 0 to disable
   *  auto-ping entirely (e.g. in tests driving a fake transport by hand). */
  pingIntervalMs?: number;
}

export interface ClientSession {
  readonly world: ClientWorld;
  readonly status: "connecting" | "open" | "closed";
  /** The server-assigned actor string ("player:<id>"), populated once
   *  "welcome" arrives (empty string beforehand). Games need this to tell
   *  their own entity apart from others' (e.g. an "owner" component set to
   *  Command.actor server-side, matched against this client-side). */
  readonly actor: string;
  submitIntent(intent: CommandIntent): void;
  stats(): ClientNetStats;
  close(): void;
}

type ComponentMap = Map<EntityId, Map<string, unknown>>;

function replicaFromState(state: ReplicaState): ComponentMap {
  const map: ComponentMap = new Map();
  for (const [id, comps] of state.entities) {
    map.set(id, new Map(comps));
  }
  return map;
}

export function createClientSession(opts: ClientSessionOptions): ClientSession {
  const { transport, token, predict, onEvent, onClose, pingIntervalMs = 2000 } = opts;

  let status: "connecting" | "open" | "closed" = "connecting";
  let selfActor = "";
  let seed = "";
  let latestTick = 0;
  let latestHash = 0;
  let ackSeq = 0;
  let seqCounter = 0;
  let rttMs: number | null = null;
  let lastPingSentAt: number | null = null;

  let replica: ComponentMap = new Map();
  let prevReplica: ComponentMap = new Map();
  let overlay: ComponentMap = new Map();

  const pending: { seq: number; intent: CommandIntent }[] = [];
  const rejectCounts: Record<string, number> = {};
  let corrections = 0;
  let eventBuffer: GameEvent[] = [];
  const MAX_EVENT_BUFFER = 500;

  function overlayGet<T>(entity: EntityId, component: string): T | undefined {
    const patched = overlay.get(entity)?.get(component);
    if (patched !== undefined) return patched as T;
    return replica.get(entity)?.get(component) as T | undefined;
  }

  function makePredictView(): PredictView {
    return {
      selfActor,
      getComponent: <T>(entity: EntityId, component: string): T | undefined =>
        overlayGet(entity, component),
      patch: <T>(entity: EntityId, component: string, value: T): void => {
        let comps = overlay.get(entity);
        if (!comps) {
          comps = new Map();
          overlay.set(entity, comps);
        }
        comps.set(component, value);
      },
    };
  }

  /**
   * Fresh authority disagreeing with what the (about to be discarded)
   * overlay predicted is a correction — measured, not an adjective.
   *
   * Only judged once nothing the client itself sent is still outstanding
   * (no pending intent survives past `newAckSeq`): while an intent is still
   * unacked, authority not yet reflecting it is expected latency, not a
   * misprediction. Once every pending intent has been acked, the overlay's
   * prediction and fresh authority describe the same instant and are
   * directly comparable.
   */
  function detectCorrections(newAckSeq: number): void {
    if (pending.some((p) => p.seq > newAckSeq)) return;
    for (const [entity, comps] of overlay) {
      const authComps = replica.get(entity);
      for (const [component, predictedValue] of comps) {
        const freshValue = authComps?.get(component);
        if (JSON.stringify(freshValue) !== JSON.stringify(predictedValue)) {
          corrections++;
        }
      }
    }
  }

  /** Reset the overlay to empty (fresh authority) and re-apply every
   *  unacknowledged intent, in submission order — standard reconciliation. */
  function rebuildOverlay(): void {
    overlay = new Map();
    if (!predict) return;
    const view = makePredictView();
    for (const p of pending) predict(view, [p.intent]);
  }

  function applyReplicaState(state: ReplicaState): void {
    prevReplica = replica;
    replica = replicaFromState(state);
    latestTick = state.tick;
    latestHash = state.stateHash;
  }

  function pruneAcked(): void {
    while (pending.length > 0 && pending[0]!.seq <= ackSeq) pending.shift();
  }

  function recordEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      eventBuffer.push(event);
      onEvent?.(event);
    }
    if (eventBuffer.length > MAX_EVENT_BUFFER) {
      eventBuffer = eventBuffer.slice(eventBuffer.length - MAX_EVENT_BUFFER);
    }
  }

  function handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = decodeServerMessage(raw);
    } catch {
      return; // malformed server frame — drop rather than crash the client
    }

    switch (msg.t) {
      case "welcome": {
        selfActor = msg.actor;
        seed = msg.seed;
        status = "open";
        applyReplicaState(msg.state);
        ackSeq = 0;
        pruneAcked();
        rebuildOverlay();
        break;
      }
      case "state": {
        applyReplicaState(msg.state);
        detectCorrections(msg.ackSeq);
        ackSeq = msg.ackSeq;
        pruneAcked();
        rebuildOverlay();
        recordEvents(msg.events);
        break;
      }
      case "reject": {
        rejectCounts[msg.reason] = (rejectCounts[msg.reason] ?? 0) + 1;
        const idx = pending.findIndex((p) => p.seq === msg.seq);
        if (idx !== -1) pending.splice(idx, 1);
        rebuildOverlay();
        break;
      }
      case "pong": {
        if (lastPingSentAt !== null && msg.sentAt === lastPingSentAt) {
          rttMs = Date.now() - lastPingSentAt;
        }
        break;
      }
      case "close": {
        status = "closed";
        stopPing();
        onClose?.({ code: msg.code, message: msg.message });
        break;
      }
    }
  }

  transport.onMessage(handleMessage);
  transport.onClose((info) => {
    if (status === "closed") return;
    status = "closed";
    stopPing();
    onClose?.(info ?? {});
  });

  let pingTimer: ReturnType<typeof setInterval> | undefined;
  function sendPing(): void {
    lastPingSentAt = Date.now();
    transport.send(encodeMessage({ t: "ping", sentAt: lastPingSentAt }));
  }
  function stopPing(): void {
    if (pingTimer !== undefined) clearInterval(pingTimer);
  }
  if (pingIntervalMs > 0) {
    pingTimer = setInterval(sendPing, pingIntervalMs);
  }

  transport.send(encodeMessage({ t: "hello", proto: PROTOCOL_VERSION, token } satisfies ClientMessage));

  const world: ClientWorld = {
    get tick() {
      return latestTick;
    },
    get seed() {
      return seed;
    },
    stateHash: () => latestHash,
    entities: function* (): Iterable<EntityId> {
      yield* replica.keys();
    },
    getComponent: <T>(entity: EntityId, component: string): T | undefined =>
      overlayGet(entity, component),
    eventsSince: (tick: number): readonly GameEvent[] =>
      eventBuffer.filter((e) => e.tick >= tick),
    getPrevComponent: <T>(entity: EntityId, component: string): T | undefined =>
      prevReplica.get(entity)?.get(component) as T | undefined,
  };

  return {
    world,
    get status() {
      return status;
    },
    get actor() {
      return selfActor;
    },
    submitIntent(intent: CommandIntent): void {
      const seq = ++seqCounter;
      pending.push({ seq, intent });
      transport.send(encodeMessage({ t: "input", seq, intents: [intent] } satisfies ClientMessage));
      rebuildOverlay();
    },
    stats(): ClientNetStats {
      return {
        rttMs,
        pendingIntents: pending.length,
        replicatedEntities: replica.size,
        corrections,
        rejects: { ...rejectCounts },
      };
    },
    close(): void {
      status = "closed";
      stopPing();
      transport.close();
    },
  };
}
