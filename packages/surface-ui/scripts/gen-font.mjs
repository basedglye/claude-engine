// Build-time codegen: generates src/host/font.ts, a committed 8x8 bitmap
// glyph atlas for the 96 printable ASCII codepoints 0x20 ("space")..0x7F
// (DEL, rendered blank as a filler so the table stays a clean contiguous
// `code - 0x20` index). Mirrors packages/space/scripts/gen-sin-lut.mjs:
// this script is the source of truth, the output is committed, and
// regeneration is verified byte-for-byte by scripts/test.mjs.
//
// Never canvas.fillText — that is platform-nondeterministic in screenshots,
// which is the entire reason a bitmap font was chosen (docs/PHASE-H1.md).
// Instead every glyph is defined as a short list of line/rect *strokes* on
// a 7x7 grid (col 7 and row 7 stay blank, giving 1px of inter-glyph/line
// spacing in the 8x8 cell) and rasterized here with integer-only Bresenham
// — deterministic, and small enough to author by hand for the full ASCII
// range. Lowercase letters reuse the uppercase stroke list, squashed into
// the x-height band [2,6] by an integer y-transform, rather than being
// authored twice.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CELL = 8; // glyph cell is 8x8; strokes live in the 0..6 sub-grid

// --- stroke primitives -------------------------------------------------
// ["l", x0, y0, x1, y1]  line (Bresenham, any slope)
// ["r", x0, y0, x1, y1]  rectangle outline (inclusive corners)
// ["f", x0, y0, x1, y1]  filled rectangle (inclusive corners)
// ["p", x, y]            single pixel

function plot(grid, x, y) {
  if (x < 0 || x >= CELL || y < 0 || y >= CELL) return;
  grid[y][x] = 1;
}

function line(grid, x0, y0, x1, y1) {
  // Integer Bresenham; abs/sign only (no transcendentals — this script is
  // build-time codegen anyway, but keeping it integer-only documents intent).
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    plot(grid, x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function rectOutline(grid, x0, y0, x1, y1) {
  line(grid, x0, y0, x1, y0);
  line(grid, x0, y1, x1, y1);
  line(grid, x0, y0, x0, y1);
  line(grid, x1, y0, x1, y1);
}

function rectFill(grid, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) plot(grid, x, y);
}

function renderStrokes(strokes) {
  const grid = Array.from({ length: CELL }, () => new Array(CELL).fill(0));
  for (const s of strokes) {
    const [op, ...args] = s;
    if (op === "l") line(grid, ...args);
    else if (op === "r") rectOutline(grid, ...args);
    else if (op === "f") rectFill(grid, ...args);
    else if (op === "p") plot(grid, args[0], args[1]);
  }
  // Pack rows to bytes: bit (1 << (7 - x)) set when pixel(x,y) is on.
  return grid.map((row) => row.reduce((byte, bit, x) => byte | (bit ? 1 << (7 - x) : 0), 0));
}

/** Lowercase reuses the matching uppercase stroke list, squashed into the
 *  x-height band y in [2,6] via an integer y-transform (y' = 2 + floor(y*4/6)). */
function squash(strokes) {
  const yT = (y) => 2 + Math.floor((y * 4) / 6);
  return strokes.map((s) => {
    const [op, ...a] = s;
    if (op === "p") return ["p", a[0], yT(a[1])];
    return [op, a[0], yT(a[1]), a[2], yT(a[3])];
  });
}

// --- glyph table: uppercase/digits/punctuation authored directly on the
// 0..6 sub-grid; lowercase derived via squash() below. -------------------
const UPPER = {
  " ": [],
  "!": [["l", 3, 0, 3, 4], ["p", 3, 6]],
  '"': [["l", 2, 0, 2, 1], ["l", 4, 0, 4, 1]],
  "#": [["l", 2, 0, 2, 6], ["l", 4, 0, 4, 6], ["l", 0, 2, 6, 2], ["l", 0, 4, 6, 4]],
  $: [["l", 3, 0, 3, 6], ["l", 1, 1, 5, 1], ["l", 1, 3, 5, 3], ["l", 1, 5, 5, 5], ["l", 1, 1, 1, 3], ["l", 5, 3, 5, 5]],
  "%": [["l", 0, 6, 6, 0], ["f", 0, 0, 1, 1], ["f", 5, 5, 6, 6]],
  "&": [["r", 0, 0, 5, 6], ["l", 0, 3, 5, 6]],
  "'": [["l", 3, 0, 3, 1]],
  "(": [["l", 4, 0, 2, 3], ["l", 2, 3, 4, 6]],
  ")": [["l", 2, 0, 4, 3], ["l", 4, 3, 2, 6]],
  "*": [["l", 0, 3, 6, 3], ["l", 3, 0, 3, 6], ["l", 1, 1, 5, 5], ["l", 1, 5, 5, 1]],
  "+": [["l", 0, 3, 6, 3], ["l", 3, 0, 3, 6]],
  ",": [["p", 3, 5], ["l", 3, 5, 2, 6]],
  "-": [["l", 1, 3, 5, 3]],
  ".": [["p", 3, 6]],
  "/": [["l", 0, 6, 6, 0]],
  0: [["r", 1, 0, 5, 6], ["l", 1, 6, 5, 0]],
  1: [["l", 3, 0, 3, 6], ["l", 2, 1, 3, 0], ["l", 1, 6, 5, 6]],
  2: [["l", 1, 0, 5, 0], ["l", 5, 0, 5, 3], ["l", 5, 3, 1, 6], ["l", 1, 6, 5, 6]],
  3: [["l", 1, 0, 5, 0], ["l", 5, 0, 5, 6], ["l", 2, 3, 5, 3], ["l", 1, 6, 5, 6]],
  4: [["l", 1, 0, 1, 3], ["l", 1, 3, 5, 3], ["l", 5, 0, 5, 6]],
  5: [["l", 1, 0, 5, 0], ["l", 1, 0, 1, 3], ["l", 1, 3, 5, 3], ["l", 5, 3, 5, 6], ["l", 1, 6, 5, 6]],
  6: [["l", 1, 0, 1, 6], ["l", 1, 0, 5, 0], ["l", 1, 3, 5, 3], ["l", 5, 3, 5, 6], ["l", 1, 6, 5, 6]],
  7: [["l", 1, 0, 5, 0], ["l", 5, 0, 2, 6]],
  8: [["r", 1, 0, 5, 6], ["l", 1, 3, 5, 3]],
  9: [["r", 1, 0, 5, 3], ["l", 5, 3, 5, 6], ["l", 1, 6, 5, 6], ["l", 1, 0, 1, 3]],
  ":": [["p", 3, 2], ["p", 3, 4]],
  ";": [["p", 3, 2], ["l", 3, 4, 2, 5]],
  "<": [["l", 5, 0, 1, 3], ["l", 1, 3, 5, 6]],
  "=": [["l", 1, 2, 5, 2], ["l", 1, 4, 5, 4]],
  ">": [["l", 1, 0, 5, 3], ["l", 5, 3, 1, 6]],
  "?": [["l", 1, 0, 5, 0], ["l", 5, 0, 5, 2], ["l", 5, 2, 3, 4], ["p", 3, 6]],
  "@": [["r", 0, 0, 6, 6], ["r", 2, 2, 4, 4]],
  A: [["l", 0, 6, 3, 0], ["l", 3, 0, 6, 6], ["l", 1, 3, 5, 3]],
  B: [["r", 0, 0, 4, 3], ["r", 0, 3, 4, 6]],
  C: [["l", 1, 0, 5, 0], ["l", 0, 1, 0, 5], ["l", 1, 6, 5, 6]],
  D: [["l", 0, 0, 0, 6], ["l", 0, 0, 4, 0], ["l", 0, 6, 4, 6], ["l", 5, 1, 5, 5]],
  E: [["l", 0, 0, 0, 6], ["l", 0, 0, 5, 0], ["l", 0, 3, 4, 3], ["l", 0, 6, 5, 6]],
  F: [["l", 0, 0, 0, 6], ["l", 0, 0, 5, 0], ["l", 0, 3, 4, 3]],
  G: [["l", 1, 0, 5, 0], ["l", 0, 1, 0, 5], ["l", 1, 6, 5, 6], ["l", 5, 3, 5, 6], ["l", 3, 3, 5, 3]],
  H: [["l", 0, 0, 0, 6], ["l", 5, 0, 5, 6], ["l", 0, 3, 5, 3]],
  I: [["l", 3, 0, 3, 6], ["l", 1, 0, 5, 0], ["l", 1, 6, 5, 6]],
  J: [["l", 5, 0, 5, 5], ["l", 5, 5, 1, 6]],
  K: [["l", 0, 0, 0, 6], ["l", 5, 0, 0, 3], ["l", 0, 3, 5, 6]],
  L: [["l", 0, 0, 0, 6], ["l", 0, 6, 5, 6]],
  M: [["l", 0, 0, 0, 6], ["l", 6, 0, 6, 6], ["l", 0, 0, 3, 3], ["l", 6, 0, 3, 3]],
  N: [["l", 0, 0, 0, 6], ["l", 6, 0, 6, 6], ["l", 0, 0, 6, 6]],
  O: [["r", 1, 0, 5, 6]],
  P: [["l", 0, 0, 0, 6], ["l", 0, 0, 4, 0], ["l", 0, 3, 4, 3], ["l", 4, 0, 4, 3]],
  Q: [["r", 1, 0, 5, 5], ["l", 3, 4, 6, 6]],
  R: [["l", 0, 0, 0, 6], ["l", 0, 0, 4, 0], ["l", 0, 3, 4, 3], ["l", 4, 0, 4, 3], ["l", 2, 3, 5, 6]],
  S: [["l", 1, 0, 5, 0], ["l", 1, 0, 1, 3], ["l", 1, 3, 5, 3], ["l", 5, 3, 5, 6], ["l", 1, 6, 5, 6]],
  T: [["l", 0, 0, 6, 0], ["l", 3, 0, 3, 6]],
  U: [["l", 0, 0, 0, 5], ["l", 6, 0, 6, 5], ["l", 0, 6, 6, 6]],
  V: [["l", 0, 0, 3, 6], ["l", 6, 0, 3, 6]],
  W: [["l", 0, 0, 0, 6], ["l", 6, 0, 6, 6], ["l", 0, 6, 3, 3], ["l", 6, 6, 3, 3]],
  X: [["l", 0, 0, 6, 6], ["l", 6, 0, 0, 6]],
  Y: [["l", 0, 0, 3, 3], ["l", 6, 0, 3, 3], ["l", 3, 3, 3, 6]],
  Z: [["l", 0, 0, 6, 0], ["l", 6, 0, 0, 6], ["l", 0, 6, 6, 6]],
  "[": [["l", 2, 0, 2, 6], ["l", 2, 0, 5, 0], ["l", 2, 6, 5, 6]],
  "\\": [["l", 0, 0, 6, 6]],
  "]": [["l", 4, 0, 4, 6], ["l", 1, 0, 4, 0], ["l", 1, 6, 4, 6]],
  "^": [["l", 3, 0, 0, 3], ["l", 3, 0, 6, 3]],
  _: [["l", 0, 6, 6, 6]],
  "`": [["l", 2, 0, 3, 1]],
  "{": [["l", 4, 0, 2, 3], ["l", 2, 3, 4, 6]],
  "|": [["l", 3, 0, 3, 6]],
  "}": [["l", 2, 0, 4, 3], ["l", 4, 3, 2, 6]],
  "~": [["l", 0, 4, 3, 2], ["l", 3, 2, 6, 4]],
};

function glyphStrokesForCode(code) {
  const ch = String.fromCharCode(code);
  if (code === 0x7f) return []; // DEL — blank filler, keeps the index contiguous
  if (ch >= "a" && ch <= "z") {
    const upper = UPPER[ch.toUpperCase()];
    return upper ? squash(upper) : [];
  }
  return UPPER[ch] ?? [];
}

export function generateFontSource() {
  const rows = [];
  for (let code = 0x20; code <= 0x7f; code++) {
    const bytes = renderStrokes(glyphStrokesForCode(code));
    rows.push(`  [${bytes.join(", ")}], // 0x${code.toString(16).padStart(2, "0")} ${JSON.stringify(String.fromCharCode(code))}`);
  }
  const lines = [];
  lines.push("// GENERATED FILE — do not hand-edit.");
  lines.push("// Produced by packages/surface-ui/scripts/gen-font.mjs.");
  lines.push("// 96 printable-ASCII 8x8 glyphs (0x20 space .. 0x7F DEL, DEL blank),");
  lines.push("// one row of 8 bits packed per byte (bit 7 = leftmost pixel).");
  lines.push("// Regeneration is verified byte-for-byte by scripts/test.mjs.");
  lines.push("export const FONT_FIRST_CODE = 0x20;");
  lines.push("export const FONT_LAST_CODE = 0x7f;");
  lines.push("export const FONT_GLYPHS: readonly (readonly number[])[] = [");
  lines.push(...rows);
  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "src", "host", "font.ts");
  writeFileSync(outPath, generateFontSource(), "utf8");
  console.log(`wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("gen-font.mjs")) {
  main();
}
