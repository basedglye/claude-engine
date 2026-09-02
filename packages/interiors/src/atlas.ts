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

/**
 * Base hue/saturation/lightness per material.
 *
 * THESE LIGHTNESSES ARE CHOSEN AGAINST THE LIGHTING BAKE, NOT IN ISOLATION.
 * The H2b review measured why the rooms did not read, and it was not "low
 * contrast" -- it was CANCELLATION. The old palette climbed in albedo
 * (floor 130 / wall 194 / ceiling 210 mean luminance) while mesh-gen.ts's
 * bake descends in light (floor x0.888 / wall x0.653 / ceiling x0.568,
 * because a ceiling faces away from SUN_DIR and a floor faces into it).
 * The two ladders are near-reciprocal, so the product landed at
 * 0.454 / 0.497 / 0.468 -- a 1.09x spread. Every surface in the hotel
 * rendered the same value, which is exactly the "there's no contrast"
 * report.
 *
 * The fix is to make albedo REINFORCE the bake instead of fighting it:
 * bright floors (they catch the light), mid walls, dark ceilings (they are
 * in shadow). That is also how an interior lit from above actually reads.
 * Target render = baseL x the measured per-class light multiplier:
 *   floor   ~0.66 x 0.888 = 0.59
 *   wall    ~0.55 x 0.653 = 0.36
 *   ceiling ~0.39 x 0.568 = 0.22   -> a ~2.6x spread, floor to ceiling.
 * If the bake's SUN_DIR or FACE_AMBIENT ever changes these must be
 * re-derived; the interiors unit test now pins the rendered spread so a
 * regression is caught rather than eyeballed.
 *
 * HUE CARRIES A SECOND, INDEPENDENT SIGNAL: temperature. Floors are warm
 * (h ~28-42), walls and ceilings are cool (h ~212-220). The old palette had
 * the lobby floor at h35 and the wall at h40 -- the same hue as well as the
 * same value, so a floor-meets-wall corner carried no cue at all.
 * Warm-vs-cool survives the bake's warm lamp tint, which a 5-degree hue gap
 * cannot. Per-room floors keep accent hues (blue/magenta/green) so bedrooms
 * are told apart at a glance.
 */
const MATERIAL_BASE_HSL: Record<(typeof MATERIAL_IDS)[number], readonly [number, number, number]> = {
  "floor:lobby": [35, 0.32, 0.68],
  "floor:corridor": [28, 0.16, 0.62],
  "floor:room1": [205, 0.3, 0.66],
  "floor:room2": [325, 0.26, 0.64],
  "floor:room3": [135, 0.28, 0.66],
  "floor:room4": [42, 0.34, 0.65],
  "floor:default": [30, 0.1, 0.64],
  wall: [212, 0.14, 0.55],
  ceiling: [220, 0.12, 0.39],
  door: [18, 0.5, 0.26],
};

/**
 * Real-world period of each material's seam grid, in atlas pixels. At
 * TEXELS_PER_METRE = 64, 32px = 0.5m tiles and 64px = 1m panels.
 *
 * WHY SEAMS ARE THE TEXTURE BUDGET. The old tile was value noise plus a
 * 16px checker at +/-0.06 lightness, dithered across three shades spanning
 * +/-0.08 -- all of it high-frequency, low-amplitude detail that falls
 * below one screen pixel at any normal viewing distance and is smeared
 * further by the PS1 material's affine warp. It measurably vanished.
 * Low-frequency, HIGH-contrast features survive minification where fine
 * noise cannot, so the contrast budget goes into a dark line at tile and
 * panel boundaries: floor tiles and wall panels read as architecture at
 * 3-4m, and a flat-on view of a large surface gains the internal structure
 * it previously had none of. `door` gets period 0 -- a door leaf is one
 * painted panel, and a grid on it would read as a window.
 */
const SEAM_PERIOD_PX: Record<(typeof MATERIAL_IDS)[number], number> = {
  "floor:lobby": 32,
  "floor:corridor": 32,
  "floor:room1": 32,
  "floor:room2": 32,
  "floor:room3": 32,
  "floor:room4": 32,
  "floor:default": 32,
  wall: 64,
  ceiling: 64,
  door: 0,
};

/** Seam line width, atlas px. Two px at 64px/m is ~3cm -- a grout line. */
const SEAM_WIDTH_PX = 2;

/** Shades synthesized per material. Still 3 (so
 *  MATERIAL_IDS.length * SHADES_PER_MATERIAL + 1 = 31 <= 32, the
 *  palette-size gate), but no longer a symmetric spread about baseL.
 *  Index 0 is the SEAM shade -- much darker, used only for tile and panel
 *  boundary lines -- and 1..2 are the two field shades the dither
 *  alternates between. Spending one of three shades on the seam is what
 *  buys a legible edge inside the same palette budget. */
const SHADES_PER_MATERIAL = 3;

/** Lightness offsets from baseL for [seam, field-dark, field-light]. The
 *  seam is a real step down (not a -0.08 nudge) so it survives both
 *  minification and the bake's brightest multiplier; the two field shades
 *  stay close so the dither reads as texture rather than as stripes. */
const SHADE_OFFSETS: readonly number[] = [-0.2, -0.045, 0.055];

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
      const offset = SHADE_OFFSETS[level] ?? 0;
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
        const period = SEAM_PERIOD_PX[id];
        // Seam first: a dark line on the tile/panel grid. Drawn on the
        // boundary of the material's OWN tile so it still lines up when
        // mesh-gen repeats the region (projectUv wraps mod ATLAS_TILE_PX).
        const onSeam =
          period > 0 && (lx % period < SEAM_WIDTH_PX || ly % period < SEAM_WIDTH_PX);
        if (onSeam) {
          rgb = materialShades[id]![0]!;
        } else {
          // Field: value noise dithered between the two FIELD shades (1..2).
          // A coarse checker at the seam period breaks up neighbouring tiles
          // so a large floor does not read as one repeated stamp.
          const noise = valueNoise(matSeed, lx, ly, 24);
          const half = period > 0 ? period : ATLAS_TILE_PX;
          const patternOn =
            (Math.floor(lx / half) + Math.floor(ly / half)) % 2 === 0;
          const combined = clamp01(noise * 0.9 + (patternOn ? 0.09 : -0.02));
          const levelIdx = ditherQuantize(combined, SHADES_PER_MATERIAL - 1, x, y);
          rgb = materialShades[id]![1 + levelIdx]!;
        }
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
