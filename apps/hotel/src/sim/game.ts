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
} from "./components.js";
import { buildOpenCellSet, buildOccupancy, makeIsOpen, findJitteredPath } from "./nav.js";
import { H1_RULES, plantViolation, type RuleDoc, type ResFields } from "./rules.js";
import { pickArchetype, pickGuestName, makeResCode, makeDocNumber } from "./guests.js";

export type {
  Pos,
  Yaw,
  Collider,
  Door,
  Interactable,
  InteractableKind,
  Player,
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

const ROOM_RATE_MINOR: Record<number, number> = { 1: 5000, 2: 8000 };
const DAILY_WAGES_MINOR = 3000;
const DAILY_UTILITIES_MINOR = 1500;

export type InteractDeniedReason =
  | "no-interactable"
  | "out-of-range"
  | "out-of-arc"
  | "not-a-door"
  | "not-presenting-eligible";

// -- Scenario config hook (spec: "Scenario config hook") ------------------

export interface ScenarioConfig {
  guestCount: number;
  spawnTickMin: number;
  spawnTickMax: number;
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
}

export const DEFAULTS: ScenarioConfig = {
  guestCount: 8,
  spawnTickMin: 100,
  spawnTickMax: 900,
  fraudRatePermille: 0,
  fixture: "normal",
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

  // -- Player (as H0) ------------------------------------------------------
  const player = sim.spawn(); // == PLAYER_ENTITY: first entity spawned
  sim.setComponent<Pos>(player, "pos", { xMm: floor.spawn.xMm, zMm: floor.spawn.zMm });
  sim.setComponent<Pos>(player, "prevPos", { xMm: floor.spawn.xMm, zMm: floor.spawn.zMm });
  sim.setComponent<Yaw>(player, "yaw", { mdeg: wrapMdeg(floor.spawn.yawMdeg) });
  sim.setComponent<Yaw>(player, "prevYaw", { mdeg: wrapMdeg(floor.spawn.yawMdeg) });
  sim.setComponent<Collider>(player, "collider", { radiusMm: PLAYER_RADIUS_MM });
  sim.setComponent<Player>(player, "player", { actor: PLAYER_ACTOR });

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
    });
  }
  const bedroomByRoomId = new Map(floor.bedrooms.map((b) => [b.roomId, b]));

  // -- Front desk terminal ------------------------------------------------
  const terminal = sim.spawn();
  sim.setComponent<Pos>(terminal, "pos", { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
  sim.setComponent<Yaw>(terminal, "yaw", { mdeg: wrapMdeg(floor.desk.yawMdeg) });
  sim.setComponent<Terminal>(terminal, "terminal", { station: "frontdesk", focusedBy: "" });
  sim.setComponent<ScreenApp>(terminal, "screenApp", { state: {}, paintSeq: 0 });
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
        });
      }
    }
  }

  // === Systems ============================================================

  // 1. snapshotPrevSystem — now over ALL pos/yaw holders, not just player.
  function snapshotPrevSystem(s: Sim): void {
    for (const [entity, pos] of s.withComponent<Pos>("pos")) {
      s.setComponent<Pos>(entity, "prevPos", { xMm: pos.xMm, zMm: pos.zMm });
    }
    for (const [entity, yaw] of s.withComponent<Yaw>("yaw")) {
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

  // 3. guestSpawnSystem — spawn guest + documents + reservation from
  //    forkRng("guest-spawn"); plant a violation via forkRng("guest-fraud")
  //    per the configured rate.
  function guestSpawnSystem(s: Sim): void {
    if (config.fixture === "headon") return; // fixture spawns nothing scheduled
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    // Check-in phases: morning (0) and day (1).
    if (hotel.phaseId !== 0 && hotel.phaseId !== 1) return;
    if (hotel.guestsSpawned >= config.guestCount) return;
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
      const planted = plantViolation(H1_RULES, guestFraudRng, ruleDocs, resFields);
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
    });
    s.emit("guest.arrived", { guestEntity });

    const interval = 50 + guestSpawnRng.int(0, 100);
    s.setComponent<Hotel>(hotelEntity, "hotel", {
      ...hotel,
      guestsSpawned: hotel.guestsSpawned + 1,
      nextGuestAtTick: s.tick + interval,
    });
  }

  // 4. guestBrainSystem — the FSM.
  function guestBrainSystem(s: Sim): void {
    // -- queue derivation (no closure array; scanned + compacted fresh) --
    const active: [EntityId, Guest][] = [];
    for (const [entity, guest] of s.withComponent<Guest>("guest")) {
      if ((guest.state === "queued" || guest.state === "presenting") && guest.queueIndex >= 0) {
        active.push([entity, guest]);
      }
    }
    active.sort((a, b) => {
      const d = a[1].queueIndex - b[1].queueIndex;
      return d !== 0 ? d : a[0] - b[0];
    });
    active.forEach(([entity, guest], i) => {
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
    for (const [entity, guest] of s.withComponent<Guest>("guest")) {
      if (guest.state === "arriving") arriving.push([entity, guest]);
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
    for (const [entity, guest] of s.withComponent<Guest>("guest")) {
      if (guest.state !== "presenting") continue;
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
    for (const [entity, guest] of s.withComponent<Guest>("guest")) {
      if (guest.state !== "toRoom") continue;
      if (hasArrived(s, entity)) {
        s.setComponent<Guest>(entity, "guest", { ...guest, state: "inRoom" });
      }
    }

    // -- inRoom -> leaving at stayUntilTick --
    for (const [entity, guest] of s.withComponent<Guest>("guest")) {
      if (guest.state !== "inRoom") continue;
      if (s.tick < guest.stayUntilTick) continue;
      if (guest.roomEntity !== 0) {
        const room = s.getComponent<RoomUnit>(guest.roomEntity, "roomUnit");
        if (room) s.setComponent<RoomUnit>(guest.roomEntity, "roomUnit", { ...room, occupantEntity: 0 });
      }
      s.setComponent<Guest>(entity, "guest", { ...guest, state: "leaving" });
      setGoal(s, entity, streetCell.cx, streetCell.cz);
      s.emit("guest.checkedOut", { guestEntity: entity });
    }
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

  function findActorEntity(s: Sim, actor: string): EntityId | undefined {
    for (const [entity, p] of s.withComponent<Player>("player")) {
      if (p.actor === actor) return entity;
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
      const path = findJitteredPath(grid, from, to, isOpen, agent.jitterSeed);
      s.setComponent<NavAgent>(entity, "navAgent", {
        ...agent,
        path: path ?? [],
        pathIdx: 0,
        repathAtTick: s.tick,
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

      const openCells = buildOpenCellSet(s, grid.width, portalCellsByDoorIndex);
      const isOpen = makeIsOpen(openCells, grid.width);
      const resolved = moveCircle(grid, pos.xMm, pos.zMm, dxMm, dzMm, collider.radiusMm, isOpen);
      s.setComponent<Pos>(player, "pos", resolved);
    }

    // -- NPC agents, ascending EntityId (deterministic priority order:
    //    lower id yields to nobody; the yield rule below is symmetric with
    //    that ordering) --
    const openCells = buildOpenCellSet(s, grid.width, portalCellsByDoorIndex);
    const isOpen = makeIsOpen(openCells, grid.width);
    const occupancy = buildOccupancy(s, grid.width);

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
            const sidestep = occupant > entity;
            s.setComponent<NavAgent>(entity, "navAgent", {
              ...agent,
              stuckTicks: newStuck,
              path: sidestep ? [] : agent.path,
              pathIdx: sidestep ? 0 : agent.pathIdx,
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
  function deskSystem(s: Sim): void {
    for (const c of s.commands()) {
      if (c.type !== "desk.decision") continue;
      const { reservationEntity, accept, roomEntity } = c.payload as {
        reservationEntity: EntityId;
        accept: boolean;
        roomEntity?: EntityId;
      };

      const actorEntity = findActorEntity(s, c.actor);
      if (actorEntity === undefined) continue;
      const actorPos = s.getComponent<Pos>(actorEntity, "pos");
      if (!actorPos) continue;
      const dxMm = floor.desk.xMm - actorPos.xMm;
      const dzMm = floor.desk.zMm - actorPos.zMm;
      if (dxMm * dxMm + dzMm * dzMm > DESK_RADIUS_MM * DESK_RADIUS_MM) {
        s.emit("screen.denied", { reason: "out-of-range" });
        continue;
      }

      const res = s.getComponent<Reservation>(reservationEntity, "reservation");
      if (!res || res.decided) continue;
      const guest = s.getComponent<Guest>(res.guestEntity, "guest");
      if (!guest || guest.state !== "presenting") continue;

      const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
      if (!hotel) continue;
      const wasPlanted = res.plantedViolations.length > 0;

      if (accept) {
        if (roomEntity === undefined) continue;
        const room = s.getComponent<RoomUnit>(roomEntity, "roomUnit");
        if (!room || room.occupantEntity !== 0) continue; // not vacant: no-op, retry later
        s.setComponent<RoomUnit>(roomEntity, "roomUnit", { ...room, occupantEntity: res.guestEntity });
        s.setComponent<Reservation>(reservationEntity, "reservation", {
          ...res,
          decided: true,
          accepted: true,
          roomEntity,
        });
        const rate = ROOM_RATE_MINOR[room.tier] ?? ROOM_RATE_MINOR[1]!;
        s.setComponent<Hotel>(hotelEntity, "hotel", { ...hotel, cash: hotel.cash + rate });
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
  }

  // 9. screenSystem — H1b. Slot reserved; not implemented in H1a (see
  //    docs/PHASE-H1.md, implementation-order lane 10). H1b's reviewer:
  //    this comment marks the reservation, delete it once screenSystem
  //    lands.
  // function screenSystem(s: Sim): void { /* H1b */ }

  // 10. economySystem — daily flat expenses at the rollover into audit.
  function economySystem(s: Sim): void {
    const hotel = s.getComponent<Hotel>(hotelEntity, "hotel");
    if (!hotel) return;
    const { day: newDay } = computePhase(s.tick);
    if (newDay === hotel.day) return; // no rollover this tick
    const expense = DAILY_WAGES_MINOR + DAILY_UTILITIES_MINOR;
    s.setComponent<Hotel>(hotelEntity, "hotel", { ...hotel, cash: hotel.cash - expense });
    const wages = s.spawn();
    s.setComponent<LedgerEntry>(wages, "ledgerEntry", {
      day: hotel.day,
      debitAccount: "expense:wages",
      creditAccount: "cash",
      amountMinor: DAILY_WAGES_MINOR,
      memo: "daily wages",
    });
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
        if (entry.creditAccount === "revenue:rooms") revenueMinor += entry.amountMinor;
        if (entry.debitAccount.startsWith("expense:")) expenseMinor += entry.amountMinor;
      }
      s.emit("econ.audit", { day: hotel.day, revenueMinor, expenseMinor, closingCashMinor: hotel.cash });
      s.setComponent<Hotel>(hotelEntity, "hotel", {
        ...hotel,
        day: newDay,
        phaseId: newPhaseId,
        phaseStartTick: s.tick,
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

  sim.addSystem(snapshotPrevSystem);
  sim.addSystem(faceSystem);
  sim.addSystem(guestSpawnSystem);
  sim.addSystem(guestBrainSystem);
  sim.addSystem(pathSystem);
  sim.addSystem(moveSystem);
  sim.addSystem(interactSystem);
  sim.addSystem(deskSystem);
  // sim.addSystem(screenSystem); -- H1b (see the reservation comment above)
  sim.addSystem(economySystem);
  sim.addSystem(dayPhaseSystem);
  sim.addSystem(cleanupSystem);
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

/**
 * `desk.decision` factory — actor-bound (B9: never "the player" as a
 * singleton). H1a has no terminal UI yet, so this is what temporary
 * accept/deny key bindings (main.ts, host wiring — out of this lane's
 * scope) must submit; H1b's RESERVA `reduce` emits the same command shape
 * as an app effect that screenSystem re-submits. Same validated path
 * either way (docs/PHASE-H1.md, "desk.decision"). H1B REVIEWER: grep
 * "TEMP DESK KEY" in main.ts once wired — those bindings must be deleted
 * when the terminal ships.
 */
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
