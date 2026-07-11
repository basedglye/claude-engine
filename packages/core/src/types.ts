/** Core protocol types. Hosts and the sim communicate ONLY through these. */

export type EntityId = number;

/** A host-submitted intent (player input, admin op). Never mutates state directly. */
export interface Command {
  tick: number;
  /** Stable actor identifier (player id, bot id, system). */
  actor: string;
  type: string;
  payload?: unknown;
}

/** An append-only fact emitted by the sim. Renderers, networking, replays and
 * harness assertions all consume this same stream. */
export interface GameEvent {
  tick: number;
  type: string;
  payload?: unknown;
}

/** Read-only view of sim state exposed to hosts (renderers, servers, harness).
 * Hosts may read; they mutate only by submitting Commands. */
export interface IWorld {
  readonly tick: number;
  readonly seed: string;
  /** Deterministic hash of full sim state — replay divergence detector. */
  stateHash(): number;
  entities(): Iterable<EntityId>;
  getComponent<T>(entity: EntityId, component: string): T | undefined;
  eventsSince(tick: number): readonly GameEvent[];
}

/** What a host environment provides to run a sim. The portability boundary:
 * web, server, headless harness — and later Godot/native — all implement this. */
export interface HostPort {
  /** Called by the host loop; the sim never reads wall-clock time. */
  submit(command: Command): void;
  /** Drain events for transport/rendering/logging. */
  onEvents(handler: (events: readonly GameEvent[]) => void): void;
}

export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;
