import { CELL, cellOfMm, type NavGrid } from "./grid.js";

export interface Portal {
  id: number;
  roomA: number;
  roomB: number;
  /** The door cell(s) this portal passes through. */
  cells: { cx: number; cz: number }[];
}

export interface PortalGraph {
  /** roomId -> portal ids touching it. Room 0 is reserved for "outside". */
  rooms: number[][];
  portals: Portal[];
}

/** Room id at a world position, or -1 if in a wall. Backed by a room-id
 *  layer emitted by the generator (see interiors). `rooms` is a flat
 *  row-major array parallel to `grid.cells`. */
export function roomAt(rooms: readonly number[], grid: NavGrid, xMm: number, zMm: number): number {
  const { cx, cz } = cellOfMm(grid, xMm, zMm);
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return -1;
  const idx = cz * grid.width + cx;
  const cell = grid.cells[idx];
  if (cell === undefined || cell & CELL.SOLID) return -1;
  return rooms[idx] ?? -1;
}
