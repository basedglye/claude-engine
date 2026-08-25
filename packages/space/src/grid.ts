// Integer static collision grid and axis-separated circle movement. See
// docs/PHASE-H0.md Determinism rules #6.

/** Cell bitfield flags. A cell may be walkable AND door, etc. */
export const CELL = {
  SOLID: 1,
  WALKABLE: 2,
  DOOR: 4,
  FURNITURE: 8,
} as const;

export const CELL_SIZE_MM = 250;

/** Immutable static collision grid for one floor. Plain JSON-serializable
 *  data (Uint8Array is NOT used — cells is number[] so grids survive the
 *  JSON round-trips core snapshots perform, if a game ever does store one). */
export interface NavGrid {
  width: number; // cells
  height: number; // cells
  originXMm: number; // world-mm of cell (0,0)'s min corner
  originZMm: number;
  cells: number[]; // length width*height, row-major, CELL bitfields
}

export function cellAt(grid: NavGrid, cx: number, cz: number): number {
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) {
    return CELL.SOLID; // out of bounds is treated as blocking
  }
  return grid.cells[cz * grid.width + cx] ?? CELL.SOLID;
}

export function cellOfMm(grid: NavGrid, xMm: number, zMm: number): { cx: number; cz: number } {
  const cx = Math.floor((xMm - grid.originXMm) / CELL_SIZE_MM);
  const cz = Math.floor((zMm - grid.originZMm) / CELL_SIZE_MM);
  return { cx, cz };
}

function isBlocking(
  grid: NavGrid,
  cx: number,
  cz: number,
  isOpen?: (cx: number, cz: number) => boolean
): boolean {
  const cell = cellAt(grid, cx, cz);
  if (cell & CELL.SOLID) return true;
  if (cell & CELL.FURNITURE) return true;
  if (cell & CELL.DOOR) {
    const open = isOpen ? isOpen(cx, cz) : false;
    if (!open) return true;
  }
  if (!(cell & CELL.WALKABLE)) return true;
  return false;
}

/** True if a circle of radiusMm centered at (xMm,zMm) overlaps any blocking
 *  cell. Checks the cells covering the circle's bounding box. */
function circleBlocked(
  grid: NavGrid,
  xMm: number,
  zMm: number,
  radiusMm: number,
  isOpen?: (cx: number, cz: number) => boolean
): boolean {
  const minC = cellOfMm(grid, xMm - radiusMm, zMm - radiusMm);
  const maxC = cellOfMm(grid, xMm + radiusMm, zMm + radiusMm);
  for (let cz = minC.cz; cz <= maxC.cz; cz++) {
    for (let cx = minC.cx; cx <= maxC.cx; cx++) {
      if (!isBlocking(grid, cx, cz, isOpen)) continue;
      // Circle-vs-AABB overlap test for this cell's box, in mm.
      const cellMinX = grid.originXMm + cx * CELL_SIZE_MM;
      const cellMinZ = grid.originZMm + cz * CELL_SIZE_MM;
      const cellMaxX = cellMinX + CELL_SIZE_MM;
      const cellMaxZ = cellMinZ + CELL_SIZE_MM;
      const closestX = Math.min(Math.max(xMm, cellMinX), cellMaxX);
      const closestZ = Math.min(Math.max(zMm, cellMinZ), cellMaxZ);
      const dx = xMm - closestX;
      const dz = zMm - closestZ;
      if (dx * dx + dz * dz < radiusMm * radiusMm) return true;
    }
  }
  return false;
}

/** Axis-separated circle-vs-grid move. Integer in, integer out. `isOpen`
 *  lets the caller overlay dynamic door state without mutating the grid:
 *  a DOOR cell blocks unless isOpen(cx,cz) returns true; SOLID always
 *  blocks; FURNITURE blocks. Resolves X then Z (documented order — part of
 *  the determinism contract). Returns the final position, never NaN, never
 *  inside a blocking cell. */
// Note: this is discrete (destination-only) collision, not swept/continuous.
// It is correct for per-tick displacements small relative to CELL_SIZE_MM
// (the intended usage: MOVE_SPEED_MM_PER_TICK = 200mm at 250mm cells) — a
// single-tick delta large enough to jump clean over a one-cell-thick wall
// could tunnel. No H0 caller produces deltas anywhere near that size.
export function moveCircle(
  grid: NavGrid,
  xMm: number,
  zMm: number,
  dxMm: number,
  dzMm: number,
  radiusMm: number,
  isOpen?: (cx: number, cz: number) => boolean
): { xMm: number; zMm: number } {
  let x = xMm;
  let z = zMm;

  // Resolve X first.
  if (dxMm !== 0) {
    const tryX = x + dxMm;
    if (!circleBlocked(grid, tryX, z, radiusMm, isOpen)) {
      x = tryX;
    }
    // else: blocked, stay at current x (0 mm movement on this axis).
  }

  // Then resolve Z, using the (possibly updated) x — this is what produces
  // wall-sliding: if X moved freely and Z is blocked, X's progress is kept.
  if (dzMm !== 0) {
    const tryZ = z + dzMm;
    if (!circleBlocked(grid, x, tryZ, radiusMm, isOpen)) {
      z = tryZ;
    }
  }

  return { xMm: x, zMm: z };
}

/** True if the swept grid line from a to b crosses no blocking cell (same
 *  isOpen overlay semantics). Integer DDA. */
export function losClear(
  grid: NavGrid,
  axMm: number,
  azMm: number,
  bxMm: number,
  bzMm: number,
  isOpen?: (cx: number, cz: number) => boolean
): boolean {
  const a = cellOfMm(grid, axMm, azMm);
  const b = cellOfMm(grid, bxMm, bzMm);

  let cx = a.cx;
  let cz = a.cz;
  const dcx = Math.abs(b.cx - cx);
  const dcz = Math.abs(b.cz - cz);
  const sx = b.cx > cx ? 1 : -1;
  const sz = b.cz > cz ? 1 : -1;
  let err = dcx - dcz;

  // Integer Bresenham/DDA walk over cells from a to b inclusive.
  for (;;) {
    if (isBlocking(grid, cx, cz, isOpen)) return false;
    if (cx === b.cx && cz === b.cz) break;
    const e2 = 2 * err;
    if (e2 > -dcz) {
      err -= dcz;
      cx += sx;
    }
    if (e2 < dcx) {
      err += dcx;
      cz += sz;
    }
  }
  return true;
}
