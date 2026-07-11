/**
 * Small deterministic color helpers shared by the mesh and icon generators.
 * Pure math only — no DOM/canvas dependency (that lives in src/web).
 */

/** HSL (h in [0,360), s/l in [0,1]) -> linear RGB triple in [0,1]. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hp = ((h % 360) + 360) % 360 / 60;
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
  return [r1 + m, g1 + m, b1 + m];
}

/** HSL -> CSS `hsl(...)` string, for SVG output. */
export function hslToCss(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  return `hsl(${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
