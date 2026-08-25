// Build-time codegen: generates src/sin-lut.ts, a committed table of Q16.16
// sin() values for 0°..90° in 0.1° steps (901 entries). This script MAY use
// Math.sin — it runs once at build/commit time, not inside the sim. The
// generated file is committed and its regeneration is verified byte-for-byte
// by scripts/test.mjs (regenerate to a temp file, diff against committed).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ONE = 65536;
const STEP_COUNT = 901; // 0.1 deg steps from 0 to 90 deg inclusive

export function generateLutSource() {
  const values = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    const deg = i * 0.1;
    const rad = (deg * Math.PI) / 180;
    const v = Math.round(Math.sin(rad) * ONE);
    values.push(v);
  }
  const lines = [];
  lines.push("// GENERATED FILE — do not hand-edit.");
  lines.push("// Produced by packages/space/scripts/gen-sin-lut.mjs.");
  lines.push("// 901 Q16.16 sin() values for 0.0deg..90.0deg in 0.1deg steps.");
  lines.push("// Regeneration is verified byte-for-byte by scripts/test.mjs.");
  lines.push("export const SIN_LUT: readonly number[] = [");
  for (let i = 0; i < values.length; i += 10) {
    lines.push("  " + values.slice(i, i + 10).join(", ") + ",");
  }
  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "src", "sin-lut.ts");
  writeFileSync(outPath, generateLutSource(), "utf8");
  console.log(`wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("gen-sin-lut.mjs")) {
  main();
}
