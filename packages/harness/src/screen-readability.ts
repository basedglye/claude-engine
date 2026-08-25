/**
 * The `screen-readability` probe's analysis (docs/PHASE-H1.md "Readability
 * as a gate"). Split into two pieces on purpose:
 *
 *  - `analyzeReadability` is a pure function of a decoded RGBA image plus
 *    the screen's projected rect — no Playwright, no filesystem. It is the
 *    unit-tested surface: callable directly on a synthetic in-memory image,
 *    which is how a blurred/mis-scaled/blank capture can be exercised
 *    without a browser at all.
 *  - `decodePng` turns the harness's already-captured PNG screenshot bytes
 *    into that RGBA buffer. It is a small hand-rolled decoder (IHDR/IDAT
 *    parsing + PNG scanline unfiltering) built on Node's built-in `zlib`
 *    for the inflate step — no new dependency. `packages/asset-pipeline`
 *    already reads PNG *dimensions* by hand (its IHDR-only reader), but
 *    stops short of decoding pixels; this extends that approach rather than
 *    introducing a second, inconsistent PNG code path or a real dependency
 *    for what is fundamentally "inflate + per-row unfilter" (~100 lines).
 *    Supports the 8-bit-depth, non-interlaced RGB/RGBA/greyscale/palette
 *    forms Playwright's `page.screenshot()` actually produces; anything
 *    else throws with a clear message rather than silently misreading.
 */
import { inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  /** Row-major, 4 bytes (R,G,B,A) per pixel. */
  data: Uint8Array;
}

/** Matches @claude-engine/renderer-three's `ScreenRect` (kept structurally
 *  compatible rather than imported, so this module has no runtime
 *  dependency beyond the pure pixel math). */
export interface ScreenRectLike {
  x: number;
  y: number;
  w: number;
  h: number;
  texelScale: number;
}

/** Matches @claude-engine/surface-ui's `Rect`, same reasoning as above. */
export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReadabilityResult {
  texelScale: number;
  calibContrast: number;
  calibPitchErr: number;
}

/** Below this, an adjacent checkerboard pair is considered to have failed
 *  to alternate (docs/PHASE-H1.md "Readability as a gate", step 3). */
const PITCH_ALTERNATION_THRESHOLD_LUMA = 24;

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function samplePixel(image: RgbaImage, px: number, py: number): { r: number; g: number; b: number } {
  const x = Math.min(image.width - 1, Math.max(0, Math.round(px)));
  const y = Math.min(image.height - 1, Math.max(0, Math.round(py)));
  const i = (y * image.width + x) * 4;
  return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
}

/**
 * Analyses a captured screenshot's calibration strip against the focused
 * screen's projected rect. Implements docs/PHASE-H1.md "Readability as a
 * gate" steps 1-3 exactly:
 *   1. texelScale is read straight off `screenRect` (no pixel work needed
 *      for that half of the check — the caller applies the `>= 1.0` bound).
 *   2. Locate the calib strip via the rect + the known surface coordinates
 *      (`calibRect`, i.e. `CALIB_RECT` from @claude-engine/surface-ui — the
 *      caller passes it in so this module never hardcodes a duplicate).
 *      Sample its checkerboard along one row at the expected pitch
 *      (texelScale screen px per surface px).
 *   3. calibContrast = mean |luma(dark) - luma(light)| over expected
 *      alternations; calibPitchErr = fraction of adjacent sample pairs
 *      failing to alternate by >= 24/255 luma.
 *
 * The checkerboard is `(x + y) % 2 === 0 ? dark : light` per surface pixel
 * (packages/surface-ui/src/host/painter.ts's drawCalib) — sampling a fixed
 * row means the row parity is constant, so along that row parity alternates
 * with x exactly like a 1D checkerboard.
 */
export function analyzeReadability(image: RgbaImage, screenRect: ScreenRectLike, calibRect: RectLike): ReadabilityResult {
  const texelScale = screenRect.texelScale;

  // Sample the row through the vertical middle of the strip (row 4 of the
  // 8-row-tall CALIB_RECT), across all `calibRect.w` columns — "along its
  // row" per the spec.
  const rowIndex = Math.floor(calibRect.h / 2);
  const samples: number[] = [];
  for (let col = 0; col < calibRect.w; col++) {
    // Center of this surface pixel's projected footprint, in screenshot px.
    const surfaceX = calibRect.x + col + 0.5;
    const surfaceY = calibRect.y + rowIndex + 0.5;
    const screenPx = screenRect.x + surfaceX * texelScale;
    const screenPy = screenRect.y + surfaceY * texelScale;
    const { r, g, b } = samplePixel(image, screenPx, screenPy);
    samples.push(luma(r, g, b));
  }

  let contrastSum = 0;
  let failCount = 0;
  let pairCount = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const diff = Math.abs(a - b);
    contrastSum += diff;
    if (diff < PITCH_ALTERNATION_THRESHOLD_LUMA) failCount++;
    pairCount++;
  }

  const calibContrast = pairCount > 0 ? contrastSum / pairCount : 0;
  const calibPitchErr = pairCount > 0 ? failCount / pairCount : 1;

  return { texelScale, calibContrast, calibPitchErr };
}

/** Pass condition from docs/PHASE-H1.md "Readability as a gate" step 3. */
export function passesReadability(r: ReadabilityResult): boolean {
  return r.texelScale >= 1.0 && r.calibContrast >= 60 && r.calibPitchErr <= 0.1;
}

// ---------------------------------------------------------------------------
// Hand-rolled PNG decoder (IHDR/IDAT + scanline unfiltering). See module
// doc comment for why this exists instead of an npm dependency.
// ---------------------------------------------------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

function readChunks(buf: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break;
    chunks.push({ type, data: buf.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4; // skip 4-byte CRC
  }
  return chunks;
}

function bytesPerPixel(colorType: number, bitDepth: number): number {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`decodePng: unsupported color type ${colorType}`);
  return Math.max(1, (channels * bitDepth) / 8);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Unfilters PNG scanlines in place (spec filter types 0-4), returning the
 *  raw per-pixel-channel bytes (still packed per `colorType`/`bitDepth`,
 *  not yet expanded to RGBA). */
function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = Math.ceil((width * bpp * 8) / 8); // bpp already includes bit-depth scaling for our supported cases
  const rowBytes = stride;
  const out = Buffer.alloc(rowBytes * height);
  let srcOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[srcOffset]!;
    srcOffset += 1;
    const rowStart = y * rowBytes;
    const prevRowStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const rawByte = raw[srcOffset + x]!;
      const a = x >= bpp ? out[rowStart + x - bpp]! : 0;
      const b = y > 0 ? out[prevRowStart + x]! : 0;
      const c = x >= bpp && y > 0 ? out[prevRowStart + x - bpp]! : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = (rawByte + a) & 0xff;
          break;
        case 2:
          value = (rawByte + b) & 0xff;
          break;
        case 3:
          value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          value = (rawByte + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`decodePng: unsupported filter type ${filterType}`);
      }
      out[rowStart + x] = value;
    }
    srcOffset += rowBytes;
  }
  return out;
}

/** Decodes a PNG file's bytes into a flat RGBA8 buffer. Supports 8-bit-depth
 *  non-interlaced greyscale (0), RGB (2), palette (3), greyscale+alpha (4),
 *  and RGBA (6) — the forms browser screenshot tools produce. */
export function decodePng(buf: Buffer): RgbaImage {
  if (buf.length < 8 || !PNG_MAGIC.every((b, i) => buf[i] === b)) {
    throw new Error("decodePng: not a PNG file (bad magic bytes)");
  }
  const chunks = readChunks(buf);
  const ihdrChunk = chunks.find((c) => c.type === "IHDR");
  if (!ihdrChunk) throw new Error("decodePng: missing IHDR chunk");
  const ihdr: Ihdr = {
    width: ihdrChunk.data.readUInt32BE(0),
    height: ihdrChunk.data.readUInt32BE(4),
    bitDepth: ihdrChunk.data.readUInt8(8),
    colorType: ihdrChunk.data.readUInt8(9),
    interlace: ihdrChunk.data.readUInt8(12),
  };
  if (ihdr.interlace !== 0) throw new Error("decodePng: interlaced PNGs are not supported");
  if (ihdr.bitDepth !== 8) throw new Error(`decodePng: only 8-bit depth is supported (got ${ihdr.bitDepth})`);

  const palette: Buffer | undefined = chunks.find((c) => c.type === "PLTE")?.data;
  if (ihdr.colorType === 3 && !palette) throw new Error("decodePng: palette color type with no PLTE chunk");

  const idatChunks = chunks.filter((c) => c.type === "IDAT").map((c) => c.data);
  const compressed = Buffer.concat(idatChunks);
  const raw = inflateSync(compressed);

  const bpp = bytesPerPixel(ihdr.colorType, ihdr.bitDepth);
  const unfiltered = unfilter(raw, ihdr.width, ihdr.height, bpp);

  const rgba = new Uint8Array(ihdr.width * ihdr.height * 4);
  for (let p = 0; p < ihdr.width * ihdr.height; p++) {
    const si = p * bpp;
    const di = p * 4;
    switch (ihdr.colorType) {
      case 0: {
        const g = unfiltered[si]!;
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = 255;
        break;
      }
      case 2:
        rgba[di] = unfiltered[si]!;
        rgba[di + 1] = unfiltered[si + 1]!;
        rgba[di + 2] = unfiltered[si + 2]!;
        rgba[di + 3] = 255;
        break;
      case 3: {
        const idx = unfiltered[si]!;
        const po = idx * 3;
        rgba[di] = palette![po]!;
        rgba[di + 1] = palette![po + 1]!;
        rgba[di + 2] = palette![po + 2]!;
        rgba[di + 3] = 255;
        break;
      }
      case 4: {
        const g = unfiltered[si]!;
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = unfiltered[si + 1]!;
        break;
      }
      case 6:
        rgba[di] = unfiltered[si]!;
        rgba[di + 1] = unfiltered[si + 1]!;
        rgba[di + 2] = unfiltered[si + 2]!;
        rgba[di + 3] = unfiltered[si + 3]!;
        break;
      default:
        throw new Error(`decodePng: unsupported color type ${ihdr.colorType}`);
    }
  }

  return { width: ihdr.width, height: ihdr.height, data: rgba };
}
