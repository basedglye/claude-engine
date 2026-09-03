/**
 * Host-side "real hotel" architecture builder. Presentation-only: reads
 * floor.grid/floor.rooms exactly like packages/interiors/src/mesh-gen.ts
 * does, but emits real geometry (floors with borders, coffered ceilings,
 * trim, architraves, pilasters, a panelled desk, fake windows) merged per
 * material into a handful of draw calls, instead of mesh-gen's flat
 * vertex-coloured box.
 *
 * Zero sim imports (type-only), zero Math.random -- any per-cell variation
 * is derived by hashing deterministic inputs (cell coords / room id), per
 * NON-NEGOTIABLE RULE 5 in this lane's brief. Math.* trig/etc is fine here
 * (host code only).
 */
import * as THREE from "three";
import { BufferGeometryUtils } from "three/examples/jsm/Addons.js";
import type { GroundFloor } from "@claude-engine/interiors";
import { makePbrMaterial } from "./assets.js";
import { stainedCarpetTexture, cleanCarpetTexture, scuffedPaintTexture, ceilingTileTexture, laminateTexture, type HotelTier } from "./procedural.js";
import {
  CELL_M,
  WALL_HEIGHT_M,
  DOOR_HEAD_M,
  ROOM,
  cellAt,
  roomAt,
  isWalkable,
  isDoor,
  roomKind,
  roomRects,
  doorRects,
  deskRect,
  type RoomKind,
} from "./floorplan.js";

// -- deterministic hash (no Math.random) -------------------------------
// -- geometry accumulation: one growable buffer per material -----------
interface Accum {
  positions: number[];
  normals: number[];
  uvs: number[];
}
function newAccum(): Accum {
  return { positions: [], normals: [], uvs: [] };
}
function pushQuad(
  acc: Accum,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  n: [number, number, number],
  uv0: [number, number],
  uv1: [number, number],
  uv2: [number, number],
  uv3: [number, number]
): void {
  // Two triangles, CCW when viewed from the normal direction: (p0,p1,p2),(p0,p2,p3).
  for (const p of [p0, p1, p2, p0, p2, p3]) {
    acc.positions.push(p[0], p[1], p[2]);
    acc.normals.push(n[0], n[1], n[2]);
  }
  for (const uv of [uv0, uv1, uv2, uv0, uv2, uv3]) {
    acc.uvs.push(uv[0], uv[1]);
  }
}
function accumToGeometry(acc: Accum): THREE.BufferGeometry | undefined {
  if (acc.positions.length === 0) return undefined;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(acc.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(acc.normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(acc.uvs, 2));
  return g;
}

/** Axis-aligned box helper: emits 6 faces with planar metre UVs, into
 *  possibly-different accumulators per face pair (top/bottom vs sides use
 *  the same accumulator here; callers needing per-face materials build
 *  boxes manually). castShadow/receiveShadow set by caller on the mesh. */
function pushBox(
  acc: Accum,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number
): void {
  // +X
  pushQuad(acc, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [z1, y0], [z0, y0], [z0, y1], [z1, y1]);
  // -X
  pushQuad(acc, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [z0, y0], [z1, y0], [z1, y1], [z0, y1]);
  // +Y (top)
  pushQuad(acc, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]);
  // -Y (bottom)
  pushQuad(acc, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
  // +Z
  pushQuad(acc, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0, y0], [x1, y0], [x1, y1], [x0, y1]);
  // -Z
  pushQuad(acc, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [x1, y0], [x0, y0], [x0, y1], [x1, y1]);
}

const MATERIAL_TILE_M: Record<string, number> = {
  "lobby-floor": 2,
  "lobby-floor-border": 1,
  "corridor-carpet": 1.5,
  "room-carpet": 1.5,
  street: 2,
  ceiling: 3,
  "wall-lobby": 2,
  "wall-corridor": 2,
  "wall-paper": 2,
  facade: 2,
  "wood-trim": 1,
  "wood-door": 1,
  "desk-top": 1,
  "metal-brass": 0.5,
  "ceiling-tee": 3,
};
const FALLBACK_COLOR: Record<string, number> = {
  "lobby-floor": 0xd8cdb8,
  "lobby-floor-border": 0x2a2622,
  "corridor-carpet": 0x5c3a3a,
  "room-carpet": 0x6b5b47,
  street: 0x5a5a5a,
  ceiling: 0xf1ede4,
  "wall-lobby": 0xe4dcc8,
  "wall-corridor": 0xc9b8a0,
  "wall-paper": 0xd9c6b0,
  facade: 0x7a6a5a,
  "wood-trim": 0x3c2a1a,
  "wood-door": 0x4a3220,
  "desk-top": 0x2e2a26,
  "metal-brass": 0xb08d3f,
  "ceiling-tee": 0xc7c6c0,
};

export type { HotelTier };

function wallMaterialForKind(kind: RoomKind, hotelTier: HotelTier): string {
  if (hotelTier === 0) return "wall-paper"; // flat scuffed paint everywhere
  switch (kind) {
    case "lobby":
      return "wall-lobby";
    case "corridor":
      return "wall-corridor";
    case "bedroom":
      return "wall-paper";
    default:
      return "wall-lobby";
  }
}
function floorMaterialForKind(kind: RoomKind, hotelTier: HotelTier): string {
  if (hotelTier === 0) {
    // Stained beige carpet in every room, per the vision table.
    return kind === "street" ? "street" : "room-carpet";
  }
  switch (kind) {
    case "lobby":
      return "lobby-floor";
    case "corridor":
      return "corridor-carpet";
    case "bedroom":
      return "room-carpet";
    case "street":
      return "street";
    default:
      return "lobby-floor";
  }
}

/** Procedural (canvas) materials used at tiers 0/1 in place of the CC0 PBR
 *  set. Cached per (name, hotelTier) — a module-level cache keyed on name
 *  alone would hand tier 1 the tier-0 material (see brief §3). */
const proceduralMatCache = new Map<string, THREE.MeshStandardMaterial>();
function proceduralMatFor(name: string, hotelTier: HotelTier): THREE.MeshStandardMaterial {
  const key = `${name}:${hotelTier}`;
  let m = proceduralMatCache.get(key);
  if (m) return m;
  if (name === "ceiling-tee") {
    // Cheap dull aluminium/white tee -- explicitly low metalness, high
    // roughness, never the "metal-brass" gold.
    m = new THREE.MeshStandardMaterial({ color: FALLBACK_COLOR["ceiling-tee"], roughness: 0.85, metalness: 0.15 });
    proceduralMatCache.set(key, m);
    return m;
  }
  const roughness = name === "desk-top" ? 0.9 : name.startsWith("wall") || name === "ceiling" ? 0.95 : 0.92;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });
  if (name === "room-carpet" || name === "corridor-carpet" || name === "lobby-floor" || name === "lobby-floor-border") {
    // Tier 0: stained (the vision's "stained beige carpet"). Tier 1: the
    // vision explicitly says "clean carpet" -- the earlier version reused
    // the stain generator with a different seed, so the stains just moved
    // (COO review item 3). No stain pass at all for tier 1.
    m.map = hotelTier === 0 ? stainedCarpetTexture(1) : cleanCarpetTexture();
  } else if (name.startsWith("wall")) {
    m.map = scuffedPaintTexture(hotelTier === 0 ? 1 : 2);
  } else if (name === "ceiling") {
    m.map = ceilingTileTexture();
  } else if (name === "desk-top") {
    m.map = laminateTexture();
  } else {
    m.color.set(FALLBACK_COLOR[name] ?? 0x999999);
  }
  const tileM = MATERIAL_TILE_M[name] ?? 1;
  if (m.map) {
    m.map.repeat.set(1 / tileM, 1 / tileM);
    m.map.needsUpdate = true;
  }
  proceduralMatCache.set(key, m);
  return m;
}

export function buildArchitecture(floor: GroundFloor, hotelTier: HotelTier): THREE.Group {
  const group = new THREE.Group();
  group.name = "architecture";

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const accums = new Map<string, Accum>();
  function matFor(name: string): THREE.MeshStandardMaterial {
    let m = materials.get(name);
    if (!m) {
      m =
        hotelTier === 2
          ? makePbrMaterial(name, {
              fallbackColor: FALLBACK_COLOR[name] ?? 0x999999,
              tileM: MATERIAL_TILE_M[name] ?? 1,
              roughness: name === "desk-top" ? 0.35 : name.startsWith("wall") ? 0.9 : 0.85,
            })
          : proceduralMatFor(name, hotelTier);
      materials.set(name, m);
      accums.set(name, newAccum());
    }
    return m;
  }
  function accFor(name: string): Accum {
    matFor(name);
    return accums.get(name)!;
  }

  const { width, height } = floor.grid;
  const rects = roomRects(floor);
  const doors = doorRects(floor);
  const desk = deskRect(floor);
  const H = WALL_HEIGHT_M;

  // --- 1+2. Floors + ceilings, per cell (merged into per-material accum). ---
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const cell = cellAt(floor, cx, cz);
      if (!isWalkable(cell)) continue;
      const roomId = roomAt(floor, cx, cz);
      const kind = roomKind(roomId);
      const x0 = cx * CELL_M;
      const x1 = x0 + CELL_M;
      const z0 = cz * CELL_M;
      const z1 = z0 + CELL_M;

      // Floor
      let floorMat = floorMaterialForKind(kind, hotelTier);
      if (kind === "lobby") {
        // 1-cell border along every lobby wall: this cell is a border
        // cell if any 4-neighbour is non-walkable or a different room.
        const isBorder =
          !isWalkable(cellAt(floor, cx - 1, cz)) ||
          !isWalkable(cellAt(floor, cx + 1, cz)) ||
          !isWalkable(cellAt(floor, cx, cz - 1)) ||
          !isWalkable(cellAt(floor, cx, cz + 1)) ||
          roomAt(floor, cx - 1, cz) !== roomId ||
          roomAt(floor, cx + 1, cz) !== roomId ||
          roomAt(floor, cx, cz - 1) !== roomId ||
          roomAt(floor, cx, cz + 1) !== roomId;
        if (isBorder) floorMat = "lobby-floor-border";
      }
      const facc = accFor(floorMat);
      pushQuad(facc, [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]);

      // Ceiling: not over street (mesh-gen bug this lane must not repeat).
      if (kind !== "street") {
        const cacc = accFor("ceiling");
        pushQuad(cacc, [x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], [0, -1, 0], [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
      }
    }
  }

  // --- Coffered lobby ceiling beams (tier 2 only): grid at ~2.5m pitch. ---
  //     Tier 0 swaps this for a drop-ceiling grid (tile seams + a couple of
  //     thin support tees) instead; tier 1 gets neither (plain ceiling).
  if (hotelTier === 2) {
    const lobby = rects.get(ROOM.LOBBY);
    if (lobby) {
      const trimAcc = accFor("wood-trim");
      const beamDepth = 0.15;
      const beamW = 0.2;
      const pitch = 2.5;
      const y1 = H;
      const y0 = H - beamDepth;
      for (let x = Math.ceil(lobby.xM0 / pitch) * pitch; x < lobby.xM1; x += pitch) {
        if (x - lobby.xM0 < 0.3 || lobby.xM1 - x < 0.3) continue;
        pushBox(trimAcc, x - beamW / 2, x + beamW / 2, y0, y1, lobby.zM0, lobby.zM1);
      }
      for (let z = Math.ceil(lobby.zM0 / pitch) * pitch; z < lobby.zM1; z += pitch) {
        if (z - lobby.zM0 < 0.3 || lobby.zM1 - z < 0.3) continue;
        pushBox(trimAcc, lobby.xM0, lobby.xM1, y0, y1, z - beamW / 2, z + beamW / 2);
      }
    }
  } else if (hotelTier === 0) {
    // Drop-ceiling grid: thin sheet-metal tee bars in a 0.6m grid, over
    // every interior room (not just the lobby) -- tier 0 is cheap everywhere.
    // Own material, not "metal-brass" -- a suspended-ceiling tee is dull
    // white/aluminium, not polished gold (COO review item 2).
    const teeAcc = accFor("ceiling-tee");
    const teeW = 0.02;
    const teeD = 0.03;
    const pitch = 0.6;
    const y1 = H;
    const y0 = H - teeD;
    for (const rect of rects.values()) {
      if (rect.kind === "street") continue;
      for (let x = Math.ceil(rect.xM0 / pitch) * pitch; x < rect.xM1; x += pitch) {
        pushBox(teeAcc, x - teeW / 2, x + teeW / 2, y0, y1, rect.zM0, rect.zM1);
      }
      for (let z = Math.ceil(rect.zM0 / pitch) * pitch; z < rect.zM1; z += pitch) {
        pushBox(teeAcc, rect.xM0, rect.xM1, y0, y1, z - teeW / 2, z + teeW / 2);
      }
    }
  }

  // --- helper: is (cx,cz) within any door span (in cell coords)? ---
  function nearDoorSpanM(xM: number, zM: number, marginM: number): boolean {
    for (const d of doors) {
      if (xM > d.xM0 - marginM && xM < d.xM1 + marginM && zM > d.zM0 - marginM && zM < d.zM1 + marginM) return true;
    }
    return false;
  }

  // --- 3. Walls: scan x-edges and z-edges exactly like mesh-gen.ts. ---
  function wallMatForSide(walkCx: number, walkCz: number): string {
    const roomId = roomAt(floor, walkCx, walkCz);
    return wallMaterialForKind(roomKind(roomId), hotelTier);
  }

  // The street strip is bordered by SOLID cells on three sides purely
  // because the grid ends there; only the building's own facade row (the
  // solid cell SOUTH of a street cell, larger cz) is a real wall. Emitting
  // the other three would box the street in -- exterior.ts draws the open
  // pavement, road and skyline beyond instead.
  function isStreetOuterEdge(walkCx: number, walkCz: number, solidCx: number, solidCz: number): boolean {
    if (roomAt(floor, walkCx, walkCz) !== ROOM.STREET) return false;
    return !(solidCx === walkCx && solidCz > walkCz);
  }

  const wallXEdges: { walkCx: number; walkCz: number; solidOnPlus: boolean; bx: number; z0: number; z1: number; exterior: boolean }[] = [];
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const a = cellAt(floor, cx, cz);
      const c = cellAt(floor, cx + 1, cz);
      const wa = isWalkable(a);
      const wc = isWalkable(c);
      if (wa === wc) continue;
      const bx = (cx + 1) * CELL_M;
      const z0 = cz * CELL_M;
      const z1 = z0 + CELL_M;
      const walkCx = wa ? cx : cx + 1;
      // exterior: the solid neighbour is off the north/outer edge (row cz small)
      // — approximate "exterior" as adjacent to grid border or the street row.
      const solidCx = wa ? cx + 1 : cx;
      if (isStreetOuterEdge(walkCx, cz, solidCx, cz)) continue;
      const exterior = solidCx <= 0 || solidCx >= width - 1;
      const mat = wallMatForSide(walkCx, cz);
      const macc = accFor(mat);
      if (wa) {
        pushQuad(macc, [bx, 0, z0], [bx, 0, z1], [bx, H, z1], [bx, H, z0], [-1, 0, 0], [z0, 0], [z1, 0], [z1, H], [z0, H]);
      } else {
        pushQuad(macc, [bx, 0, z1], [bx, 0, z0], [bx, H, z0], [bx, H, z1], [1, 0, 0], [z1, 0], [z0, 0], [z0, H], [z1, H]);
      }
      wallXEdges.push({ walkCx, walkCz: cz, solidOnPlus: !wa, bx, z0, z1, exterior });
    }
  }
  const wallZEdges: { walkCx: number; walkCz: number; bz: number; x0: number; x1: number; exterior: boolean }[] = [];
  for (let cz = 0; cz < height - 1; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const a = cellAt(floor, cx, cz);
      const c = cellAt(floor, cx, cz + 1);
      const wa = isWalkable(a);
      const wc = isWalkable(c);
      if (wa === wc) continue;
      const bz = (cz + 1) * CELL_M;
      const x0 = cx * CELL_M;
      const x1 = x0 + CELL_M;
      const walkCz = wa ? cz : cz + 1;
      const solidCz = wa ? cz + 1 : cz;
      if (isStreetOuterEdge(cx, walkCz, cx, solidCz)) continue;
      const exterior = solidCz <= 0 || solidCz >= height - 1;
      const mat = wallMatForSide(cx, walkCz);
      const macc = accFor(mat);
      if (wa) {
        pushQuad(macc, [x1, 0, bz], [x0, 0, bz], [x0, H, bz], [x1, H, bz], [0, 0, -1], [x1, 0], [x0, 0], [x0, H], [x1, H]);
      } else {
        pushQuad(macc, [x0, 0, bz], [x1, 0, bz], [x1, H, bz], [x0, H, bz], [0, 0, 1], [x0, 0], [x1, 0], [x1, H], [x0, H]);
      }
      wallZEdges.push({ walkCx: cx, walkCz, bz, x0, x1, exterior });
    }
  }

  // Door headers (mirrors mesh-gen.ts) — reuse the same edge scan.
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const a = cellAt(floor, cx, cz);
      const c = cellAt(floor, cx + 1, cz);
      if (!isWalkable(a) || !isWalkable(c)) continue;
      if (isDoor(a) === isDoor(c)) continue;
      const bx = (cx + 1) * CELL_M;
      const z0 = cz * CELL_M;
      const z1 = z0 + CELL_M;
      const mat = wallMatForSide(cx, cz);
      const macc = accFor(mat);
      pushQuad(macc, [bx, DOOR_HEAD_M, z0], [bx, DOOR_HEAD_M, z1], [bx, H, z1], [bx, H, z0], [-1, 0, 0], [z0, DOOR_HEAD_M], [z1, DOOR_HEAD_M], [z1, H], [z0, H]);
      pushQuad(macc, [bx, DOOR_HEAD_M, z1], [bx, DOOR_HEAD_M, z0], [bx, H, z0], [bx, H, z1], [1, 0, 0], [z1, DOOR_HEAD_M], [z0, DOOR_HEAD_M], [z0, H], [z1, H]);
    }
  }
  for (let cz = 0; cz < height - 1; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const a = cellAt(floor, cx, cz);
      const c = cellAt(floor, cx, cz + 1);
      if (!isWalkable(a) || !isWalkable(c)) continue;
      if (isDoor(a) === isDoor(c)) continue;
      const bz = (cz + 1) * CELL_M;
      const x0 = cx * CELL_M;
      const x1 = x0 + CELL_M;
      const mat = wallMatForSide(cx, cz);
      const macc = accFor(mat);
      pushQuad(
        macc,
        [x1, DOOR_HEAD_M, bz],
        [x0, DOOR_HEAD_M, bz],
        [x0, H, bz],
        [x1, H, bz],
        [0, 0, -1],
        [x1, DOOR_HEAD_M],
        [x0, DOOR_HEAD_M],
        [x0, H],
        [x1, H]
      );
    }
  }

  // --- 4. Trim: skirting, chair rail + wainscot (lobby/corridor only), cornice. ---
  const trimAcc = accFor("wood-trim");
  const ceilTrimAcc = accFor("ceiling");
  const SKIRT_H = 0.12;
  const SKIRT_D = 0.018;
  const RAIL_Y = 0.9;
  const RAIL_H = 0.04;
  const WAINS_D = 0.02;
  const CORNICE_H = 0.1;
  const CORNICE_D = 0.06;
  const DOOR_TRIM_MARGIN = CELL_M * 0.5; // stop trim near door spans

  function trimRunX(z: number, xLo: number, xHi: number, kind: RoomKind, faceSign: 1 | -1): void {
    // faceSign: +1 wall faces +Z (protrudes toward +z), -1 faces -Z.
    const segs = splitAroundDoors(xLo, xHi, "x", z);
    for (const [sx0, sx1] of segs) {
      if (sx1 - sx0 <= 0.01) continue;
      const zLo = faceSign === 1 ? z : z - SKIRT_D;
      const zHi = faceSign === 1 ? z + SKIRT_D : z;
      pushBox(trimAcc, sx0, sx1, 0, SKIRT_H, zLo, zHi);
      if (hotelTier === 2) {
        pushBox(ceilTrimAcc, sx0, sx1, H - CORNICE_H, H, faceSign === 1 ? z : z - CORNICE_D, faceSign === 1 ? z + CORNICE_D : z);
      }
      if (hotelTier >= 1 && (kind === "lobby" || kind === "corridor")) {
        pushBox(trimAcc, sx0, sx1, RAIL_Y, RAIL_Y + RAIL_H, faceSign === 1 ? z : z - WAINS_D, faceSign === 1 ? z + WAINS_D : z);
        pushBox(trimAcc, sx0, sx1, 0, RAIL_Y, faceSign === 1 ? z : z - WAINS_D * 0.6, faceSign === 1 ? z + WAINS_D * 0.6 : z);
      }
    }
  }
  function trimRunZ(x: number, zLo: number, zHi: number, kind: RoomKind, faceSign: 1 | -1): void {
    const segs = splitAroundDoors(zLo, zHi, "z", x);
    for (const [sz0, sz1] of segs) {
      if (sz1 - sz0 <= 0.01) continue;
      const xLo = faceSign === 1 ? x : x - SKIRT_D;
      const xHi = faceSign === 1 ? x + SKIRT_D : x;
      pushBox(trimAcc, xLo, xHi, 0, SKIRT_H, sz0, sz1);
      if (hotelTier === 2) {
        pushBox(ceilTrimAcc, faceSign === 1 ? x : x - CORNICE_D, faceSign === 1 ? x + CORNICE_D : x, H - CORNICE_H, H, sz0, sz1);
      }
      if (hotelTier >= 1 && (kind === "lobby" || kind === "corridor")) {
        pushBox(trimAcc, faceSign === 1 ? x : x - WAINS_D, faceSign === 1 ? x + WAINS_D : x, RAIL_Y, RAIL_Y + RAIL_H, sz0, sz1);
        pushBox(trimAcc, faceSign === 1 ? x : x - WAINS_D * 0.6, faceSign === 1 ? x + WAINS_D * 0.6 : x, 0, RAIL_Y, sz0, sz1);
      }
    }
  }
  function splitAroundDoors(lo: number, hi: number, axis: "x" | "z", fixed: number): [number, number][] {
    // Cut out any door span whose fixed coordinate matches this wall run.
    const cuts: [number, number][] = [];
    for (const d of doors) {
      const onThisWall = axis === "x" ? Math.abs(d.centerZM - fixed) < 0.3 && d.axis === "row" : Math.abs(d.centerXM - fixed) < 0.3 && d.axis === "col";
      if (!onThisWall) continue;
      const a0 = axis === "x" ? d.xM0 : d.zM0;
      const a1 = axis === "x" ? d.xM1 : d.zM1;
      cuts.push([a0 - DOOR_TRIM_MARGIN, a1 + DOOR_TRIM_MARGIN]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    let cur = lo;
    const out: [number, number][] = [];
    for (const [c0, c1] of cuts) {
      if (c0 > cur) out.push([cur, Math.min(c0, hi)]);
      cur = Math.max(cur, c1);
      if (cur >= hi) break;
    }
    if (cur < hi) out.push([cur, hi]);
    return out;
  }

  // Merge x-edges into runs (consecutive walkCz same, contiguous z) per wall side.
  {
    // group by (walkCx as boundary x, side) then by contiguous z-run
    const byKeyX = new Map<string, { bx: number; z0: number; z1: number; kind: RoomKind; faceSign: 1 | -1 }[]>();
    for (const e of wallXEdges) {
      const kind = roomKind(roomAt(floor, e.walkCx, e.walkCz));
      const faceSign: 1 | -1 = 1; // trim is emitted as a run along Z at fixed bx; handled via trimRunZ below
      const key = `${e.bx}:${e.solidOnPlus ? "+" : "-"}`;
      const arr = byKeyX.get(key) ?? [];
      arr.push({ bx: e.bx, z0: e.z0, z1: e.z1, kind, faceSign });
      byKeyX.set(key, arr);
    }
    for (const [key, arr] of byKeyX) {
      arr.sort((a, b) => a.z0 - b.z0);
      const solidOnPlus = key.endsWith("+");
      let runStart = 0;
      for (let i = 0; i < arr.length; i++) {
        const isLast = i === arr.length - 1;
        const next = arr[i + 1];
        const contiguous = next && Math.abs(next.z0 - arr[i]!.z1) < 1e-6;
        if (!contiguous || isLast) {
          const s = arr[runStart]!;
          const e = arr[i]!;
          // wall face is at x=bx; walkable side determines which way trim protrudes.
          // NOTE: the x-edge scan stores `solidOnPlus: !wa`, i.e. it is really
          // "WALKABLE on plus" -- so + here means the room is on +x and the
          // trim protrudes toward +x. (The z-edge loop below computes a true
          // solid-on-plus and uses the opposite sign.)
          const faceOffset: 1 | -1 = solidOnPlus ? 1 : -1;
          trimRunZ(s.bx, s.z0, e.z1, s.kind, faceOffset);
          runStart = i + 1;
        }
      }
    }
  }
  {
    const byKeyZ = new Map<string, { bz: number; x0: number; x1: number; kind: RoomKind; solidOnPlus: boolean }[]>();
    for (const e of wallZEdges) {
      const kind = roomKind(roomAt(floor, e.walkCx, e.walkCz));
      const solidOnPlus = !isWalkable(cellAt(floor, e.walkCx, Math.round(e.bz / CELL_M)));
      const key = `${e.bz}:${solidOnPlus ? "+" : "-"}`;
      const arr = byKeyZ.get(key) ?? [];
      arr.push({ bz: e.bz, x0: e.x0, x1: e.x1, kind, solidOnPlus });
      byKeyZ.set(key, arr);
    }
    for (const [, arr] of byKeyZ) {
      arr.sort((a, b) => a.x0 - b.x0);
      let runStart = 0;
      for (let i = 0; i < arr.length; i++) {
        const isLast = i === arr.length - 1;
        const next = arr[i + 1];
        const contiguous = next && Math.abs(next.x0 - arr[i]!.x1) < 1e-6;
        if (!contiguous || isLast) {
          const s = arr[runStart]!;
          const e = arr[i]!;
          // Trim protrudes toward the WALKABLE side: a true solid-on-plus means
          // the room is on -z. (Inverted at first, every lobby panel sat inside
          // the wall and its coplanar front face z-fought as a sawtooth.)
          const faceOffset: 1 | -1 = s.solidOnPlus ? -1 : 1;
          trimRunX(s.bz, s.x0, e.x1, s.kind, faceOffset);
          runStart = i + 1;
        }
      }
    }
  }

  // --- 5. Door architrave frames + threshold. ---
  for (const d of doors) {
    const jambW = 0.09;
    const jambD = 0.02;
    const isRow = d.axis === "row";
    // Threshold strip on the floor.
    pushBox(trimAcc, d.xM0, d.xM1, 0, 0.01, d.zM0, d.zM1);
    if (isRow) {
      // jambs at xM0 and xM1, on both wall faces (protrude ±jambD around z-center)
      const zc = d.centerZM;
      pushBox(trimAcc, d.xM0 - jambW, d.xM0, 0, DOOR_HEAD_M, zc - jambD, zc + jambD);
      pushBox(trimAcc, d.xM1, d.xM1 + jambW, 0, DOOR_HEAD_M, zc - jambD, zc + jambD);
      pushBox(trimAcc, d.xM0 - jambW, d.xM1 + jambW, DOOR_HEAD_M, DOOR_HEAD_M + jambW, zc - jambD, zc + jambD);
    } else {
      const xc = d.centerXM;
      pushBox(trimAcc, xc - jambD, xc + jambD, 0, DOOR_HEAD_M, d.zM0 - jambW, d.zM0);
      pushBox(trimAcc, xc - jambD, xc + jambD, 0, DOOR_HEAD_M, d.zM1, d.zM1 + jambW);
      pushBox(trimAcc, xc - jambD, xc + jambD, DOOR_HEAD_M, DOOR_HEAD_M + jambW, d.zM0 - jambW, d.zM1 + jambW);
    }
  }

  // --- 6. Pilasters on lobby's long walls every ~3m (tier 2 only -- the
  //        vision drops pilasters at tier 0, and tier 1 interpolates by
  //        not yet having them either). ---
  if (hotelTier === 2) {
    const lobby = rects.get(ROOM.LOBBY);
    if (lobby) {
      const pilW = 0.35;
      const pilD = 0.12;
      const pitch = 3;
      const wallLobbyAcc = accFor("wall-lobby");
      // South wall of lobby is internal (toward corridor gap); use east/west walls (long walls run along Z).
      for (const xWall of [lobby.xM0, lobby.xM1]) {
        const inward = xWall === lobby.xM0 ? 1 : -1;
        // Skip any pilaster whose z would land on the desk run when the
        // desk is flush against THIS wall (COO review P4: a pilaster was
        // bisecting the front desk because pilaster generation never
        // consulted decor's desk rect). 0.5m margin on both ends of the
        // desk's z-span, same margin PLAN-ALPHA gives other desk clearance.
        const deskOnThisWall = desk && (Math.abs(desk.xM0 - xWall) < 0.3 || Math.abs(desk.xM1 - xWall) < 0.3);
        for (let z = lobby.zM0 + pitch / 2; z < lobby.zM1; z += pitch) {
          if (nearDoorSpanM(xWall, z, 0.6)) continue;
          if (deskOnThisWall && desk && z > desk.zM0 - 0.5 && z < desk.zM1 + 0.5) continue;
          const cx = xWall + (inward * pilD) / 2;
          pushBox(wallLobbyAcc, Math.min(xWall, cx) - pilW / 2 + pilW / 2 * 0, xWall + inward * pilD, 0, H - CORNICE_H, z - pilW / 2, z + pilW / 2);
          pushBox(trimAcc, Math.min(xWall, xWall + inward * pilD), Math.max(xWall, xWall + inward * pilD), 0, SKIRT_H + 0.05, z - pilW / 2, z + pilW / 2);
        }
      }
    }
  }

  // --- 7. Reception counter on desk cells. ---
  if (desk) {
    const deskWoodAcc = accFor("wood-trim");
    const deskTopAcc = accFor("desk-top");
    // Guest (north, -Z) side panelled front, floor to 1.1m.
    pushBox(deskWoodAcc, desk.xM0, desk.xM1, 0, 1.1, desk.zM0, desk.zM0 + 0.05);
    // Top slab overhanging 0.05m all round, 0.06m thick, at 1.1m.
    pushBox(deskTopAcc, desk.xM0 - 0.05, desk.xM1 + 0.05, 1.1, 1.16, desk.zM0 - 0.05, desk.zM1 + 0.05);
    // Lower inner work surface, clerk side, at 0.75m.
    pushBox(deskWoodAcc, desk.xM0, desk.xM1, 0.72, 0.75, desk.zM1 - 0.5, desk.zM1);
    // Clerk-side workstation table, centred at floor.desk.xMm/zMm, top at 1.0m.
    const wsX = floor.desk.xMm / 1000;
    const wsZ = floor.desk.zMm / 1000;
    pushBox(deskWoodAcc, wsX - 0.6, wsX + 0.6, 0, 1.0, wsZ - 0.3, wsZ + 0.3);
  }

  // --- 8. Fake windows on exterior walls. ---
  {
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0a1e2e,
      roughness: 0.08,
      metalness: 0.1,
      emissive: new THREE.Color(0xffdca0),
      emissiveIntensity: 0.15,
    });
    const glassGeoms: THREE.BufferGeometry[] = [];
    const winW = 1.2;
    const winH = 1.5;
    const sillY = 0.9;
    const frameAcc = accFor("wood-trim");

    function tryWindowX(bx: number, z0: number, z1: number, solidOnPlus: boolean, kind: RoomKind): void {
      if (kind !== "bedroom" && kind !== "lobby") return;
      const midZ = (z0 + z1) / 2;
      if (nearDoorSpanM(bx, midZ, 0.3)) return;
      if (z1 - z0 < winW + 0.4) return;
      // Skip a window whose glass/frame would land near the front desk
      // when the desk is flush against THIS wall (COO review W3-2: a fake
      // window's frame -- not a pilaster -- was the "full-height pale
      // column" bisecting the tier-0 desk from the desk pose, since window
      // generation never consulted the desk rect at all, at any tier). A
      // 0.5m margin was not enough: the offending window's glass edge sat
      // only ~0.65m from the desk, well inside the desk pose's near field
      // of view even though its FOOTPRINT technically cleared the rect --
      // 1.0m keeps a window from reading as "next to the desk" from where
      // a guest actually stands to look at it, not just off the rect.
      const deskWindowMarginM = 1.0;
      if (
        desk &&
        Math.abs(desk.xM0 - bx) < 0.3 &&
        midZ > desk.zM0 - deskWindowMarginM - winW / 2 &&
        midZ < desk.zM1 + deskWindowMarginM + winW / 2
      )
        return;
      // one per ~3m: skip if too close to previous window on this wall coordinate
      const g = new THREE.PlaneGeometry(winW, winH);
      g.rotateY(Math.PI / 2);
      g.translate(bx + (solidOnPlus ? 0.01 : -0.01), sillY + winH / 2, midZ);
      glassGeoms.push(g);
      const inward = solidOnPlus ? -1 : 1;
      pushBox(frameAcc, bx - 0.03, bx + 0.03, sillY, sillY + winH, midZ - winW / 2 - 0.06, midZ - winW / 2);
      pushBox(frameAcc, bx - 0.03, bx + 0.03, sillY, sillY + winH, midZ + winW / 2, midZ + winW / 2 + 0.06);
      pushBox(frameAcc, bx - 0.03, bx + 0.03, sillY - 0.06, sillY, midZ - winW / 2 - 0.06, midZ + winW / 2 + 0.06);
      pushBox(frameAcc, bx - 0.03, bx + 0.03, sillY + winH, sillY + winH + 0.06, midZ - winW / 2 - 0.06, midZ + winW / 2 + 0.06);
      pushBox(frameAcc, bx + inward * 0.12, bx + inward * 0.14, sillY - 0.1, sillY, midZ - winW / 2 - 0.1, midZ + winW / 2 + 0.1);
    }
    function tryWindowZ(bz: number, x0: number, x1: number, solidOnPlus: boolean, kind: RoomKind): void {
      if (kind !== "bedroom" && kind !== "lobby") return;
      const midX = (x0 + x1) / 2;
      if (nearDoorSpanM(midX, bz, 0.3)) return;
      if (x1 - x0 < winW + 0.4) return;
      // Same desk exclusion as tryWindowX (1.0m margin, see there), for a
      // north/south-wall desk.
      const deskWindowMarginZ = 1.0;
      if (
        desk &&
        Math.abs(desk.zM0 - bz) < 0.3 &&
        midX > desk.xM0 - deskWindowMarginZ - winW / 2 &&
        midX < desk.xM1 + deskWindowMarginZ + winW / 2
      )
        return;
      const g = new THREE.PlaneGeometry(winW, winH);
      g.translate(midX, sillY + winH / 2, bz + (solidOnPlus ? 0.01 : -0.01));
      glassGeoms.push(g);
      pushBox(frameAcc, midX - winW / 2 - 0.06, midX - winW / 2, sillY, sillY + winH, bz - 0.03, bz + 0.03);
      pushBox(frameAcc, midX + winW / 2, midX + winW / 2 + 0.06, sillY, sillY + winH, bz - 0.03, bz + 0.03);
      pushBox(frameAcc, midX - winW / 2 - 0.06, midX + winW / 2 + 0.06, sillY - 0.06, sillY, bz - 0.03, bz + 0.03);
      pushBox(frameAcc, midX - winW / 2 - 0.06, midX + winW / 2 + 0.06, sillY + winH, sillY + winH + 0.06, bz - 0.03, bz + 0.03);
    }

    // Merge x-edges/z-edges into runs again for window placement (reuse trim runs' logic loosely: sample every ~3m along each exterior run).
    const byKeyX = new Map<string, { bx: number; z0: number; z1: number; kind: RoomKind; solidOnPlus: boolean; exterior: boolean }[]>();
    for (const e of wallXEdges) {
      if (!e.exterior) continue;
      const kind = roomKind(roomAt(floor, e.walkCx, e.walkCz));
      const key = `${e.bx}:${e.solidOnPlus ? "+" : "-"}`;
      const arr = byKeyX.get(key) ?? [];
      arr.push({ bx: e.bx, z0: e.z0, z1: e.z1, kind, solidOnPlus: e.solidOnPlus, exterior: e.exterior });
      byKeyX.set(key, arr);
    }
    for (const [, arr] of byKeyX) {
      arr.sort((a, b) => a.z0 - b.z0);
      let runStart = 0;
      for (let i = 0; i < arr.length; i++) {
        const isLast = i === arr.length - 1;
        const next = arr[i + 1];
        const contiguous = next && Math.abs(next.z0 - arr[i]!.z1) < 1e-6;
        if (!contiguous || isLast) {
          const s = arr[runStart]!;
          const e = arr[i]!;
          const runLen = e.z1 - s.z0;
          const count = Math.max(1, Math.floor(runLen / 3));
          for (let k = 0; k < count; k++) {
            const centerZ = s.z0 + ((k + 0.5) * runLen) / count;
            tryWindowX(s.bx, centerZ - winW / 2 - 0.2, centerZ + winW / 2 + 0.2, s.solidOnPlus, s.kind);
          }
          runStart = i + 1;
        }
      }
    }
    const byKeyZ = new Map<string, { bz: number; x0: number; x1: number; kind: RoomKind; solidOnPlus: boolean; exterior: boolean }[]>();
    for (const e of wallZEdges) {
      if (!e.exterior) continue;
      const kind = roomKind(roomAt(floor, e.walkCx, e.walkCz));
      const solidOnPlus = !isWalkable(cellAt(floor, e.walkCx, Math.round(e.bz / CELL_M)));
      const key = `${e.bz}:${solidOnPlus ? "+" : "-"}`;
      const arr = byKeyZ.get(key) ?? [];
      arr.push({ bz: e.bz, x0: e.x0, x1: e.x1, kind, solidOnPlus, exterior: e.exterior });
      byKeyZ.set(key, arr);
    }
    for (const [, arr] of byKeyZ) {
      arr.sort((a, b) => a.x0 - b.x0);
      let runStart = 0;
      for (let i = 0; i < arr.length; i++) {
        const isLast = i === arr.length - 1;
        const next = arr[i + 1];
        const contiguous = next && Math.abs(next.x0 - arr[i]!.x1) < 1e-6;
        if (!contiguous || isLast) {
          const s = arr[runStart]!;
          const e = arr[i]!;
          const runLen = e.x1 - s.x0;
          const count = Math.max(1, Math.floor(runLen / 3));
          for (let k = 0; k < count; k++) {
            const centerX = s.x0 + ((k + 0.5) * runLen) / count;
            tryWindowZ(s.bz, centerX - winW / 2 - 0.2, centerX + winW / 2 + 0.2, s.solidOnPlus, s.kind);
          }
          runStart = i + 1;
        }
      }
    }

    if (glassGeoms.length > 0) {
      const merged = BufferGeometryUtils.mergeGeometries(glassGeoms, false);
      if (merged) {
        const glassMesh = new THREE.Mesh(merged, glassMat);
        glassMesh.castShadow = false;
        glassMesh.receiveShadow = true;
        group.add(glassMesh);
      }
    }
  }

  // --- Build final meshes, one per material accumulator. ---
  const floorLikeNames = new Set(["lobby-floor", "lobby-floor-border", "corridor-carpet", "room-carpet", "street", "ceiling"]);
  for (const [name, acc] of accums) {
    const geo = accumToGeometry(acc);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, matFor(name));
    mesh.name = `arch-${name}`;
    const isFloorLike = floorLikeNames.has(name);
    mesh.castShadow = !isFloorLike;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
