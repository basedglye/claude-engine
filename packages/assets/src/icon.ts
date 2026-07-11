import type { Rng } from "@claude-engine/core";
import { hslToCss } from "./color.js";

export interface IconOptions {
  /** SVG viewBox side length (logical units). Default 64. */
  sizePx?: number;
  /** Number of generative shapes. Default: rng-picked 3-6. */
  shapeCount?: number;
  /** Draw a solid background rect behind the shapes. Default true. */
  background?: boolean;
}

const SHAPE_KINDS = ["circle", "rect", "polygon"] as const;

/** Deterministic, self-contained generative SVG icon — vector output only. */
export function generateIconSvg(rng: Rng, opts: IconOptions = {}): string {
  const size = opts.sizePx ?? 64;
  const colorRng = rng.fork("icon-color");
  const shapeRng = rng.fork("icon-shapes");
  const shapeCount = opts.shapeCount ?? shapeRng.int(3, 6);
  const drawBackground = opts.background ?? true;

  const parts: string[] = [];
  if (drawBackground) {
    const bg = hslToCss(colorRng.next() * 360, 0.35, 0.16);
    parts.push(`<rect x="0" y="0" width="${size}" height="${size}" fill="${bg}" />`);
  }

  for (let i = 0; i < shapeCount; i++) {
    const kind = SHAPE_KINDS[shapeRng.int(0, SHAPE_KINDS.length - 1)] ?? "circle";
    const fill = hslToCss(colorRng.next() * 360, 0.6, 0.55);
    const cx = shapeRng.next() * size;
    const cy = shapeRng.next() * size;
    const r = size * (0.08 + shapeRng.next() * 0.22);
    const opacity = fmt(0.55 + shapeRng.next() * 0.45);

    if (kind === "circle") {
      parts.push(
        `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="${fill}" fill-opacity="${opacity}" />`
      );
    } else if (kind === "rect") {
      const w = r * 1.6;
      const h = r * 1.6;
      const rot = Math.round(shapeRng.next() * 360);
      parts.push(
        `<rect x="${fmt(cx - w / 2)}" y="${fmt(cy - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" ` +
          `fill="${fill}" fill-opacity="${opacity}" transform="rotate(${rot} ${fmt(cx)} ${fmt(cy)})" />`
      );
    } else {
      const sides = shapeRng.int(3, 6);
      const points: string[] = [];
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        points.push(`${fmt(cx + Math.cos(a) * r)},${fmt(cy + Math.sin(a) * r)}`);
      }
      parts.push(`<polygon points="${points.join(" ")}" fill="${fill}" fill-opacity="${opacity}" />`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${parts.join("")}</svg>`;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}
