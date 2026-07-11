import { TICK_MS, type IWorld } from "@claude-engine/core";

/**
 * Fixed-tick host loop contract shared by every renderer-three host.
 *
 * - Drives the fixed-tick sim loop from requestAnimationFrame with an
 *   accumulator (render interpolates between the last two sim states).
 * - Depends only on IWorld — no game-specific knowledge in the host.
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
