/**
 * Core-only sim module for Phase H1a "The Queue", extending H0's "Walk the
 * Lobby". Imports ONLY @claude-engine/core, @claude-engine/space, and
 * @claude-engine/interiors (headless-safe: no three, no DOM, zero `Math.`
 * transcendentals anywhere in this purity root). See docs/PHASE-H1.md.
 *
 * Determinism / no-closure-state (Phase-3 review item 1, re-applied here):
 * `generateGroundFloor(seed)` is a pure function of the seed alone, called
 * once in `setup()` and captured by system closures — legal, exactly as in
 * H0, because it is setup-derived deterministic data that never changes
 * after setup and is byte-identically re-derived by Sim.restore()'s fresh
 * setup() run. `config` (the ScenarioConfig passed to setupWithConfig) is
 * likewise a legal closure capture: static, seed-independent, and supplied
 * identically on every fresh setup() call a harness/host makes. What is
 * NOT a legal closure capture is anything that changes after tick 1 —
 * guest FSM state, queue membership, paths, decisions, cash, the repath
 * round-robin cursor. All of that lives in components (see components.ts)
 * and nowhere else. Two sharp edges called out by the spec:
 *   (a) the queue is DERIVED every tick (guestBrainSystem compacts
 *       queueIndex from a fresh scan of withComponent("guest")) — never a
 *       closure array of queue entities.
 *   (b) the repath cursor lives in the `navSchedule` SINGLETON COMPONENT,
 *       never a closure variable.
 */
import type { Command, EntityId, Sim } from "@claude-engine/core";
import {
  atan2Mdeg,
  angleDeltaMdeg,
  cosMdeg,
  sinMdeg,
  isqrt,
  FULL_TURN_MDEG,
  moveCircle,
  cellAt,
  cellOfMm,
  CELL,
  CELL_SIZE_MM,
  type NavGrid,
} from "@claude-engine/space";
import { generateGroundFloor, type GroundFloor } from "@claude-engine/interiors";
import type {
  Pos,
  Yaw,
  Collider,
  Door,
  Interactable,
  Player,
  ActorId,
  Guest,
  NavAgent,
  PathCell,
  DocumentComp,
  DocType,
  Reservation,
  RoomUnit,
  Terminal,
  ScreenApp,
  Hotel,
  LedgerEntry,
  NavSchedule,
  NoticeList,
  Mess,
  Prop,
  Review,
  Objective,
  Staffed,
  Mail,
  SaveRestoreDebug,
} from "./components.js";
import { buildOpenCellSet, buildOccupancy, makeIsOpen, findJitteredPath } from "./nav.js";
import {
  H1_RULES,
  plantViolation,
  plantableRules,
  rulesForStars,
  type RuleContext,
  type RuleDoc,
  type ResFields,
} from "./rules.js";
import { pickArchetype, pickGuestName, makeResCode, makeDocNumber } from "./guests.js";
import {
  scoreReview,
  reputationBySegment,
  overallReputation,
  starsFromReputation,
  REVIEW_WINDOW_DAYS,
  DEFAULT_REP_PERMILLE,
  type ReviewRow,
} from "./reviews.js";
import {
  arrivalsForDay,
  totalArrivals,
  generateObjectives,
  OBJECTIVE_KINDS,
  HIRE_THRESHOLD_MINOR,
  DAILY_UTILITIES_MINOR as UTILITIES_MINOR,
  DAILY_OVERHEAD_MINOR,
} from "./economy.js";
import { hotelShell, buildScreenWorldView } from "./screen.js";
import type { ScreenInput, ScreenEffect } from "@claude-engine/surface-ui";

export type {
  Pos,
  Yaw,
  Collider,
  Door,
  Interactable,
  InteractableKind,
  Player,
  ActorId,
  Guest,
  GuestState,
  NavAgent,
  PathCell,
  DocumentComp,
  DocType,
  Reservation,
  RoomUnit,
  Terminal,
  ScreenApp,
  Hotel,
  LedgerEntry,
  NavSchedule,
  NoticeList,
  Mess,
  Prop,
  Staffed,
  Candidate,
  Review,
  Mail,
  Objective,
  SaveRestoreDebug,
} from "./components.js";

export const PLAYER_ENTITY: EntityId = 1;
export const PLAYER_ACTOR = "player";

/** 4 m/s at the sim's fixed 20 Hz tick rate — H0's player speed, unchanged. */
export const MOVE_SPEED_MM_PER_TICK = 200;
/** Guest walk speed per determinism rules: 150 mm/tick. */
export const GUEST_SPEED_MM_PER_TICK = 150;
export const PLAYER_RADIUS_MM = 300;
export const GUEST_RADIUS_MM = 300;
export const INTERACTABLE_RADIUS_MM = 1500;
export const INTERACTABLE_ARC_MDEG = 60_000;
export const DESK_RADIUS_MM = 1500;

/** Repath budget per tick (determinism rules / spec system-order item 5). */
const REPATH_BUDGET = 10;
/** stuckTicks threshold that fires nav.stuck (roadmap risk 4 tripwire). */
const STUCK_THRESHOLD = 40;

/** 5 minutes/day at 20 Hz, 4 equal phases (spec system-order item 11). */
const DAY_TICKS = 4 * 1500;
const PHASE_TICKS = 1500;

/** How long an accepted guest stays before checking out (implementer
 *  judgment call — the spec leaves guest patience/stay tuning free, open
 *  question 4).
 *
 *  Tuned in H1a lane 7 against the `checkin-rush` gate's own fixed
 *  numbers (8 guests arriving over ticks 100-900, 4 bedrooms, a 2400-tick
 *  run). The value has to satisfy two opposing constraints at once:
 *
 *   - short enough that the 4-room pool turns over and ALL 8 guests get a
 *     room inside the run (the gate asserts 8 `guest.checkedIn`), and
 *   - long enough that the run does not END with an empty hotel, or the
 *     gate's occupancy-consistency and "checked-in guest is inside its
 *     assigned room" assertions become vacuously true against zero guests
 *     — exactly the hardcoded-`[]` failure mode H0's review round 1
 *     rejected.
 *
 *  At 500 the whole hotel had emptied out by ~tick 1500 and those two
 *  assertions were checking nothing. At 1600 the first four guests check
 *  in around ticks 170-430 and check out around 1770-2030, the second
 *  four take those rooms immediately after and are still `inRoom` when
 *  the run ends: 8 check-ins AND a non-empty final state. */
const STAY_TICKS = 1600;

/** Half-length, in cells, of the "headon" fixture's Z-axis (mirrored) pair
 *  leg, measured from the lobby spawn cell. 3 keeps both endpoints inside
 *  the lobby for every generated lobbyDepth (9..12 cells, spawn always at
 *  its mid-row) with a cell of wall clearance to spare — see the fixture
 *  block in setupWithConfig. */
const HEADON_Z_HALF_SPAN = 3;

/** Opening nightly rates per tier, in minor units. H2a moves the live
 *  rates into `hotel.rateByTier` (PRICER edits them); this is the starting
 *  table and the fallback when a tier is missing. Keys are strings because
 *  the component is JSON-plain and JSON object keys are strings — reading
 *  it back through a number key would silently miss. */
const DEFAULT_RATE_BY_TIER: Record<string, number> = { "1": 5000, "2": 8000 };
const ROOM_RATE_MINOR: Record<number, number> = { 1: 5000, 2: 8000 };
/** H1 shipped a flat "wages" line even with no staff. H2a splits it: the
 *  owner's own draw is overhead, and WAGES are the sum of the `staffed`
 *  components — so hiring shows up on the expense line as a real change,
 *  which is the whole point of the first-hire beat's economics. */
const DAILY_WAGES_MINOR = DAILY_OVERHEAD_MINOR;
const DAILY_UTILITIES_MINOR = UTILITIES_MINOR;

/** Housekeeping/maintenance content (docs/PHASE-H2.md §9, open question 2).
 *  Comedy flavour only — no system reads the kind. */
const MESS_KINDS: readonly string[] = [
  "pizza-box",
  "mystery-stain",
  "towel-mountain",
  "minibar-carnage",
  "suspicious-glitter",
];
const PROP_KINDS: readonly string[] = ["tv", "radiator", "lamp", "icebox"];

/** A checkout leaves 2..4 discrete messes — bounded by spec. */
const MESS_MIN = 2;
const MESS_MAX = 4;
/** Repair is this many `interact` presses. Bounded, no consumables, no
 *  failure state — the zen ruling's "one verb" (DESIGN §6, H2 spec §9). */
const REPAIR_STEPS = 3;
/** Per-prop chance, per night, of breaking. Drawn once per prop at the day
 *  rollover from forkRng("upkeep"). */
const BREAKAGE_PERMILLE = 150;

export type InteractDeniedReason =
  | "no-interactable"
  | "out-of-range"
  | "out-of-arc"
  | "not-a-door"
  | "not-presenting-eligible"
  | "not-broken"
  | "not-a-mess";

// -- Scenario config hook (spec: "Scenario config hook") ------------------

export interface ScenarioConfig {
  guestCount: number;
  spawnTickMin: number;
  /** Per-mille (0..1000) chance a spawned guest's documents are planted
   *  with exactly one violation via rules.ts's plantViolation. */
  fraudRatePermille: number;
  /** "headon" spawns no scheduled guests and instead places two head-on
   *  navAgent PAIRS with swapped starts/goals — one along X (the queue
   *  row), one along Z (a column through the lobby spawn cell), the
   *  mirror of the first with the id/direction relation flipped. Both
   *  members of a pair share one jitterSeed so they genuinely want the
   *  same lane; see the fixture block in setupWithConfig and
   *  scenarios/corridor-headon.scenario.mjs. */
  fixture: "normal" | "headon";
  /** H2a housekeeping/maintenance. When false, no props are created, no
   *  checkout leaves a mess, and nothing ever breaks.
   *
   *  The H1 gates pin this FALSE, for the same reason determinism rule 8
   *  pins them to the fixed-schedule spawn path: `checkin-rush`'s whole
   *  design is 8 guests serialising through 4 rooms, and `STAY_TICKS` was
   *  tuned against exactly that turnover. Letting checkouts dirty rooms
   *  would silently re-tune an H1 gate from an H2 content change — the
   *  opposite of what those gates are for. The shipped default is true,
   *  and `zen-clean` / `one-man-week` are what verify it. */
  upkeep: boolean;
  /** H2a arrivals. "fixed" is H1's schedule (`guestCount` guests, first at
   *  `spawnTickMin`, then every 50-150 ticks) — pinned by the H1 gates so
   *  their spawn streams stay byte-identical (determinism rule 8).
   *  "demand" is the shipped path: a per-day quota computed at the rollover
   *  from price, per-segment reputation and stars. */
  arrivals: "fixed" | "demand";
}

// H1a shipped `spawnTickMax` in ScenarioConfig but guestSpawnSystem never
// read it (the actual spawn cadence is `nextGuestAtTick`, advanced each
// spawn by `50 + guestSpawnRng.int(0, 100)`, seeded only from
// `spawnTickMin`). Phase-H1a review deferral item 3 ("enforce or delete")
// — deleted here rather than enforced: nothing in the H1a gates asserts an
// upper bound on spawn timing (checkin-rush only counts `guest.checkedIn`
// and checks final occupancy), so wiring it in would change the spawn
// stream those gates already golden-verify, which the same review flagged
// as the thing to avoid ("if a gate's behaviour changes, stop").
export const DEFAULTS: ScenarioConfig = {
  guestCount: 8,
  spawnTickMin: 100,
  fraudRatePermille: 0,
  fixture: "normal",
  upkeep: true,
  arrivals: "demand",
};

function wrapMdeg(mdeg: number): number {
  let m = mdeg % FULL_TURN_MDEG;
  if (m < 0) m += FULL_TURN_MDEG;
  return m;
}

function clampMilli(v: number): number {
  return Math.max(-1000, Math.min(1000, v));
}

/** Pure function of the seed alone — never touches the live sim.rng. Safe
 *  to call again outside setup() and get byte-identical results. */
export function loadGroundFloor(seed: string): GroundFloor {
  return generateGroundFloor(seed);
}

function cellMm(cx: number, cz: number): Pos {
  return { xMm: cx * CELL_SIZE_MM + CELL_SIZE_MM / 2, zMm: cz * CELL_SIZE_MM + CELL_SIZE_MM / 2 };
}

function computePhase(tick: number): { day: number; phaseId: number } {
  const day = Math.floor(tick / DAY_TICKS) + 1;
  const phaseId = Math.floor((tick % DAY_TICKS) / PHASE_TICKS);
  return { day, phaseId };
}

export function setup(sim: Sim): void {
  setupWithConfig(sim, DEFAULTS);
}

export function setupWithConfig(sim: Sim, config: ScenarioConfig): void {
  const floor = loadGroundFloor(sim.seed);
  const grid: NavGrid = floor.grid;
  // Portal cell lists indexed by doorIndex — the SAME seed-pure data H0's
  // isOpenAt used, just precomputed once here (still legal closure capture:
  // pure derivation of `floor`, never mutated).
  const portalCellsByDoorIndex: { cx: number; cz: number }[][] = floor.doors.map(
    (d) => floor.portals.portals[d.doorIndex]?.cells ?? []
  );

  // Guest RNG: registered forks so snapshot()/restore() capture the exact
  // future-guest stream (determinism rule 4 / spec "Guest RNG uses
  // sim.forkRng").
  const guestSpawnRng = sim.forkRng("guest-spawn");
  const guestFraudRng = sim.forkRng("guest-fraud");
  // H2a's four new streams. Registered here, in this order, for every
  // config — a fork's mere existence draws nothing, and a label set that
  // varies by config would make snapshots config-specific. Registering
  // them is what breaks H1 saves at Sim.restore()'s label check, which is
  // the documented policy (docs/PHASE-H2.md non-goals: no save migration
  // pre-1.0; the boot path treats a RestoreError as "no save").
  const demandRng = sim.forkRng("demand");
  const staffRng = sim.forkRng("staff");
  const objectivesRng = sim.forkRng("objectives");
  const upkeepRng = sim.forkRng("upkeep");
  void staffRng;

  // -- Player (as H0) ------------------------------------------------------
  const player = sim.spawn(); // == PLAYER_ENTITY: first entity spawned
  sim.setComponent<Pos>(player, "pos", { xMm: floor.spawn.xMm, zMm: floor.spawn.zMm });
  sim.setComponent<Pos>(player, "prevPos", { xMm: floor.spawn.xMm, zMm: floor.spawn.zMm });
  sim.setComponent<Yaw>(player, "yaw", { mdeg: wrapMdeg(floor.spawn.yawMdeg) });
  sim.setComponent<Yaw>(player, "prevYaw", { mdeg: wrapMdeg(floor.spawn.yawMdeg) });
  sim.setComponent<Collider>(player, "collider", { radiusMm: PLAYER_RADIUS_MM });
  sim.setComponent<Player>(player, "player", { actor: PLAYER_ACTOR });
  // The human's avatar carries BOTH: `player` still marks "this is the
  // local human's body" (movement/face input target), while `actorId` is
  // what every who-acted lookup resolves through — see findActorEntity.
  sim.setComponent<ActorId>(player, "actorId", { actor: PLAYER_ACTOR });

  // -- Doors ----------------------------------------------------------------
  // Doors default CLOSED (open:false), exactly as H0. First judgment call
  // (doors default open) broke the H0 fps-look-interact gate's semantics —
  // reverted. Guests do not get a special "doors are open for me" world;
  // they open the same door.open bit through the same mechanism the
  // player uses (see the guest-door-opening block inside moveSystem,
  // below), emitting the identical "door" event. One bit, one behaviour,
  // for everyone — now actually true rather than only true when nobody
  // ever finds a closed door.
  const doorEntityByIndex: EntityId[] = [];
  // cellIndex (cz*width+cx) -> doorIndex, for every cell any door spans —
  // used by the guest-door-opening logic to find "which door am I facing"
  // from a plain path cell. Seed-pure (derived from `floor` alone, like
  // `portalCellsByDoorIndex` above), so a legal closure capture.
  const doorIndexByCell = new Map<number, number>();
  for (const doorSpec of floor.doors) {
    const doorEntity = sim.spawn();
    doorEntityByIndex[doorSpec.doorIndex] = doorEntity;
    sim.setComponent<Door>(doorEntity, "door", {
      doorIndex: doorSpec.doorIndex,
      open: false,
      cx: doorSpec.cx,
      cz: doorSpec.cz,
    });
    sim.setComponent<Interactable>(doorEntity, "interactable", {
      kind: "door",
      xMm: doorSpec.xMm,
      zMm: doorSpec.zMm,
      radiusMm: INTERACTABLE_RADIUS_MM,
      arcMdeg: INTERACTABLE_ARC_MDEG,
    });
    for (const cell of portalCellsByDoorIndex[doorSpec.doorIndex] ?? []) {
      doorIndexByCell.set(cell.cz * grid.width + cell.cx, doorSpec.doorIndex);
    }
  }

  // -- Rooms ------------------------------------------------------------
  const roomEntityByRoomId = new Map<number, EntityId>();
  for (const bedroom of floor.bedrooms) {
    const roomEntity = sim.spawn();
    roomEntityByRoomId.set(bedroom.roomId, roomEntity);
    sim.setComponent<RoomUnit>(roomEntity, "roomUnit", {
      roomId: bedroom.roomId,
      tier: bedroom.tier,
      occupantEntity: 0,
      messCount: 0,
    });
  }
  const bedroomByRoomId = new Map(floor.bedrooms.map((b) => [b.roomId, b]));

  // Every walkable, non-doorway cell of each bedroom, in ascending cell
  // index. Pure derivation of `floor` (which is a pure function of the
  // seed), so this is a legal closure capture exactly like
  // `portalCellsByDoorIndex` — and the placement pool messes and props are
  // drawn from.
  const bedroomCellsByRoomId = new Map<number, PathCell[]>();
  for (const bedroom of floor.bedrooms) {
    const cells: PathCell[] = [];
    for (let cz = 0; cz < grid.height; cz++) {
      for (let cx = 0; cx < grid.width; cx++) {
        if (floor.rooms[cz * grid.width + cx] !== bedroom.roomId) continue;
        const cell = cellAt(grid, cx, cz);
        if ((cell & CELL.WALKABLE) === 0) continue;
        if (cell & CELL.DOOR) continue;
        cells.push({ cx, cz });
      }
    }
    bedroomCellsByRoomId.set(bedroom.roomId, cells);
  }

  // -- Front desk terminal ------------------------------------------------
  const terminal = sim.spawn();
  sim.setComponent<Pos>(terminal, "pos", { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
  sim.setComponent<Yaw>(terminal, "yaw", { mdeg: wrapMdeg(floor.desk.yawMdeg) });
  sim.setComponent<Terminal>(terminal, "terminal", { station: "frontdesk", focusedBy: "" });
  sim.setComponent<ScreenApp>(terminal, "screenApp", { state: hotelShell.init(), paintSeq: 0 });
  sim.setComponent<Interactable>(terminal, "interactable", {
    kind: "terminal",
    xMm: floor.desk.xMm,
    zMm: floor.desk.zMm,
    radiusMm: DESK_RADIUS_MM,
    arcMdeg: INTERACTABLE_ARC_MDEG,
  });

  // -- Hotel singleton ------------------------------------------------------
  const hotelEntity = sim.spawn();
  const { day: day0, phaseId: phaseId0 } = computePhase(0);
  sim.setComponent<Hotel>(hotelEntity, "hotel", {
    cash: 0,
    day: day0,
    phaseId: phaseId0,
    phaseStartTick: 0,
    nextGuestAtTick: config.spawnTickMin,
    guestsSpawned: 0,
    stars: 1,
    repBySegment: {},
    rateByTier: { ...DEFAULT_RATE_BY_TIER },
    // Day 1 has no rollover behind it, so its quota is drawn here — the
    // same call, the same fork, one day earlier. Without this the shipped
    // demand path would open on an empty first day.
    arrivalsToday:
      config.arrivals === "demand"
        ? totalArrivals(
            arrivalsForDay(demandRng, { ...DEFAULT_RATE_BY_TIER }, {}, 1, DEFAULT_REP_PERMILLE)
          )
        : 0,
    arrivalsSpawned: 0,
    hireUnlocked: false,
  });

  // -- Nav schedule singleton (the repath cursor — a component, not a
  //    closure variable) ---------------------------------------------------
  const navScheduleEntity = sim.spawn();
  sim.setComponent<NavSchedule>(navScheduleEntity, "navSchedule", { lastServedId: 0 });

  const streetDoor = floor.doors[floor.entranceDoorIndex]!;
  // The door's CENTER cell, not its anchor (`cx`/`cz`, the span's
  // lowest-coordinate cell) — see nav.ts's `hasClearance` doc comment: an
  // edge cell of a DOOR_WIDTH_CELLS span sits too close to the jamb for a
  // 300mm-radius collider, so it isn't a legal walk-through/goal point.
  const streetCell: PathCell = cellOfMm(grid, streetDoor.xMm, streetDoor.zMm);

  // -- headon fixture: two head-on navAgent PAIRS, swapped goals --------
  //
  // Gate 1 (`corridor-headon`) exists to prove the yield rule resolves a
  // genuine head-on conflict, so the fixture's whole job is to MANUFACTURE
  // that conflict rather than hope for it. Two things make it structural:
  //
  //  1. Both members of a pair share ONE `jitterSeed`. Per determinism
  //     rule 5 the A* step cost is `1 + jitter(agentSeed, cell)`, so two
  //     agents with different seeds see different cost fields and, in an
  //     open room, simply pick different lanes and glide past each other
  //     (measured: with per-agent seeds the pair never once contended).
  //     One shared seed gives them one identical cost field, so the cheapest
  //     route from A to B is the reverse of the cheapest route from B to A —
  //     they want the same cells, in opposite order, at the same time.
  //  2. Each pair starts AT the other's goal, on one axis, so the conflict
  //     is exactly head-on rather than a crossing.
  //
  // Pair 1 runs along X (the queue row); pair 2 is its mirror on Z (a
  // column through the lobby spawn cell), with the id/direction relation
  // flipped: pair 1's LOWER id starts at the low-coordinate end, pair 2's
  // lower id starts at the HIGH-coordinate end. That matters because the
  // yield rule is asymmetric in EntityId (lower id has priority), so the
  // mirrored pair exercises the "higher-id occupant, sidestep-repath"
  // branch as well as the "wait" branch.
  if (config.fixture === "headon") {
    const qLen = floor.desk.queueCells.length;
    const spawnCell = cellOfMm(grid, floor.spawn.xMm, floor.spawn.zMm);
    const pairs: { from: PathCell; to: PathCell }[][] = [
      // Pair 1, X axis: queue row, west end <-> east end. Lower id west.
      [
        { from: floor.desk.queueCells[0]!, to: floor.desk.queueCells[qLen - 1]! },
        { from: floor.desk.queueCells[qLen - 1]!, to: floor.desk.queueCells[0]! },
      ],
      // Pair 2, Z axis (mirrored): a column through the lobby spawn cell,
      // south end <-> north end. Lower id SOUTH (the mirror of pair 1).
      [
        {
          from: { cx: spawnCell.cx, cz: spawnCell.cz + HEADON_Z_HALF_SPAN },
          to: { cx: spawnCell.cx, cz: spawnCell.cz - HEADON_Z_HALF_SPAN },
        },
        {
          from: { cx: spawnCell.cx, cz: spawnCell.cz - HEADON_Z_HALF_SPAN },
          to: { cx: spawnCell.cx, cz: spawnCell.cz + HEADON_Z_HALF_SPAN },
        },
      ],
    ];
    // Pair 3 is NOT head-on — it is the SIDESTEP fixture (H1b review
    // deferral 4b). The lower-id agent walks east along row 14; the
    // higher-id agent is PARKED on its first step (goal == its own cell,
    // so pathSystem skips it and moveSystem never moves it). That is the
    // only configuration that reaches moveSystem's `occupant > entity`
    // branch: a higher-id occupant that will not vacate. The mover must
    // detour around it and still land on its goal, which is what proves
    // the branch resolves rather than merely fires.
    pairs.push([
      { from: { cx: 30, cz: 14 }, to: { cx: 40, cz: 14 } },
      { from: { cx: 31, cz: 14 }, to: { cx: 31, cz: 14 } },
    ]);
    for (const pair of pairs) {
      // One draw per PAIR, shared by both of its agents (see note 1 above).
      const pairJitterSeed = guestSpawnRng.int(0, 0x7fffffff);
      for (const { from, to } of pair) {
        const mm = cellMm(from.cx, from.cz);
        const agent = sim.spawn();
        sim.setComponent<Pos>(agent, "pos", mm);
        sim.setComponent<Pos>(agent, "prevPos", mm);
        sim.setComponent<Yaw>(agent, "yaw", { mdeg: 0 });
        sim.setComponent<Yaw>(agent, "prevYaw", { mdeg: 0 });
        sim.setComponent<Collider>(agent, "collider", { radiusMm: GUEST_RADIUS_MM });
        sim.setComponent<NavAgent>(agent, "navAgent", {
          goalCx: to.cx,
          goalCz: to.cz,
          path: [],
          pathIdx: 0,
          repathAtTick: 0,
          jitterSeed: pairJitterSeed,
          stuckTicks: 0,
          avoidCx: -1,
          avoidCz: -1,
        });
      }
    }
  }

  // -- Props: one breakable prop per bedroom (H2a) -----------------------
  //
  // Created AFTER the headon fixture block on purpose: `corridor-headon`
  // asserts against committed entity ids, and inserting spawns ahead of the
  // fixture would shift them. (That gate also pins `upkeep: false`, so it
  // creates none — belt and braces, because the ordering constraint is the
  // kind of thing a later edit breaks silently.)
  if (config.upkeep) {
    for (const bedroom of floor.bedrooms) {
      const cells = bedroomCellsByRoomId.get(bedroom.roomId) ?? [];
      if (cells.length === 0) continue;
      const roomEntity = roomEntityByRoomId.get(bedroom.roomId);
      if (roomEntity === undefined) continue;
      const kind = upkeepRng.pick(PROP_KINDS);
      const cell = upkeepRng.pick(cells);
      const propEntity = sim.spawn();
      const mm = cellMm(cell.cx, cell.cz);
      sim.setComponent<Prop>(propEntity, "prop", {
        kind,
        roomEntity,
        broken: false,
        repairProgress: 0,
      });
      sim.setComponent<Pos>(propEntity, "pos", mm);
      sim.setComponent<Interactable>(propEntity, "interactable", {
        kind: "prop",
        xMm: mm.xMm,
        zMm: mm.zMm,
        radiusMm: INTERACTABLE_RADIUS_MM,
        arcMdeg: INTERACTABLE_ARC_MDEG,
      });
    }
  }

  // === The per-tick index (docs/PHASE-H2.md §6 system 1, §12 item 1) ====
  //
  // ONE object, rebuilt in full at the start of every tick by
  // `indexSystem` and dead at tick end. This is the H1 "per-tick locals"
  // rule hoisted so the shared scans happen once instead of once per
  // reader — NOT closure state: `ctxFor` keys the cached object on
  // `s.tick` and rebuilds whenever the tick differs, so a fresh setup()
  // after `Sim.restore()` (or any caller reaching a system out of order)
  // can never be served a context from a tick that no longer exists.
  //
  // Two of its fields are deliberately MUTABLE by their writers, because
  // that is what the pre-index code did with its local copies and the
  // goldens encode it:
  //   - `openCells`: moveSystem's guest-door-opening block adds the cells
  //     of a door it just opened so the same tick's later agents see it
  //     open (the local copy did exactly this).
  //   - `occupancy`: moveSystem moves agents between cells as it walks
  //     them, and `guestSpawnSystem` inserts a guest it spawns THIS tick
  //     (the old code built occupancy inside moveSystem, i.e. after the
  //     spawn, so a tick-new guest was present — dropping it would change
  //     which agents yield, and therefore the goldens).
  interface TickContext {
    tick: number;
    openCells: Set<number>;
    isOpen: (cx: number, cz: number) => boolean;
    occupancy: Map<number, EntityId>;
    /** Named lists for `RuleContext.lists`, rebuilt per tick from the
     *  `noticeList` components (never cached across ticks — determinism
     *  rule 3 of the H2 spec). Empty until MAILBOX delivers a bulletin. */
    lists: Record<string, string[]>;
  }

  let tickCtx: TickContext | null = null;

  function buildTickContext(s: Sim): TickContext {
    const openCells = buildOpenCellSet(s, grid.width, portalCellsByDoorIndex);
    const lists: Record<string, string[]> = {};
    for (const [, list] of s.withComponent<NoticeList>("noticeList")) {
      const bucket = lists[list.listId] ?? (lists[list.listId] = []);
      for (const value of list.values) bucket.push(value);
    }
    return {
      tick: s.tick,
      openCells,
      isOpen: makeIsOpen(openCells, grid.width),
      occupancy: buildOccupancy(s, grid.width),
      lists,
    };
  }

  function ctxFor(s: Sim): TickContext {
    if (tickCtx === null || tickCtx.tick !== s.tick) tickCtx = buildTickContext(s);
    return tickCtx;
  }

  // === Systems ============================================================

  // 0. indexSystem — builds the per-tick context, first, before any reader.
  function indexSystem(s: Sim): void {
    tickCtx = buildTickContext(s);
  }

  // 1. snapshotPrevSystem — now over ALL pos/yaw holders, not just player.
  //    Skips the write when the value is already identical: the resulting
  //    state (and therefore the hash) is the same either way, but a
  //    needless setComponent() dirties the incremental hash's cache entry
  //    for every static prop, every tick.
  function snapshotPrevSystem(s: Sim): void {
    for (const [entity, pos] of s.withComponent<Pos>("pos")) {
      const prev = s.getComponent<Pos>(entity, "prevPos");
      if (prev && prev.xMm === pos.xMm && prev.zMm === pos.zMm) continue;
      s.setComponent<Pos>(entity, "prevPos", { xMm: pos.xMm, zMm: pos.zMm });
    }
    for (const [entity, yaw] of s.withComponent<Yaw>("yaw")) {
      const prev = s.getComponent<Yaw>(entity, "prevYaw");
      if (prev && prev.mdeg === yaw.mdeg) continue;
      s.setComponent<Yaw>(entity, "prevYaw", { mdeg: yaw.mdeg });
    }
  }

  // 2. faceSystem — player, as H0.
  function faceSystem(s: Sim): void {
    const seenActors = new Set<string>();
    for (const c of s.commands()) {
      if (c.type !== "face") continue;
      if (seenActors.has(c.actor)) continue;
      seenActors.add(c.actor);
      if (c.actor !== PLAYER_ACTOR) continue;
      const { yawMdeg } = c.payload as { yawMdeg: number };
      s.setComponent<Yaw>(player, "yaw", { mdeg: wrapMdeg(yawMdeg) });
    }
  }

  /** The `RuleContext` for this tick — rebuilt from the tick index's
   *  `noticeList` scan every time it is asked for, never cached across
   *  ticks (H2 determinism rule 3). */
  function ruleCtx(s: Sim, hotel: Hotel): RuleContext {
    return { day: hotel.day, lists: ctxFor(s).lists };
  }

  // 3. guestSpawnSystem — spawn guest + documents + reservation from
  //    forkRng("guest-spawn"); plant a violation via forkRng("guest-fraud")
  //    per the configured rate.
  function guestSpawnSystem(s: Sim): void {
    if (config.fixture === "headon") return; // fixture spawns nothing scheduled
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    // Check-in phases: morning (0) and day (1).
    if (hotel.phaseId !== 0 && hotel.phaseId !== 1) return;
    if (config.arrivals === "demand") {
      if (hotel.arrivalsSpawned >= hotel.arrivalsToday) return;
    } else if (hotel.guestsSpawned >= config.guestCount) {
      return;
    }
    if (s.tick < hotel.nextGuestAtTick) return;

    const archetype = pickArchetype(guestSpawnRng);
    const name = pickGuestName(archetype, guestSpawnRng);
    const resCode = makeResCode(guestSpawnRng);
    const docNumber = makeDocNumber(guestSpawnRng);
    const expiresDay = hotel.day + 200 + guestSpawnRng.int(0, 200);
    const jitterSeed = guestSpawnRng.int(0, 0x7fffffff);

    let ruleDocs: RuleDoc[] = [
      { docType: "id", fields: { name, docNumber, expiresDay: String(expiresDay) } },
      { docType: "resSlip", fields: { guestName: name, resCode } },
    ];
    let resFields: ResFields = { guestName: name, resCode };
    const plantedViolations: string[] = [];

    if (guestFraudRng.int(0, 999) < config.fraudRatePermille) {
      // Plant only among rows that are BOTH active at the current star tier
      // and violable in this world right now (docs/PHASE-H2.md deferral
      // 4d): a `listed`/absent row with an empty list has no value that
      // would violate it, so planting it would hand the desk an
      // uncatchable "fraud". H1's gates run at stars 1 with no lists, so
      // this filters to exactly H1's five rows and their streams are
      // unchanged.
      const activeRules = plantableRules(rulesForStars(H1_RULES, hotel.stars), ruleCtx(s, hotel));
      const planted = plantViolation(activeRules, guestFraudRng, ruleDocs, resFields, ruleCtx(s, hotel));
      ruleDocs = planted.docs;
      resFields = planted.resFields;
      plantedViolations.push(planted.failFlag);
    }

    const guestEntity = s.spawn();
    for (const doc of ruleDocs) {
      const docEntity = s.spawn();
      s.setComponent<DocumentComp>(docEntity, "document", {
        docType: doc.docType as DocType,
        fields: doc.fields,
        ownerEntity: guestEntity,
        heldBy: 0,
      });
    }
    const resEntity = s.spawn();
    s.setComponent<Reservation>(resEntity, "reservation", {
      guestEntity,
      fields: resFields,
      plantedViolations,
      decided: false,
      accepted: false,
      roomEntity: 0,
    });
    s.setComponent<Guest>(guestEntity, "guest", {
      archetypeId: archetype.id,
      segment: archetype.segment,
      state: "arriving",
      roomEntity: 0,
      stayUntilTick: 0,
      queueIndex: -1,
      patienceTicks: 0,
      waitedTicks: 0,
      brokenPropNights: 0,
      paidMinor: 0,
    });
    const spawnMm = cellMm(streetCell.cx, streetCell.cz);
    s.setComponent<Pos>(guestEntity, "pos", spawnMm);
    s.setComponent<Pos>(guestEntity, "prevPos", spawnMm);
    s.setComponent<Yaw>(guestEntity, "yaw", { mdeg: 0 });
    s.setComponent<Yaw>(guestEntity, "prevYaw", { mdeg: 0 });
    s.setComponent<Collider>(guestEntity, "collider", { radiusMm: GUEST_RADIUS_MM });
    s.setComponent<NavAgent>(guestEntity, "navAgent", {
      goalCx: streetCell.cx,
      goalCz: streetCell.cz,
      path: [],
      pathIdx: 0,
      repathAtTick: 0,
      jitterSeed,
      stuckTicks: 0,
      avoidCx: -1,
      avoidCz: -1,
    });
    // The pre-index code built `occupancy` inside moveSystem, i.e. AFTER
    // this system ran, so a guest spawned this tick was already on its
    // cell for that tick's yield checks. Keep that exactly.
    const spawnCtx = ctxFor(s);
    spawnCtx.occupancy.set(streetCell.cz * grid.width + streetCell.cx, guestEntity);
    s.emit("guest.arrived", { guestEntity });

    const interval = 50 + guestSpawnRng.int(0, 100);
    s.setComponent<Hotel>(hotelEntity, "hotel", {
      ...hotel,
      guestsSpawned: hotel.guestsSpawned + 1,
      arrivalsSpawned: hotel.arrivalsSpawned + 1,
      nextGuestAtTick: s.tick + interval,
    });
  }

  // 4. guestBrainSystem — the FSM.
  function guestBrainSystem(s: Sim): void {
    // One pass over the `guest` store per tick instead of five: the id list
    // is collected once (membership cannot change inside this system —
    // spawning happens before it, despawning after), and every phase below
    // re-READS each guest's component through getComponent, so a phase
    // still sees the transitions an earlier phase made. Behaviour-identical
    // to the five separate scans; the goldens are the proof.
    const guestIds: EntityId[] = [];
    for (const [entity] of s.withComponent<Guest>("guest")) guestIds.push(entity);

    // -- queue derivation (no closure array; scanned + compacted fresh) --
    const active: [EntityId, Guest][] = [];
    for (const entity of guestIds) {
      const guest = s.getComponent<Guest>(entity, "guest");
      if (!guest) continue;
      if ((guest.state === "queued" || guest.state === "presenting") && guest.queueIndex >= 0) {
        active.push([entity, guest]);
      }
    }
    active.sort((a, b) => {
      const d = a[1].queueIndex - b[1].queueIndex;
      return d !== 0 ? d : a[0] - b[0];
    });
    // Queue time is a stay FACT, accumulated on the guest and cashed out
    // once at the checkout review. Not a meter, not visible, not a running
    // score — day-granularity consequences (DESIGN §6).
    for (const [entity, guest] of active) {
      s.setComponent<Guest>(entity, "guest", { ...guest, waitedTicks: guest.waitedTicks + 1 });
    }
    const activeAfterWait: [EntityId, Guest][] = active.map(([entity]) => [
      entity,
      s.getComponent<Guest>(entity, "guest")!,
    ]);
    activeAfterWait.forEach(([entity, guest], i) => {
      if (guest.queueIndex === i) return;
      s.setComponent<Guest>(entity, "guest", { ...guest, queueIndex: i });
      // ...and WALK to the new slot. Compacting `queueIndex` without
      // re-issuing the nav goal (the original behaviour) advanced the
      // queue only on paper: a guest that arrived into slot 3 kept
      // slot 3's cell as its goal forever, so once it compacted to index
      // 0 it stood three cells short of the desk and never came into the
      // clerk's interact range. `checkin-rush` deadlocked there with the
      // whole line "queued" and nobody ever presenting. A `presenting`
      // guest is deliberately left alone — it is already at the desk and
      // must not be re-pathed mid-transaction.
      if (guest.state !== "queued") return;
      const slot = floor.desk.queueCells[i];
      if (slot) setGoal(s, entity, slot.cx, slot.cz);
    });
    let nextFreeSlot = active.length;

    // -- assign arriving guests to the back of the queue --
    const arriving: [EntityId, Guest][] = [];
    for (const entity of guestIds) {
      const guest = s.getComponent<Guest>(entity, "guest");
      if (guest && guest.state === "arriving") arriving.push([entity, guest]);
    }
    arriving.sort((a, b) => a[0] - b[0]);
    for (const [entity, guest] of arriving) {
      const qLen = floor.desk.queueCells.length;
      if (nextFreeSlot >= qLen) continue; // queue full; wait outside (retry next tick)
      const slot = floor.desk.queueCells[nextFreeSlot]!;
      s.setComponent<Guest>(entity, "guest", { ...guest, state: "queued", queueIndex: nextFreeSlot });
      setGoal(s, entity, slot.cx, slot.cz);
      s.emit("guest.queued", { guestEntity: entity, queueIndex: nextFreeSlot });
      nextFreeSlot++;
    }

    // -- presenting guests: react to a PRIOR tick's desk.decision outcome
    //    (deskSystem, item 8, runs after this system, so `decided` reflects
    //    the previous tick's decision by the time we read it here) --
    for (const entity of guestIds) {
      const guest = s.getComponent<Guest>(entity, "guest");
      if (!guest || guest.state !== "presenting") continue;
      const resEntity = findReservationFor(s, entity);
      if (resEntity === undefined) continue;
      const res = s.getComponent<Reservation>(resEntity, "reservation");
      if (!res || !res.decided) continue;
      if (res.accepted) {
        const room = s.getComponent<RoomUnit>(res.roomEntity, "roomUnit");
        const bedroom = room ? bedroomByRoomId.get(room.roomId) : undefined;
        s.setComponent<Guest>(entity, "guest", {
          ...guest,
          state: "toRoom",
          roomEntity: res.roomEntity,
          stayUntilTick: s.tick + STAY_TICKS,
        });
        if (bedroom) setGoal(s, entity, bedroom.goalCx, bedroom.goalCz);
      } else {
        s.setComponent<Guest>(entity, "guest", { ...guest, state: "leaving" });
        setGoal(s, entity, streetCell.cx, streetCell.cz);
      }
    }

    // -- toRoom -> inRoom on arrival --
    for (const entity of guestIds) {
      const guest = s.getComponent<Guest>(entity, "guest");
      if (!guest || guest.state !== "toRoom") continue;
      if (hasArrived(s, entity)) {
        s.setComponent<Guest>(entity, "guest", { ...guest, state: "inRoom" });
      }
    }

    // -- inRoom -> leaving at stayUntilTick --
    for (const entity of guestIds) {
      const guest = s.getComponent<Guest>(entity, "guest");
      if (!guest || guest.state !== "inRoom") continue;
      if (s.tick < guest.stayUntilTick) continue;
      if (guest.roomEntity !== 0) {
        const room = s.getComponent<RoomUnit>(guest.roomEntity, "roomUnit");
        if (room) s.setComponent<RoomUnit>(guest.roomEntity, "roomUnit", { ...room, occupantEntity: 0 });
        spawnMessesFor(s, guest.roomEntity);
      }
      s.setComponent<Guest>(entity, "guest", { ...guest, state: "leaving" });
      setGoal(s, entity, streetCell.cx, streetCell.cz);
      s.emit("guest.checkedOut", { guestEntity: entity });
    }
  }

  /** Post one piece of mail. MAILBOX content is world state, created by
   *  the systems that have something to say; `read` is set by the player's
   *  `mailbox.read` effect and by nothing else. Bulletins take effect at
   *  DELIVERY, never on read — see mailSystem. */
  function queueMail(s: Sim, day: number, kind: Mail["kind"], subjectKey: string, fields: Record<string, string>): void {
    const entity = s.spawn();
    s.setComponent<Mail>(entity, "mail", { day, kind, subjectKey, fields, read: false });
    s.emit("mail.delivered", { mailEntity: entity, kind, day });
  }

  /** Is this room sellable right now? Vacant, wiped, and not carrying a
   *  broken prop. A dirty or broken room is BLOCKED, never punished — the
   *  cost is the room-night you did not sell, and it lands at the audit
   *  like every other economic fact (docs/PHASE-H2.md §9). */
  function roomReady(s: Sim, roomEntity: EntityId): boolean {
    const room = s.getComponent<RoomUnit>(roomEntity, "roomUnit");
    if (!room) return false;
    if (room.occupantEntity !== 0) return false;
    if (room.messCount > 0) return false;
    for (const [, prop] of s.withComponent<Prop>("prop")) {
      if (prop.roomEntity === roomEntity && prop.broken) return false;
    }
    return true;
  }

  /** A checkout leaves 2..4 discrete, visible messes on the room's own
   *  cells. The player's progress bar is the literal count of objects still
   *  in front of them — never a meter, never a HUD. */
  function spawnMessesFor(s: Sim, roomEntity: EntityId): void {
    if (!config.upkeep) return;
    const room = s.getComponent<RoomUnit>(roomEntity, "roomUnit");
    if (!room) return;
    const cells = bedroomCellsByRoomId.get(room.roomId) ?? [];
    if (cells.length === 0) return;
    const count = MESS_MIN + upkeepRng.int(0, MESS_MAX - MESS_MIN);
    for (let i = 0; i < count; i++) {
      const kind = upkeepRng.pick(MESS_KINDS);
      const cell = upkeepRng.pick(cells);
      const messEntity = s.spawn();
      const mm = cellMm(cell.cx, cell.cz);
      s.setComponent<Mess>(messEntity, "mess", { roomEntity, kind });
      s.setComponent<Pos>(messEntity, "pos", mm);
      s.setComponent<Interactable>(messEntity, "interactable", {
        kind: "mess",
        xMm: mm.xMm,
        zMm: mm.zMm,
        radiusMm: INTERACTABLE_RADIUS_MM,
        arcMdeg: INTERACTABLE_ARC_MDEG,
      });
    }
    const after = s.getComponent<RoomUnit>(roomEntity, "roomUnit");
    if (after) s.setComponent<RoomUnit>(roomEntity, "roomUnit", { ...after, messCount: after.messCount + count });
    s.emit("room.messSpawned", { roomEntity, count });
  }

  function setGoal(s: Sim, entity: EntityId, goalCx: number, goalCz: number): void {
    const agent = s.getComponent<NavAgent>(entity, "navAgent");
    if (!agent) return;
    s.setComponent<NavAgent>(entity, "navAgent", { ...agent, goalCx, goalCz, path: [], pathIdx: 0 });
  }

  function hasArrived(s: Sim, entity: EntityId): boolean {
    const pos = s.getComponent<Pos>(entity, "pos");
    const agent = s.getComponent<NavAgent>(entity, "navAgent");
    if (!pos || !agent) return false;
    const cur = cellOfMm(grid, pos.xMm, pos.zMm);
    return cur.cx === agent.goalCx && cur.cz === agent.goalCz;
  }

  function findReservationFor(s: Sim, guestEntity: EntityId): EntityId | undefined {
    for (const [entity, res] of s.withComponent<Reservation>("reservation")) {
      if (res.guestEntity === guestEntity) return entity;
    }
    return undefined;
  }

  /** Who acted. Scans `actorId`, NOT `player` (ARCHITECTURE B9 / H2a): the
   *  hired clerk is an actor with no `player` component, and every
   *  validation path — interact, desk.decision, screen.* — must resolve it
   *  the same way it resolves the human. There is deliberately no branch on
   *  the literal "player" anywhere below this line. */
  function findActorEntity(s: Sim, actor: string): EntityId | undefined {
    for (const [entity, a] of s.withComponent<ActorId>("actorId")) {
      if (a.actor === actor) return entity;
    }
    return undefined;
  }

  // 5. pathSystem — repath budget <= 10 A* per tick, round-robin by
  //    ascending EntityId starting after navSchedule.lastServedId; the
  //    open-cell set and (jittered A* internally handles cost) are built
  //    once per tick, up front (determinism rule 6).
  //
  //    Guest PLANNING treats every door as passable regardless of its
  //    current `open` bit: guests are staff-side actors who open whatever
  //    they need (see moveSystem's guest-door-opening block) rather than
  //    detouring around a closed door the way the player must. This keeps
  //    A* from failing/rerouting around doors that are simply closed
  //    because nobody has walked through them yet — the entrance door in
  //    particular starts closed and MUST be plannable or no guest could
  //    ever route in from the street. Real collision (moveCircle, in
  //    moveSystem) still respects the true `open` bit at the moment of
  //    the move; opening happens there, just-in-time, before the guest
  //    steps through.
  function pathSystem(s: Sim): void {
    const isOpen = () => true;
    const schedule = s.getComponent<NavSchedule>(navScheduleEntity, "navSchedule") ?? { lastServedId: 0 };

    const needing: EntityId[] = [];
    for (const [entity, agent] of s.withComponent<NavAgent>("navAgent")) {
      const pos = s.getComponent<Pos>(entity, "pos");
      if (!pos) continue;
      const cur = cellOfMm(grid, pos.xMm, pos.zMm);
      if (cur.cx === agent.goalCx && cur.cz === agent.goalCz) continue; // arrived
      if (agent.path.length === 0 || agent.pathIdx >= agent.path.length) needing.push(entity);
    }
    needing.sort((a, b) => a - b);
    const startAt = needing.findIndex((e) => e > schedule.lastServedId);
    const ordered = startAt === -1 ? needing : [...needing.slice(startAt), ...needing.slice(0, startAt)];

    let budget = REPATH_BUDGET;
    let lastServed = schedule.lastServedId;
    for (const entity of ordered) {
      if (budget <= 0) break;
      const agent = s.getComponent<NavAgent>(entity, "navAgent");
      const pos = s.getComponent<Pos>(entity, "pos");
      if (!agent || !pos) continue;
      const from = cellOfMm(grid, pos.xMm, pos.zMm);
      const to: PathCell = { cx: agent.goalCx, cz: agent.goalCz };
      // Consume the sidestep branch's avoid cell, ONCE. Falling back to
      // the un-avoided path when no detour exists matters: in a
      // single-lane corridor there IS no way around, and the agent should
      // go back to waiting behind the yield rule rather than losing its
      // path entirely.
      const avoidIdx = agent.avoidCx >= 0 && agent.avoidCz >= 0 ? agent.avoidCz * grid.width + agent.avoidCx : -1;
      const detour = avoidIdx >= 0 ? findJitteredPath(grid, from, to, isOpen, agent.jitterSeed, avoidIdx) : null;
      const path = detour ?? findJitteredPath(grid, from, to, isOpen, agent.jitterSeed);
      s.setComponent<NavAgent>(entity, "navAgent", {
        ...agent,
        path: path ?? [],
        pathIdx: 0,
        repathAtTick: s.tick,
        avoidCx: -1,
        avoidCz: -1,
      });
      budget--;
      lastServed = entity;
    }
    if (ordered.length > 0) {
      s.setComponent<NavSchedule>(navScheduleEntity, "navSchedule", { lastServedId: lastServed });
    }
  }

  // 6. moveSystem — player intent (as H0) + NPC agents with the yield rule.
  function moveSystem(s: Sim): void {
    // -- player (as H0) --
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      if (c.actor !== PLAYER_ACTOR) continue;
      const pos = s.getComponent<Pos>(player, "pos");
      const yaw = s.getComponent<Yaw>(player, "yaw");
      const collider = s.getComponent<Collider>(player, "collider");
      if (!pos || !yaw || !collider) continue;
      const { forwardMilli, strafeMilli } = c.payload as { forwardMilli: number; strafeMilli: number };
      const fw = clampMilli(forwardMilli);
      const sw = clampMilli(strafeMilli);

      const sinYaw = sinMdeg(yaw.mdeg);
      const cosYaw = cosMdeg(yaw.mdeg);
      const ONE = 65536;
      const dxMm = Math.trunc(
        (fw * sinYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE) + (sw * cosYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE)
      );
      const dzMm = Math.trunc(
        (fw * cosYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE) - (sw * sinYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE)
      );

      const resolved = moveCircle(grid, pos.xMm, pos.zMm, dxMm, dzMm, collider.radiusMm, ctxFor(s).isOpen);
      s.setComponent<Pos>(player, "pos", resolved);
    }

    // -- NPC agents, ascending EntityId (deterministic priority order:
    //    lower id yields to nobody; the yield rule below is symmetric with
    //    that ordering) --
    const ctx = ctxFor(s);
    const { openCells, isOpen, occupancy } = ctx;

    const agents: [EntityId, NavAgent][] = [...s.withComponent<NavAgent>("navAgent")];
    agents.sort((a, b) => a[0] - b[0]);

    for (const [entity, agent] of agents) {
      const pos = s.getComponent<Pos>(entity, "pos");
      if (!pos) continue;
      if (agent.pathIdx >= agent.path.length) continue; // no move needed this tick

      const collider = s.getComponent<Collider>(entity, "collider") ?? { radiusMm: GUEST_RADIUS_MM };
      const curCell = cellOfMm(grid, pos.xMm, pos.zMm);
      const curIdx = curCell.cz * grid.width + curCell.cx;
      const targetCell = agent.path[agent.pathIdx]!;
      const targetIdx = targetCell.cz * grid.width + targetCell.cx;

      // Guest door-opening: a guest whose immediate next path cell is a
      // closed door opens it — the SAME door.open bit, the SAME "door"
      // event the player's interactSystem uses, just triggered by arrival
      // at the threshold rather than by an `interact` command. Mutates
      // `openCells` in place so this tick's own moveCircle call (and any
      // later agent's, same tick) sees the door already open — otherwise
      // the guest would compute a path assuming the door opens (pathSystem
      // plans optimistically, above) and then immediately collide with
      // its own still-closed door on the very tick it arrives.
      //
      // Judgment call: guests do NOT close doors behind them. Two guests
      // can be mid-crossing the same doorway in opposite directions on
      // adjacent ticks; a "close on exit" rule risks slamming a door a
      // following guest's already-computed path still assumes is open,
      // forcing extra recomputation for no gameplay benefit. Leaving
      // doors open once opened also means `checkin-rush` settles into a
      // stable, fully-open floor rather than one that flaps open/closed
      // as guests come and go — simpler to reason about and to verify.
      // Lookahead of 2 path cells (not just the immediate target): the
      // 300mm collider radius exceeds the 250mm cell size, so `moveCircle`
      // (space's circle-vs-grid check) starts refusing a step whose
      // bounding box merely APPROACHES a closed DOOR cell, one full cell
      // before the agent is actually standing at the threshold. Opening
      // only the exact target cell's door (checked one cell too late)
      // left the guest permanently blocked outside its own future
      // doorway. Scanning pathIdx..pathIdx+2 opens the door with enough
      // lead distance to clear that radius margin.
      for (let look = agent.pathIdx; look <= Math.min(agent.pathIdx + 2, agent.path.length - 1); look++) {
        const lookCell = agent.path[look];
        if (!lookCell) continue;
        const lookIdx = lookCell.cz * grid.width + lookCell.cx;
        const doorIndexHere = doorIndexByCell.get(lookIdx);
        if (doorIndexHere === undefined || openCells.has(lookIdx)) continue;
        const doorEntity = doorEntityByIndex[doorIndexHere];
        const door = doorEntity !== undefined ? s.getComponent<Door>(doorEntity, "door") : undefined;
        if (doorEntity !== undefined && door && !door.open) {
          s.setComponent<Door>(doorEntity, "door", { ...door, open: true });
          s.emit("door", { doorIndex: doorIndexHere, open: true });
          for (const cell of portalCellsByDoorIndex[doorIndexHere] ?? []) {
            openCells.add(cell.cz * grid.width + cell.cx);
          }
        }
      }

      if (targetIdx !== curIdx) {
        const occupant = occupancy.get(targetIdx);
        if (occupant !== undefined && occupant !== entity) {
          let blocked: boolean;
          if (occupant < entity) {
            // Lower-id agent has priority: wait.
            blocked = true;
          } else {
            // Higher-id occupant: proceed only if it is itself about to
            // move off that cell this tick (a lookahead at its own
            // pending step — occupant hasn't been processed yet this
            // pass, since it sorts after `entity`); otherwise sidestep by
            // forcing a fresh repath next opportunity.
            const occAgent = s.getComponent<NavAgent>(occupant, "navAgent");
            const occPos = s.getComponent<Pos>(occupant, "pos");
            let willVacate = false;
            if (occAgent && occPos && occAgent.pathIdx < occAgent.path.length) {
              const occCell = cellOfMm(grid, occPos.xMm, occPos.zMm);
              const occTarget = occAgent.path[occAgent.pathIdx]!;
              willVacate = !(occTarget.cx === occCell.cx && occTarget.cz === occCell.cz);
            }
            blocked = !willVacate;
          }
          if (blocked) {
            // The yield rule actually firing. Emitted so a gate can PROVE
            // it exercised contention instead of asserting that two agents
            // happened to walk past each other in an empty room (the H0
            // review's "a gate must be provably non-vacuous" item, applied
            // to nav). Distinct from `nav.stuck`, which fires only once a
            // yield has persisted for STUCK_THRESHOLD ticks: `nav.yield`
            // is the healthy, expected case, `nav.stuck` the pathology.
            s.emit("nav.yield", { entity, blockedBy: occupant, cx: targetCell.cx, cz: targetCell.cz });
            const newStuck = agent.stuckTicks + 1;
            if (agent.stuckTicks < STUCK_THRESHOLD && newStuck >= STUCK_THRESHOLD) {
              s.emit("nav.stuck", { entity, cx: curCell.cx, cz: curCell.cz });
            }
            // SIDESTEP branch: a higher-EntityId agent is sitting on the
            // cell we want and is not about to leave it. Before H2a this
            // cleared the path and let pathSystem recompute — which,
            // because A* is blind to occupancy, produced the IDENTICAL
            // route and re-blocked on the same cell every tick until
            // `nav.stuck` fired. Dead code in every H1 gate (verified: the
            // branch never once fired), but H2a parks a clerk at the desk
            // work cell and a candidate in the lobby — permanently
            // stationary, high-EntityId agents directly in guests' way —
            // so it becomes live. Recording the blocked cell makes the
            // repath an actual detour; `pathSystem` consumes and clears it
            // in the same breath, so it is one-shot and cannot wedge.
            const sidestep = occupant > entity;
            s.setComponent<NavAgent>(entity, "navAgent", {
              ...agent,
              stuckTicks: newStuck,
              path: sidestep ? [] : agent.path,
              pathIdx: sidestep ? 0 : agent.pathIdx,
              avoidCx: sidestep ? targetCell.cx : agent.avoidCx,
              avoidCz: sidestep ? targetCell.cz : agent.avoidCz,
            });
            continue;
          }
        }
      }

      const targetMm = cellMm(targetCell.cx, targetCell.cz);
      const dxMm = targetMm.xMm - pos.xMm;
      const dzMm = targetMm.zMm - pos.zMm;
      const distSq = dxMm * dxMm + dzMm * dzMm;
      let stepX: number;
      let stepZ: number;
      let arrivingAtCell: boolean;
      if (distSq <= GUEST_SPEED_MM_PER_TICK * GUEST_SPEED_MM_PER_TICK) {
        stepX = dxMm;
        stepZ = dzMm;
        arrivingAtCell = true;
      } else {
        const dist = isqrt(distSq);
        stepX = dist > 0 ? Math.trunc((dxMm * GUEST_SPEED_MM_PER_TICK) / dist) : 0;
        stepZ = dist > 0 ? Math.trunc((dzMm * GUEST_SPEED_MM_PER_TICK) / dist) : 0;
        arrivingAtCell = false;
      }
      const resolved = moveCircle(grid, pos.xMm, pos.zMm, stepX, stepZ, collider.radiusMm, isOpen);
      s.setComponent<Pos>(entity, "pos", resolved);
      if (dxMm !== 0 || dzMm !== 0) {
        s.setComponent<Yaw>(entity, "yaw", { mdeg: atan2Mdeg(dxMm, dzMm) });
      }
      s.setComponent<NavAgent>(entity, "navAgent", {
        ...agent,
        pathIdx: arrivingAtCell ? agent.pathIdx + 1 : agent.pathIdx,
        stuckTicks: 0,
      });
      occupancy.delete(curIdx);
      occupancy.set(targetIdx, entity);
    }
  }

  // 7. interactSystem — as H0, widened kinds: terminal focus, guest
  //    presenting.
  function interactSystem(s: Sim): void {
    for (const c of s.commands()) {
      if (c.type !== "interact") continue;
      const { target } = c.payload as { target: EntityId };
      const actorEntity = findActorEntity(s, c.actor);
      if (actorEntity === undefined) continue;
      const pos = s.getComponent<Pos>(actorEntity, "pos");
      const yaw = s.getComponent<Yaw>(actorEntity, "yaw");
      if (!pos || !yaw) continue;

      const interactable = s.getComponent<Interactable>(target, "interactable");
      if (!interactable) {
        // A presenting-eligible guest at the queue head has no
        // `interactable` component (guests aren't props) — handle it via
        // the `guest` component directly before falling back to denial.
        const guest = s.getComponent<Guest>(target, "guest");
        if (guest && guest.state === "queued" && guest.queueIndex === 0) {
          const dx = 0; // range/arc checked below via the guest's own pos
          void dx;
          const guestPos = s.getComponent<Pos>(target, "pos");
          if (guestPos && withinRangeAndArc(pos, yaw, guestPos, INTERACTABLE_RADIUS_MM, INTERACTABLE_ARC_MDEG)) {
            s.setComponent<Guest>(target, "guest", { ...guest, state: "presenting" });
            for (const [docEntity, doc] of s.withComponent<DocumentComp>("document")) {
              if (doc.ownerEntity === target) {
                s.setComponent<DocumentComp>(docEntity, "document", { ...doc, heldBy: actorEntity });
              }
            }
            s.emit("guest.presenting", { guestEntity: target, actor: c.actor });
            continue;
          }
        }
        s.emit("interact-denied", { reason: "no-interactable" satisfies InteractDeniedReason });
        continue;
      }

      const dxMm = interactable.xMm - pos.xMm;
      const dzMm = interactable.zMm - pos.zMm;
      const distSqMm = dxMm * dxMm + dzMm * dzMm;
      const radiusSqMm = interactable.radiusMm * interactable.radiusMm;
      if (distSqMm > radiusSqMm) {
        s.emit("interact-denied", { reason: "out-of-range" satisfies InteractDeniedReason });
        continue;
      }
      const bearingMdeg = atan2Mdeg(dxMm, dzMm);
      const deltaMdeg = Math.abs(angleDeltaMdeg(bearingMdeg, yaw.mdeg));
      if (deltaMdeg > interactable.arcMdeg / 2) {
        s.emit("interact-denied", { reason: "out-of-arc" satisfies InteractDeniedReason });
        continue;
      }

      if (interactable.kind === "door") {
        const door = s.getComponent<Door>(target, "door");
        if (!door) {
          s.emit("interact-denied", { reason: "not-a-door" satisfies InteractDeniedReason });
          continue;
        }
        const open = !door.open;
        s.setComponent<Door>(target, "door", { ...door, open });
        s.emit("door", { doorIndex: door.doorIndex, open });
        continue;
      }

      if (interactable.kind === "mess") {
        const mess = s.getComponent<Mess>(target, "mess");
        if (!mess) {
          s.emit("interact-denied", { reason: "not-a-mess" satisfies InteractDeniedReason });
          continue;
        }
        // ONE wipe, one object gone. No timer, no meter, no partial state:
        // the world in front of the player IS the progress bar.
        const room = s.getComponent<RoomUnit>(mess.roomEntity, "roomUnit");
        if (room) {
          s.setComponent<RoomUnit>(mess.roomEntity, "roomUnit", {
            ...room,
            messCount: Math.max(0, room.messCount - 1),
          });
        }
        s.despawn(target);
        s.emit("room.messCleaned", { roomEntity: mess.roomEntity, messEntity: target, actor: c.actor });
        continue;
      }

      if (interactable.kind === "prop") {
        const prop = s.getComponent<Prop>(target, "prop");
        if (!prop) continue;
        if (!prop.broken) {
          s.emit("interact-denied", { reason: "not-broken" satisfies InteractDeniedReason });
          continue;
        }
        // Repair advances by a fixed quantum per press and PERSISTS
        // indefinitely — half-repaired stays half-repaired across days,
        // saves and interruptions. Nothing decays it back.
        const progress = prop.repairProgress + 1;
        if (progress >= REPAIR_STEPS) {
          s.setComponent<Prop>(target, "prop", { ...prop, broken: false, repairProgress: 0 });
          s.emit("prop.repaired", { propEntity: target, roomEntity: prop.roomEntity, actor: c.actor });
          s.emit("incident.resolved", { propEntity: target, roomEntity: prop.roomEntity });
        } else {
          s.setComponent<Prop>(target, "prop", { ...prop, repairProgress: progress });
          s.emit("prop.repairStep", { propEntity: target, progress, of: REPAIR_STEPS, actor: c.actor });
        }
        continue;
      }

      if (interactable.kind === "terminal") {
        const terminalComp = s.getComponent<Terminal>(target, "terminal");
        if (!terminalComp) continue;
        const next = terminalComp.focusedBy === c.actor ? "" : c.actor;
        s.setComponent<Terminal>(target, "terminal", { ...terminalComp, focusedBy: next });
        continue;
      }
    }

    // `screen.blur` — actor-bound, clears focus regardless of interactable
    // proximity (matching the terminal contract: blur is always allowed).
    for (const c of s.commands()) {
      if (c.type !== "screen.blur") continue;
      for (const [entity, terminalComp] of s.withComponent<Terminal>("terminal")) {
        if (terminalComp.focusedBy === c.actor) {
          s.setComponent<Terminal>(entity, "terminal", { ...terminalComp, focusedBy: "" });
        }
      }
    }
  }

  function withinRangeAndArc(fromPos: Pos, fromYaw: Yaw, toPos: Pos, radiusMm: number, arcMdeg: number): boolean {
    const dxMm = toPos.xMm - fromPos.xMm;
    const dzMm = toPos.zMm - fromPos.zMm;
    const distSqMm = dxMm * dxMm + dzMm * dzMm;
    if (distSqMm > radiusMm * radiusMm) return false;
    const bearingMdeg = atan2Mdeg(dxMm, dzMm);
    const deltaMdeg = Math.abs(angleDeltaMdeg(bearingMdeg, fromYaw.mdeg));
    return deltaMdeg <= arcMdeg / 2;
  }

  // 8. deskSystem — validate + apply desk.decision; fraud/econ events;
  //    assign roomUnit; paired double-entry ledgerEntry.
  //
  //    The per-decision body is factored into `applyDeskDecision` so
  //    screenSystem (9, below) can call the SAME validated path when
  //    RESERVA's `reduce` returns a `desk.decision` effect. It cannot just
  //    `s.submit()` that effect and rely on this system to pick it up: Sim
  //    (packages/core) drains `pendingCommands` unconditionally at the end
  //    of every `step()`, and `commands()` returns that live array with no
  //    per-tick filtering — a command pushed by a system that runs AFTER
  //    this one (screenSystem is #9) is simply gone before it is ever
  //    iterated. Calling `applyDeskDecision` directly is same-tick, exact
  //    (no queueing hazard), and is still "the one validated decision path"
  //    per docs/PHASE-H1.md: same function, same checks, whether the caller
  //    is this loop (a real `desk.decision` command from `clerkBot` or a
  //    temp key) or screenSystem's effect re-application.
  function applyDeskDecision(
    s: Sim,
    actor: string,
    payload: { reservationEntity: EntityId; accept: boolean; roomEntity?: EntityId }
  ): void {
    const { reservationEntity, accept, roomEntity } = payload;

    const actorEntity = findActorEntity(s, actor);
    if (actorEntity === undefined) return;
    const actorPos = s.getComponent<Pos>(actorEntity, "pos");
    if (!actorPos) return;
    const dxMm = floor.desk.xMm - actorPos.xMm;
    const dzMm = floor.desk.zMm - actorPos.zMm;
    if (dxMm * dxMm + dzMm * dzMm > DESK_RADIUS_MM * DESK_RADIUS_MM) {
      s.emit("screen.denied", { reason: "out-of-range" });
      return;
    }

    const res = s.getComponent<Reservation>(reservationEntity, "reservation");
    if (!res || res.decided) return;
    const guest = s.getComponent<Guest>(res.guestEntity, "guest");
    if (!guest || guest.state !== "presenting") return;

    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    const wasPlanted = res.plantedViolations.length > 0;

    if (accept) {
      if (roomEntity === undefined) return;
      const room = s.getComponent<RoomUnit>(roomEntity, "roomUnit");
      if (!room || room.occupantEntity !== 0) return; // not vacant: no-op, retry later
      if (!roomReady(s, roomEntity)) {
        // Dirty or broken: a BLOCK, not a punishment. Nothing is charged,
        // nothing is flagged, the reservation stays undecided and the desk
        // can try another room (or the same one once it is wiped).
        s.emit("desk.denied-room", { reservationEntity, roomEntity, reason: "not-ready" });
        return;
      }
      s.setComponent<RoomUnit>(roomEntity, "roomUnit", { ...room, occupantEntity: res.guestEntity });
      s.setComponent<Reservation>(reservationEntity, "reservation", {
        ...res,
        decided: true,
        accepted: true,
        roomEntity,
      });
      // The live rate is whatever PRICER last set for this tier; the
      // committed opening table is the fallback for a tier PRICER has never
      // touched.
      const rate = hotel.rateByTier[String(room.tier)] ?? ROOM_RATE_MINOR[room.tier] ?? ROOM_RATE_MINOR[1]!;
      s.setComponent<Hotel>(hotelEntity, "hotel", { ...hotel, cash: hotel.cash + rate });
      s.setComponent<Guest>(res.guestEntity, "guest", { ...guest, paidMinor: rate });
      const ledger = s.spawn();
      s.setComponent<LedgerEntry>(ledger, "ledgerEntry", {
        day: hotel.day,
        debitAccount: "cash",
        creditAccount: "revenue:rooms",
        amountMinor: rate,
        memo: `room charge guest ${res.guestEntity}`,
      });
      s.emit("guest.checkedIn", { guestEntity: res.guestEntity, roomEntity });
      if (wasPlanted) s.emit("desk.fraudMissed", { reservationEntity, violations: res.plantedViolations });
    } else {
      s.setComponent<Reservation>(reservationEntity, "reservation", {
        ...res,
        decided: true,
        accepted: false,
        roomEntity: 0,
      });
      s.emit("guest.denied", { guestEntity: res.guestEntity });
      if (wasPlanted) s.emit("desk.fraudCaught", { reservationEntity, violations: res.plantedViolations });
      else s.emit("desk.falseDeny", { reservationEntity });
    }
  }

  function deskSystem(s: Sim): void {
    for (const c of s.commands()) {
      if (c.type !== "desk.decision") continue;
      applyDeskDecision(
        s,
        c.actor,
        c.payload as { reservationEntity: EntityId; accept: boolean; roomEntity?: EntityId }
      );
    }
  }

  // 9. screenSystem — routes validated `screen.*` to the shell's `reduce`
  //    with a fresh `ScreenWorldView` (built by the same exported pure
  //    `buildScreenWorldView` main.ts's host-side repaint uses); on a state
  //    reference change bumps `paintSeq`; re-applies app effects via
  //    `applyDeskDecision` (see the comment on that function for why this
  //    is a direct call rather than a re-queued command).
  //
  //    Validation (docs/PHASE-H1.md, H0 anti-cheat posture applied to
  //    screens): applies only if `terminal.focusedBy === c.actor` AND that
  //    actor's entity is still in range of the terminal's `interactable`.
  //    Otherwise emits `screen.denied { reason }` — the host's UV mapping
  //    proposes `screen.click{px,py}`/`screen.key{code}`, the sim
  //    revalidates focus and proximity on every single command.
  function screenSystem(s: Sim): void {
    const terminalInteractable = s.getComponent<Interactable>(terminal, "interactable");

    // The screen's visible content (RESERVA's queue head, room vacancy,
    // AUDIT's ledger figures) is derived from the WORLD every call, not
    // from `screenApp.state` alone -- a newly-presenting guest or a room
    // that just vacated is real content the screen must show even though
    // nobody clicked anything. `paintSeq` only means "the host should
    // repaint" (a counter, never a content hash -- determinism rules), so
    // bumping it once per tick while a human is actually looking at the
    // terminal is cheap and correct; it stays untouched (no repaint work)
    // whenever nobody is focused.
    const focusedTerminalComp = s.getComponent<Terminal>(terminal, "terminal");
    if (focusedTerminalComp && focusedTerminalComp.focusedBy !== "") {
      const liveScreenApp = s.getComponent<ScreenApp>(terminal, "screenApp");
      if (liveScreenApp) {
        s.setComponent<ScreenApp>(terminal, "screenApp", { ...liveScreenApp, paintSeq: liveScreenApp.paintSeq + 1 });
      }
    }

    for (const c of s.commands()) {
      if (c.type !== "screen.key" && c.type !== "screen.click") continue;

      const terminalComp = s.getComponent<Terminal>(terminal, "terminal");
      if (!terminalComp || terminalComp.focusedBy !== c.actor) {
        s.emit("screen.denied", { reason: "not-focused" });
        continue;
      }
      const actorEntity = findActorEntity(s, c.actor);
      const actorPos = actorEntity !== undefined ? s.getComponent<Pos>(actorEntity, "pos") : undefined;
      if (!actorPos || !terminalInteractable) {
        s.emit("screen.denied", { reason: "no-interactable" satisfies InteractDeniedReason });
        continue;
      }
      const dxMm = terminalInteractable.xMm - actorPos.xMm;
      const dzMm = terminalInteractable.zMm - actorPos.zMm;
      if (dxMm * dxMm + dzMm * dzMm > terminalInteractable.radiusMm * terminalInteractable.radiusMm) {
        s.emit("screen.denied", { reason: "out-of-range" satisfies InteractDeniedReason });
        continue;
      }

      const screenApp = s.getComponent<ScreenApp>(terminal, "screenApp");
      if (!screenApp) continue;

      const input: ScreenInput =
        c.type === "screen.key"
          ? { kind: "key", code: (c.payload as { code: string }).code }
          : { kind: "click", px: (c.payload as { px: number; py: number }).px, py: (c.payload as { px: number; py: number }).py };

      const view = buildScreenWorldView(s);
      const result = hotelShell.reduce(screenApp.state, input, view);
      const isTagged = result !== null && typeof result === "object" && "state" in result;
      const nextState = isTagged ? (result as { state: typeof screenApp.state }).state : (result as typeof screenApp.state);
      const effect: ScreenEffect | undefined = isTagged ? (result as { effect?: ScreenEffect }).effect : undefined;
      const openAppChanged = nextState.openAppId !== screenApp.state.openAppId;
      const changed = nextState !== screenApp.state;

      s.setComponent<ScreenApp>(terminal, "screenApp", {
        state: nextState,
        paintSeq: changed ? screenApp.paintSeq + 1 : screenApp.paintSeq,
      });
      if (openAppChanged) s.emit("screen.appOpened", { actor: c.actor, appId: nextState.openAppId });
      else if (changed) s.emit("screen.actionTaken", { actor: c.actor });

      if (effect && effect.type === "desk.decision") {
        applyDeskDecision(
          s,
          c.actor,
          effect.payload as { reservationEntity: EntityId; accept: boolean; roomEntity?: EntityId }
        );
      }
    }
  }

  // 14. reviewSystem — one review per checkout, scored from integer stay
  //     facts. Runs after guestBrainSystem (which emits guest.checkedOut
  //     earlier in the same tick), so this tick's checkouts are visible in
  //     the event log by the time we read it.
  function reviewSystem(s: Sim): void {
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    for (const event of s.eventsSince(s.tick)) {
      if (event.type !== "guest.checkedOut") continue;
      const guestEntity = (event.payload as { guestEntity: EntityId }).guestEntity;
      const guest = s.getComponent<Guest>(guestEntity, "guest");
      if (!guest) continue;
      const tierBaseline = ROOM_RATE_MINOR[1]!;
      const outcome = scoreReview({
        waitedTicks: guest.waitedTicks,
        brokenPropNights: guest.brokenPropNights,
        paidMinor: guest.paidMinor,
        tierBaselineMinor: tierBaseline,
      });
      const reviewEntity = s.spawn();
      s.setComponent<Review>(reviewEntity, "review", {
        day: hotel.day,
        segment: guest.segment,
        score: outcome.score,
        factors: outcome.factors,
      });
      s.emit("guest.reviewed", { guestEntity, score: outcome.score, segment: guest.segment, factors: outcome.factors });
      if (outcome.score <= 2) {
        s.emit("guest.complained", { guestEntity, score: outcome.score, segment: guest.segment, factors: outcome.factors });
        queueMail(s, hotel.day, "complaint", "mail.complaint", {
          segment: guest.segment,
          score: String(outcome.score),
          factors: outcome.factors.join(","),
        });
      }
    }
  }

  // 13. upkeepSystem — breakage rolls at the day rollover, one draw per
  //     prop from forkRng("upkeep"). A broken prop is a broken prop: it
  //     never worsens, never spreads, and never becomes a flood (incident
  //     cascade is a Phase 3 system, deliberately absent). An OCCUPIED
  //     room's broken prop accrues one integer broken-night on its guest,
  //     cashed out once in the checkout review — nothing dings the player
  //     mid-day and nothing beeps.
  function upkeepSystem(s: Sim): void {
    if (!config.upkeep) return;
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    const { day: newDay } = computePhase(s.tick);
    if (newDay === hotel.day) return; // rollover only

    for (const [entity, prop] of [...s.withComponent<Prop>("prop")]) {
      if (prop.broken) {
        const room = s.getComponent<RoomUnit>(prop.roomEntity, "roomUnit");
        const occupant = room?.occupantEntity ?? 0;
        if (occupant !== 0) {
          const guest = s.getComponent<Guest>(occupant, "guest");
          if (guest) {
            s.setComponent<Guest>(occupant, "guest", {
              ...guest,
              brokenPropNights: guest.brokenPropNights + 1,
            });
          }
        }
        continue;
      }
      if (upkeepRng.int(0, 999) >= BREAKAGE_PERMILLE) continue;
      s.setComponent<Prop>(entity, "prop", { ...prop, broken: true, repairProgress: 0 });
      s.emit("prop.broke", { propEntity: entity, roomEntity: prop.roomEntity, kind: prop.kind });
    }
  }

  // 10. economySystem — daily flat expenses at the rollover into audit.
  function economySystem(s: Sim): void {
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;

    // Objective progress, every tick, from THIS tick's events. Progress
    // lives on the component (never a closure counter), so a mid-day
    // restore() resumes with exactly the progress the snapshot recorded.
    const todaysEvents = s.eventsSince(s.tick);
    if (todaysEvents.length > 0) {
      for (const [entity, objective] of [...s.withComponent<Objective>("objective")]) {
        if (objective.done || objective.day !== hotel.day) continue;
        const template = OBJECTIVE_KINDS.find((t) => t.kind === objective.kind);
        if (!template) continue;
        let hits = 0;
        for (const event of todaysEvents) if (event.type === template.event) hits++;
        if (hits === 0) continue;
        const progress = objective.progress + hits;
        const done = progress >= objective.target;
        s.setComponent<Objective>(entity, "objective", { ...objective, progress, done });
        if (done) s.emit("objective.completed", { objectiveEntity: entity, kind: objective.kind, day: objective.day });
      }
    }

    const { day: newDay } = computePhase(s.tick);
    if (newDay === hotel.day) return; // no rollover this tick

    // Settle the day's objectives: completed ones pay, missed ones just
    // close. There is no penalty for a missed objective anywhere in this
    // system — "punishing absence" is on the explicit avoid-list.
    let rewardTotal = 0;
    for (const [entity, objective] of [...s.withComponent<Objective>("objective")]) {
      if (objective.day !== hotel.day) continue;
      if (!objective.done) {
        s.emit("objective.failed", { objectiveEntity: entity, kind: objective.kind, day: objective.day });
        continue;
      }
      rewardTotal += objective.rewardMinor;
    }
    if (rewardTotal > 0) {
      const reward = s.spawn();
      s.setComponent<LedgerEntry>(reward, "ledgerEntry", {
        day: hotel.day,
        debitAccount: "cash",
        creditAccount: "revenue:objectives",
        amountMinor: rewardTotal,
        memo: "daily objectives",
      });
    }

    let wagesMinor = 0;
    for (const [, staffed] of s.withComponent<Staffed>("staffed")) wagesMinor += staffed.wage;
    const expense = DAILY_WAGES_MINOR + DAILY_UTILITIES_MINOR + wagesMinor;

    s.setComponent<Hotel>(hotelEntity, "hotel", { ...hotel, cash: hotel.cash - expense + rewardTotal });
    const overhead = s.spawn();
    s.setComponent<LedgerEntry>(overhead, "ledgerEntry", {
      day: hotel.day,
      debitAccount: "expense:wages",
      creditAccount: "cash",
      amountMinor: DAILY_WAGES_MINOR,
      memo: "daily wages",
    });
    if (wagesMinor > 0) {
      const staffWages = s.spawn();
      s.setComponent<LedgerEntry>(staffWages, "ledgerEntry", {
        day: hotel.day,
        debitAccount: "expense:staff",
        creditAccount: "cash",
        amountMinor: wagesMinor,
        memo: "staff wages",
      });
    }
    const utilities = s.spawn();
    s.setComponent<LedgerEntry>(utilities, "ledgerEntry", {
      day: hotel.day,
      debitAccount: "expense:utilities",
      creditAccount: "cash",
      amountMinor: DAILY_UTILITIES_MINOR,
      memo: "daily utilities",
    });
  }

  // 11. dayPhaseSystem — advance phaseId/day on tick thresholds; emit
  //     econ.audit at the night rollover (economySystem, just before this
  //     system in registration order, has already applied that day's
  //     expenses, so `hotel.cash` here is the true closing balance).
  function dayPhaseSystem(s: Sim): void {
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    const { day: newDay, phaseId: newPhaseId } = computePhase(s.tick);
    if (newDay !== hotel.day) {
      let revenueMinor = 0;
      let expenseMinor = 0;
      for (const [, entry] of s.withComponent<LedgerEntry>("ledgerEntry")) {
        if (entry.day !== hotel.day) continue;
        if (entry.creditAccount.startsWith("revenue:")) revenueMinor += entry.amountMinor;
        if (entry.debitAccount.startsWith("expense:")) expenseMinor += entry.amountMinor;
      }

      // Reputation and stars: RECOMPUTED from the rolling review window,
      // never accumulated. A mid-week restore() is trivially correct
      // because there is no running total to be out of step with.
      const windowRows: ReviewRow[] = [];
      for (const [, review] of s.withComponent<Review>("review")) {
        windowRows.push({ day: review.day, segment: review.segment, score: review.score });
      }
      const repBySegment = reputationBySegment(windowRows, hotel.day);
      const reviewsInWindow = windowRows.filter((r) => r.day > hotel.day - REVIEW_WINDOW_DAYS).length;
      const stars = starsFromReputation(overallReputation(repBySegment), reviewsInWindow);
      if (stars !== hotel.stars) s.emit("hotel.starsChanged", { from: hotel.stars, to: stars, day: hotel.day });

      // Tomorrow's demand, then tomorrow's objectives. Both draw ONCE,
      // here, at generation time (H2 determinism rule 3).
      const arrivalsBySegment =
        config.arrivals === "demand"
          ? arrivalsForDay(demandRng, hotel.rateByTier, repBySegment, stars, DEFAULT_REP_PERMILLE)
          : {};
      const forecastArrivals = config.arrivals === "demand" ? totalArrivals(arrivalsBySegment) : 0;

      const roomCount = [...s.withComponent<RoomUnit>("roomUnit")].length;
      const objectiveSpecs = generateObjectives(objectivesRng, Math.max(1, forecastArrivals), roomCount);
      const objectivePayload: { kind: string; target: number; rewardMinor: number }[] = [];
      for (const spec of objectiveSpecs) {
        const entity = s.spawn();
        s.setComponent<Objective>(entity, "objective", {
          day: newDay,
          kind: spec.kind,
          target: spec.target,
          progress: 0,
          done: false,
          rewardMinor: spec.rewardMinor,
        });
        objectivePayload.push({ kind: spec.kind, target: spec.target, rewardMinor: spec.rewardMinor });
        s.emit("objective.posted", { objectiveEntity: entity, kind: spec.kind, target: spec.target, day: newDay });
      }

      const hireUnlocked = hotel.hireUnlocked || hotel.cash >= HIRE_THRESHOLD_MINOR;
      if (hireUnlocked && !hotel.hireUnlocked) {
        s.emit("econ.hireUnlocked", { day: hotel.day, thresholdMinor: HIRE_THRESHOLD_MINOR });
      }

      // The audit is the ritual close AND the "one more day" hook: the
      // forecast line is the hook, and the STAFF BUDGET gap is printed
      // whether or not it has been reached (DESIGN §6 transparency).
      s.emit("econ.audit", {
        day: hotel.day,
        revenueMinor,
        expenseMinor,
        closingCashMinor: hotel.cash,
        stars,
        repBySegment,
        forecastArrivals,
        objectives: objectivePayload,
        hireUnlocked,
        hireThresholdMinor: HIRE_THRESHOLD_MINOR,
      });

      s.setComponent<Hotel>(hotelEntity, "hotel", {
        ...hotel,
        day: newDay,
        phaseId: newPhaseId,
        phaseStartTick: s.tick,
        stars,
        repBySegment,
        arrivalsToday: forecastArrivals,
        arrivalsSpawned: 0,
        guestsSpawned: config.arrivals === "demand" ? 0 : hotel.guestsSpawned,
        nextGuestAtTick: s.tick + config.spawnTickMin,
        hireUnlocked,
      });
    } else if (newPhaseId !== hotel.phaseId) {
      s.setComponent<Hotel>(hotelEntity, "hotel", { ...hotel, phaseId: newPhaseId, phaseStartTick: s.tick });
    }
  }

  // 12. cleanupSystem — despawn guests in "leaving" state that reached the
  //     street spawn cell (guest, their documents, and the decided
  //     reservation), via core's despawn.
  function cleanupSystem(s: Sim): void {
    const toDespawn: EntityId[] = [];
    for (const [entity, guest] of s.withComponent<Guest>("guest")) {
      if (guest.state !== "leaving") continue;
      if (!hasArrived(s, entity)) continue;
      toDespawn.push(entity);
    }
    for (const guestEntity of toDespawn) {
      s.emit("guest.left", { guestEntity });
      for (const [docEntity, doc] of [...s.withComponent<DocumentComp>("document")]) {
        if (doc.ownerEntity === guestEntity) s.despawn(docEntity);
      }
      const resEntity = findReservationFor(s, guestEntity);
      if (resEntity !== undefined) s.despawn(resEntity);
      s.despawn(guestEntity);
    }
  }

  /** H1b save-restore gate wiring (docs/PHASE-H1.md gate 4; see
   *  SaveRestoreDebug's doc comment in components.ts). Lazily creates one
   *  singleton entity only if `debug.saveRestoreRecord` is ever submitted —
   *  every scenario that never presses F5/F9 has zero extra entities and an
   *  unchanged stateHash. */
  function saveRestoreDebugSystem(s: Sim): void {
    for (const c of s.commands()) {
      if (c.type !== "debug.saveRestoreRecord") continue;
      const payload = c.payload as { savedTick: number; savedHash: number; restoredHash: number };
      let target: EntityId | undefined;
      for (const [entity] of s.withComponent<SaveRestoreDebug>("saveRestoreDebug")) {
        target = entity;
        break;
      }
      const entity = target ?? s.spawn();
      s.setComponent<SaveRestoreDebug>(entity, "saveRestoreDebug", {
        savedTick: payload.savedTick,
        savedHash: payload.savedHash,
        restoredHash: payload.restoredHash,
      });
    }
  }

  sim.addSystem(indexSystem);
  sim.addSystem(snapshotPrevSystem);
  sim.addSystem(faceSystem);
  sim.addSystem(guestSpawnSystem);
  sim.addSystem(guestBrainSystem);
  sim.addSystem(pathSystem);
  sim.addSystem(moveSystem);
  sim.addSystem(interactSystem);
  sim.addSystem(deskSystem);
  sim.addSystem(screenSystem);
  sim.addSystem(upkeepSystem);
  sim.addSystem(reviewSystem);
  sim.addSystem(economySystem);
  sim.addSystem(dayPhaseSystem);
  sim.addSystem(cleanupSystem);
  sim.addSystem(saveRestoreDebugSystem);
}

// -- Command factories -------------------------------------------------

export function faceCommand(tick: number, yawMdeg: number): Command {
  return { tick, actor: PLAYER_ACTOR, type: "face", payload: { yawMdeg: wrapMdeg(yawMdeg) } };
}

export function moveCommand(tick: number, forwardMilli: number, strafeMilli: number): Command {
  return {
    tick,
    actor: PLAYER_ACTOR,
    type: "move",
    payload: { forwardMilli: clampMilli(forwardMilli), strafeMilli: clampMilli(strafeMilli) },
  };
}

export function interactCommand(tick: number, target: EntityId, actor: string = PLAYER_ACTOR): Command {
  return { tick, actor, type: "interact", payload: { target } };
}

export function screenBlurCommand(tick: number, actor: string = PLAYER_ACTOR): Command {
  return { tick, actor, type: "screen.blur", payload: {} };
}

export function screenKeyCommand(tick: number, code: string, actor: string = PLAYER_ACTOR): Command {
  return { tick, actor, type: "screen.key", payload: { code } };
}

export function screenClickCommand(tick: number, px: number, py: number, actor: string = PLAYER_ACTOR): Command {
  return { tick, actor, type: "screen.click", payload: { px, py } };
}

/**
 * `desk.decision` factory — actor-bound (B9: never "the player" as a
 * singleton). H1a shipped with no terminal UI and (per the H1a review's
 * deferral item 2) no temp desk keys either — this factory existed purely
 * so headless scenarios/bots (`clerkBot`) could drive the one validated
 * path directly. As of H1b, RESERVA's `reduce` emits the same command
 * shape as a `desk.decision` `ScreenEffect`, which `screenSystem` applies
 * via `applyDeskDecision` — the SAME validation this factory's command
 * ultimately reaches through `deskSystem`. This is the first and only
 * player-facing decision input (docs/PHASE-H1.md): a human accepts/denies
 * exclusively through RESERVA's ACCEPT/DENY buttons.
 */
/** H1b save-restore gate (docs/PHASE-H1.md gate 4). Submitted once by
 *  apps/hotel/src/main.ts's quickLoad(), right after a quick-load
 *  completes, carrying the facts the scenario's assertion needs into
 *  sim-visible (and therefore replay-visible) state -- see
 *  SaveRestoreDebug's doc comment in components.ts for why. */
export function saveRestoreDebugCommand(
  tick: number,
  savedTick: number,
  savedHash: number,
  restoredHash: number,
  actor: string = PLAYER_ACTOR
): Command {
  return { tick, actor, type: "debug.saveRestoreRecord", payload: { savedTick, savedHash, restoredHash } };
}

export function deskDecisionCommand(
  tick: number,
  reservationEntity: EntityId,
  accept: boolean,
  roomEntity?: EntityId,
  actor: string = PLAYER_ACTOR
): Command {
  return { tick, actor, type: "desk.decision", payload: { reservationEntity, accept, roomEntity } };
}

export { cellAt, cellOfMm, CELL };
// Re-exported so main.ts imports the terminal's screen wiring from the same
// module it already imports everything else from; `screenSystem` (above)
// and `syncScene`'s repaint call the exact same `buildScreenWorldView` —
// two view-builders that can disagree is the bug this avoids.
export { hotelShell, buildScreenWorldView } from "./screen.js";
