import type { Rng } from "@claude-engine/core";
import { hslToRgb } from "./color.js";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors?: Float32Array;
  triCount: number;
}

export interface CreatureOptions {
  /** Approximate body radius, world units. Default 0.5. */
  radius?: number;
  /** Relative per-vertex radial perturbation, 0..1. Default 0.25. */
  jitter?: number;
}

export interface PropOptions {
  /** Overall scale, world units. Default 1. */
  scale?: number;
  /** Relative perturbation applied to sub-part placement, 0..1. Default 0.2. */
  jitter?: number;
}

type Vec3 = [number, number, number];

interface RawMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

function emptyMesh(): RawMesh {
  return { positions: [], normals: [], indices: [] };
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Appends a flat-shaded triangle (vertices duplicated, one normal per face). */
function appendTri(mesh: RawMesh, a: Vec3, b: Vec3, c: Vec3): void {
  const base = mesh.positions.length / 3;
  const n = faceNormal(a, b, c);
  for (const p of [a, b, c]) {
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.normals.push(n[0], n[1], n[2]);
  }
  mesh.indices.push(base, base + 1, base + 2);
}

function appendMesh(target: RawMesh, src: RawMesh): void {
  const base = target.positions.length / 3;
  for (const p of src.positions) target.positions.push(p);
  for (const n of src.normals) target.normals.push(n);
  for (const idx of src.indices) target.indices.push(idx + base);
}

function appendMeshWithColor(
  target: RawMesh,
  colors: number[],
  src: RawMesh,
  color: Vec3
): void {
  appendMesh(target, src);
  const vertCount = src.positions.length / 3;
  for (let i = 0; i < vertCount; i++) colors.push(color[0], color[1], color[2]);
}

function rotateY(mesh: RawMesh, angle: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] ?? 0;
    const z = mesh.positions[i + 2] ?? 0;
    mesh.positions[i] = x * cos + z * sin;
    mesh.positions[i + 2] = -x * sin + z * cos;
    const nx = mesh.normals[i] ?? 0;
    const nz = mesh.normals[i + 2] ?? 0;
    mesh.normals[i] = nx * cos + nz * sin;
    mesh.normals[i + 2] = -nx * sin + nz * cos;
  }
}

function translate(mesh: RawMesh, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] = (mesh.positions[i] ?? 0) + dx;
    mesh.positions[i + 1] = (mesh.positions[i + 1] ?? 0) + dy;
    mesh.positions[i + 2] = (mesh.positions[i + 2] ?? 0) + dz;
  }
}

function scaleMesh(mesh: RawMesh, sx: number, sy: number, sz: number): void {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] = (mesh.positions[i] ?? 0) * sx;
    mesh.positions[i + 1] = (mesh.positions[i + 1] ?? 0) * sy;
    mesh.positions[i + 2] = (mesh.positions[i + 2] ?? 0) * sz;
  }
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const nx = (mesh.normals[i] ?? 0) / sx;
    const ny = (mesh.normals[i + 1] ?? 0) / sy;
    const nz = (mesh.normals[i + 2] ?? 0) / sz;
    const len = Math.hypot(nx, ny, nz) || 1;
    mesh.normals[i] = nx / len;
    mesh.normals[i + 1] = ny / len;
    mesh.normals[i + 2] = nz / len;
  }
}

// ---- Low-poly primitives -------------------------------------------------

function box(w: number, h: number, d: number): RawMesh {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const p = (sx: number, sy: number, sz: number): Vec3 => [sx * x, sy * y, sz * z];
  const faces: [Vec3, Vec3, Vec3, Vec3][] = [
    [p(1, -1, -1), p(1, -1, 1), p(1, 1, 1), p(1, 1, -1)], // +X
    [p(-1, -1, 1), p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1)], // -X
    [p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1)], // +Y
    [p(-1, -1, 1), p(1, -1, 1), p(1, -1, -1), p(-1, -1, -1)], // -Y
    [p(-1, -1, 1), p(-1, 1, 1), p(1, 1, 1), p(1, -1, 1)], // +Z
    [p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, -1)], // -Z
  ];
  const mesh = emptyMesh();
  for (const [a, b, c, d2] of faces) {
    appendTri(mesh, a, b, c);
    appendTri(mesh, a, c, d2);
  }
  return mesh;
}

function cone(radius: number, height: number, segments: number): RawMesh {
  const mesh = emptyMesh();
  const apex: Vec3 = [0, height, 0];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: Vec3 = [Math.cos(a0) * radius, 0, Math.sin(a0) * radius];
    const p1: Vec3 = [Math.cos(a1) * radius, 0, Math.sin(a1) * radius];
    appendTri(mesh, apex, p0, p1);
  }
  return mesh;
}

function cylinder(radius: number, height: number, segments: number): RawMesh {
  const mesh = emptyMesh();
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    const b0: Vec3 = [x0, 0, z0];
    const b1: Vec3 = [x1, 0, z1];
    const t0: Vec3 = [x0, height, z0];
    const t1: Vec3 = [x1, height, z1];
    appendTri(mesh, b0, b1, t1);
    appendTri(mesh, b0, t1, t0);
  }
  return mesh;
}

const ICOSAHEDRON_VERTS: Vec3[] = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  return [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
})();

const ICOSAHEDRON_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const OCTAHEDRON_VERTS: Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const OCTAHEDRON_FACES: [number, number, number][] = [
  [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
  [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
];

/** Radially-jittered polyhedron: same base shape, per-vertex random radius. */
function jitteredPolyhedron(
  baseVerts: readonly Vec3[],
  faces: readonly [number, number, number][],
  radius: number,
  rng: Rng,
  jitter: number
): RawMesh {
  const verts: Vec3[] = baseVerts.map((v) => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    const r = radius * (1 + (rng.next() * 2 - 1) * jitter);
    return [(v[0] / len) * r, (v[1] / len) * r, (v[2] / len) * r];
  });
  const mesh = emptyMesh();
  for (const [ia, ib, ic] of faces) {
    const a = verts[ia];
    const b = verts[ib];
    const c = verts[ic];
    if (!a || !b || !c) continue;
    appendTri(mesh, a, b, c);
  }
  return mesh;
}

function toMeshData(raw: RawMesh, color: Vec3): MeshData {
  const vertCount = raw.positions.length / 3;
  const colors = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
  }
  return {
    positions: new Float32Array(raw.positions),
    normals: new Float32Array(raw.normals),
    indices: new Uint32Array(raw.indices),
    colors,
    triCount: raw.indices.length / 3,
  };
}

function toMeshDataWithColors(raw: RawMesh, colors: number[]): MeshData {
  return {
    positions: new Float32Array(raw.positions),
    normals: new Float32Array(raw.normals),
    indices: new Uint32Array(raw.indices),
    colors: new Float32Array(colors),
    triCount: raw.indices.length / 3,
  };
}

// ---- Public generators -----------------------------------------------------

/** Low-poly, symmetric-perturbed icosahedron — v0 creature body. */
export function generateCreatureMesh(rng: Rng, opts: CreatureOptions = {}): MeshData {
  const radius = opts.radius ?? 0.5;
  const jitter = opts.jitter ?? 0.25;
  const bodyRng = rng.fork("creature-body");
  const raw = jitteredPolyhedron(ICOSAHEDRON_VERTS, ICOSAHEDRON_FACES, radius, bodyRng, jitter);
  const colorRng = rng.fork("creature-color");
  const color = hslToRgb(colorRng.next() * 360, 0.55, 0.55);
  return toMeshData(raw, color);
}

/** `kind`-specific low-poly prop. v0 — not art quality. */
export function generatePropMesh(
  rng: Rng,
  kind: "rock" | "tree" | "crystal",
  opts: PropOptions = {}
): MeshData {
  const scale = opts.scale ?? 1;
  const jitter = opts.jitter ?? 0.2;
  switch (kind) {
    case "rock":
      return generateRock(rng, scale, jitter);
    case "tree":
      return generateTree(rng, scale);
    case "crystal":
      return generateCrystal(rng, scale, jitter);
  }
}

/** Perturbed box cluster: 2-4 boxes of varied size/rotation/offset. */
function generateRock(rng: Rng, scale: number, jitter: number): MeshData {
  const clusterRng = rng.fork("rock-cluster");
  const count = clusterRng.int(2, 4);
  const merged = emptyMesh();
  const colorRng = rng.fork("rock-color");
  const color = hslToRgb(0, 0, 0.35 + colorRng.next() * 0.2);
  for (let i = 0; i < count; i++) {
    const boxRng = clusterRng.fork(`box-${i}`);
    const w = scale * (0.5 + boxRng.next() * 0.5);
    const h = scale * (0.4 + boxRng.next() * 0.5);
    const d = scale * (0.5 + boxRng.next() * 0.5);
    const raw = box(w, h, d);
    rotateY(raw, boxRng.next() * Math.PI * 2);
    const offX = (boxRng.next() * 2 - 1) * scale * 0.3 * (1 + jitter);
    const offZ = (boxRng.next() * 2 - 1) * scale * 0.3 * (1 + jitter);
    const offY = i === 0 ? h / 2 : boxRng.next() * h * 0.4;
    translate(raw, offX, offY, offZ);
    appendMesh(merged, raw);
  }
  return toMeshData(merged, color);
}

/** Cone canopy on a cylinder trunk. */
function generateTree(rng: Rng, scale: number): MeshData {
  const trunkRng = rng.fork("tree-trunk");
  const trunkHeight = scale * (0.6 + trunkRng.next() * 0.3);
  const trunkRadius = scale * 0.08;
  const trunk = cylinder(trunkRadius, trunkHeight, 6);
  const trunkColor = hslToRgb(28 + trunkRng.next() * 10, 0.45, 0.28 + trunkRng.next() * 0.08);

  const canopyRng = rng.fork("tree-canopy");
  const canopyHeight = scale * (0.8 + canopyRng.next() * 0.4);
  const canopyRadius = scale * (0.35 + canopyRng.next() * 0.15);
  const canopy = cone(canopyRadius, canopyHeight, 7);
  translate(canopy, 0, trunkHeight * 0.85, 0);
  const canopyColor = hslToRgb(95 + canopyRng.next() * 40, 0.5, 0.3 + canopyRng.next() * 0.15);

  const merged = emptyMesh();
  const colors: number[] = [];
  appendMeshWithColor(merged, colors, trunk, trunkColor);
  appendMeshWithColor(merged, colors, canopy, canopyColor);
  return toMeshDataWithColors(merged, colors);
}

/** Perturbed, Y-elongated octahedron. */
function generateCrystal(rng: Rng, scale: number, jitter: number): MeshData {
  const bodyRng = rng.fork("crystal-body");
  const elongate = 1.5 + bodyRng.next() * 1.0;
  const raw = jitteredPolyhedron(OCTAHEDRON_VERTS, OCTAHEDRON_FACES, scale * 0.5, bodyRng, jitter);
  scaleMesh(raw, 1, elongate, 1);
  const colorRng = rng.fork("crystal-color");
  const color = hslToRgb(190 + colorRng.next() * 80, 0.6, 0.55);
  return toMeshData(raw, color);
}
