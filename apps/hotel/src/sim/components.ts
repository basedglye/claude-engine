/**
 * All component interfaces for apps/hotel's sim (H0's set, split out of
 * game.ts per docs/PHASE-H1.md, plus the full H1a set from the spec's
 * component table). Every shape here is JSON-plain: integers, strings,
 * booleans, and plain arrays/objects thereof only — these are hashed by
 * Sim.stateHash() and round-tripped by Sim.snapshot()/restore().
 *
 * Entity-id fields that may be "absent" use the sentinel 0 (never a valid
 * EntityId — Sim.spawn() starts numbering at 1) rather than `undefined`,
 * so every component stays a plain, always-fully-populated object (no
 * `exactOptionalPropertyTypes` friction, and no ambiguity between "not yet
 * computed" and "computed as absent").
 */
import type { ShellState } from "@claude-engine/surface-ui";

// -- H0 (unchanged) ----------------------------------------------------

export interface Pos {
  xMm: number;
  zMm: number;
}
export interface Yaw {
  mdeg: number;
}
export interface Collider {
  radiusMm: number;
}
export interface Door {
  doorIndex: number;
  open: boolean;
  cx: number;
  cz: number;
}
export interface Player {
  actor: string;
}

/** H1a widens `interactable.kind`: "door" (H0), "terminal" (the front-desk
 *  terminal), "guest" (a presenting-eligible guest at the queue head). */
export type InteractableKind = "door" | "terminal" | "guest";
export interface Interactable {
  kind: InteractableKind;
  xMm: number;
  zMm: number;
  radiusMm: number;
  arcMdeg: number;
}

// -- H1a ------------------------------------------------------------------

export type GuestState = "arriving" | "queued" | "presenting" | "toRoom" | "inRoom" | "leaving";

export interface Guest {
  archetypeId: string;
  segment: string;
  state: GuestState;
  /** 0 = no room assigned yet. */
  roomEntity: number;
  stayUntilTick: number;
  /** -1 = not (yet) in the queue chain. Derived/compacted every tick by
   *  guestBrainSystem — never cached elsewhere (see game.ts). */
  queueIndex: number;
  patienceTicks: number;
}

export interface PathCell {
  cx: number;
  cz: number;
}

export interface NavAgent {
  goalCx: number;
  goalCz: number;
  /** Empty when no path is currently held (either not yet computed, or the
   *  agent has arrived). */
  path: PathCell[];
  pathIdx: number;
  repathAtTick: number;
  /** Assigned once at spawn from forkRng("guest-spawn"); jitter() is a pure
   *  hash of this plus the cell coordinate — never an Rng draw at query
   *  time (determinism rule 5). */
  jitterSeed: number;
  stuckTicks: number;
}

export type DocType = "id" | "resSlip";
export interface DocumentComp {
  docType: DocType;
  fields: Record<string, string>;
  ownerEntity: number;
  /** 0 = nobody currently holding it. */
  heldBy: number;
}

export interface Reservation {
  guestEntity: number;
  fields: Record<string, string>;
  plantedViolations: string[];
  decided: boolean;
  accepted: boolean;
  /** 0 = none (denied, or not yet decided). */
  roomEntity: number;
}

export interface RoomUnit {
  roomId: number;
  tier: number;
  /** 0 = vacant. */
  occupantEntity: number;
}

export interface Terminal {
  station: "frontdesk";
  /** "" = nobody focused. Actor string, per B9 (never an entity/singleton
   *  "the player"). */
  focusedBy: string;
}

/** The terminal's diegetic-shell state (H1b): the shell's `ShellState` is
 *  JSON-plain (`{ openAppId, appStates }`, surface-ui/shell.ts) so it lives
 *  verbatim here and is hashed like any other component. `paintSeq` is a
 *  counter bumped by `screenSystem` on state-reference change — never a
 *  content hash (hashing paint output would smuggle presentation into
 *  `stateHash`, docs/PHASE-H1.md determinism rules). */
export interface ScreenApp {
  state: ShellState;
  paintSeq: number;
}

/** Singleton — one entity carries this component. */
export interface Hotel {
  cash: number;
  day: number;
  /** 0 morning, 1 day, 2 evening, 3 night. */
  phaseId: number;
  phaseStartTick: number;
  nextGuestAtTick: number;
  /** Progress counter for the configured spawn schedule. NOT closure state
   *  (see game.ts's "no closure state" note) — this is what lets restore()
   *  resume spawning correctly. */
  guestsSpawned: number;
}

export interface LedgerEntry {
  day: number;
  debitAccount: string;
  creditAccount: string;
  amountMinor: number;
  memo: string;
}

/** H1b save-restore gate (docs/PHASE-H1.md gate 4, apps/hotel/src/main.ts's
 *  quickLoad()): the browser scenario needs `savedHash === restoredHash` to
 *  be assertable by `--browser`'s replay-based assertion evaluation
 *  (packages/harness/src/cli.ts's runBrowserMode replays the captured
 *  command log through a headless Sim and runs `assertions` against THAT
 *  Sim — a host-only value like a stateHash comparison is otherwise
 *  invisible to it). main.ts submits one `debug.saveRestoreRecord` command
 *  right after a quick-load completes; this component is created lazily
 *  (never spawned by setup()) so every OTHER scenario — none of which ever
 *  submit that command — has zero extra entities and an unchanged
 *  stateHash. Singleton, created on first use. */
export interface SaveRestoreDebug {
  savedTick: number;
  savedHash: number;
  restoredHash: number;
}

/** Singleton — the repath round-robin cursor. A component, never a closure
 *  variable (docs/PHASE-H1.md, "no closure state", edge (b); also the
 *  Phase-3 review item-1 lesson: Sim.restore() reruns setup() fresh, so
 *  anything the sim needs across ticks must live here, not in a JS
 *  variable captured by a system closure). */
export interface NavSchedule {
  lastServedId: number;
}
