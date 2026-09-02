/**
 * Host-side floorplan queries over the sim's own grid. Presentation-only —
 * every function here reads `GroundFloor.grid` / `.rooms` (the ONE source
 * of truth for where a wall is, see packages/interiors/src/layout.ts) and
 * returns metres for the renderer. Nothing here is hashed or fed back into
 * the sim, so `Math.*` is fine (invariant 2 only bans it in sim-side code).
 *
 * Shared by render/architecture.ts (walls/floors/trim), render/lighting.ts
 * (one light rig per room), and render/decor.ts (furniture per room), so
 * the three of them cannot disagree about where a room is.
 */
import { CELL, CELL_SIZE_MM } from "@claude-engine/space";
import type { GroundFloor } from "@claude-engine/interiors";

/** Room ids as packages/interiors/src/layout.ts assigns them. 0 is
 *  "outside" (space's convention). */
export const ROOM = {
  OUTSIDE: 0,
  LOBBY: 1,
  CORRIDOR: 2,
  BEDROOM_1: 3,
  BEDROOM_2: 4,
  BEDROOM_3: 5,
  BEDROOM_4: 6,
  STREET: 7,
} as const;

export type RoomKind = "lobby" | "corridor" | "bedroom" | "street" | "outside";

export function roomKind(roomId: number): RoomKind {
  switch (roomId) {
    case ROOM.LOBBY:
      return "lobby";
    case ROOM.CORRIDOR:
      return "corridor";
    case ROOM.BEDROOM_1:
    case ROOM.BEDROOM_2:
    case ROOM.BEDROOM_3:
    case ROOM.BEDROOM_4:
      return "bedroom";
    case ROOM.STREET:
      return "street";
    default:
      return "outside";
  }
}

export const CELL_M = CELL_SIZE_MM / 1000;
/** Matches packages/interiors/src/mesh-gen.ts WALL_HEIGHT_MM. */
export const WALL_HEIGHT_M = 2.7;
/** Matches packages/interiors/src/layout.ts DOOR_HEAD_HEIGHT_MM. */
export const DOOR_HEAD_M = 2.1;

/** Axis-aligned bounding box of one room's walkable (non-door) cells.
 *  Cell coords are full-grid; `cx1`/`cz1` are EXCLUSIVE. Metre fields are
 *  the world-space extents (grid origin is 0,0 for every seed). */
export interface RoomRect {
  roomId: number;
  kind: RoomKind;
  cx0: number;
  cz0: number;
  cx1: number;
  cz1: number;
  xM0: number;
  zM0: number;
  xM1: number;
  zM1: number;
  centerXM: number;
  centerZM: number;
  widthM: number;
  depthM: number;
}

export function cellAt(floor: GroundFloor, cx: number, cz: number): number {
  const { width, height, cells } = floor.grid;
  if (cx < 0 || cz < 0 || cx >= width || cz >= height) return CELL.SOLID;
  return cells[cz * width + cx] ?? CELL.SOLID;
}

export function roomAt(floor: GroundFloor, cx: number, cz: number): number {
  const { width, height } = floor.grid;
  if (cx < 0 || cz < 0 || cx >= width || cz >= height) return ROOM.OUTSIDE;
  return floor.rooms[cz * width + cx] ?? ROOM.OUTSIDE;
}

export function isWalkable(cell: number): boolean {
  return (cell & CELL.WALKABLE) !== 0;
}
export function isDoor(cell: number): boolean {
  return (cell & CELL.DOOR) !== 0;
}
export function isFurniture(cell: number): boolean {
  return (cell & CELL.FURNITURE) !== 0;
}

/** World-space centre of a cell, in metres. */
export function cellCenterM(cx: number, cz: number): { x: number; z: number } {
  return { x: (cx + 0.5) * CELL_M, z: (cz + 0.5) * CELL_M };
}

/** Bounding rect per room id, over walkable non-door cells. Door cells are
 *  excluded on purpose: layout.ts assigns a doorway's cells to roomA, which
 *  would otherwise stretch the lobby's rect one row into its wall. */
export function roomRects(floor: GroundFloor): Map<number, RoomRect> {
  const { width, height } = floor.grid;
  const acc = new Map<number, { cx0: number; cz0: number; cx1: number; cz1: number }>();
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const cell = cellAt(floor, cx, cz);
      if (!isWalkable(cell) || isDoor(cell)) continue;
      const roomId = roomAt(floor, cx, cz);
      if (roomId === ROOM.OUTSIDE) continue;
      const a = acc.get(roomId);
      if (!a) acc.set(roomId, { cx0: cx, cz0: cz, cx1: cx + 1, cz1: cz + 1 });
      else {
        a.cx0 = Math.min(a.cx0, cx);
        a.cz0 = Math.min(a.cz0, cz);
        a.cx1 = Math.max(a.cx1, cx + 1);
        a.cz1 = Math.max(a.cz1, cz + 1);
      }
    }
  }
  const out = new Map<number, RoomRect>();
  for (const [roomId, a] of acc) {
    const xM0 = a.cx0 * CELL_M;
    const zM0 = a.cz0 * CELL_M;
    const xM1 = a.cx1 * CELL_M;
    const zM1 = a.cz1 * CELL_M;
    out.set(roomId, {
      roomId,
      kind: roomKind(roomId),
      cx0: a.cx0,
      cz0: a.cz0,
      cx1: a.cx1,
      cz1: a.cz1,
      xM0,
      zM0,
      xM1,
      zM1,
      centerXM: (xM0 + xM1) / 2,
      centerZM: (zM0 + zM1) / 2,
      widthM: xM1 - xM0,
      depthM: zM1 - zM0,
    });
  }
  return out;
}

/** The front desk's FURNITURE cells (the only furniture cells layout.ts
 *  writes), as a rect in metres. The clerk stands on the +Z (south) side;
 *  guests queue on the -Z (north) side — see layout.ts's desk placement. */
export function deskRect(floor: GroundFloor): RoomRect | undefined {
  const { width, height } = floor.grid;
  let a: { cx0: number; cz0: number; cx1: number; cz1: number } | undefined;
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      if (!isFurniture(cellAt(floor, cx, cz))) continue;
      if (!a) a = { cx0: cx, cz0: cz, cx1: cx + 1, cz1: cz + 1 };
      else {
        a.cx0 = Math.min(a.cx0, cx);
        a.cz0 = Math.min(a.cz0, cz);
        a.cx1 = Math.max(a.cx1, cx + 1);
        a.cz1 = Math.max(a.cz1, cz + 1);
      }
    }
  }
  if (!a) return undefined;
  const xM0 = a.cx0 * CELL_M;
  const zM0 = a.cz0 * CELL_M;
  const xM1 = a.cx1 * CELL_M;
  const zM1 = a.cz1 * CELL_M;
  return {
    roomId: ROOM.LOBBY,
    kind: "lobby",
    ...a,
    xM0,
    zM0,
    xM1,
    zM1,
    centerXM: (xM0 + xM1) / 2,
    centerZM: (zM0 + zM1) / 2,
    widthM: xM1 - xM0,
    depthM: zM1 - zM0,
  };
}

/** True when the cell is walkable and at least `clearanceCells` away from
 *  any non-walkable cell in every direction — a safe spot to stand a
 *  decorative prop without blocking a doorway or intersecting a wall.
 *  Decor is presentation only and the sim never collides with it, so this
 *  is about not LOOKING wrong, and about keeping props out of the queue
 *  and door lanes the nav system actually uses. */
export function hasClearance(floor: GroundFloor, cx: number, cz: number, clearanceCells: number): boolean {
  for (let dz = -clearanceCells; dz <= clearanceCells; dz++) {
    for (let dx = -clearanceCells; dx <= clearanceCells; dx++) {
      const c = cellAt(floor, cx + dx, cz + dz);
      if (!isWalkable(c) || isDoor(c)) return false;
    }
  }
  return true;
}

/** Every door's span as a rect in metres plus its axis, straight from
 *  `floor.doors` (a "row" door spans X at fixed Z; a "col" door spans Z). */
export interface DoorRect {
  doorIndex: number;
  axis: "row" | "col";
  xM0: number;
  zM0: number;
  xM1: number;
  zM1: number;
  centerXM: number;
  centerZM: number;
  roomA: number;
  roomB: number;
  isEntrance: boolean;
}

export function doorRects(floor: GroundFloor): DoorRect[] {
  return floor.doors.map((d) => {
    // layout.ts: yaw 0 == a row-spanning doorway (cells along +X), yaw
    // 90000 == column-spanning (cells along +Z).
    const axis: "row" | "col" = d.yawMdeg === 0 ? "row" : "col";
    const w = d.widthCells * CELL_M;
    const xM0 = axis === "row" ? d.cx * CELL_M : d.cx * CELL_M;
    const zM0 = axis === "row" ? d.cz * CELL_M : d.cz * CELL_M;
    const xM1 = axis === "row" ? xM0 + w : xM0 + CELL_M;
    const zM1 = axis === "row" ? zM0 + CELL_M : zM0 + w;
    return {
      doorIndex: d.doorIndex,
      axis,
      xM0,
      zM0,
      xM1,
      zM1,
      centerXM: d.xMm / 1000,
      centerZM: d.zMm / 1000,
      roomA: d.roomA,
      roomB: d.roomB,
      isEntrance: d.doorIndex === floor.entranceDoorIndex,
    };
  });
}
