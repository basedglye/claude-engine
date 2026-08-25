// Rasterizes a PaintNode[] tree at native SCREEN_W x SCREEN_H onto a 2D
// canvas context. Pure function of the tree — repainting is the caller's
// (screen-quad's sync()) responsibility. Never canvas.fillText; glyphs come
// from the committed bitmap atlas in font.ts (see gen-font.mjs).
import type { PaintNode, Rect } from "../types.js";
import { GLYPH_H, GLYPH_W } from "../types.js";
import { FONT_FIRST_CODE, FONT_GLYPHS, FONT_LAST_CODE } from "./font.js";

/** The 16-colour HOTELSOFT palette. Index 0 is the default background. The
 *  sim only ever knows indices (types.ts); the host owns these RGB values. */
export const PALETTE: readonly string[] = [
  "#000030", // 0 background navy
  "#1a1a4e", // 1 panel/taskbar
  "#2f2f7a", // 2 panel border
  "#4040a0", // 3
  "#6060c0", // 4
  "#8080e0", // 5
  "#a0a0f0", // 6
  "#c0c0ff", // 7
  "#ffffff", // 8 primary text
  "#00ff00", // 9 accept green
  "#ff4040", // 10 deny red
  "#ffff00", // 11 highlight yellow
  "#00c0c0", // 12
  "#ff8000", // 13
  "#808080", // 14 dim
  "#e0e0e0", // 15 bright text/button
];

function color(idx: number): string {
  return PALETTE[idx] ?? PALETTE[0]!;
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function drawGlyph(ctx: Ctx, code: number, x: number, y: number, colorIdx: number): void {
  if (code < FONT_FIRST_CODE || code > FONT_LAST_CODE) return;
  const rows = FONT_GLYPHS[code - FONT_FIRST_CODE];
  if (!rows) return;
  ctx.fillStyle = color(colorIdx);
  for (let ry = 0; ry < GLYPH_H; ry++) {
    const bits = rows[ry] ?? 0;
    for (let rx = 0; rx < GLYPH_W; rx++) {
      if (bits & (1 << (7 - rx))) {
        ctx.fillRect(x + rx, y + ry, 1, 1);
      }
    }
  }
}

function drawText(ctx: Ctx, x: number, y: number, text: string, colorIdx: number, bgIdx?: number): void {
  if (bgIdx !== undefined) {
    ctx.fillStyle = color(bgIdx);
    ctx.fillRect(x, y, text.length * GLYPH_W, GLYPH_H);
  }
  for (let i = 0; i < text.length; i++) {
    drawGlyph(ctx, text.charCodeAt(i), x + i * GLYPH_W, y, colorIdx);
  }
}

function fillRect(ctx: Ctx, rect: Rect, colorIdx: number): void {
  ctx.fillStyle = color(colorIdx);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function strokeRect(ctx: Ctx, rect: Rect, colorIdx: number): void {
  ctx.strokeStyle = color(colorIdx);
  ctx.lineWidth = 1;
  // Inset by 0.5px so a 1px stroke lands exactly on integer pixel centers.
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

/** Paints the calibration checkerboard: a 1-surface-pixel-per-cell
 *  alternation, exactly (not scaled) — see docs/PHASE-H1.md "Readability as
 *  a gate". Uses palette 0 (dark) / 8 (light) for maximum contrast. */
function drawCalib(ctx: Ctx, rect: Rect): void {
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const dark = (x + y) % 2 === 0;
      ctx.fillStyle = dark ? color(0) : color(8);
      ctx.fillRect(rect.x + x, rect.y + y, 1, 1);
    }
  }
}

export function paintScreen(ctx: Ctx, nodes: readonly PaintNode[]): void {
  for (const node of nodes) {
    switch (node.kind) {
      case "panel":
        fillRect(ctx, node.rect, node.fill);
        if (node.border !== undefined) strokeRect(ctx, node.rect, node.border);
        break;
      case "text":
        drawText(ctx, node.x, node.y, node.text, node.color, node.bg);
        break;
      case "button":
        fillRect(ctx, node.rect, node.pressed ? 3 : 1);
        strokeRect(ctx, node.rect, node.color);
        drawText(
          ctx,
          node.rect.x + 2,
          node.rect.y + Math.max(0, Math.floor((node.rect.h - GLYPH_H) / 2)),
          node.label,
          node.color
        );
        break;
      case "table": {
        strokeRect(ctx, node.rect, node.color);
        let rowY = node.rect.y + 1;
        node.rows.forEach((row, ri) => {
          if (ri === node.selRow) {
            fillRect(ctx, { x: node.rect.x + 1, y: rowY, w: node.rect.w - 2, h: GLYPH_H }, 3);
          }
          let colX = node.rect.x + 1;
          row.forEach((cell, ci) => {
            drawText(ctx, colX, rowY, cell, node.color);
            colX += node.cols[ci] ?? 0;
          });
          rowY += GLYPH_H;
        });
        break;
      }
      case "hline":
        ctx.fillStyle = color(node.color);
        ctx.fillRect(node.x, node.y, node.w, 1);
        break;
      case "calib":
        drawCalib(ctx, node.rect);
        break;
      default: {
        const exhaustive: never = node;
        void exhaustive;
      }
    }
  }
}
