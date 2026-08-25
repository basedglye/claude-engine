// Creates the screen quad's CanvasTexture and the UV->surface-pixel mapping
// used to turn a raycast hit into integer {px,py}. The float->int
// quantization happens HERE, host-side — the sim only ever sees integers
// (docs/PHASE-H1.md determinism rule 2).
import * as THREE from "three";
import type { PaintNode } from "../types.js";
import { SCREEN_H, SCREEN_W } from "../types.js";
import { paintScreen } from "./painter.js";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createScreenSurface(): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  uvToPixel(u: number, v: number): { px: number; py: number };
  sync(paintSeq: number, nodes: readonly PaintNode[]): void;
} {
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(SCREEN_W, SCREEN_H)
      : (() => {
          const c = document.createElement("canvas");
          c.width = SCREEN_W;
          c.height = SCREEN_H;
          return c;
        })();

  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("createScreenSurface: 2d context unavailable");

  // `as any` on the canvas: three's CanvasTexture typing wants
  // HTMLCanvasElement | HTMLImageElement | ..., but accepts OffscreenCanvas
  // at runtime (both expose the drawable-surface interface it needs).
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // Flagged for exclusion from any future retro/PS1 shader pass — the
  // screen texture is native-resolution per ARCHITECTURE B7.
  (texture as unknown as { excludeFromRetroPipeline?: boolean }).excludeFromRetroPipeline = true;

  let lastPaintSeq: number | undefined;

  return {
    canvas,
    texture,
    uvToPixel(u: number, v: number): { px: number; py: number } {
      const px = clamp(Math.floor(u * SCREEN_W), 0, SCREEN_W - 1);
      const py = clamp(Math.floor((1 - v) * SCREEN_H), 0, SCREEN_H - 1);
      return { px, py };
    },
    sync(paintSeq: number, nodes: readonly PaintNode[]): void {
      if (paintSeq === lastPaintSeq) return;
      lastPaintSeq = paintSeq;
      ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
      paintScreen(ctx, nodes);
      texture.needsUpdate = true;
    },
  };
}
