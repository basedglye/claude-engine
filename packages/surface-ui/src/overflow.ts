/**
 * Mechanical clipping gate for `PaintNode[]` trees. Pure — no DOM, no
 * Three.js, same purity root as the rest of this package's non-`host`
 * source. Exists because a truncated field or a crowded/overlapping
 * procedures line is not cosmetic on a diegetic terminal: the whole
 * front-desk loop is the player reading fields off this surface and
 * comparing them by eye (rules.ts's header, DESIGN.md §4) — text an app
 * cannot see is a fraud the player cannot catch. This was caught by a
 * screenshot, not a test, once (H1b review round 3); this module is what
 * makes that a build-time gate instead of an eyeballing exercise for every
 * future app registered with the shell.
 */
import type { PaintNode, Rect } from "./types.js";
import { GLYPH_H, GLYPH_W, SCREEN_H, SCREEN_W } from "./types.js";

/** The rectangle a painted node actually occupies, at the same 8x8-glyph
 *  metrics `host/painter.ts` draws with. For `text`, width is
 *  `text.length * GLYPH_W` — the font is fixed-width, so this is exact,
 *  not an estimate. */
export function occupiedRect(node: PaintNode): Rect {
  switch (node.kind) {
    case "text":
      return { x: node.x, y: node.y, w: node.text.length * GLYPH_W, h: GLYPH_H };
    case "panel":
    case "button":
    case "table":
    case "calib":
      return node.rect;
    case "hline":
      return { x: node.x, y: node.y, w: node.w, h: 1 };
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export interface OverflowViolation {
  node: PaintNode;
  /** The node's actual occupied rect (see `occupiedRect`). */
  rect: Rect;
  /** The rect it was checked against — the full surface unless the caller
   *  passed a narrower `bounds` (e.g. one app column). */
  bounds: Rect;
}

function rectContains(bounds: Rect, rect: Rect): boolean {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.w <= bounds.x + bounds.w &&
    rect.y + rect.h <= bounds.y + bounds.h
  );
}

/**
 * Returns every node whose occupied rect extends outside `bounds`.
 * `bounds` defaults to the full `SCREEN_W x SCREEN_H` surface — the
 * universal, app-independent check every `PaintNode[]` must pass. Callers
 * that want a per-column check (RESERVA's two side-by-side text columns,
 * say) filter `nodes` to that column's own pushes and pass that column's
 * declared `Rect` as `bounds`; a node clipping its own column but still
 * inside the surface is caught the same way a node clipping the whole
 * surface is.
 */
export function findOverflowingNodes(
  nodes: readonly PaintNode[],
  bounds: Rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }
): OverflowViolation[] {
  const violations: OverflowViolation[] = [];
  for (const node of nodes) {
    const rect = occupiedRect(node);
    if (!rectContains(bounds, rect)) {
      violations.push({ node, rect, bounds });
    }
  }
  return violations;
}
