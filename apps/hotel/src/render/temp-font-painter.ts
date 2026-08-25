/**
 * TEMPORARY canvas text painter for the held-document prop only.
 *
 * docs/PHASE-H1.md is explicit that `@claude-engine/surface-ui` (with its
 * committed 8x8 bitmap glyph atlas, `packages/surface-ui/src/host/font.ts`)
 * does not exist yet — it is H1b. The held-document view needs *some* way
 * to paint field text this phase, so this module is a small, self-contained
 * canvas-2D text painter, used ONLY by `render/documents.ts`.
 *
 * H1B REVIEWER: once `@claude-engine/surface-ui/host`'s `paintScreen` +
 * committed font ship, delete this file and repaint documents through that
 * one painter instead — the module doc comment on `render/documents.ts`
 * points back here. Do not let two font/text paths coexist past H1b.
 *
 * This is host-only presentation: `ctx.fillText` is not deterministic
 * across platforms at the pixel level, which is exactly why the real
 * surface-ui painter (H1b) uses a committed glyph atlas instead of
 * `fillText` for anything the sim/replay cares about. Nothing here is
 * hashed or read back into sim state (invariant 2/3 don't apply to this
 * file) — it only ever paints a prop the player looks at.
 */

export interface DocumentPaintLine {
  label: string;
  value: string;
}

const CANVAS_W = 512;
const CANVAS_H = 384;
const MARGIN = 28;
const LINE_HEIGHT = 40;
const TITLE_SIZE = 30;
const FIELD_SIZE = 24;

export { CANVAS_W as DOC_CANVAS_W, CANVAS_H as DOC_CANVAS_H };

/** Paints a simple paper-like document: title + label/value lines, onto a
 *  fixed-size canvas 2D context. Pure function of its inputs; caller
 *  decides when to invoke it (dirty-checked against the last-painted field
 *  set, so this never runs unnecessarily in the render loop). */
export function paintDocument(ctx: CanvasRenderingContext2D, title: string, lines: readonly DocumentPaintLine[]): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Paper background.
  ctx.fillStyle = "#f2ead6";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = "#3a3226";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, CANVAS_W - 6, CANVAS_H - 6);

  ctx.fillStyle = "#241f18";
  ctx.font = `bold ${TITLE_SIZE}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(title, MARGIN, MARGIN);

  ctx.strokeStyle = "#8a7c5c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, MARGIN + TITLE_SIZE + 10);
  ctx.lineTo(CANVAS_W - MARGIN, MARGIN + TITLE_SIZE + 10);
  ctx.stroke();

  ctx.font = `${FIELD_SIZE}px monospace`;
  let y = MARGIN + TITLE_SIZE + 30;
  for (const line of lines) {
    ctx.fillStyle = "#5a4f3a";
    ctx.fillText(`${line.label}:`, MARGIN, y);
    ctx.fillStyle = "#161310";
    ctx.fillText(line.value, MARGIN + 180, y);
    y += LINE_HEIGHT;
  }
}
