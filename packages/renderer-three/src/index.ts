import { TICK_MS, type IWorld } from "@claude-engine/core";

/**
 * Web render host (Phase 1 target — this is a skeleton).
 *
 * Responsibilities, per DESIGN.md:
 * - Drive the fixed-tick sim loop from requestAnimationFrame with an
 *   accumulator (render interpolates between the last two sim states).
 * - Translate browser input into Commands; never mutate sim state directly.
 * - Depend only on IWorld — no game-specific knowledge in the host.
 *
 * Three.js integration lands in Phase 1; this file establishes the host
 * loop contract so game scaffolds can compile against it today.
 */
export interface RenderHostOptions {
  /** Called once per sim tick with commands drained from input. */
  onTick: () => void;
  /** Called once per animation frame with interpolation alpha in [0,1). */
  onRender: (world: IWorld, alpha: number) => void;
}

export function startHostLoop(world: IWorld, opts: RenderHostOptions): () => void {
  let accumulator = 0;
  let last = performance.now();
  let running = true;

  function frame(now: number) {
    if (!running) return;
    accumulator += now - last;
    last = now;
    // Clamp to avoid spiral-of-death after a background tab pause.
    if (accumulator > 250) accumulator = 250;
    while (accumulator >= TICK_MS) {
      opts.onTick();
      accumulator -= TICK_MS;
    }
    opts.onRender(world, accumulator / TICK_MS);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return () => {
    running = false;
  };
}
