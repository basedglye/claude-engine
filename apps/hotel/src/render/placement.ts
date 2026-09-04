/**
 * Lane C2-W4 — deterministic furniture placement solver.
 *
 * Presentation-only, like decor.ts and floorplan.ts: pure functions over
 * (floor, room, tier) that never touch sim state and never call
 * `Math.random()` (any tie-break uses a hash of stable inputs, same
 * discipline as decor.ts's `hashInt`). This module answers "where does
 * this piece of furniture go" so decor.ts only has to answer "what pieces
 * does this room get."
 *
 * Model: every room gets a 0.25m OCCUPANCY grid over its walkable cells.
 * Placement functions consult it to find free WALL RUNS or free CORNERS,
 * mark what they use (plus a small usage margin), and return `undefined`
 * when nothing fits so callers can omit the item instead of overlapping.
 */
import { CELL_M, deskRect, cellCenterM, doorRects, type RoomRect } from "./floorplan.js";
import type { GroundFloor } from "@claude-engine/interiors";

const GRID_M = 0.25;
const DOOR_LANE_M = 1.0;
const USAGE_MARGIN_M = 0.3;

export type WallSide = "north" | "south" | "east" | "west";
export const WALL_SIDES: WallSide[] = ["north", "south", "east", "west"];

export interface Footprint {
  w: number;
  d: number;
}

export interface PlacementResult {
  x: number;
  z: number;
  yawRad: number;
}

/** One contiguous free span along a wall, in metres measured along the
 *  wall's own axis from the room's min corner on that side. */
interface WallRun {
  side: WallSide;
  /** Coordinate running along the wall (x for north/south, z for east/west). */
  from: number;
  to: number;
}

// -- occupancy grid -----------------------------------------------------

export class RoomOccupancy {
  readonly room: RoomRect;
  private readonly cols: number;
  private readonly rows: number;
  private readonly blocked: Uint8Array;

  /** Wall-mounted items (paintings, sconces) live on a SEPARATE channel
   *  keyed by side, one flag per GRID_M step along that wall's own axis.
   *  This is deliberately not the floor `blocked` grid: a painting above a
   *  dresser is legal, but two wall-mounted items must never share a span
   *  (COO review P1/P3 -- `placeOnWallSurface` was a pure query that never
   *  marked anything, so every call in a loop returned the same spot). */
  private readonly wallSpanBlocked: Record<WallSide, Uint8Array>;

  constructor(room: RoomRect) {
    this.room = room;
    this.cols = Math.max(1, Math.ceil(room.widthM / GRID_M));
    this.rows = Math.max(1, Math.ceil(room.depthM / GRID_M));
    this.blocked = new Uint8Array(this.cols * this.rows);
    const wSteps = Math.ceil(room.widthM / GRID_M) + 2;
    const dSteps = Math.ceil(room.depthM / GRID_M) + 2;
    this.wallSpanBlocked = {
      north: new Uint8Array(wSteps),
      south: new Uint8Array(wSteps),
      west: new Uint8Array(dSteps),
      east: new Uint8Array(dSteps),
    };
  }

  private wallSpanIdx(side: WallSide, along: number): number {
    return Math.round(along / GRID_M);
  }

  /** Marks `[from, to]` (plus `marginM` on both ends) as occupied on
   *  `side`'s wall-surface channel -- called by `placeOnWallSurface` once
   *  it commits to a span, so the next call in the same loop cannot return
   *  the identical pose. */
  blockWallSpan(side: WallSide, from: number, to: number, marginM = 0): void {
    const arr = this.wallSpanBlocked[side];
    const i0 = Math.max(0, this.wallSpanIdx(side, from - marginM));
    const i1 = Math.min(arr.length - 1, this.wallSpanIdx(side, to + marginM));
    for (let i = i0; i <= i1; i++) arr[i] = 1;
  }

  isWallSpanFree(side: WallSide, from: number, to: number): boolean {
    const arr = this.wallSpanBlocked[side];
    const i0 = Math.max(0, this.wallSpanIdx(side, from));
    const i1 = Math.min(arr.length - 1, this.wallSpanIdx(side, to));
    for (let i = i0; i <= i1; i++) {
      if (arr[i]) return false;
    }
    return true;
  }

  private idx(gx: number, gz: number): number {
    return gz * this.cols + gx;
  }

  private toGrid(xM: number, zM: number): { gx: number; gz: number } {
    return {
      gx: Math.floor((xM - this.room.xM0) / GRID_M),
      gz: Math.floor((zM - this.room.zM0) / GRID_M),
    };
  }

  /** Marks a world-space AABB (metres) as occupied, clamped to the room. */
  blockRect(xM0: number, zM0: number, xM1: number, zM1: number): void {
    const a = this.toGrid(xM0, zM0);
    const b = this.toGrid(xM1, zM1);
    const gx0 = Math.max(0, Math.min(a.gx, b.gx));
    const gx1 = Math.min(this.cols - 1, Math.max(a.gx, b.gx));
    const gz0 = Math.max(0, Math.min(a.gz, b.gz));
    const gz1 = Math.min(this.rows - 1, Math.max(a.gz, b.gz));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        this.blocked[this.idx(gx, gz)] = 1;
      }
    }
  }

  blockCircle(xM: number, zM: number, radiusM: number): void {
    this.blockRect(xM - radiusM, zM - radiusM, xM + radiusM, zM + radiusM);
  }

  isRectFree(xM0: number, zM0: number, xM1: number, zM1: number): boolean {
    const a = this.toGrid(xM0, zM0);
    const b = this.toGrid(xM1, zM1);
    const gx0 = Math.max(0, Math.min(a.gx, b.gx));
    const gx1 = Math.min(this.cols - 1, Math.max(a.gx, b.gx));
    const gz0 = Math.max(0, Math.min(a.gz, b.gz));
    const gz1 = Math.min(this.rows - 1, Math.max(a.gz, b.gz));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (this.blocked[this.idx(gx, gz)]) return false;
      }
    }
    return true;
  }

}

// -- door / desk / spawn / bedroom-goal blocking -------------------------

/** Populates an occupancy grid with every blocked zone PLAN-ALPHA §6 lists:
 *  door cells + 1m lane, desk queue + clerk cells, spawn + 0.75m radius,
 *  the entrance<->corridor-door straight lane (lobby only), and every
 *  bedroom goal cell + 1-cell ring. Callers pass in whichever of
 *  `deskRect`/`spawn`/etc. apply to this room; unrelated args are omitted. */
export function buildOccupancy(
  floor: GroundFloor,
  room: RoomRect,
  opts: {
    deskRect?: RoomRect | undefined;
    spawn?: { x: number; z: number } | undefined;
    bedroomGoals?: { x: number; z: number }[] | undefined;
    lobbyDoorLane?: boolean | undefined;
  } = {}
): RoomOccupancy {
  const occ = new RoomOccupancy(room);

  const doors = doorRects(floor).filter((d) => d.roomA === room.roomId || d.roomB === room.roomId);
  for (const d of doors) {
    if (d.axis === "row") {
      occ.blockRect(d.xM0 - 0.05, d.zM0 - DOOR_LANE_M, d.xM1 + 0.05, d.zM1 + DOOR_LANE_M);
    } else {
      occ.blockRect(d.xM0 - DOOR_LANE_M, d.zM0 - 0.05, d.xM1 + DOOR_LANE_M, d.zM1 + 0.05);
    }
  }

  if (opts.deskRect) {
    const d = opts.deskRect;
    // Desk footprint itself, the queue lane to its north (-Z, guest side)
    // and the clerk cells to its south, plus one cell of margin all round.
    occ.blockRect(d.xM0 - CELL_M, d.zM0 - 1.5, d.xM1 + CELL_M, d.zM1 + 1.0);
  }

  if (opts.spawn) {
    occ.blockCircle(opts.spawn.x, opts.spawn.z, 0.75);
  }

  if (opts.lobbyDoorLane) {
    const entrance = doors.find((d) => d.isEntrance);
    const corridorDoor = doors.find((d) => !d.isEntrance);
    if (entrance && corridorDoor) {
      const x0 = Math.min(entrance.centerXM, corridorDoor.centerXM) - 0.6;
      const x1 = Math.max(entrance.centerXM, corridorDoor.centerXM) + 0.6;
      const z0 = Math.min(entrance.centerZM, corridorDoor.centerZM) - 0.6;
      const z1 = Math.max(entrance.centerZM, corridorDoor.centerZM) + 0.6;
      occ.blockRect(x0, z0, x1, z1);
    }
  }

  for (const goal of opts.bedroomGoals ?? []) {
    occ.blockRect(goal.x - GRID_M * 1.5, goal.z - GRID_M * 1.5, goal.x + GRID_M * 1.5, goal.z + GRID_M * 1.5);
  }

  return occ;
}

// -- wall runs ------------------------------------------------------------

/** Memoised per (floor, room, tier) so `decor.ts` and `fixtures.ts` --
 *  different modules, both called once per (floor, hotelTier) render pass
 *  from `main.ts`/`tour.ts` -- build against the exact SAME `RoomOccupancy`
 *  instance instead of two independent grids that can never see each
 *  other's wall-mounted items (COO review W3-1: sconces bypassed the
 *  solver entirely because they had no shared grid to route through).
 *  `floor` is a stable object for the lifetime of one render pass, so a
 *  `WeakMap` keyed on it (then on `roomId:tier`) is exactly "once per
 *  render pass, shared across modules" without either module needing to
 *  pass the other's options in. Desk/lobby-lane/bedroom-goal options are
 *  derived internally from `floor`/`room` so callers need only the three
 *  positional args. */
const occupancyCache = new WeakMap<GroundFloor, Map<string, RoomOccupancy>>();

export function roomOccupancyFor(floor: GroundFloor, room: RoomRect, tier: number): RoomOccupancy {
  let byKey = occupancyCache.get(floor);
  if (!byKey) {
    byKey = new Map();
    occupancyCache.set(floor, byKey);
  }
  const key = `${room.roomId}:${tier}`;
  let occ = byKey.get(key);
  if (occ) return occ;

  const opts: Parameters<typeof buildOccupancy>[2] = {};
  if (room.kind === "lobby") {
    opts.deskRect = deskRect(floor);
    opts.lobbyDoorLane = true;
  }
  if (room.kind === "bedroom") {
    opts.bedroomGoals = floor.bedrooms.filter((b) => b.roomId === room.roomId).map((b) => cellCenterM(b.goalCx, b.goalCz));
  }
  occ = buildOccupancy(floor, room, opts);
  byKey.set(key, occ);
  return occ;
}

/** Free spans (in the "along the wall" coordinate) along `side` of `room`,
 *  found by sampling every GRID_M and merging free samples into runs. This
 *  is the (1) WALL RUNS deliverable -- door spans are already baked into
 *  `occ` via `buildOccupancy`, so a run simply stops wherever `occ` says a
 *  1m-deep strip against that wall is blocked. */
export function wallRuns(occ: RoomOccupancy, side: WallSide, probeDepthM = 0.7): WallRun[] {
  const room = occ.room;
  const along = side === "north" || side === "south" ? room.widthM : room.depthM;
  const runs: WallRun[] = [];
  let runStart: number | null = null;
  const steps = Math.ceil(along / GRID_M);
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(along, i * GRID_M);
    let free: boolean;
    if (side === "north") {
      free = occ.isRectFree(room.xM0 + t - GRID_M / 2, room.zM0, room.xM0 + t + GRID_M / 2, room.zM0 + probeDepthM);
    } else if (side === "south") {
      free = occ.isRectFree(room.xM0 + t - GRID_M / 2, room.zM1 - probeDepthM, room.xM0 + t + GRID_M / 2, room.zM1);
    } else if (side === "west") {
      free = occ.isRectFree(room.xM0, room.zM0 + t - GRID_M / 2, room.xM0 + probeDepthM, room.zM0 + t + GRID_M / 2);
    } else {
      free = occ.isRectFree(room.xM1 - probeDepthM, room.zM0 + t - GRID_M / 2, room.xM1, room.zM0 + t + GRID_M / 2);
    }
    if (free) {
      if (runStart === null) runStart = t;
    } else if (runStart !== null) {
      runs.push({ side, from: runStart, to: t });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ side, from: runStart, to: along });
  return runs.filter((r) => r.to - r.from > 0.05);
}

export function wallPoint(room: RoomRect, side: WallSide, along: number): { x: number; z: number; yawRad: number } {
  switch (side) {
    case "north":
      return { x: room.xM0 + along, z: room.zM0, yawRad: 0 }; // back to wall, faces +Z (into room)
    case "south":
      return { x: room.xM0 + along, z: room.zM1, yawRad: Math.PI };
    case "west":
      return { x: room.xM0, z: room.zM0 + along, yawRad: Math.PI / 2 };
    case "east":
    default:
      return { x: room.xM1, z: room.zM0 + along, yawRad: -Math.PI / 2 };
  }
}

export interface WallPrefs {
  sides?: WallSide[];
  minRunM?: number;
  align?: "center" | "corner-start" | "corner-end";
}

/** (3) Places `footprint` flush against the longest free wall run
 *  satisfying `prefs`, back to the wall, front into the room. Marks the
 *  footprint plus a 0.3m usage margin as occupied and returns the pose --
 *  or `undefined` if nothing fits. Callers MUST handle `undefined` by
 *  omitting the item. */
export function placeAgainstWall(occ: RoomOccupancy, footprint: Footprint, prefs: WallPrefs = {}): PlacementResult | undefined {
  const sides = prefs.sides ?? WALL_SIDES;
  const minRun = Math.max(prefs.minRunM ?? 0, footprint.w);
  let best: { run: WallRun; len: number } | undefined;
  for (const side of sides) {
    for (const run of wallRuns(occ, side, Math.max(0.7, footprint.d + USAGE_MARGIN_M))) {
      const len = run.to - run.from;
      if (len < minRun) continue;
      if (!best || len > best.len) best = { run, len };
    }
  }
  if (!best) return undefined;
  const { run, len } = best;
  let along: number;
  if (prefs.align === "corner-start") along = run.from + footprint.w / 2;
  else if (prefs.align === "corner-end") along = run.to - footprint.w / 2;
  else along = run.from + len / 2;

  const room = occ.room;
  const p = wallPoint(room, run.side, along);
  const halfW = footprint.w / 2;
  const depth = footprint.d + 0.02;
  let x0: number, z0: number, x1: number, z1: number, cx: number, cz: number;
  if (run.side === "north") {
    x0 = p.x - halfW;
    x1 = p.x + halfW;
    z0 = room.zM0;
    z1 = room.zM0 + depth;
    cx = p.x;
    cz = room.zM0 + footprint.d / 2 + 0.02;
  } else if (run.side === "south") {
    x0 = p.x - halfW;
    x1 = p.x + halfW;
    z0 = room.zM1 - depth;
    z1 = room.zM1;
    cx = p.x;
    cz = room.zM1 - footprint.d / 2 - 0.02;
  } else if (run.side === "west") {
    z0 = p.z - halfW;
    z1 = p.z + halfW;
    x0 = room.xM0;
    x1 = room.xM0 + depth;
    cz = p.z;
    cx = room.xM0 + footprint.d / 2 + 0.02;
  } else {
    z0 = p.z - halfW;
    z1 = p.z + halfW;
    x0 = room.xM1 - depth;
    x1 = room.xM1;
    cz = p.z;
    cx = room.xM1 - footprint.d / 2 - 0.02;
  }
  occ.blockRect(x0 - USAGE_MARGIN_M, z0 - USAGE_MARGIN_M, x1 + USAGE_MARGIN_M, z1 + USAGE_MARGIN_M);
  return { x: cx, z: cz, yawRad: p.yawRad };
}

/** Splits a floor-level `WallRun` into the sub-spans that are ALSO free on
 *  `occ`'s wall-surface channel (paintings/sconces already placed there),
 *  by walking it in GRID_M steps and merging free samples -- same
 *  merge-adjacent-free-samples shape as `wallRuns` itself, one level up. */
function freeSubSpans(occ: RoomOccupancy, run: WallRun): WallRun[] {
  const out: WallRun[] = [];
  const steps = Math.ceil((run.to - run.from) / GRID_M);
  let start: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(run.to, run.from + i * GRID_M);
    const free = occ.isWallSpanFree(run.side, t - GRID_M / 2, t + GRID_M / 2);
    if (free) {
      if (start === null) start = t;
    } else if (start !== null) {
      out.push({ side: run.side, from: start, to: t });
      start = null;
    }
  }
  if (start !== null) out.push({ side: run.side, from: start, to: run.to });
  return out.filter((r) => r.to - r.from > 0.02);
}

/** (4) Places a wall-mounted item (painting/mirror/sconce) centred on the
 *  longest span that is free on BOTH the floor-level run (so it doesn't
 *  hang over furniture taller than the probe depth) and the wall-surface
 *  channel (so it doesn't land on a previously placed wall-mounted item).
 *  Marks the span it uses (plus a margin) on the wall-surface channel
 *  before returning, so the next call in the same loop gets a DIFFERENT
 *  span or `undefined` -- COO review P1: this used to be a pure query and
 *  every call in a `decor.ts` loop returned the identical pose. */
export function placeOnWallSurface(
  occ: RoomOccupancy,
  w: number,
  _h: number,
  sides: WallSide[] = WALL_SIDES,
  marginM = 0.15,
  /** Extra clearance (metres) a candidate span must keep from any
   *  ALREADY-PLACED wall item on this channel, beyond just not
   *  overlapping it -- e.g. sconces called with 0.6 so a fixture never
   *  lands within 0.6m of a painting's span (COO review P3). Paintings
   *  themselves call with the default 0, i.e. just "don't overlap". */
  clearanceM = 0
): PlacementResult | undefined {
  let best: { side: WallSide; span: WallRun; len: number } | undefined;
  for (const side of sides) {
    for (const run of wallRuns(occ, side, 0.15)) {
      for (const span of freeSubSpans(occ, run)) {
        const len = span.to - span.from;
        if (len < w) continue;
        if (clearanceM > 0 && !occ.isWallSpanFree(side, span.from - clearanceM, span.to + clearanceM)) continue;
        if (!best || len > best.len) best = { side, span, len };
      }
    }
  }
  if (!best) return undefined;
  const along = best.span.from + (best.span.to - best.span.from) / 2;
  const p = wallPoint(occ.room, best.side, along);
  occ.blockWallSpan(best.side, along - w / 2, along + w / 2, marginM);
  return { x: p.x, z: p.z, yawRad: p.yawRad };
}

/** (5) Free corner farthest from any door, for plants etc. */
export function placeCorner(floor: GroundFloor, occ: RoomOccupancy, footprint: Footprint): PlacementResult | undefined {
  const room = occ.room;
  const doors = doorRects(floor).filter((d) => d.roomA === room.roomId || d.roomB === room.roomId);
  const inset = Math.max(footprint.w, footprint.d) / 2 + 0.1;
  const corners: { x: number; z: number }[] = [
    { x: room.xM0 + inset, z: room.zM0 + inset },
    { x: room.xM1 - inset, z: room.zM0 + inset },
    { x: room.xM0 + inset, z: room.zM1 - inset },
    { x: room.xM1 - inset, z: room.zM1 - inset },
  ];
  let best: { c: { x: number; z: number }; score: number } | undefined;
  for (const c of corners) {
    if (!occ.isRectFree(c.x - footprint.w / 2, c.z - footprint.d / 2, c.x + footprint.w / 2, c.z + footprint.d / 2)) continue;
    const minDoorDist = doors.length === 0 ? 999 : Math.min(...doors.map((d) => Math.hypot(c.x - d.centerXM, c.z - d.centerZM)));
    if (!best || minDoorDist > best.score) best = { c, score: minDoorDist };
  }
  if (!best) return undefined;
  occ.blockRect(
    best.c.x - footprint.w / 2 - USAGE_MARGIN_M,
    best.c.z - footprint.d / 2 - USAGE_MARGIN_M,
    best.c.x + footprint.w / 2 + USAGE_MARGIN_M,
    best.c.z + footprint.d / 2 + USAGE_MARGIN_M
  );
  return { x: best.c.x, z: best.c.z, yawRad: 0 };
}

/** Snaps a sim-owned prop's visual position to the nearest wall point
 *  within `maxSnapM`, oriented to face into the room -- used by
 *  upkeep.ts. Returns `pos` unchanged (yawRad 0) if no wall is close
 *  enough; `pos` itself is never used for interaction, only display. */
export function snapToNearestWall(
  room: RoomRect,
  pos: { x: number; z: number },
  maxSnapM = 0.9
): PlacementResult {
  const distances: { side: WallSide; d: number; snap: { x: number; z: number; yawRad: number } }[] = [
    { side: "west", d: pos.x - room.xM0, snap: { x: room.xM0 + 0.1, z: pos.z, yawRad: Math.PI / 2 } },
    { side: "east", d: room.xM1 - pos.x, snap: { x: room.xM1 - 0.1, z: pos.z, yawRad: -Math.PI / 2 } },
    { side: "north", d: pos.z - room.zM0, snap: { x: pos.x, z: room.zM0 + 0.1, yawRad: 0 } },
    { side: "south", d: room.zM1 - pos.z, snap: { x: pos.x, z: room.zM1 - 0.1, yawRad: Math.PI } },
  ];
  let best: (typeof distances)[number] | undefined;
  for (const d of distances) {
    if (d.d < 0 || d.d > maxSnapM) continue;
    if (!best || d.d < best.d) best = d;
  }
  if (!best) return { x: pos.x, z: pos.z, yawRad: 0 };
  return best.snap;
}
