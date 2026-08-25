// The HOTELSOFT '95 shell: a taskbar, an app switcher, and delegation of
// reduce/layout/paintSpec to the registered apps. Pure — see
// docs/PHASE-H1.md "The screen contract, consolidated".
import type { ScreenAppDef, ScreenEffect, ScreenWorldView } from "./app.js";
import { hitRect } from "./app.js";
import type { PaintNode, Rect } from "./types.js";
import { GLYPH_W, SCREEN_H, SCREEN_W } from "./types.js";

export interface ShellState {
  openAppId: string;
  appStates: Record<string, unknown>;
}

const TASKBAR_H = 24;
const TASKBAR_Y = SCREEN_H - TASKBAR_H;
const TASKBAR_BTN_W = 80;
const TASKBAR_BTN_H = 16;
const TASKBAR_BTN_GAP = 4;
const TASKBAR_BTN_Y = TASKBAR_Y + 4;

/** The calibration strip's checkerboard rect (32x8, 1 surface-pixel per
 *  cell), at a fixed surface position — exported so the screen-readability
 *  probe imports this coordinate rather than hardcoding a duplicate. The
 *  shell also paints one 8x8 reference glyph row directly below it. */
export const CALIB_RECT: Rect = { x: SCREEN_W - 40, y: 4, w: 32, h: 8 };
/** Where the reference glyph row is painted, directly below CALIB_RECT. */
export const CALIB_GLYPH_Y = CALIB_RECT.y + CALIB_RECT.h;
/** Reference glyph row text (H1b review item 2: painted at `CALIB_RECT.x`
 *  = 600, 9 glyphs wide at GLYPH_W=8 runs to x=672 on a 640-wide surface —
 *  32px off the edge, rendering as "AaBbC"). Right-aligned to the surface
 *  edge instead of sharing CALIB_RECT's x, so its width is free to change
 *  without silently overflowing again. */
export const CALIB_GLYPH_TEXT = "AaBbCc123";
export const CALIB_GLYPH_X = SCREEN_W - CALIB_GLYPH_TEXT.length * GLYPH_W;

export function createShell(
  apps: readonly ScreenAppDef<unknown>[],
  opts?: { available?: (appId: string, view: ScreenWorldView) => boolean }
): ScreenAppDef<ShellState> {
  const byId = new Map(apps.map((a) => [a.id, a] as const));
  const available = opts?.available ?? (() => true);

  function availableApps(view: ScreenWorldView): ScreenAppDef<unknown>[] {
    return apps.filter((a) => available(a.id, view));
  }

  function ensureState(state: ShellState, appId: string): unknown {
    if (Object.prototype.hasOwnProperty.call(state.appStates, appId)) {
      return state.appStates[appId];
    }
    const app = byId.get(appId);
    return app ? app.init() : undefined;
  }

  function withAppState(state: ShellState, appId: string, inner: unknown): Record<string, unknown> {
    return { ...state.appStates, [appId]: inner };
  }

  function taskbarRects(view: ScreenWorldView): Record<string, Rect> {
    const rects: Record<string, Rect> = {};
    let x = 4;
    for (const app of availableApps(view)) {
      rects[`taskbar:${app.id}`] = { x, y: TASKBAR_BTN_Y, w: TASKBAR_BTN_W, h: TASKBAR_BTN_H };
      x += TASKBAR_BTN_W + TASKBAR_BTN_GAP;
    }
    return rects;
  }

  function focusedApp(state: ShellState): ScreenAppDef<unknown> | undefined {
    return byId.get(state.openAppId);
  }

  const shell: ScreenAppDef<ShellState> = {
    id: "shell",

    init(): ShellState {
      const first = apps[0];
      return { openAppId: first ? first.id : "", appStates: {} };
    },

    reduce(state, input, view) {
      if (input.kind === "click") {
        const hit = hitRect(taskbarRects(view), input.px, input.py);
        if (hit !== undefined) {
          const appId = hit.slice("taskbar:".length);
          const inner = ensureState(state, appId);
          return { state: { openAppId: appId, appStates: withAppState(state, appId, inner) } };
        }
      }

      const app = focusedApp(state);
      if (!app) return state;

      const innerState = ensureState(state, state.openAppId);
      const result = app.reduce(innerState, input, view);

      if (result !== null && typeof result === "object" && "state" in result) {
        const r = result as { state: unknown; effect?: ScreenEffect };
        return {
          state: { openAppId: state.openAppId, appStates: withAppState(state, state.openAppId, r.state) },
          ...(r.effect !== undefined ? { effect: r.effect } : {}),
        };
      }
      return { openAppId: state.openAppId, appStates: withAppState(state, state.openAppId, result) };
    },

    layout(state, view) {
      const rects: Record<string, Rect> = { ...taskbarRects(view), calib: CALIB_RECT };
      const app = focusedApp(state);
      if (app) {
        const innerState = ensureState(state, state.openAppId);
        const inner = app.layout(innerState, view);
        for (const key of Object.keys(inner)) {
          const r = inner[key];
          if (r) rects[`app:${key}`] = r;
        }
      }
      return rects;
    },

    paintSpec(state, view) {
      const nodes: PaintNode[] = [];
      const tb = taskbarRects(view);
      nodes.push({ kind: "panel", rect: { x: 0, y: TASKBAR_Y, w: SCREEN_W, h: TASKBAR_H }, fill: 1 });
      for (const app of availableApps(view)) {
        const rect = tb[`taskbar:${app.id}`];
        if (!rect) continue;
        nodes.push({ kind: "button", rect, label: app.id, color: 15, pressed: app.id === state.openAppId });
      }

      const app = focusedApp(state);
      if (app) {
        const innerState = ensureState(state, state.openAppId);
        nodes.push(...app.paintSpec(innerState, view));
      }

      // Calibration strip — the shell chrome paints this on every app, per
      // docs/PHASE-H1.md "Readability as a gate".
      nodes.push({ kind: "calib", rect: CALIB_RECT });
      nodes.push({ kind: "text", x: CALIB_GLYPH_X, y: CALIB_GLYPH_Y, text: CALIB_GLYPH_TEXT, color: 15 });

      return nodes;
    },
  };

  return shell;
}
