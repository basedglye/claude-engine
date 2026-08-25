// BSP-ish partition of a hotel ground floor onto the 250mm `space` grid.
// This module is the ONE source of truth for geometry: it produces the
// NavGrid, the room-id layer, and the door list together, in the same pass,
// from the same cell writes. mesh-gen.ts derives the mesh purely by
// scanning the grid this module returns — there is no second place that
// knows where a wall is.
import { Rng } from "@claude-engine/core";
import { CELL, CELL_SIZE_MM, type NavGrid } from "@claude-engine/space";
import type { Portal, PortalGraph } from "@claude-engine/space";

export interface DoorSpec {
  /** Stable per-layout door index (generation order). */
  doorIndex: number;
  cx: number;
  cz: number; // the DOOR cell (full-grid coords)
  xMm: number;
  zMm: number; // center, for placing the mesh + interactable
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

/** Pick an interior point (avoiding the corners) in [start, endExclusive). */
function pickInterior(start: number, endExclusive: number, rng: Rng): number {
  const lo = start + 1;
  const hi = endExclusive - 2;
  if (hi < lo) return Math.floor((start + endExclusive - 1) / 2);
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
  const corridorW = 4 + layoutRng.int(0, 2); // 4..6

  const corridorTop = lobbyDepth + 1; // 1-cell gap row separates lobby/corridor
  const corridorX0 = Math.floor((FW - corridorW) / 2);
  const corridorX1 = corridorX0 + corridorW;

  const restH = FH - corridorTop; // corridor + flanking rooms depth
  const minRoomDepth = 7;
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

  function addDoor(lx: number, lz: number, roomA: number, roomB: number, yawMdeg: number): void {
    const idx = gidx(lx, lz);
    cells[idx] = CELL.WALKABLE | CELL.DOOR;
    rooms[idx] = roomA;
    const gx = lx + margin;
    const gz = lz + margin;
    const doorIndex = doors.length;
    const xMm = gx * CELL_SIZE_MM + CELL_SIZE_MM / 2;
    const zMm = gz * CELL_SIZE_MM + CELL_SIZE_MM / 2;
    doors.push({ doorIndex, cx: gx, cz: gz, xMm, zMm, yawMdeg, roomA, roomB });
    const portalId = portals.length;
    portals.push({ id: portalId, roomA, roomB, cells: [{ cx: gx, cz: gz }] });
    roomTouches[roomA]!.push(portalId);
    roomTouches[roomB]!.push(portalId);
  }

  // Lobby <-> corridor door: on the gap row (lobbyDepth), within corridor span.
  {
    const lx = pickInterior(corridorX0, corridorX1, doorRng.fork("door-lobby-x"));
    addDoor(lx, lobbyDepth, ROOM_LOBBY, ROOM_CORRIDOR, 0);
  }
  // Corridor <-> room1 (left-top): on the gap column corridorX0-1.
  {
    const lz = pickInterior(corridorTop, splitRowLeft - 1, doorRng.fork("door-r1-z"));
    addDoor(corridorX0 - 1, lz, ROOM_CORRIDOR, ROOM_1, 90_000);
  }
  // Corridor <-> room2 (left-bottom).
  {
    const lz = pickInterior(splitRowLeft, FH, doorRng.fork("door-r2-z"));
    addDoor(corridorX0 - 1, lz, ROOM_CORRIDOR, ROOM_2, 90_000);
  }
  // Corridor <-> room3 (right-top): on the gap column corridorX1.
  {
    const lz = pickInterior(corridorTop, splitRowRight - 1, doorRng.fork("door-r3-z"));
    addDoor(corridorX1, lz, ROOM_CORRIDOR, ROOM_3, 90_000);
  }
  // Corridor <-> room4 (right-bottom).
  {
    const lz = pickInterior(splitRowRight, FH, doorRng.fork("door-r4-z"));
    addDoor(corridorX1, lz, ROOM_CORRIDOR, ROOM_4, 90_000);
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
