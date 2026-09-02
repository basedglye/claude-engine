// Emits the ground floor's static mesh (floor + walls + ceiling) by
// scanning the SAME grid cells layout.ts wrote. There is no second,
// independent geometric description of a wall: every wall quad below comes
// directly from a solid/walkable cell-boundary test on `grid`.
import { CELL, CELL_SIZE_MM, type NavGrid } from "@claude-engine/space";
import type { MeshDataWithColors } from "@claude-engine/assets";
import { DOOR_HEAD_HEIGHT_MM } from "./layout.js";
import { ATLAS_SIZE_PX, ATLAS_TILE_PX, TEXELS_PER_METRE, type AtlasData } from "./atlas.js";

export const WALL_HEIGHT_MM = 2700;

type Vec3 = readonly [number, number, number];
/** Which two world axes a quad's UVs project onto -- see buildFloorMesh's
 *  planar-UV comment below. */
type UvAxis = "xz" | "zy" | "xy";

/**
 * H2b: ALBEDO LIVES IN THE ATLAS, LIGHTING LIVES IN THE VERTEX COLOURS.
 *
 * Before H2b these palettes WERE the surface colour, because there was no
 * texture. Now every quad also samples its material's atlas region, which
 * carries the same information — per-room floor hues, wall tone, ceiling,
 * door — at 64 px/m with a dithered 32-colour palette. Multiplying both
 * together describes each material's colour twice and lands roughly at its
 * square: driving the build with albedo in both places rendered the entire
 * hotel as a uniform dark brown (wall 0.74 albedo x 0.78 tint x 0.8 bake
 * = 0.46, and every material converged on the same mud). Caught by looking
 * at it, which is the only way this class of defect is ever caught.
 *
 * So the vertex colour is now the LIGHT ALONE — `litColor` is handed white
 * and returns the corridor gradient, window falloff and lamp warmth as a
 * near-neutral multiplier. The palettes below are kept as the DERIVATION
 * RECORD for `atlas.ts`'s per-material base colours (that is where they are
 * now authored) and as the fallback for any material with no atlas region.
 */
const FLOOR_PALETTE: Record<number, Vec3> = {
  1: [0.72, 0.66, 0.55], // lobby
  2: [0.6, 0.6, 0.62], // corridor
  3: [0.55, 0.62, 0.7], // room 1
  4: [0.62, 0.55, 0.6], // room 2
  5: [0.55, 0.68, 0.58], // room 3
  6: [0.7, 0.62, 0.5], // room 4
};
const DEFAULT_FLOOR_COLOR: Vec3 = [0.5, 0.5, 0.5];
// Kept as the derivation record for atlas.ts's `wall`/`ceiling` base
// colours (see the block comment above FLOOR_PALETTE); no longer emitted
// into vertex colours, so exported rather than left as dead locals.
export const WALL_COLOR: Vec3 = [0.8, 0.78, 0.74];
/** What `litColor` is handed for any surface whose albedo comes from the
 *  atlas: white, so the emitted vertex colour is purely the light. */
const UNTINTED: Vec3 = [1, 1, 1];
export const CEILING_COLOR: Vec3 = [0.88, 0.88, 0.88];

/** Room-id -> atlas material id, mirroring FLOOR_PALETTE's keys (layout.ts's
 *  private room-id scheme: 1=lobby, 2=corridor, 3..6=room1..room4 -- already
 *  hardcoded the same way in FLOOR_PALETTE above, so this just extends the
 *  existing convention rather than introducing a new one). */
const FLOOR_MATERIAL: Record<number, string> = {
  1: "floor:lobby",
  2: "floor:corridor",
  3: "floor:room1",
  4: "floor:room2",
  5: "floor:room3",
  6: "floor:room4",
};
const DEFAULT_FLOOR_MATERIAL = "floor:default";
/** layout.ts's ROOM_CORRIDOR id (private to that module) -- the corridor
 *  lighting gradient below needs to recognise corridor cells specifically. */
const ROOM_CORRIDOR_ID = 2;

function isWalkable(cellValue: number): boolean {
  return (cellValue & CELL.WALKABLE) !== 0;
}

function isDoor(cellValue: number): boolean {
  return (cellValue & CELL.DOOR) !== 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Lighting anchors the vertex-colour bake needs but that don't live in
 *  `grid`/`rooms` -- the entrance (street) door and the desk terminal, both
 *  already computed by layout.ts. index.ts's internal call passes them
 *  through; buildFloorMesh's own public shape stays two required geometry
 *  args (`grid`, `rooms`) plus `atlas` and this one lighting bag, rather
 *  than growing a long positional parameter list. */
export interface FloorMeshLighting {
  entranceXMm: number;
  entranceZMm: number;
  deskXMm: number;
  deskZMm: number;
}

/** Deterministic vertex-colour light multiplier + warm-tint amount for a
 *  point in the floor plan. Three effects, all integer-mm-distance-driven
 *  (Math.sqrt is allowed -- see scripts/check-purity.mjs's ban list, which
 *  covers sin/cos/tan/atan2/exp/log/pow/hypot/cbrt but NOT sqrt):
 *   - Corridor gradient: a linear ramp along the corridor's long axis
 *     (fluorescent-strip falloff away from the lobby end).
 *   - Window falloff: a quadratic brightness boost near the street door.
 *   - Lamp warmth: a quadratic warm-tint boost near the desk.
 *  Clamped to [0.35, 1.0] per H1b's "too-dark bake makes a screenshot
 *  unreadable" lesson (see the H2b task brief). */
function computeLight(
  roomId: number,
  xMm: number,
  zMm: number,
  corridor: { axis: "x" | "z"; min: number; max: number },
  lighting: FloorMeshLighting
): { mul: number; warm: number } {
  let mul = 1;

  if (roomId === ROOM_CORRIDOR_ID) {
    const pos = corridor.axis === "z" ? zMm : xMm;
    const span = corridor.max - corridor.min;
    const frac = span > 0 ? clamp01((pos - corridor.min) / span) : 0.5;
    mul *= 0.7 + 0.3 * frac;
  }

  const WINDOW_RADIUS_MM = 5000;
  const dxWin = xMm - lighting.entranceXMm;
  const dzWin = zMm - lighting.entranceZMm;
  const distWin = Math.sqrt(dxWin * dxWin + dzWin * dzWin);
  if (distWin < WINDOW_RADIUS_MM) {
    const t = 1 - distWin / WINDOW_RADIUS_MM;
    mul += 0.25 * t * t;
  }

  const LAMP_RADIUS_MM = 3000;
  const dxLamp = xMm - lighting.deskXMm;
  const dzLamp = zMm - lighting.deskZMm;
  const distLamp = Math.sqrt(dxLamp * dxLamp + dzLamp * dzLamp);
  let warm = 0;
  if (distLamp < LAMP_RADIUS_MM) {
    const t = 1 - distLamp / LAMP_RADIUS_MM;
    warm = 0.3 * t * t;
    mul += 0.15 * warm;
  }

  mul = clampRange(mul, 0.35, 1.0);
  return { mul, warm };
}

/**
 * The per-face directional term of the bake.
 *
 * WHY IT EXISTS. The positional falloffs above (corridor gradient, window,
 * lamp) vary slowly across the FLOOR PLAN and not at all with a surface's
 * orientation, so two opposite walls a metre apart get the same value and a
 * room renders as one flat field of colour. Driving the built game after the
 * first H2b pass showed exactly that: floor, wall and ceiling all landed
 * inside a ~1.3x value band and an interior read as noise rather than as a
 * room. The pre-H2b build did not have the problem only because it ran a
 * strong runtime DirectionalLight; moving the lighting into the bake without
 * bringing the normal term with it is what lost the separation.
 *
 * The direction is a committed constant, already unit-length so no
 * normalisation (and no transcendental) is needed: down-and-forward from
 * high on one side, the way an interior's ceiling fixtures actually read.
 * Floors face it and are brightest; ceilings face away and are darkest,
 * which is correct for an interior lit from above and is also what makes a
 * doorway silhouette legible.
 *
 * `FACE_AMBIENT` keeps the unlit side off the floor of the range — a wall
 * you cannot see the texture of is not stylish, it is broken.
 */
const SUN_DIR: Vec3 = [0.45, 0.78, 0.44];
const FACE_AMBIENT = 0.58;

function faceLight(normal: Vec3): number {
  const d = normal[0] * SUN_DIR[0] + normal[1] * SUN_DIR[1] + normal[2] * SUN_DIR[2];
  return FACE_AMBIENT + (1 - FACE_AMBIENT) * Math.max(0, d);
}

/** Multiplies `mul` (positional falloffs) and the per-face directional term
 *  into `color`, and nudges R up / B down by `warm` (a "warm lamp" shift),
 *  clamping each channel to [0,1]. */
function litColor(color: Vec3, mul: number, warm: number, normal: Vec3): Vec3 {
  const m = mul * faceLight(normal);
  return [
    clamp01(color[0] * m + warm * 0.08),
    clamp01(color[1] * m),
    clamp01(color[2] * m - warm * 0.05),
  ];
}

/** Builder that accumulates raw (mm-scale) quads and converts to metres at
 *  the end -- geometry is presentation-only, so the mm->m division here is
 *  the one place float leaves integer sim data. */
class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /** Adds one quad as two triangles (p0,p1,p2) and (p0,p2,p3), 6 indices --
   *  callers and the interiors test rely on "2 triangles per quad, emitted
   *  contiguously" to reconstruct quads from the flat mesh for the
   *  one-source-of-truth property check.
   *
   *  UVs: each corner's (u,v) is a planar projection of its own mm-scale
   *  world position onto `uvAxis`, converted to atlas texels at
   *  TEXELS_PER_METRE px/m, then WRAPPED (mod ATLAS_TILE_PX) into
   *  `atlas.regions[materialId]` before mapping to [0,1] atlas UV space.
   *  The wrap is mandatory, not cosmetic: without it, a quad whose world
   *  extent along an axis exceeds one tile period (ATLAS_TILE_PX /
   *  TEXELS_PER_METRE = 2m -- true for every full-height wall, which spans
   *  WALL_HEIGHT_MM=2.7m vertically) would sample past its material's tile
   *  into whatever tile happens to sit next to it in the atlas. Wrapping
   *  makes the material repeat (tile) instead, which is what "texture
   *  atlas" mapping means. Per-cell floor/wall quads are only 250mm (a
   *  fraction of the 2m period) so the wrap is a no-op for them in
   *  practice, but it must still run on every vertex uniformly -- a
   *  cell-boundary-relative special case would be a second UV rule to keep
   *  in sync with the first. */
  addQuad(
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
    p3: Vec3,
    normal: Vec3,
    color: Vec3,
    atlas: AtlasData,
    materialId: string,
    uvAxis: UvAxis
  ): void {
    const base = this.positions.length / 3;
    const region = atlas.regions[materialId];
    for (const p of [p0, p1, p2, p3]) {
      this.positions.push(p[0] / 1000, p[1] / 1000, p[2] / 1000);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(color[0], color[1], color[2]);
      if (region) {
        const [u, v] = projectUv(p, uvAxis, region);
        this.uvs.push(u, v);
      } else {
        this.uvs.push(0, 0);
      }
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function wrapPx(worldMm: number): number {
  const texel = (worldMm / 1000) * TEXELS_PER_METRE;
  const wrapped = texel % ATLAS_TILE_PX;
  return wrapped < 0 ? wrapped + ATLAS_TILE_PX : wrapped;
}

function projectUv(
  p: Vec3,
  axis: UvAxis,
  region: { u0: number; v0: number; u1: number; v1: number }
): [number, number] {
  let uWorldMm: number;
  let vWorldMm: number;
  if (axis === "xz") {
    uWorldMm = p[0];
    vWorldMm = p[2];
  } else if (axis === "zy") {
    uWorldMm = p[2];
    vWorldMm = p[1];
  } else {
    uWorldMm = p[0];
    vWorldMm = p[1];
  }
  const localU = wrapPx(uWorldMm) / ATLAS_TILE_PX;
  const localV = wrapPx(vWorldMm) / ATLAS_TILE_PX;
  // HALF-TEXEL GUTTER. `wrapPx` returns [0, ATLAS_TILE_PX), so a vertex
  // sitting exactly on a tile period maps to localU === 0 and therefore to
  // u === region.u0 — the shared edge between this material's tile and its
  // neighbour's. Under NearestFilter that boundary is decided by float
  // rounding, and a per-cell floor quad (250mm, a clean fraction of the 2m
  // tile period) hits it on essentially every vertex. Measured before this
  // inset: lobby floor quads sampling the CORRIDOR tile's grey-blue, and
  // ceiling quads sampling the lobby floor's tan. Pulling both ends in by
  // half a texel keeps every sample strictly inside its own material and
  // costs one texel of tile period, which at 64 px/m is 16mm of world.
  const insetU = 0.5 / ATLAS_SIZE_PX;
  const insetV = 0.5 / ATLAS_SIZE_PX;
  const u0 = region.u0 + insetU;
  const v0 = region.v0 + insetV;
  const u1 = region.u1 - insetU;
  const v1 = region.v1 - insetV;
  const u = u0 + localU * (u1 - u0);
  const v = v0 + localV * (v1 - v0);
  return [u, v];
}

/** Builds the single static floor+walls+ceiling mesh by scanning `grid`
 *  (and `rooms`, for floor tint) for cell boundaries. `atlas` supplies the
 *  UV regions per material id; `lighting` supplies the world-mm anchors
 *  (street door, desk) the vertex-colour bake falls off from. */
export function buildFloorMesh(
  grid: NavGrid,
  rooms: readonly number[],
  atlas: AtlasData,
  lighting: FloorMeshLighting
): MeshDataWithColors {
  const b = new MeshBuilder();
  const { width, height, originXMm, originZMm } = grid;
  const S = CELL_SIZE_MM;
  const H = WALL_HEIGHT_MM;

  function idx(cx: number, cz: number): number {
    return cz * width + cx;
  }

  // --- Corridor bbox prepass, for the lighting gradient's long axis. ------
  // Single scan over `rooms`; cheap next to the wall/floor scans below.
  let corrMinX = Infinity;
  let corrMaxX = -Infinity;
  let corrMinZ = Infinity;
  let corrMaxZ = -Infinity;
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      if (rooms[idx(cx, cz)] !== ROOM_CORRIDOR_ID) continue;
      const x0 = originXMm + cx * S;
      const z0 = originZMm + cz * S;
      if (x0 < corrMinX) corrMinX = x0;
      if (x0 + S > corrMaxX) corrMaxX = x0 + S;
      if (z0 < corrMinZ) corrMinZ = z0;
      if (z0 + S > corrMaxZ) corrMaxZ = z0 + S;
    }
  }
  const corridorHasCells = corrMinX <= corrMaxX;
  const corridorExtentX = corridorHasCells ? corrMaxX - corrMinX : 0;
  const corridorExtentZ = corridorHasCells ? corrMaxZ - corrMinZ : 0;
  const corridor = corridorHasCells
    ? corridorExtentZ >= corridorExtentX
      ? { axis: "z" as const, min: corrMinZ, max: corrMaxZ }
      : { axis: "x" as const, min: corrMinX, max: corrMaxX }
    : { axis: "z" as const, min: 0, max: 0 };

  function floorMaterialFor(roomId: number): string {
    return FLOOR_MATERIAL[roomId] ?? DEFAULT_FLOOR_MATERIAL;
  }

  function litWallColor(roomId: number, xMm: number, zMm: number, normal: Vec3): Vec3 {
    const { mul, warm } = computeLight(roomId, xMm, zMm, corridor, lighting);
    return litColor(UNTINTED, mul, warm, normal);
  }

  // --- Walls: scan internal x-edges (boundary between (cx,cz) and (cx+1,cz)). ---
  // Winding convention (both axes): a quad's front face -- determined by its
  // vertex winding order, which is what backface culling actually uses, NOT
  // the `normals` array on its own -- must point INTO the walkable cell on
  // that side. The `normals` array is set to match, since vertex-colour
  // lighting depends on it agreeing with the winding.
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const a = grid.cells[idx(cx, cz)] ?? CELL.SOLID;
      const c = grid.cells[idx(cx + 1, cz)] ?? CELL.SOLID;
      const wa = isWalkable(a);
      const wc = isWalkable(c);
      const bx = originXMm + (cx + 1) * S; // boundary plane, world mm
      const z0 = originZMm + cz * S;
      const z1 = z0 + S;
      const zMid = (z0 + z1) / 2;
      if (wa !== wc) {
        // Full-height wall: exactly one side is walkable.
        const walkableRoomId = wa ? rooms[idx(cx, cz)] ?? 0 : rooms[idx(cx + 1, cz)] ?? 0;
        if (wa) {
          // Walkable side is -X (cell cx); face normal points -X, into cx.
          const n: Vec3 = [-1, 0, 0];
          const color = litWallColor(walkableRoomId, bx, zMid, n);
          b.addQuad([bx, 0, z0], [bx, 0, z1], [bx, H, z1], [bx, H, z0], n, color, atlas, "wall", "zy");
        } else {
          // Walkable side is +X (cell cx+1); face normal points +X.
          const n: Vec3 = [1, 0, 0];
          const color = litWallColor(walkableRoomId, bx, zMid, n);
          b.addQuad([bx, 0, z1], [bx, 0, z0], [bx, H, z0], [bx, H, z1], n, color, atlas, "wall", "zy");
        }
      } else if (wa && wc && isDoor(a) !== isDoor(c)) {
        // Both walkable, but exactly one side is a DOOR cell: this boundary
        // is a doorway opening at floor level (no wall there, correctly),
        // but still needs a header above the door leaf, closing the hole
        // through to the void. Two quads (one per side), door-head-height
        // to ceiling -- same shape as a full wall pair, just clipped to the
        // top band.
        const colorNeg = litWallColor(rooms[idx(cx, cz)] ?? 0, bx, zMid, [-1, 0, 0]);
        const colorPos = litWallColor(rooms[idx(cx + 1, cz)] ?? 0, bx, zMid, [1, 0, 0]);
        b.addQuad(
          [bx, DOOR_HEAD_HEIGHT_MM, z0],
          [bx, DOOR_HEAD_HEIGHT_MM, z1],
          [bx, H, z1],
          [bx, H, z0],
          [-1, 0, 0],
          colorNeg,
          atlas,
          "wall",
          "zy"
        );
        b.addQuad(
          [bx, DOOR_HEAD_HEIGHT_MM, z1],
          [bx, DOOR_HEAD_HEIGHT_MM, z0],
          [bx, H, z0],
          [bx, H, z1],
          [1, 0, 0],
          colorPos,
          atlas,
          "wall",
          "zy"
        );
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
      const bz = originZMm + (cz + 1) * S;
      const x0 = originXMm + cx * S;
      const x1 = x0 + S;
      const xMid = (x0 + x1) / 2;
      if (wa !== wc) {
        const walkableRoomId = wa ? rooms[idx(cx, cz)] ?? 0 : rooms[idx(cx, cz + 1)] ?? 0;
        if (wa) {
          // Walkable side is -Z (cell cz); normal points -Z.
          const n: Vec3 = [0, 0, -1];
          const color = litWallColor(walkableRoomId, xMid, bz, n);
          b.addQuad([x1, 0, bz], [x0, 0, bz], [x0, H, bz], [x1, H, bz], n, color, atlas, "wall", "xy");
        } else {
          // Walkable side is +Z (cell cz+1); normal points +Z.
          const n: Vec3 = [0, 0, 1];
          const color = litWallColor(walkableRoomId, xMid, bz, n);
          b.addQuad([x0, 0, bz], [x1, 0, bz], [x1, H, bz], [x0, H, bz], n, color, atlas, "wall", "xy");
        }
      } else if (wa && wc && isDoor(a) !== isDoor(c)) {
        // Door header, see x-edge case above.
        const colorNeg = litWallColor(rooms[idx(cx, cz)] ?? 0, xMid, bz, [0, 0, -1]);
        const colorPos = litWallColor(rooms[idx(cx, cz + 1)] ?? 0, xMid, bz, [0, 0, 1]);
        b.addQuad(
          [x1, DOOR_HEAD_HEIGHT_MM, bz],
          [x0, DOOR_HEAD_HEIGHT_MM, bz],
          [x0, H, bz],
          [x1, H, bz],
          [0, 0, -1],
          colorNeg,
          atlas,
          "wall",
          "xy"
        );
        b.addQuad(
          [x0, DOOR_HEAD_HEIGHT_MM, bz],
          [x1, DOOR_HEAD_HEIGHT_MM, bz],
          [x1, H, bz],
          [x0, H, bz],
          [0, 0, 1],
          colorPos,
          atlas,
          "wall",
          "xy"
        );
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
      const xMid = (x0 + x1) / 2;
      const zMid = (z0 + z1) / 2;
      const roomId = rooms[idx(cx, cz)] ?? 0;
      const { mul, warm } = computeLight(roomId, xMid, zMid, corridor, lighting);
      // Untinted for the same reason walls and ceilings are: the per-room
      // hue is in the atlas region `floorMaterialFor(roomId)` selects. A
      // room with NO atlas region falls back to its palette entry, so the
      // tints above are still load-bearing for anything unmapped.
      const hasRegion = atlas.regions[floorMaterialFor(roomId)] !== undefined;
      const floorColor = litColor(hasRegion ? UNTINTED : (FLOOR_PALETTE[roomId] ?? DEFAULT_FLOOR_COLOR), mul, warm, [0, 1, 0]);
      const ceilingColor = litColor(UNTINTED, mul, warm, [0, -1, 0]);
      const floorMaterial = floorMaterialFor(roomId);
      // Floor, y=0, normal +Y (up, into the walkable volume above it).
      b.addQuad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], floorColor, atlas, floorMaterial, "xz");
      // Ceiling, y=H, normal -Y (down, into the walkable volume below it).
      b.addQuad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], [0, -1, 0], ceilingColor, atlas, "ceiling", "xz");
    }
  }

  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    indices: new Uint32Array(b.indices),
    colors: new Float32Array(b.colors),
    uvs: new Float32Array(b.uvs),
    triCount: b.indices.length / 3,
  };
}
