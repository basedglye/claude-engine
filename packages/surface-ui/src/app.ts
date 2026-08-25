// Pure app contract. reduce() runs sim-side; layout() is the single source
// of geometry shared by reduce's hit-testing and paintSpec's placement — see
// docs/PHASE-H1.md "The screen contract, consolidated".
import type { PaintNode, Rect, ScreenInput } from "./types.js";

/** What an app reads from the world. A narrow, read-only projection built
 *  by the game's screenSystem each time reduce runs — apps never receive
 *  the Sim. Keeps reduce pure and testable with plain objects. */
export interface ScreenWorldView {
  tick: number;
  /** Game-defined query results, prepared by the registering game code. */
  data: Record<string, unknown>;
}

export interface ScreenEffect {
  type: string;
  payload: unknown;
}

/** A diegetic screen app. `state` must be JSON-plain integers/strings — it
 *  lives verbatim in the `screenApp` component and is hashed. */
export interface ScreenAppDef<S> {
  id: string;
  /** Initial state. Pure; no Rng (apps are UIs, not games). */
  init(): S;
  /** Sim-side. Returns the next state, optionally with an effect the
   *  screenSystem re-submits as a validated command. */
  reduce(state: S, input: ScreenInput, view: ScreenWorldView): S | { state: S; effect?: ScreenEffect };
  /** Pure integer layout: the SAME function reduce uses for hit-testing is
   *  the one paintSpec uses for placement — hit rects cannot drift from
   *  pixels. Exposed so tests can assert click routing headlessly. */
  layout(state: S, view: ScreenWorldView): Record<string, Rect>;
  /** Host-side interpretation input. Pure function of (state, view). */
  paintSpec(state: S, view: ScreenWorldView): PaintNode[];
}

/** Hit-test helper shared by app reduce() implementations.
 *
 *  Precedence when rects overlap: the rects object preserves insertion
 *  (string-key) order per the JS spec for non-integer-like keys, and this
 *  function returns the FIRST key (in that iteration order) whose rect
 *  contains the point — i.e. earlier-registered rects win. Callers that
 *  need a specific stacking order should register rects in that order. */
export function hitRect(rects: Record<string, Rect>, px: number, py: number): string | undefined {
  for (const key of Object.keys(rects)) {
    const r = rects[key];
    if (!r) continue;
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
      return key;
    }
  }
  return undefined;
}
