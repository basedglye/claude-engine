import type { Rng } from "@claude-engine/core";

export interface TerrainOptions {
  /** World units per side. */
  size: number;
  /** Vertices per side (the heightmap is resolution x resolution). */
  resolution: number;
  heightScale: number;
  /** Number of layered noise octaves. Default 4. */
  octaves?: number;
}

export interface TerrainData {
  size: number;
  resolution: number;
  /** resolution x resolution grid, row-major (index = z * resolution + x). */
  heights: Float32Array;
}

const DEFAULT_OCTAVES = 4;

/**
 * Deterministic layered value-noise heightmap. All randomness is drawn from
 * `rng`, forked per-octave so adding/removing octaves never perturbs other
 * subsystems drawing from the same parent stream.
 */
export function generateTerrain(rng: Rng, opts: TerrainOptions): TerrainData {
  const { size, resolution, heightScale } = opts;
  const octaves = Math.max(1, opts.octaves ?? DEFAULT_OCTAVES);
  const heights = new Float32Array(Math.max(0, resolution) * Math.max(0, resolution));

  const noiseRng = rng.fork("terrain-noise");
  const lattices: { grid: Float32Array; cells: number }[] = [];
  for (let o = 0; o < octaves; o++) {
    const octaveRng = noiseRng.fork(`octave-${o}`);
    const cells = Math.max(2, Math.round(4 * Math.pow(2, o)));
    const grid = new Float32Array((cells + 1) * (cells + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = octaveRng.next() * 2 - 1;
    lattices.push({ grid, cells });
  }

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const u = resolution <= 1 ? 0 : x / (resolution - 1);
      const v = resolution <= 1 ? 0 : z / (resolution - 1);
      let amplitude = 1;
      let sum = 0;
      let ampSum = 0;
      for (const lattice of lattices) {
        sum += amplitude * sampleLattice(lattice.grid, lattice.cells, u, v);
        ampSum += amplitude;
        amplitude *= 0.5;
      }
      const n = ampSum > 0 ? sum / ampSum : 0;
      heights[z * resolution + x] = n * heightScale;
    }
  }

  return { size, resolution, heights };
}

function sampleLattice(grid: Float32Array, cells: number, u: number, v: number): number {
  const gx = u * cells;
  const gz = v * cells;
  const x0 = Math.min(cells, Math.max(0, Math.floor(gx)));
  const z0 = Math.min(cells, Math.max(0, Math.floor(gz)));
  const x1 = Math.min(cells, x0 + 1);
  const z1 = Math.min(cells, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const stride = cells + 1;
  const v00 = grid[z0 * stride + x0] ?? 0;
  const v10 = grid[z0 * stride + x1] ?? 0;
  const v01 = grid[z1 * stride + x0] ?? 0;
  const v11 = grid[z1 * stride + x1] ?? 0;
  const sx = smoothstep(tx);
  const sz = smoothstep(tz);
  const a = lerp(v00, v10, sx);
  const b = lerp(v01, v11, sx);
  return lerp(a, b, sz);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Bilinear sample of `terrain` at world position (x, z), mapped into the
 * terrain's size x size extent centered at the origin. Out-of-bounds
 * positions clamp to the terrain edge. Pure/synchronous, no allocation.
 */
export function heightAt(terrain: TerrainData, x: number, z: number): number {
  const { size, resolution, heights } = terrain;
  if (resolution <= 0 || size <= 0) return 0;
  const half = size / 2;
  const u = clamp01((x + half) / size);
  const v = clamp01((z + half) / size);
  if (resolution === 1) return heights[0] ?? 0;

  const gx = u * (resolution - 1);
  const gz = v * (resolution - 1);
  const x0 = Math.min(resolution - 1, Math.max(0, Math.floor(gx)));
  const z0 = Math.min(resolution - 1, Math.max(0, Math.floor(gz)));
  const x1 = Math.min(resolution - 1, x0 + 1);
  const z1 = Math.min(resolution - 1, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const h00 = heights[z0 * resolution + x0] ?? 0;
  const h10 = heights[z0 * resolution + x1] ?? 0;
  const h01 = heights[z1 * resolution + x0] ?? 0;
  const h11 = heights[z1 * resolution + x1] ?? 0;
  const a = lerp(h00, h10, tx);
  const b = lerp(h01, h11, tx);
  return lerp(a, b, tz);
}
