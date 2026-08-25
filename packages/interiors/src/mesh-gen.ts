// Emits the ground floor's static mesh (floor + walls + ceiling) by
// scanning the SAME grid cells layout.ts wrote. There is no second,
// independent geometric description of a wall: every wall quad below comes
// directly from a solid/walkable cell-boundary test on `grid`.
import { CELL, CELL_SIZE_MM, type NavGrid } from "@claude-engine/space";
import type { MeshDataWithColors } from "@claude-engine/assets";

export const WALL_HEIGHT_MM = 2700;

type Vec3 = readonly [number, number, number];

const FLOOR_PALETTE: Record<number, Vec3> = {
  1: [0.72, 0.66, 0.55], // lobby
  2: [0.6, 0.6, 0.62], // corridor
  3: [0.55, 0.62, 0.7], // room 1
  4: [0.62, 0.55, 0.6], // room 2
  5: [0.55, 0.68, 0.58], // room 3
  6: [0.7, 0.62, 0.5], // room 4
};
const DEFAULT_FLOOR_COLOR: Vec3 = [0.5, 0.5, 0.5];
const WALL_COLOR: Vec3 = [0.8, 0.78, 0.74];
const CEILING_COLOR: Vec3 = [0.88, 0.88, 0.88];

function isWalkable(cellValue: number): boolean {
  return (cellValue & CELL.WALKABLE) !== 0;
}

/** Builder that accumulates raw (mm-scale) quads and converts to metres at
 *  the end -- geometry is presentation-only, so the mm->m division here is
 *  the one place float leaves integer sim data. */
class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  /** Adds one quad as two triangles (p0,p1,p2) and (p0,p2,p3), 6 indices --
   *  callers and the interiors test rely on "2 triangles per quad, emitted
   *  contiguously" to reconstruct quads from the flat mesh for the
   *  one-source-of-truth property check. */
  addQuad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, normal: Vec3, color: Vec3): void {
    const base = this.positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      this.positions.push(p[0] / 1000, p[1] / 1000, p[2] / 1000);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Builds the single static floor+walls+ceiling mesh by scanning `grid`
 *  (and `rooms`, for floor tint) for cell boundaries. */
export function buildFloorMesh(grid: NavGrid, rooms: readonly number[]): MeshDataWithColors {
  const b = new MeshBuilder();
  const { width, height, originXMm, originZMm } = grid;
  const S = CELL_SIZE_MM;
  const H = WALL_HEIGHT_MM;

  function idx(cx: number, cz: number): number {
    return cz * width + cx;
  }

  // --- Walls: scan internal x-edges (boundary between (cx,cz) and (cx+1,cz)). ---
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const a = grid.cells[idx(cx, cz)] ?? CELL.SOLID;
      const c = grid.cells[idx(cx + 1, cz)] ?? CELL.SOLID;
      const wa = isWalkable(a);
      const wc = isWalkable(c);
      if (wa === wc) continue; // both open or both closed: no wall here
      const bx = originXMm + (cx + 1) * S; // boundary plane, world mm
      const z0 = originZMm + cz * S;
      const z1 = z0 + S;
      if (wa) {
        // Walkable side is -X (cell cx); face normal points -X, into cx.
        b.addQuad([bx, 0, z1], [bx, 0, z0], [bx, H, z0], [bx, H, z1], [-1, 0, 0], WALL_COLOR);
      } else {
        // Walkable side is +X (cell cx+1); face normal points +X.
        b.addQuad([bx, 0, z0], [bx, 0, z1], [bx, H, z1], [bx, H, z0], [1, 0, 0], WALL_COLOR);
      }
    }
  }

  // --- Walls: scan internal z-edges (boundary between (cx,cz) and (cx,cz+1)). ---
  for (let cz = 0; cz < height - 1; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const a = grid.cells[idx(cx, cz)] ?? CELL.SOLID;
      const c = grid.cells[idx(cx, cz + 1)] ?? CELL.SOLID;
      const wa = isWalkable(a);
      const wc = isWalkable(c);
      if (wa === wc) continue;
      const bz = originZMm + (cz + 1) * S;
      const x0 = originXMm + cx * S;
      const x1 = x0 + S;
      if (wa) {
        // Walkable side is -Z (cell cz); normal points -Z.
        b.addQuad([x0, 0, bz], [x1, 0, bz], [x1, H, bz], [x0, H, bz], [0, 0, -1], WALL_COLOR);
      } else {
        // Walkable side is +Z (cell cz+1); normal points +Z.
        b.addQuad([x1, 0, bz], [x0, 0, bz], [x0, H, bz], [x1, H, bz], [0, 0, 1], WALL_COLOR);
      }
    }
  }

  // --- Floor + ceiling: one quad per walkable cell. ---
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const cell = grid.cells[idx(cx, cz)] ?? CELL.SOLID;
      if (!isWalkable(cell)) continue;
      const x0 = originXMm + cx * S;
      const x1 = x0 + S;
      const z0 = originZMm + cz * S;
      const z1 = z0 + S;
      const roomId = rooms[idx(cx, cz)] ?? 0;
      const floorColor = FLOOR_PALETTE[roomId] ?? DEFAULT_FLOOR_COLOR;
      // Floor, y=0, normal +Y.
      b.addQuad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], floorColor);
      // Ceiling, y=H, normal -Y.
      b.addQuad([x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], [0, -1, 0], CEILING_COLOR);
    }
  }

  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    indices: new Uint32Array(b.indices),
    colors: new Float32Array(b.colors),
    triCount: b.indices.length / 3,
  };
}
