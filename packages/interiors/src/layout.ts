// BSP-ish partition of a hotel ground floor onto the 250mm `space` grid.
// This module is the ONE source of truth for geometry: it produces the
// NavGrid, the room-id layer, and the door list together, in the same pass,
// from the same cell writes. mesh-gen.ts derives the mesh purely by
// scanning the grid this module returns — there is no second place that
// knows where a wall is.
import { Rng } from "@claude-engine/core";
import { CELL, CELL_SIZE_MM, type NavGrid } from "@claude-engine/space";
import type { Portal, PortalGraph } from "@claude-engine/space";

/** A doorway spans this many 250mm cells along its wall (1000mm) — real
 *  doorway width, and comfortable clearance for the 600mm-diameter player
 *  collider (PLAYER_RADIUS_MM=300 in apps/hotel). A single 250mm cell is
 *  narrower than the player, which made every doorway impassable
 *  regardless of door.open — this constant is the fix. */
export const DOOR_WIDTH_CELLS = 4;

/** Door head height, in mm: the wall above this (up to WALL_HEIGHT_MM in
 *  mesh-gen.ts) is a solid header over a DOOR cell, closing off what would
 *  otherwise be a hole straight through the wall to the void above the door
 *  leaf. ~2100mm matches a real interior door leaf height (also the
 *  DOOR_HEIGHT_MM in door-mesh.ts, which sizes the leaf mesh itself). Grid
 *  and collision are unaffected -- a DOOR cell stays walkable at floor
 *  level regardless of this constant; this only changes header GEOMETRY. */
export const DOOR_HEAD_HEIGHT_MM = 2100;

export interface DoorSpec {
  /** Stable per-layout door index (generation order). One doorway == one
   *  DoorSpec, even though it spans DOOR_WIDTH_CELLS grid cells. */
  doorIndex: number;
  /** Anchor DOOR cell (full-grid coords): the lowest-coordinate cell of the
   *  span (lowest cx for a row-spanning doorway, lowest cz for a
   *  column-spanning doorway). All DOOR_WIDTH_CELLS cells of the span carry
   *  CELL.WALKABLE|CELL.DOOR and are listed in the matching Portal's
   *  `cells` (portals.portals[doorIndex] by construction). */
  cx: number;
  cz: number;
  /** Center of the full span, in world mm — for mesh placement and the
   *  `interactable` component. NOT the anchor cell's center. */
  xMm: number;
  zMm: number;
  /** Cell span width, always DOOR_WIDTH_CELLS in H0 but carried explicitly
   *  so consumers (mesh sizing) never hardcode it. */
  widthCells: number;
  yawMdeg: number; // hinge orientation
  roomA: number;
  roomB: number;
}

export interface Layout {
  grid: NavGrid;
  rooms: number[];
  portals: PortalGraph;
  doors: DoorSpec[];
  spawn: { xMm: number; zMm: number; yawMdeg: number };
}

// Room ids. 0 is reserved for "outside" (space's convention).
const ROOM_LOBBY = 1;
const ROOM_CORRIDOR = 2;
const ROOM_1 = 3;
const ROOM_2 = 4;
const ROOM_3 = 5;
const ROOM_4 = 6;

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Pick the start of a `width`-cell span (avoiding the corners) inside
 *  [start, endExclusive), i.e. the span [p, p+width) with at least a
 *  1-cell margin on each side when the segment is long enough. Callers
 *  (layout generation, Scope C) guarantee every wall segment a door is cut
 *  into is at least width+2 cells long, so the margin branch below is a
 *  defensive fallback, never the live path for DOOR_WIDTH_CELLS. */
function pickSpanStart(start: number, endExclusive: number, width: number, rng: Rng): number {
  const lo = start + 1;
  const hi = endExclusive - 1 - width;
  if (hi < lo) {
    const p = Math.floor((start + endExclusive - width) / 2);
    return clampInt(p, start, Math.max(start, endExclusive - width));
  }
  return lo + rng.int(0, hi - lo);
}

export function generateLayout(seed: string): Layout {
  const rootRng = new Rng(seed);
  const layoutRng = rootRng.fork("layout");
  const doorRng = rootRng.fork("doors");

  // Footprint dimensions in cells, with modest jitter. Ranges are chosen so
  // every downstream constraint (room min depth/width, door clearance)
  // holds for every possible draw -- no seed can produce an invalid floor.
  const FW = 40 + layoutRng.int(0, 6); // 40..46
  const FH = 30 + layoutRng.int(0, 6); // 30..36
  const lobbyDepth = 9 + layoutRng.int(0, 3); // 9..12
  // Corridor width must leave room for a DOOR_WIDTH_CELLS-wide lobby<->
  // corridor doorway plus a 1-cell margin on each side (pickSpanStart's
  // fitting requirement): >= DOOR_WIDTH_CELLS + 2 = 6.
  const corridorW = (DOOR_WIDTH_CELLS + 2) + layoutRng.int(0, 2); // 6..8

  const corridorTop = lobbyDepth + 1; // 1-cell gap row separates lobby/corridor
  const corridorX0 = Math.floor((FW - corridorW) / 2);
  const corridorX1 = corridorX0 + corridorW;

  const restH = FH - corridorTop; // corridor + flanking rooms depth
  // Each split room's depth must leave room for a DOOR_WIDTH_CELLS-wide
  // corridor<->room doorway plus margin (same pickSpanStart requirement as
  // the corridor width above), i.e. >= DOOR_WIDTH_CELLS + 2 = 6; the extra
  // +1 here (7) keeps the pre-existing room-proportion feel unchanged.
  const minRoomDepth = DOOR_WIDTH_CELLS + 3; // 7
  const midLeft = corridorTop + Math.floor(restH / 2) + layoutRng.int(-2, 2);
  const splitRowLeft = clampInt(
    midLeft,
    corridorTop + minRoomDepth,
    corridorTop + restH - minRoomDepth - 1
  );
  const midRight = corridorTop + Math.floor(restH / 2) + layoutRng.int(-2, 2);
  const splitRowRight = clampInt(
    midRight,
    corridorTop + minRoomDepth,
    corridorTop + restH - minRoomDepth - 1
  );

  const margin = 1; // 1-cell "outside" border, kept SOLID
  const width = FW + margin * 2;
  const height = FH + margin * 2;
  const cells = new Array<number>(width * height).fill(CELL.SOLID);
  const rooms = new Array<number>(width * height).fill(0);

  function gidx(lx: number, lz: number): number {
    return (lz + margin) * width + (lx + margin);
  }

  function carve(x0: number, x1: number, z0: number, z1: number, roomId: number): void {
    for (let lz = z0; lz < z1; lz++) {
      for (let lx = x0; lx < x1; lx++) {
        const idx = gidx(lx, lz);
        cells[idx] = CELL.WALKABLE;
        rooms[idx] = roomId;
      }
    }
  }

  // Lobby: full width, top of the footprint.
  carve(0, FW, 0, lobbyDepth, ROOM_LOBBY);
  // Corridor: centered strip, from just below the lobby to the bottom.
  carve(corridorX0, corridorX1, corridorTop, FH, ROOM_CORRIDOR);
  // Left rooms, split top/bottom, leaving a 1-cell wall gap at corridorX0-1.
  carve(0, corridorX0 - 1, corridorTop, splitRowLeft - 1, ROOM_1);
  carve(0, corridorX0 - 1, splitRowLeft, FH, ROOM_2);
  // Right rooms, split top/bottom, leaving a 1-cell wall gap at corridorX1.
  carve(corridorX1 + 1, FW, corridorTop, splitRowRight - 1, ROOM_3);
  carve(corridorX1 + 1, FW, splitRowRight, FH, ROOM_4);

  const doors: DoorSpec[] = [];
  const portals: Portal[] = [];
  const roomTouches: number[][] = [[], [], [], [], [], [], []]; // index 0..6

  /** Carve a DOOR_WIDTH_CELLS-wide doorway. `axis: "row"` spans local X at
   *  fixed lz (lx is the span start); `axis: "col"` spans local Z at fixed
   *  lx (lz is the span start). One DoorSpec (stable doorIndex) per
   *  doorway; its Portal (portals[doorIndex] by construction) lists every
   *  spanned cell. */
  function addDoor(
    axis: "row" | "col",
    lx: number,
    lz: number,
    roomA: number,
    roomB: number,
    yawMdeg: number
  ): void {
    const cellsLocal: { lx: number; lz: number }[] = [];
    for (let i = 0; i < DOOR_WIDTH_CELLS; i++) {
      cellsLocal.push(axis === "row" ? { lx: lx + i, lz } : { lx, lz: lz + i });
    }
    const cellsGlobal = cellsLocal.map(({ lx: clx, lz: clz }) => ({ cx: clx + margin, cz: clz + margin }));
    for (const { cx, cz } of cellsGlobal) {
      const idx = cx + cz * width;
      cells[idx] = CELL.WALKABLE | CELL.DOOR;
      rooms[idx] = roomA;
    }
    const anchor = cellsGlobal[0]!;
    const last = cellsGlobal[cellsGlobal.length - 1]!;
    const doorIndex = doors.length;
    // Center of the full span, in world mm (midpoint between the anchor
    // cell's min corner and the last cell's max corner).
    const anchorMinX = anchor.cx * CELL_SIZE_MM;
    const anchorMinZ = anchor.cz * CELL_SIZE_MM;
    const lastMaxX = (last.cx + 1) * CELL_SIZE_MM;
    const lastMaxZ = (last.cz + 1) * CELL_SIZE_MM;
    const xMm = Math.floor((anchorMinX + lastMaxX) / 2);
    const zMm = Math.floor((anchorMinZ + lastMaxZ) / 2);
    doors.push({
      doorIndex,
      cx: anchor.cx,
      cz: anchor.cz,
      xMm,
      zMm,
      widthCells: DOOR_WIDTH_CELLS,
      yawMdeg,
      roomA,
      roomB,
    });
    const portalId = portals.length;
    portals.push({ id: portalId, roomA, roomB, cells: cellsGlobal });
    roomTouches[roomA]!.push(portalId);
    roomTouches[roomB]!.push(portalId);
  }

  // Lobby <-> corridor door: on the gap row (lobbyDepth), within corridor span.
  {
    const lx = pickSpanStart(corridorX0, corridorX1, DOOR_WIDTH_CELLS, doorRng.fork("door-lobby-x"));
    addDoor("row", lx, lobbyDepth, ROOM_LOBBY, ROOM_CORRIDOR, 0);
  }
  // Corridor <-> room1 (left-top): on the gap column corridorX0-1.
  {
    const lz = pickSpanStart(corridorTop, splitRowLeft - 1, DOOR_WIDTH_CELLS, doorRng.fork("door-r1-z"));
    addDoor("col", corridorX0 - 1, lz, ROOM_CORRIDOR, ROOM_1, 90_000);
  }
  // Corridor <-> room2 (left-bottom).
  {
    const lz = pickSpanStart(splitRowLeft, FH, DOOR_WIDTH_CELLS, doorRng.fork("door-r2-z"));
    addDoor("col", corridorX0 - 1, lz, ROOM_CORRIDOR, ROOM_2, 90_000);
  }
  // Corridor <-> room3 (right-top): on the gap column corridorX1.
  {
    const lz = pickSpanStart(corridorTop, splitRowRight - 1, DOOR_WIDTH_CELLS, doorRng.fork("door-r3-z"));
    addDoor("col", corridorX1, lz, ROOM_CORRIDOR, ROOM_3, 90_000);
  }
  // Corridor <-> room4 (right-bottom).
  {
    const lz = pickSpanStart(splitRowRight, FH, DOOR_WIDTH_CELLS, doorRng.fork("door-r4-z"));
    addDoor("col", corridorX1, lz, ROOM_CORRIDOR, ROOM_4, 90_000);
  }

  const graph: PortalGraph = {
    rooms: roomTouches,
    portals,
  };

  const grid: NavGrid = { width, height, originXMm: 0, originZMm: 0, cells };

  // Spawn: center of the lobby, always well clear of walls given the
  // minimum lobby dimensions above (>= 9 cells deep, >= 40 wide).
  const spawnLx = Math.floor(FW / 2);
  const spawnLz = Math.floor(lobbyDepth / 2);
  const spawnGx = spawnLx + margin;
  const spawnGz = spawnLz + margin;
  const spawn = {
    xMm: spawnGx * CELL_SIZE_MM + CELL_SIZE_MM / 2,
    zMm: spawnGz * CELL_SIZE_MM + CELL_SIZE_MM / 2,
    yawMdeg: 0,
  };

  return { grid, rooms, portals: graph, doors, spawn };
}
