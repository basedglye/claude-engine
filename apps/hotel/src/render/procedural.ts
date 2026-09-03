/**
 * W2 — procedural texture sources for the motel (tier 0) and hotel (tier 1)
 * looks. Everything here is canvas-generated, deterministic (a small
 * integer hash from a fixed seed, never Math.random — CLAUDE.md invariant
 * 2), and cached by its exact arguments. Host-side only: nothing here is
 * hashed into sim state or read by sim-side code (CLAUDE.md invariant 2,
 * "Asset-synthesis output... must never be hashed into sim state").
 */
import * as THREE from "three";

/** Renovation tier: 0 Motel, 1 Hotel, 2 Grand Foyer. Shared by every W2
 *  render module so there is exactly one definition. */
export type HotelTier = 0 | 1 | 2;

/** Deterministic pseudo-random unit float from an integer seed (xorshift
 *  mix, no trig, no Math.random). Matches lighting.ts's hash01. */
function hash01(n: number): number {
  let x = n | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x = x | 0;
  return ((x >>> 0) % 10000) / 10000;
}
function hash2(a: number, b: number): number {
  return hash01((a | 0) * 374761393 + (b | 0) * 668265263 + 0x9e3779b9);
}

function ctx2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = canvas.getContext("2d");
  if (!c) throw new Error("procedural.ts: 2d context unavailable");
  return c;
}
function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function colorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// -- caches, keyed by exact arguments -----------------------------------
const carpetCache = new Map<number, THREE.Texture>();
let cleanCarpetCache: THREE.Texture | undefined;
const paintCache = new Map<number, THREE.Texture>();
let ceilingCache: THREE.Texture | undefined;
let laminateCache: THREE.Texture | undefined;
let chainLinkCache: THREE.Texture | undefined;
const asphaltCache = new Map<number, THREE.Texture>();
const neonCache = new Map<string, THREE.Texture>();

/** Stained beige carpet: a base fleck field plus a handful of darker
 *  irregular "stain" blobs, seeded so the same seedInt always produces
 *  the same texture. */
export function stainedCarpetTexture(seedInt: number): THREE.Texture {
  const cached = carpetCache.get(seedInt);
  if (cached) return cached;
  const size = 256;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#a89473";
  ctx.fillRect(0, 0, size, size);
  // Fleck field.
  const fleckCount = 2200;
  for (let i = 0; i < fleckCount; i++) {
    const rx = hash2(seedInt, i * 2);
    const ry = hash2(seedInt, i * 2 + 1);
    const x = rx * size;
    const y = ry * size;
    const shade = hash2(seedInt + 1, i);
    const v = 0.75 + shade * 0.4;
    const c = Math.floor(168 * v);
    ctx.fillStyle = `rgb(${c},${Math.floor(c * 0.86)},${Math.floor(c * 0.63)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  // Stain blobs — dark irregular patches, the "run-down" tell.
  const stainCount = 6;
  for (let s = 0; s < stainCount; s++) {
    const cx = hash2(seedInt + 2, s * 3) * size;
    const cy = hash2(seedInt + 2, s * 3 + 1) * size;
    const r = 10 + hash2(seedInt + 2, s * 3 + 2) * 22;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, "rgba(58,45,28,0.55)");
    grad.addColorStop(1, "rgba(58,45,28,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.6 + hash2(seedInt + 3, s) * 0.5), hash2(seedInt + 4, s) * 6.28, 0, 6.28);
    ctx.fill();
  }
  const tex = colorTexture(canvas);
  carpetCache.set(seedInt, tex);
  return tex;
}

/** Clean carpet: the tier-1 ("clean carpet", per the vision) counterpart
 *  to `stainedCarpetTexture` -- same fleck-field base, deliberately no
 *  stain pass. Not seeded (there is nothing seed-dependent to vary once
 *  the stains are gone), so it is a single cached texture. */
export function cleanCarpetTexture(): THREE.Texture {
  if (cleanCarpetCache) return cleanCarpetCache;
  const size = 256;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#8a7350";
  ctx.fillRect(0, 0, size, size);
  const fleckCount = 2200;
  for (let i = 0; i < fleckCount; i++) {
    const rx = hash2(9, i * 2);
    const ry = hash2(9, i * 2 + 1);
    const x = rx * size;
    const y = ry * size;
    const shade = hash2(10, i);
    const v = 0.85 + shade * 0.3;
    const c = Math.floor(138 * v);
    ctx.fillStyle = `rgb(${c},${Math.floor(c * 0.85)},${Math.floor(c * 0.58)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = colorTexture(canvas);
  cleanCarpetCache = tex;
  return tex;
}

/** Flat scuffed paint: a uniform base with subtle patchy value noise and
 *  a scattering of small scuff marks near the "floor" edge of the tile. */
export function scuffedPaintTexture(seedInt: number): THREE.Texture {
  const cached = paintCache.get(seedInt);
  if (cached) return cached;
  const size = 256;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#c9c2b0";
  ctx.fillRect(0, 0, size, size);
  // Patchy roller variation.
  for (let i = 0; i < 60; i++) {
    const x = hash2(seedInt, i * 2) * size;
    const y = hash2(seedInt, i * 2 + 1) * size;
    const w = 20 + hash2(seedInt + 1, i) * 60;
    const h = 20 + hash2(seedInt + 1, i + 50) * 60;
    const shade = 0.9 + hash2(seedInt + 2, i) * 0.16;
    const c = Math.floor(201 * shade);
    ctx.fillStyle = `rgba(${c},${Math.floor(c * 0.97)},${Math.floor(c * 0.87)},0.5)`;
    ctx.fillRect(x, y, w, h);
  }
  // Scuffs: short dark diagonal smears clustered low in the tile.
  for (let i = 0; i < 18; i++) {
    const x = hash2(seedInt + 3, i * 2) * size;
    const y = size * (0.6 + hash2(seedInt + 3, i * 2 + 1) * 0.4);
    const len = 6 + hash2(seedInt + 4, i) * 14;
    const ang = hash2(seedInt + 5, i) * 6.28;
    ctx.strokeStyle = "rgba(70,64,52,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  const tex = colorTexture(canvas);
  paintCache.set(seedInt, tex);
  return tex;
}

/** 2x2 drop-ceiling tile grid: off-white tiles with visible grid lines. */
export function ceilingTileTexture(): THREE.Texture {
  if (ceilingCache) return ceilingCache;
  const size = 256;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#e9e6dc";
  ctx.fillRect(0, 0, size, size);
  const half = size / 2;
  ctx.strokeStyle = "#a9a596";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(half, size);
  ctx.moveTo(0, half);
  ctx.lineTo(size, half);
  ctx.stroke();
  // Faint mottled fissured-tile texture per quadrant.
  for (let i = 0; i < 400; i++) {
    const x = hash2(11, i * 2) * size;
    const y = hash2(11, i * 2 + 1) * size;
    ctx.fillStyle = `rgba(160,156,140,${0.03 + hash2(12, i) * 0.05})`;
    ctx.fillRect(x, y, 2, 2);
  }
  const tex = colorTexture(canvas);
  ceilingCache = tex;
  return tex;
}

/** Chipped laminate counter-top: speckled beige laminate with one darker
 *  chipped corner. */
export function laminateTexture(): THREE.Texture {
  if (laminateCache) return laminateCache;
  const size = 256;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#d7c9a8";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = hash2(21, i * 2) * size;
    const y = hash2(21, i * 2 + 1) * size;
    const shade = hash2(22, i);
    ctx.fillStyle = `rgba(${120 + shade * 60},${105 + shade * 55},${70 + shade * 40},0.5)`;
    ctx.fillRect(x, y, 1, 1);
  }
  // Chipped edge corner.
  ctx.fillStyle = "#5a4a34";
  ctx.beginPath();
  ctx.moveTo(size - 34, size);
  ctx.lineTo(size, size);
  ctx.lineTo(size, size - 26);
  ctx.lineTo(size - 20, size - 8);
  ctx.closePath();
  ctx.fill();
  const tex = colorTexture(canvas);
  laminateCache = tex;
  return tex;
}

/** Chain-link fence: a transparent PNG-style alpha texture with a diagonal
 *  diamond weave. */
export function chainLinkTexture(): THREE.Texture {
  if (chainLinkCache) return chainLinkCache;
  const size = 128;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(150,150,150,0.9)";
  ctx.lineWidth = 2;
  const step = 16;
  for (let x = -size; x < size * 2; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + size, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  chainLinkCache = tex;
  return tex;
}

/** Cracked asphalt: dark base with lighter aggregate speckle and a handful
 *  of thin crack lines, seeded. */
export function asphaltTexture(seedInt: number): THREE.Texture {
  const cached = asphaltCache.get(seedInt);
  if (cached) return cached;
  const size = 256;
  const canvas = mkCanvas(size, size);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#2b2a28";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1600; i++) {
    const x = hash2(seedInt, i * 2) * size;
    const y = hash2(seedInt, i * 2 + 1) * size;
    const v = 40 + hash2(seedInt + 1, i) * 40;
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.strokeStyle = "rgba(10,10,10,0.6)";
  ctx.lineWidth = 1;
  for (let c = 0; c < 5; c++) {
    let x = hash2(seedInt + 2, c) * size;
    let y = hash2(seedInt + 2, c + 10) * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 6 + Math.floor(hash2(seedInt + 3, c) * 5);
    for (let s = 0; s < segs; s++) {
      x += (hash2(seedInt + 4, c * 10 + s) - 0.5) * 40;
      y += (hash2(seedInt + 5, c * 10 + s) - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = colorTexture(canvas);
  asphaltCache.set(seedInt, tex);
  return tex;
}

/** Emissive neon-sign texture for the given text: dark ground, glowing
 *  tube-style lettering. Not repeat-tiled (used once per sign plane). */
export function neonSignTexture(text: string): THREE.Texture {
  const cached = neonCache.get(text);
  if (cached) return cached;
  const w = 512;
  const h = 256;
  const canvas = mkCanvas(w, h);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 96px 'Arial Black', Arial, sans-serif";
  // Glow: several blurred passes of the same text.
  ctx.shadowColor = "#ff3b6b";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ff6f9b";
  for (let i = 0; i < 3; i++) ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffe0e8";
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  neonCache.set(text, tex);
  return tex;
}
