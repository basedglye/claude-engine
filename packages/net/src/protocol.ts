import type { EntityId, GameEvent } from "@claude-engine/core";

/**
 * The wire protocol — the portability boundary (docs/DESIGN.md): a versioned,
 * JSON-text message vocabulary any future host (Godot sidecar, native) can
 * speak without sharing TypeScript.
 *
 * The wire wraps command data in a network envelope rather than reusing
 * `Command` as-is: `Command.actor` and `Command.tick` are server-assigned
 * fields a client must never choose. Clients send bare intents; the server
 * validates, stamps `actor` and the executing `tick`, and only then does a
 * `Command` exist.
 */
export const PROTOCOL_VERSION = 1;

/** What a client may send: bare intent. actor and tick are SERVER-assigned. */
export interface CommandIntent {
  type: string;
  payload?: unknown;
}

export type ClientMessage =
  | { t: "hello"; proto: number; token: string }
  | { t: "input"; seq: number; intents: readonly CommandIntent[] }
  | { t: "ping"; sentAt: number };

export type RejectReason = "unknown-type" | "invalid-payload" | "rate-limited";
export type CloseCode = "auth-failed" | "protocol-error" | "superseded" | "server-shutdown";

/** Interest-filtered authoritative state. v0 sends the full interest set
 *  each time (no deltas). removed = left interest OR destroyed. */
export interface ReplicaState {
  tick: number;
  /** Server-computed full-world stateHash() — the client's authority anchor. */
  stateHash: number;
  entities: readonly [EntityId, readonly [string, unknown][]][];
  removed: readonly EntityId[];
}

export type ServerMessage =
  | {
      t: "welcome";
      proto: number;
      playerId: string;
      actor: string;
      seed: string;
      tick: number;
      tickRateHz: number;
      state: ReplicaState;
    }
  | { t: "state"; state: ReplicaState; ackSeq: number; events: readonly GameEvent[] }
  | { t: "reject"; seq: number; type: string; reason: RejectReason }
  | { t: "pong"; sentAt: number; serverTick: number }
  | { t: "close"; code: CloseCode; message: string };

export interface ProtocolLimits {
  maxMessageBytes: number;
  maxIntentsPerMessage: number;
}

export const DEFAULT_LIMITS: ProtocolLimits = {
  maxMessageBytes: 16 * 1024,
  maxIntentsPerMessage: 32,
};

export class ProtocolError extends Error {}

export function encodeMessage(m: ClientMessage | ServerMessage): string {
  return JSON.stringify(m);
}

/** Intent types beginning with "@" are reserved for the engine
 *  (@net/join, @net/leave) and always rejected from clients. */
export function isReservedIntentType(type: string): boolean {
  return type.startsWith("@");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Boundary validation: message size, JSON shape, and per-message intent
 * count are enforced HERE, before any game code sees the payload — this is
 * "input validation live in engine packages" (CLAUDE.md invariant #5) made
 * literal for the wire itself. Throws ProtocolError on any violation.
 */
export function decodeClientMessage(
  raw: string,
  limits: ProtocolLimits = DEFAULT_LIMITS
): ClientMessage {
  if (raw.length > limits.maxMessageBytes) {
    throw new ProtocolError(
      `Message exceeds maxMessageBytes (${raw.length} > ${limits.maxMessageBytes})`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError("Message is not valid JSON");
  }

  if (!isPlainObject(parsed) || typeof parsed.t !== "string") {
    throw new ProtocolError('Message missing string discriminant field "t"');
  }

  switch (parsed.t) {
    case "hello": {
      if (typeof parsed.proto !== "number" || typeof parsed.token !== "string") {
        throw new ProtocolError("Malformed hello message");
      }
      return { t: "hello", proto: parsed.proto, token: parsed.token };
    }
    case "input": {
      if (typeof parsed.seq !== "number" || !Array.isArray(parsed.intents)) {
        throw new ProtocolError("Malformed input message");
      }
      if (parsed.intents.length > limits.maxIntentsPerMessage) {
        throw new ProtocolError(
          `Too many intents in one message (${parsed.intents.length} > ${limits.maxIntentsPerMessage})`
        );
      }
      const intents: CommandIntent[] = parsed.intents.map((raw: unknown, i: number) => {
        if (!isPlainObject(raw) || typeof raw.type !== "string") {
          throw new ProtocolError(`Malformed intent at index ${i}`);
        }
        if (isReservedIntentType(raw.type)) {
          throw new ProtocolError(
            `Intent type "${raw.type}" is engine-reserved and cannot be sent by a client`
          );
        }
        return { type: raw.type, payload: raw.payload };
      });
      return { t: "input", seq: parsed.seq, intents };
    }
    case "ping": {
      if (typeof parsed.sentAt !== "number") {
        throw new ProtocolError("Malformed ping message");
      }
      return { t: "ping", sentAt: parsed.sentAt };
    }
    default:
      throw new ProtocolError(`Unknown client message type: "${parsed.t}"`);
  }
}

/**
 * The server is a trusted origin (the engine's own authoritative host), so
 * decoding here is a shape check, not a hostile-input gate — ProtocolError
 * still throws on unparseable/malformed frames so a broken connection fails
 * loudly rather than corrupting client state.
 */
export function decodeServerMessage(raw: string): ServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError("Message is not valid JSON");
  }
  if (!isPlainObject(parsed) || typeof parsed.t !== "string") {
    throw new ProtocolError('Message missing string discriminant field "t"');
  }
  switch (parsed.t) {
    case "welcome":
    case "state":
    case "reject":
    case "pong":
    case "close":
      return parsed as ServerMessage;
    default:
      throw new ProtocolError(`Unknown server message type: "${parsed.t}"`);
  }
}
