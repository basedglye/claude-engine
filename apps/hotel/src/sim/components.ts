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

/** H2a — the actor-identity component (docs/PHASE-H2.md §6, ARCHITECTURE
 *  B9). Any system resolving "who acted" scans THIS, never `player`: the
 *  human's avatar carries `player` AND `actorId{actor:"player"}`, a hired
 *  clerk carries `actorId{actor:"staff:<entity>"}` and no `player`. That is
 *  what makes the second actor kind a data difference instead of a code
 *  branch — nothing in a decision or validation path may test for the
 *  literal "player". */
export interface ActorId {
  actor: string;
}

/** H1a widens `interactable.kind`: "door" (H0), "terminal" (the front-desk
 *  terminal), "guest" (a presenting-eligible guest at the queue head). */
/** H2a widens `interactable.kind` again: "mess" (wipe), "prop" (repair
 *  step), "candidate" (begin the interview), "document" (pick up / put down
 *  a printed resume). */
export type InteractableKind = "door" | "terminal" | "guest" | "mess" | "prop" | "candidate" | "document";
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
  /** H2a stay facts, integer, accumulated on the guest and cashed out ONCE
   *  by `reviewSystem` at checkout (never a running score, never a meter
   *  the player can see mid-stay — DESIGN's day-granularity ruling). */
  waitedTicks: number;
  brokenPropNights: number;
  /** What this stay was actually charged, in minor units — the review
   *  compares it against the tier baseline. 0 until check-in. */
  paidMinor: number;
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
  /** The cell this agent was last blocked on by the yield rule's SIDESTEP
   *  branch (a higher-EntityId agent that is not vacating), as cell
   *  coordinates; -1/-1 = none. Consumed and cleared by the very next
   *  repath, which routes around it. One-shot by construction: a stale
   *  avoid cell can never wedge an agent, because it never survives the
   *  repath it was set for. */
  avoidCx: number;
  avoidCz: number;
}

/** H2a widens `DocType` with "resume" — a candidate's printed resume is a
 *  real document entity on the printer tray, picked up and read through the
 *  exact held-item path IDs already use. */
export type DocType = "id" | "resSlip" | "resume";
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
  /** How many `mess` entities currently sit in this room. Kept in step by
   *  the systems that spawn and despawn messes; the hotel suite asserts it
   *  against a live `mess` scan so the two can never quietly diverge.
   *  Check-in eligibility is `occupantEntity === 0 && messCount === 0 && no
   *  broken prop in the room`. */
  messCount: number;
}

/** H2a — one discrete, visible piece of mess left by a checkout. `interact`
 *  removes it: one wipe, one object gone. There is deliberately NO
 *  timestamp field anywhere in this shape — nothing here CAN decay,
 *  compound or expire, which is how DESIGN's zen ruling ("no per-room
 *  timer") is enforced by construction rather than by discipline. */
export interface Mess {
  roomEntity: number;
  kind: string;
}

/** H2a — one breakable prop per bedroom. Repair is N `interact` presses;
 *  again, no timestamp: a broken prop never worsens and never cascades. */
export interface Prop {
  kind: string;
  roomEntity: number;
  broken: boolean;
  repairProgress: number;
}

/** H2a — a hired staff member. `seed` feeds the STATELESS decision-error
 *  hash (never an Rng draw: decision frequency must not perturb a stream —
 *  H2 determinism rule 3). `moralePermille` exists as data and is read by
 *  no system this phase, by design. */
export interface Staffed {
  job: "clerk";
  wage: number;
  skillPermille: number;
  moralePermille: number;
  quirk: string;
  hiredDay: number;
  seed: number;
}

/** H2a — a named NPC: candidates and hired staff. Guests deliberately do
 *  NOT carry this: a guest's name lives on their documents, because the
 *  whole desk game is reading it off paper rather than off a label. */
export interface Person {
  kind: "candidate" | "staff";
  name: string;
  seed: number;
}

/** H2a — the hired clerk's in-progress decision. A COMPONENT, never a
 *  closure timer: Sim.restore() reruns setup() fresh, so a deliberation
 *  half-finished at the save tick has to be recoverable from state or the
 *  clerk silently forgets who it was serving. `reservationEntity` 0 = idle. */
export interface StaffWork {
  reservationEntity: number;
  decideAtTick: number;
}

export type CandidateState = "arriving" | "waiting" | "interviewing" | "hired" | "rejected";

/** H2a — a job candidate NPC. Walks in the street door like a guest, waits
 *  in the lobby instead of queueing, and is interviewed in person. */
export interface Candidate {
  wageAsk: number;
  skillPermille: number;
  quirk: string;
  state: CandidateState;
  /** The `document` entity holding this candidate's printed resume, or 0. */
  resumeEntity: number;
}

/** H2a — one review, spawned at checkout. Reputation and stars are
 *  RECOMPUTED from a rolling window of these at each audit, never
 *  accumulated in place, so a mid-week restore() is trivially correct. */
export interface Review {
  day: number;
  segment: string;
  /** 1..5. */
  score: number;
  /** Slugs naming what drove the score, for MAILBOX complaint text. */
  factors: string[];
}

export type MailKind = "complaint" | "bulletin" | "applications" | "spam";

/** H2a — MAILBOX's content. Bulletins take effect at DELIVERY, not on
 *  read: reading is how the player learns, never how rules activate, so
 *  ignoring your mail can never dodge escalation. */
export interface Mail {
  day: number;
  kind: MailKind;
  /** i18n key, per house style — English only in source. */
  subjectKey: string;
  fields: Record<string, string>;
  read: boolean;
}

/** H2a — one of the three daily objectives, posted at the morning rollover
 *  and settled at the night audit. */
export interface Objective {
  day: number;
  kind: string;
  target: number;
  progress: number;
  done: boolean;
  rewardMinor: number;
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
  // -- H2a --
  /** Star tier. Recomputed at the audit ONLY (day granularity: the rule set
   *  a shift starts with is the rule set it ends with). Reachable range
   *  this phase is 1..2. */
  stars: number;
  /** Per-segment reputation in permille, recomputed at each audit from the
   *  rolling review window. */
  repBySegment: Record<string, number>;
  /** Nightly room rate per tier, in minor units — what PRICER sets. */
  rateByTier: Record<string, number>;
  /** Today's arrival quota, computed at the day rollover from the demand
   *  curve; `arrivalsSpawned` is how many of it have arrived so far. The
   *  H1 gates pin the fixed-schedule path instead (see ScenarioConfig). */
  arrivalsToday: number;
  arrivalsSpawned: number;
  /** True once closing cash has crossed the hire threshold. Diegetic and
   *  printed — LEDGER shows the locked line and the gap every night. */
  hireUnlocked: boolean;
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

/** A named list of values that `RuleContext.lists` is built from — the
 *  seam rules.ts's `listed` check kind was designed against, activated in
 *  Phase H2a. MAILBOX bulletins append values; nothing ever mutates the
 *  RULE TABLE at runtime (H2 determinism rule 7 — rows stay committed
 *  data, world state is what changes). One entity per list id. */
export interface NoticeList {
  listId: string;
  values: string[];
}

/** Singleton — the repath round-robin cursor. A component, never a closure
 *  variable (docs/PHASE-H1.md, "no closure state", edge (b); also the
 *  Phase-3 review item-1 lesson: Sim.restore() reruns setup() fresh, so
 *  anything the sim needs across ticks must live here, not in a JS
 *  variable captured by a system closure). */
export interface NavSchedule {
  lastServedId: number;
}
