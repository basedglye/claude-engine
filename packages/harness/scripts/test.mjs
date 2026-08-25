// Unit tests for @claude-engine/harness's screen-readability probe analysis
// (npm run test -w @claude-engine/harness builds first). Hand-rolled
// assert-and-exit script, matching packages/surface-ui/scripts/test.mjs
// style. Exercises `analyzeReadability` directly on synthetic in-memory
// images — no browser, no Playwright — per docs/PHASE-H1.md's exit
// criteria for this lane ("unit-test the probe's analysis function
// directly on synthetic images").
import { analyzeReadability, passesReadability, decodePng } from "../dist/screen-readability.js";
import { deflateSync } from "node:zlib";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// The real CALIB_RECT (packages/surface-ui/src/shell.ts): 32x8, at a fixed
// surface position. Kept as a local literal here (not imported) so this
// test has no dependency beyond harness's own dist — but the value must
// match shell.ts's export exactly, since a probe run reads the real one.
const CALIB_RECT = { x: 640 - 40, y: 4, w: 32, h: 8 };

/** Builds a synthetic screenshot-shaped RGBA image containing nothing but
 *  the calibration checkerboard, painted at `texelScale` screen px per
 *  surface px, exactly like packages/surface-ui/src/host/painter.ts's
 *  drawCalib (dark = near-black #000030, light = white #ffffff), so the
 *  probe's row-sampling math can be exercised end to end. `screenOffset`
 *  simulates the quad not starting at image (0,0) (the general case). */
function buildCalibImage(texelScale, opts = {}) {
  const screenOffsetX = opts.screenOffsetX ?? 10;
  const screenOffsetY = opts.screenOffsetY ?? 10;
  const rowIndex = Math.floor(CALIB_RECT.h / 2);
  const width = Math.ceil(screenOffsetX + (CALIB_RECT.x + CALIB_RECT.w + 4) * texelScale);
  const height = Math.ceil(screenOffsetY + (CALIB_RECT.y + CALIB_RECT.h + 4) * texelScale);
  const data = new Uint8Array(width * height * 4);
  // Fill with a mid-grey background so out-of-strip pixels aren't
  // accidentally read as part of the checkerboard.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 255;
  }
  const dark = [0, 0, 0x30];
  const light = [0xff, 0xff, 0xff];
  // Paint one surface-pixel-wide, `texelScale`-px-tall band for the sampled
  // row, at the full projected resolution (each surface pixel becomes a
  // texelScale x texelScale screen-pixel block) — matches a nearest-filtered
  // CanvasTexture projected onto the quad at that scale.
  for (let col = 0; col < CALIB_RECT.w; col++) {
    const isDark = (col + rowIndex) % 2 === 0;
    const [r, g, b] = isDark ? dark : light;
    const x0 = Math.floor(screenOffsetX + (CALIB_RECT.x + col) * texelScale);
    const x1 = Math.floor(screenOffsetX + (CALIB_RECT.x + col + 1) * texelScale);
    const y0 = Math.floor(screenOffsetY + (CALIB_RECT.y + rowIndex) * texelScale);
    const y1 = Math.floor(screenOffsetY + (CALIB_RECT.y + rowIndex + 1) * texelScale);
    for (let y = y0; y < y1 && y < height; y++) {
      for (let x = x0; x < x1 && x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }
  return { image: { width, height, data }, screenRect: { x: screenOffsetX, y: screenOffsetY, w: 640 * texelScale, h: 480 * texelScale, texelScale } };
}

/** 3x3 box blur in place — simulates a mip/linear-filtered capture. */
function boxBlur(image, radius) {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const i = (yy * width + xx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const i = (y * width + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

// --- Case 1: a perfect 1-texel checkerboard (texelScale = 2, an easy
// integer scale to sample precisely) must pass. ---------------------------
{
  const { image, screenRect } = buildCalibImage(2);
  const result = analyzeReadability(image, screenRect, CALIB_RECT);
  console.log(`  case 1 (perfect, texelScale=2): texelScale=${result.texelScale} calibContrast=${result.calibContrast.toFixed(1)} calibPitchErr=${result.calibPitchErr.toFixed(3)}`);
  assert(result.texelScale === 2, "case 1: texelScale reported as given (2)");
  assert(result.calibContrast >= 60, `case 1: calibContrast >= 60 (got ${result.calibContrast.toFixed(1)})`);
  assert(result.calibPitchErr <= 0.1, `case 1: calibPitchErr <= 0.1 (got ${result.calibPitchErr.toFixed(3)})`);
  assert(passesReadability(result), "case 1: passesReadability() is true for a perfect checkerboard");
}

// --- Case 2: a 2x box-blurred version must fail on contrast. --------------
{
  const { image, screenRect } = buildCalibImage(4); // wider texels so the blur radius is meaningful relative to a cell
  const blurred = boxBlur(boxBlur(image, 2), 2); // two 2x passes ~= a strong blur, well beyond the 1-texel alternation
  const result = analyzeReadability(blurred, screenRect, CALIB_RECT);
  console.log(`  case 2 (2x box-blurred, texelScale=4): texelScale=${result.texelScale} calibContrast=${result.calibContrast.toFixed(1)} calibPitchErr=${result.calibPitchErr.toFixed(3)}`);
  assert(result.calibContrast < 60, `case 2: calibContrast < 60 after blur (got ${result.calibContrast.toFixed(1)})`);
  assert(!passesReadability(result), "case 2: passesReadability() is false after blur");
}

// --- Case 3: a half-scale (texelScale = 0.5) capture must fail — either on
// texelScale itself (< 1.0) or on pitch (undersampling collapses the
// alternation). ------------------------------------------------------------
{
  const { image, screenRect } = buildCalibImage(0.5);
  const result = analyzeReadability(image, screenRect, CALIB_RECT);
  console.log(`  case 3 (half-scale, texelScale=0.5): texelScale=${result.texelScale} calibContrast=${result.calibContrast.toFixed(1)} calibPitchErr=${result.calibPitchErr.toFixed(3)}`);
  assert(result.texelScale === 0.5, "case 3: texelScale reported as given (0.5)");
  assert(result.texelScale < 1.0, "case 3: texelScale < 1.0 (fails B7's texel-per-glyph-pixel bound)");
  assert(!passesReadability(result), "case 3: passesReadability() is false at texelScale 0.5");
}

// --- Case 4: a uniform grey capture (blank/no signal) must fail on
// contrast (contrast -> 0) and on pitch (every pair fails to alternate). --
{
  const { image, screenRect } = buildCalibImage(2);
  const grey = new Uint8Array(image.data.length);
  for (let i = 0; i < grey.length; i += 4) {
    grey[i] = 100;
    grey[i + 1] = 100;
    grey[i + 2] = 100;
    grey[i + 3] = 255;
  }
  const result = analyzeReadability({ width: image.width, height: image.height, data: grey }, screenRect, CALIB_RECT);
  console.log(`  case 4 (uniform grey): texelScale=${result.texelScale} calibContrast=${result.calibContrast.toFixed(1)} calibPitchErr=${result.calibPitchErr.toFixed(3)}`);
  assert(result.calibContrast === 0, `case 4: calibContrast is exactly 0 (got ${result.calibContrast})`);
  assert(result.calibPitchErr === 1, `case 4: calibPitchErr is exactly 1 (got ${result.calibPitchErr})`);
  assert(!passesReadability(result), "case 4: passesReadability() is false for a blank capture");
}

// --- decodePng: round-trip a hand-built minimal PNG (8-bit RGB, one IDAT,
// filter type 0/None on every row) through Node's own zlib deflate, then
// decode it back and check pixels match. Exercises the decoder's IHDR/IDAT
// parsing and unfiltering independent of analyzeReadability. ---------------
{
  const w = 4,
    h = 3;
  const pixels = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
    [0, 255, 255], [255, 0, 255], [0, 0, 0], [255, 255, 255],
    [10, 20, 30], [40, 50, 60], [70, 80, 90], [100, 110, 120],
  ];
  const raw = Buffer.alloc(h * (1 + w * 3));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter type None
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixels[y * w + x];
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const idat = deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    // CRC is not checked by our decoder, so a zero CRC is fine here.
    const crc = Buffer.alloc(4);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0; // no interlace
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const decoded = decodePng(png);
  assert(decoded.width === w && decoded.height === h, "decodePng: dimensions round-trip");
  let pixelsOk = true;
  for (let p = 0; p < w * h; p++) {
    const [r, g, b] = pixels[p];
    const i = p * 4;
    if (decoded.data[i] !== r || decoded.data[i + 1] !== g || decoded.data[i + 2] !== b || decoded.data[i + 3] !== 255) {
      pixelsOk = false;
    }
  }
  assert(pixelsOk, "decodePng: all pixels round-trip exactly");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll @claude-engine/harness screen-readability tests passed.");
