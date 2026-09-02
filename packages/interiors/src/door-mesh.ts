// Door panel mesh: one fixed panel sized to the doorway, oriented by the
// door's hinge yaw. Uses space's Q16.16 integer trig (never Math.sin/cos)
// so orientation is deterministic across engines like everything else here.
import { cosMdeg, sinMdeg, ONE, CELL_SIZE_MM } from "@claude-engine/space";
import type { MeshDataWithColors } from "@claude-engine/assets";
import type { DoorSpec } from "./layout.js";
import { ATLAS_TILE_PX, TEXELS_PER_METRE, type AtlasRegion } from "./atlas.js";

const DOOR_HEIGHT_MM = 2100;
const DOOR_THICKNESS_MM = 40;
/** Vertex tint when the panel is NOT atlas-textured (the pre-H2b path, kept
 *  so a caller with no atlas still gets a door rather than a white slab). */
const DOOR_COLOR: readonly [number, number, number] = [0.45, 0.3, 0.2];
/** Vertex colour when the panel IS textured: white, so the atlas's `door`
 *  region supplies the albedo and the vertex channel carries nothing but
 *  light -- the same division of labour buildFloorMesh uses. */
const DOOR_UNTINTED: readonly [number, number, number] = [1, 1, 1];

/** Rotate a local (lx,lz) offset by yawMdeg using integer Q16.16 trig, then
 *  return metres. `sinMdeg`/`cosMdeg` are exact for yaw 0 and multiples of
 *  90000 (the only values H0's generator ever emits) and within-LUT-error
 *  otherwise -- fine for presentation-only door geometry. */
function rotateToWorldM(lx: number, lz: number, yawMdeg: number, cxMm: number, czMm: number): [number, number] {
  const cos = cosMdeg(yawMdeg);
  const sin = sinMdeg(yawMdeg);
  const wx = (lx * cos - lz * sin) / ONE;
  const wz = (lx * sin + lz * cos) / ONE;
  return [(cxMm + wx) / 1000, (czMm + wz) / 1000];
}

/**
 * Door mesh for one door: a thin box panel spanning the doorway width,
 * DOOR_HEIGHT_MM tall, centered on the door cell and oriented by yawMdeg.
 *
 * `region` is the atlas's `door` sub-rect. Pass it and the panel is UV'd
 * into the atlas and tinted white; omit it and you get the old flat
 * vertex-coloured slab.
 *
 * WHY THIS EXISTS. The atlas has had a `door` region since H2b synthesized
 * it, and nothing sampled it: door panels carried vertex colours and no
 * UVs, so every door in the hotel rendered as one flat brown rectangle.
 * With `look-lock` opening doors along the route, those slabs are the
 * largest objects in most interior shots, and they read as untextured
 * cardboard next to tiled floors and panelled walls -- they were the single
 * biggest remaining "this doesn't look like a room" contributor once the
 * floor/wall atlas started working.
 */
export function generateDoorMesh(spec: DoorSpec, region?: AtlasRegion): MeshDataWithColors {
  const halfW = (spec.widthCells * CELL_SIZE_MM) / 2;
  const halfT = DOOR_THICKNESS_MM / 2;
  const h = DOOR_HEIGHT_MM;

  // Local-space (before rotation) corners of the panel footprint, in mm,
  // width along local X, thickness along local Z.
  const corners2D: [number, number][] = [
    [-halfW, -halfT],
    [halfW, -halfT],
    [halfW, halfT],
    [-halfW, halfT],
  ];
  const world2D = corners2D.map(([lx, lz]) => rotateToWorldM(lx, lz, spec.yawMdeg, spec.xMm, spec.zMm));

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tint = region ? DOOR_UNTINTED : DOOR_COLOR;

  /** Planar UV for a panel vertex, at the same TEXELS_PER_METRE density the
   *  floor mesh uses so a door and the wall beside it share a texel scale.
   *  `u` runs along the panel's own width (tracked by the caller as a 0..1
   *  fraction) and `v` with height, both wrapped into the door tile and
   *  mapped into `region`. */
  function doorUv(widthFrac: number, yM: number): [number, number] {
    if (!region) return [0, 0];
    const widthM = (spec.widthCells * CELL_SIZE_MM) / 1000;
    const texU = ((widthFrac * widthM * TEXELS_PER_METRE) % ATLAS_TILE_PX + ATLAS_TILE_PX) % ATLAS_TILE_PX;
    const texV = ((yM * TEXELS_PER_METRE) % ATLAS_TILE_PX + ATLAS_TILE_PX) % ATLAS_TILE_PX;
    return [
      region.u0 + (texU / ATLAS_TILE_PX) * (region.u1 - region.u0),
      region.v0 + (texV / ATLAS_TILE_PX) * (region.v1 - region.v0),
    ];
  }

  function pushVert(
    x: number,
    y: number,
    z: number,
    n: [number, number, number],
    widthFrac: number
  ): number {
    const i = positions.length / 3;
    positions.push(x, y, z);
    normals.push(n[0], n[1], n[2]);
    colors.push(tint[0], tint[1], tint[2]);
    const [u, v] = doorUv(widthFrac, y);
    uvs.push(u, v);
    return i;
  }

  function quad(
    a: [number, number, number],
    bV: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number]
  ): void {
    // The four corners of every face are pushed in the order
    // (near-bottom, far-bottom, far-top, near-top), so the width fraction
    // is 0,1,1,0 -- enough for a panel whose texture is a vertical grain.
    const ia = pushVert(a[0], a[1], a[2], n, 0);
    const ib = pushVert(bV[0], bV[1], bV[2], n, 1);
    const ic = pushVert(c[0], c[1], c[2], n, 1);
    const id = pushVert(d[0], d[1], d[2], n, 0);
    indices.push(ia, ib, ic, ia, ic, id);
  }

  const y0 = 0;
  const y1 = h / 1000;
  const [x0, z0] = world2D[0]!;
  const [x1, z1] = world2D[1]!;
  const [x2, z2] = world2D[2]!;
  const [x3, z3] = world2D[3]!;

  // Front/back faces (along local Z, the thin axis) and top/bottom/sides --
  // a simple 6-face box, good enough for H0's "one fixed panel".
  quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [0, 0, -1]);
  quad([x2, y0, z2], [x3, y0, z3], [x3, y1, z3], [x2, y1, z2], [0, 0, 1]);
  quad([x1, y0, z1], [x2, y0, z2], [x2, y1, z2], [x1, y1, z1], [1, 0, 0]);
  quad([x3, y0, z3], [x0, y0, z0], [x0, y1, z0], [x3, y1, z3], [-1, 0, 0]);
  quad([x0, y1, z0], [x1, y1, z1], [x2, y1, z2], [x3, y1, z3], [0, 1, 0]);
  quad([x1, y0, z1], [x0, y0, z0], [x3, y0, z3], [x2, y0, z2], [0, -1, 0]);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    colors: new Float32Array(colors),
    uvs: new Float32Array(uvs),
    triCount: indices.length / 3,
  };
}
