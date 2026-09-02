// Deterministic retro texture atlas: per-material procedural synthesis
// (integer/hash noise + a coarse pattern) -> quantize to <=32 colours ->
// 4x4 Bayer dither -> packed 1024x1024 RGBA. Pure function of the seed.
//
// PURITY NOTE (corrects docs/PHASE-H2.md section 5D's stray comment):
// packages/interiors/src IS a `banTranscendentals: true` purity root (see
// scripts/check-purity.mjs's PURITY_ROOTS list) -- unlike packages/assets,
// which is exempt because its output never re-enters this package's own
// source text. Math.sin/cos/atan2/pow/hypot/etc and Math.random are BANNED
// in this file. Every "random" draw below goes through the seeded `Rng`
// (integer state, no float trig), and every noise/pattern function is
// integer hashing + linear interpolation -- exactly reproducible byte for
// byte, which is strictly stronger than what float trig would give us.
import { Rng } from "@claude-engine/core";

/** Atlas edge length, pixels. Fixed -- not a tuning knob. */
export const ATLAS_SIZE_PX = 1024;
/** One material's tile, pixels per edge. 1024/128 = 8x8 = 64 tile slots,
 *  comfortably more than the 10 material ids below need. */
export const ATLAS_TILE_PX = 128;
/** Texel density every UV-emitting quad in mesh-gen.ts targets: 64 atlas
 *  pixels per world metre, i.e. one 128px tile repeats every 2m. */
export const TEXELS_PER_METRE = 64;

/** The material vocabulary mesh-gen.ts stamps into UVs (plus "door", which
 *  is reserved for the door-mesh.ts / renderer-three lanes outside this
 *  package's H2b scope) -- every id here MUST have a region below, checked
 *  by the interiors unit test. Fixed array (not a Set) so tile assignment
 *  is deterministic by index, not iteration-order-dependent. */
const MATERIAL_IDS = [
  "floor:lobby",
  "floor:corridor",
  "floor:room1",
  "floor:room2",
  "floor:room3",
  "floor:room4",
  "floor:default",
  "wall",
  "ceiling",
  "door",
] as const;

/** Base hue/saturation/lightness per material, loosely mirroring
 *  mesh-gen.ts's flat FLOOR_PALETTE/WALL_COLOR/CEILING_COLOR tints so the
 *  atlas reads as "the same rooms, now textured" rather than a different
 *  palette. h in [0,360), s/l in [0,1]. */
const MATERIAL_BASE_HSL: Record<(typeof MATERIAL_IDS)[number], readonly [number, number, number]> = {
  "floor:lobby": [35, 0.3, 0.55],
  "floor:corridor": [220, 0.06, 0.55],
  "floor:room1": [210, 0.28, 0.55],
  "floor:room2": [320, 0.22, 0.52],
  "floor:room3": [130, 0.24, 0.55],
  "floor:room4": [35, 0.32, 0.5],
  "floor:default": [0, 0, 0.5],
  wall: [40, 0.14, 0.72],
  ceiling: [0, 0, 0.85],
  door: [25, 0.4, 0.35],
};

/** Shades synthesized per material -- kept small (3) so
 *  MATERIAL_IDS.length * SHADES_PER_MATERIAL + 1 filler <= 32 (the
 *  palette-size gate), with headroom (10*3+1=31). */
const SHADES_PER_MATERIAL = 3;

/** Packed RGB (u0..255 each channel) for tiles the atlas allocates but no
 *  material claims (64 slots vs. 10 materials). One shared colour, so it
 *  contributes exactly one extra palette entry. */
const FILLER_RGB: readonly [number, number, number] = [24, 24, 28];

export interface AtlasRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface AtlasData {
  sizePx: 1024;
  /** RGBA, length sizePx*sizePx*4. */
  pixels: Uint8ClampedArray;
  /** Material id -> UV sub-rect in the atlas (0..1). */
  regions: Record<string, AtlasRegion>;
  /** The palette actually used, for the palette-size unit gate. Packed
   *  0xRRGGBB, length <= 32. */
  palette: readonly number[];
}

// ---- Trig-free HSL -> RGB (Math.abs only; banned-transcendental-safe). ----
// A local copy rather than importing @claude-engine/assets' hslToRgb: that
// helper happens to be trig-free too, but it is not part of assets' public
// export surface (only ./index and ./web are), and duplicating ~12 lines
// keeps this package from depending on assets' internals.
function hslToRgb255(h: number, s: number, l: number): [number, number, number] {
  const hp = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return [clampByte(r), clampByte(g), clampByte(b)];
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---- Integer hash + value noise (replaces float trig noise). --------------
// FNV-1a-flavoured 3-input integer hash -> uint32. No division, no
// transcendentals; Math.imul is exact 32-bit integer multiply.
function hash32(a: number, b: number, c: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ c, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** hash32 rescaled to [0,1). */
function hashUnit(seed: number, x: number, y: number): number {
  return hash32(seed, x, y) / 4294967296;
}

/** Bilinear-interpolated value noise over an integer lattice spaced
 *  `lattice` px apart -- linear interpolation only (no smoothstep/trig),
 *  which is exactly reproducible in integer/float-deterministic terms
 *  across platforms since it's pure multiply-add. */
function valueNoise(seed: number, px: number, py: number, lattice: number): number {
  const x0 = Math.floor(px / lattice);
  const y0 = Math.floor(py / lattice);
  const fx = px / lattice - x0;
  const fy = py / lattice - y0;
  const h00 = hashUnit(seed, x0, y0);
  const h10 = hashUnit(seed, x0 + 1, y0);
  const h01 = hashUnit(seed, x0, y0 + 1);
  const h11 = hashUnit(seed, x0 + 1, y0 + 1);
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fy;
}

// ---- 4x4 ordered (Bayer) dither. -------------------------------------------
// Standard Bayer4 matrix, row-major, values 0..15.
const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Quantizes a continuous value in [0,1) to one of `levels` discrete bins,
 *  adding a per-pixel Bayer-matrix threshold before rounding so that a
 *  smoothly (or flatly) varying input produces a periodic dithered pattern
 *  instead of hard quantization bands -- the classic ordered-dither trick,
 *  done with pure integer/linear math (no trig). Exported for the interiors
 *  unit test's dither-vs-flat-control comparison. */
export function ditherQuantize(value01: number, levels: number, xPx: number, yPx: number): number {
  const bayer = BAYER4[(yPx & 3) * 4 + (xPx & 3)] ?? 0;
  const threshold = (bayer + 0.5) / 16; // (0, 1)
  const scaled = value01 * levels + threshold - 0.5;
  let idx = Math.floor(scaled);
  if (idx < 0) idx = 0;
  if (idx > levels - 1) idx = levels - 1;
  return idx;
}

/** Pure function of `seed`: synthesizes the full retro texture atlas. */
export function synthesizeAtlas(seed: string): AtlasData {
  const rootRng = new Rng(seed);

  // Per-material seed ints (for the integer noise hash) and quantized shade
  // palette (SHADES_PER_MATERIAL RGB triples each), computed once up front.
  const materialSeed: Record<string, number> = {};
  const materialShades: Record<string, [number, number, number][]> = {};
  const paletteSet = new Set<number>();

  for (const id of MATERIAL_IDS) {
    const matRng = rootRng.fork(`atlas:${id}`);
    materialSeed[id] = matRng.nextUint32();
    const [baseH, baseS, baseL] = MATERIAL_BASE_HSL[id];
    // Small seed-driven jitter so different seeds actually look different,
    // not just noise-phase-shifted.
    const h = baseH + (matRng.next() * 2 - 1) * 10;
    const s = clamp01(baseS + (matRng.next() * 2 - 1) * 0.05);
    const shades: [number, number, number][] = [];
    for (let level = 0; level < SHADES_PER_MATERIAL; level++) {
      // Levels spread symmetrically around baseL, e.g. 3 levels -> [-0.08, 0, +0.08].
      const offset = (level - (SHADES_PER_MATERIAL - 1) / 2) * 0.08;
      const l = clamp01(baseL + offset);
      const rgb = hslToRgb255(h, s, l);
      shades.push(rgb);
      paletteSet.add(packRgb(rgb[0], rgb[1], rgb[2]));
    }
    materialShades[id] = shades;
  }
  paletteSet.add(packRgb(FILLER_RGB[0], FILLER_RGB[1], FILLER_RGB[2]));

  // Regions: fixed grid assignment by MATERIAL_IDS index, TILE_PX-aligned.
  const tilesPerEdge = ATLAS_SIZE_PX / ATLAS_TILE_PX;
  const regions: Record<string, AtlasRegion> = {};
  MATERIAL_IDS.forEach((id, i) => {
    const col = i % tilesPerEdge;
    const row = Math.floor(i / tilesPerEdge);
    const u0 = (col * ATLAS_TILE_PX) / ATLAS_SIZE_PX;
    const v0 = (row * ATLAS_TILE_PX) / ATLAS_SIZE_PX;
    regions[id] = { u0, v0, u1: u0 + ATLAS_TILE_PX / ATLAS_SIZE_PX, v1: v0 + ATLAS_TILE_PX / ATLAS_SIZE_PX };
  });

  const pixels = new Uint8ClampedArray(ATLAS_SIZE_PX * ATLAS_SIZE_PX * 4);
  for (let y = 0; y < ATLAS_SIZE_PX; y++) {
    const row = Math.floor(y / ATLAS_TILE_PX);
    const ly = y - row * ATLAS_TILE_PX;
    for (let x = 0; x < ATLAS_SIZE_PX; x++) {
      const col = Math.floor(x / ATLAS_TILE_PX);
      const tileIndex = row * tilesPerEdge + col;
      const lx = x - col * ATLAS_TILE_PX;
      const off = (y * ATLAS_SIZE_PX + x) * 4;

      const id = MATERIAL_IDS[tileIndex];
      let rgb: readonly [number, number, number];
      if (id === undefined) {
        rgb = FILLER_RGB;
      } else {
        const matSeed = materialSeed[id]!;
        // Value noise (smooth base texture) plus a coarse checker "pattern"
        // term (procedural synthesis = noise + pattern, per the spec).
        const noise = valueNoise(matSeed, lx, ly, 32);
        const patternOn = (Math.floor(lx / 16) + Math.floor(ly / 16)) % 2 === 0;
        const pattern = patternOn ? 0.06 : -0.06;
        const combined = clamp01(noise * 0.85 + 0.075 + pattern);
        const levelIdx = ditherQuantize(combined, SHADES_PER_MATERIAL, x, y);
        rgb = materialShades[id]![levelIdx]!;
      }
      pixels[off] = rgb[0];
      pixels[off + 1] = rgb[1];
      pixels[off + 2] = rgb[2];
      pixels[off + 3] = 255;
    }
  }

  return {
    sizePx: 1024,
    pixels,
    regions,
    palette: [...paletteSet],
  };
}

function packRgb(r: number, g: number, b: number): number {
  return ((r << 16) | (g << 8) | b) >>> 0;
}
