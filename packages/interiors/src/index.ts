// @claude-engine/interiors -- deterministic procedural hotel ground floors.
// One generator, three synchronized outputs (geometry, nav grid, portal
// graph) from a single BSP pass over the 250mm `space` grid, so they cannot
// desync. See docs/PHASE-H0.md section C.
import type { NavGrid, PortalGraph } from "@claude-engine/space";
import type { MeshDataWithColors } from "@claude-engine/assets";
import { generateLayout, type DoorSpec } from "./layout.js";
import { buildFloorMesh } from "./mesh-gen.js";

export type { DoorSpec } from "./layout.js";
export { DOOR_WIDTH_CELLS, DOOR_HEAD_HEIGHT_MM } from "./layout.js";
export { WALL_HEIGHT_MM } from "./mesh-gen.js";
export type { MeshDataWithColors } from "@claude-engine/assets";
export { generateDoorMesh } from "./door-mesh.js";

export interface GroundFloor {
  grid: NavGrid;
  rooms: number[]; // room-id per cell (parallel to grid.cells)
  portals: PortalGraph;
  doors: DoorSpec[];
  /** One static mesh for floor+walls+ceiling, vertex-coloured, no UVs.
   *  Positions in METRES (renderer space; mm/1000) -- geometry is
   *  presentation, the grid is truth. */
  mesh: MeshDataWithColors;
  spawn: { xMm: number; zMm: number; yawMdeg: number }; // lobby center
  /** Front desk: the desk prop cells are FURNITURE in `grid` (see
   *  mesh-gen.ts -- they get wall geometry from the same boundary scan as
   *  every other wall, never a second description). `xMm`/`zMm`/`yawMdeg`
   *  is the clerk-side terminal anchor; `queueCells[0]` is the head slot,
   *  adjacent to the desk on the guest side. */
  desk: {
    xMm: number;
    zMm: number;
    yawMdeg: number;
    queueCells: { cx: number; cz: number }[];
  };
  /** Index into `doors`: the street door guests spawn outside of. */
  entranceDoorIndex: number;
  /** The 4 existing rooms, annotated as bedrooms with a walk-to goal cell. */
  bedrooms: { roomId: number; tier: number; goalCx: number; goalCz: number }[];
}

/** Pure function of the seed: BSP-partition a lobby + corridor + 4 rooms
 *  onto the 250mm grid, carve door cells, then rasterize walls into the
 *  grid AND emit wall quads from the SAME cell data (mesh-gen.ts scans
 *  solid/walkable cell boundaries -- there is no second geometric
 *  description to drift). Deterministic: same seed, same bytes, forever. */
export function generateGroundFloor(seed: string): GroundFloor {
  const layout = generateLayout(seed);
  const mesh = buildFloorMesh(layout.grid, layout.rooms);
  return {
    grid: layout.grid,
    rooms: layout.rooms,
    portals: layout.portals,
    doors: layout.doors,
    mesh,
    spawn: layout.spawn,
    desk: layout.desk,
    entranceDoorIndex: layout.entranceDoorIndex,
    bedrooms: layout.bedrooms,
  };
}
