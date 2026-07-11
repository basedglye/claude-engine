/**
 * texture / icon gates (docs/PHASE-2.md, Scope C).
 *
 * texture: PNG only. icon: PNG or SVG.
 *
 * No image-decoding dependency is used anywhere here — PNG dimensions are
 * read straight out of the IHDR chunk by hand (the format is simple enough),
 * and SVG is checked with a lightweight regex-based well-formedness probe,
 * not a full XML parser, per the spec's explicit allowance.
 */
import { statSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AssetBudgets, GateResult } from "../types.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniffPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

/** Width/height live at fixed offsets in the IHDR chunk, which is always the
 *  first chunk right after the 8-byte signature: 4-byte chunk length, 4-byte
 *  "IHDR" type, then 4-byte width + 4-byte height, both big-endian. */
function parsePngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Lightweight well-formed-ish check: has an <svg ...> root and a matching
 *  close (either a separate </svg> or the root tag self-closing). This is
 *  deliberately not a real XML parser — per PHASE-2.md's "lightweight check,
 *  not a full XML parser" allowance. */
function looksLikeSvg(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const hasSvgRoot = /<svg[\s>]/i.test(trimmed);
  const hasClose = /<\/svg>/i.test(trimmed) || /<svg\b[^>]*\/>/i.test(trimmed);
  return hasSvgRoot && hasClose;
}

/** Best-effort width/height extraction from the <svg> root tag's attributes.
 *  A valid SVG need not declare pixel width/height at all (viewBox alone is
 *  legal), so absence is not itself a failure — see the caller. */
function parseSvgDimensions(text: string): { width: number; height: number } | null {
  const openTagMatch = text.match(/<svg\b[^>]*>/i);
  if (!openTagMatch) return null;
  const tag = openTagMatch[0];
  const widthMatch = tag.match(/\bwidth=["']?([\d.]+)/i);
  const heightMatch = tag.match(/\bheight=["']?([\d.]+)/i);
  if (!widthMatch || !heightMatch) return null;
  const width = parseFloat(widthMatch[1]!);
  const height = parseFloat(heightMatch[1]!);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

export function validateTexture(
  file: string,
  type: "texture" | "icon",
  budgets: AssetBudgets
): GateResult[] {
  const gates: GateResult[] = [];
  const buf = readFileSync(file);
  const ext = extname(file).toLowerCase();
  const budget = type === "texture" ? budgets.texture : budgets.icon;

  let formatPassed = false;
  let formatDetail: string;
  let isPng = false;
  let isSvg = false;

  if (ext === ".png") {
    isPng = sniffPng(buf);
    formatPassed = isPng;
    formatDetail = isPng
      ? "valid PNG magic bytes"
      : "file has .png extension but does not start with the PNG magic byte sequence";
  } else if (ext === ".svg" && type === "icon") {
    isSvg = looksLikeSvg(buf.toString("utf8"));
    formatPassed = isSvg;
    formatDetail = isSvg
      ? "well-formed-ish SVG (has <svg> root and matching close)"
      : "file has .svg extension but does not look like well-formed SVG";
  } else if (ext === ".svg" && type === "texture") {
    formatDetail = "texture assets must be PNG; SVG is only accepted for icon";
  } else {
    formatDetail =
      type === "texture"
        ? `unsupported extension "${ext}" for texture; expected .png`
        : `unsupported extension "${ext}" for icon; expected .png or .svg`;
  }
  gates.push({ name: "format", passed: formatPassed, detail: formatDetail });

  const size = statSync(file).size;
  gates.push({
    name: "size",
    passed: size <= budget.maxBytes,
    detail: `${size} bytes (budget ${budget.maxBytes})`,
  });

  if (formatPassed && isPng) {
    const dims = parsePngDimensions(buf);
    if (dims) {
      const dimOk = dims.width <= budget.maxDim && dims.height <= budget.maxDim;
      gates.push({
        name: "dimensions",
        passed: dimOk,
        detail: `${dims.width}x${dims.height} (max ${budget.maxDim})`,
      });
      if (type === "texture") {
        const textureBudget = budgets.texture;
        const pow2 = isPowerOfTwo(dims.width) && isPowerOfTwo(dims.height);
        // requirePow2=true makes this a hard requirement (gate fails on a
        // non-pow2 texture); requirePow2=false means it is not enforced at
        // all, not merely a soft warning — per PHASE-2.md: "warn via a
        // passed:false gate only if the budget flag requires it".
        gates.push({
          name: "pow2",
          passed: !textureBudget.requirePow2 || pow2,
          detail: pow2
            ? "power-of-two dimensions"
            : `not power-of-two (${dims.width}x${dims.height})${
                textureBudget.requirePow2 ? "" : " — not enforced (requirePow2=false)"
              }`,
        });
      }
    } else {
      gates.push({
        name: "dimensions",
        passed: false,
        detail: "could not parse PNG IHDR chunk to determine dimensions",
      });
    }
  } else if (formatPassed && isSvg) {
    const dims = parseSvgDimensions(buf.toString("utf8"));
    if (dims) {
      const dimOk = dims.width <= budget.maxDim && dims.height <= budget.maxDim;
      gates.push({
        name: "dimensions",
        passed: dimOk,
        detail: `${dims.width}x${dims.height} (max ${budget.maxDim})`,
      });
    } else {
      // SVG is vector data; not declaring width/height is spec-legal (a
      // viewBox alone suffices). Best-effort only: pass rather than penalize
      // a legal SVG we can't measure without a real XML/CSS-aware parser.
      gates.push({
        name: "dimensions",
        passed: true,
        detail:
          "SVG has no explicit width/height attributes; pixel-dimension check skipped (vector asset, best-effort)",
      });
    }
  }

  return gates;
}
