import { TICK_RATE_HZ, type Command, type IWorld } from "@claude-engine/core";

/**
 * The page-side contract for browser-mode harness verification (see
 * docs/PHASE-2.md Scope E). Exposes exactly the same two capabilities a
 * keyboard host has: read via IWorld, mutate via submit(Command) — invariant
 * #4's shape, nothing more. Not a new mutation channel.
 */
/**
 * The `renderer-three` side of the synthetic-input contract (see
 * docs/PHASE-H0.md). This package supplies only the slot: it never
 * implements look/click behaviour itself, and stays game-agnostic — the
 * implementation is supplied by whichever app registers a pointer pipeline
 * (e.g. `@claude-engine/player-fps`).
 */
export interface SyntheticPointer {
  /** Simulate pointerlockchange -> locked. */
  lock(): void;
  look(dxPx: number, dyPx: number): void;
  click(): void;
  /** H1b: simulate a click on the focused screen quad at surface UV (u, v),
   *  each in [0, 1]. Present iff the app wired screen-focus support into
   *  its FpsController (see @claude-engine/player-fps) — a game with no
   *  screens simply never sets this, exactly like `pointer` itself being
   *  absent for a game with no player-fps controller at all. */
  screenClick?(u: number, v: number): void;
}

/**
 * A game-agnostic "start paused / release" slot (phase-H0 round-2 review,
 * blocking item 1). `installTestHook({ startPaused: true })` creates one;
 * the app itself is what must honour it by not stepping the sim until
 * `release()` is called — this interface only exposes the control, it has
 * no opinion on what "stepping" means for a given app/host loop. Exists so
 * a harness-driven tick-gated input step (e.g. `downAtTick: 0`) can mean
 * the literal sim tick 0 on every engine/machine, instead of "whatever
 * tick the world has already reached by the time the input script starts"
 * (browser startup latency varies 0-6+ ticks across engines).
 */
export interface StartBarrier {
  /** True once release() has been called. */
  readonly released: boolean;
  /** Release the barrier — the app should now begin stepping the sim. */
  release(): void;
}

/** The focused screen quad's projected axis-aligned pixel rect in the
 *  viewport, plus its texel scale (screen px per surface px, i.e. the
 *  projected quad width / SCREEN_W — see @claude-engine/surface-ui). The
 *  `screen-readability` probe reads this to locate the calibration strip in
 *  a captured screenshot and to check ARCHITECTURE B7's "at least one texel
 *  per glyph pixel" (texelScale >= 1.0) directly, rather than hoping. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  texelScale: number;
}

/**
 * Per-frame render statistics for the `draw-calls` and `frame-time-p95`
 * probes (docs/PHASE-H2.md section 5F). Additive and optional, exactly like
 * `tickTimings`/`screenRect`: this package supplies only the slot, and an
 * app with no interest in the budgets simply never sets it.
 *
 * `drawCalls` is the renderer's own count for the LAST rendered frame
 * (THREE.WebGLRenderer.info.render.calls), not an estimate — a probe that
 * counted meshes instead would report a number the GPU never saw, which is
 * the "a gate can report a number that is not true" trap this project has
 * already paid for once.
 *
 * `frameMsSamples` are wall-clock deltas between consecutive rendered
 * frames, in milliseconds — the thing a player actually feels, and
 * deliberately NOT the sim's per-tick cost (`tickTimings` is that).
 */
export interface FrameStats {
  drawCalls: number;
  frameMsSamples: readonly number[];
}

export interface WorldforgeHook {
  world: IWorld;
  /** The ONLY sim-affecting capability — standard command ingress. */
  submit(command: Command): void;
  /**
   * Called by the app once per sim tick, immediately after `sim.step()`.
   *
   * This exists so the harness can dispatch tick-gated input EXACTLY on the
   * tick it declared. The harness used to poll `world.tick` from out of
   * process and then dispatch over a round trip, which is bounded-late: a
   * key-up gated on tick N could land on N+1, silently gaining or losing a
   * move command. docs/reviews/phase-H0.md round 3 recorded that as debt
   * with a named trigger ("a command landing one tick after its declared
   * gate"), and it fired. Queued steps installed on
   * `window.__WORLDFORGE_TICK_QUEUE__` are drained here, in-page and
   * synchronously, so there is no gap to slip through.
   */
  notifyTick(tick: number): void;
  /** Every command submitted through this hook, in order. */
  commandLog(): readonly Command[];
  info: { app: string; tickRateHz: number };
  /** Present iff the app registered a pointer pipeline (player-fps does). */
  pointer?: SyntheticPointer;
  /** Present iff the app wired tick timing (see sim-tick-ms probe). */
  tickTimings?(): readonly number[];
  /** Present iff `installTestHook` was called with `startPaused: true`. */
  startBarrier?: StartBarrier;
  /** Present iff the app wired render-loop statistics (H2b — the
   *  `draw-calls` / `frame-time-p95` probes). See `FrameStats`. */
  frameStats?(): FrameStats;
  /** Present iff the app wired screen-focus rendering (H1b). This package
   *  supplies only the slot — it stays game-agnostic exactly like `pointer`
   *  and `tickTimings`; the app (e.g. @claude-engine/hotel) supplies the
   *  implementation by reading back its own focused screen quad's projected
   *  bounds. Returns undefined when no screen is currently focused. */
  screenRect?(): ScreenRect | undefined;
}

declare global {
  interface Window {
    __WORLDFORGE__?: WorldforgeHook;
  }
}

/**
 * Sets window.__WORLDFORGE__; wraps the game's submit to record a command
 * log, so a browser session becomes headlessly reproducible via the
 * harness's `--replay` mode (the returned verdict's replay bundle is this
 * log, per docs/PHASE-2.md Scope E).
 */
/** One tick-gated step the harness queued into the page. */
export interface TickQueueEntry {
  atTick: number;
  run(): void;
  done?: boolean;
  error?: string;
}

export function installTestHook(opts: {
  world: IWorld;
  submit: (command: Command) => void;
  app: string;
  tickRateHz?: number;
  pointer?: SyntheticPointer;
  tickTimings?: () => readonly number[];
  /** Create a `startBarrier` the app must honour (see `StartBarrier`).
   *  Opt-in and false by default — a scenario with no tick-gated input
   *  steps never sets this, so the app's step loop is never touched. */
  startPaused?: boolean;
  /** Present iff the app wired screen-focus rendering (see `ScreenRect`). */
  screenRect?: () => ScreenRect | undefined;
  /** Present iff the app wired render-loop statistics (see `FrameStats`). */
  frameStats?: () => FrameStats;
}): WorldforgeHook {
  const log: Command[] = [];
  const hook: WorldforgeHook = {
    world: opts.world,
    submit(command: Command): void {
      log.push(command);
      opts.submit(command);
    },
    commandLog(): readonly Command[] {
      return log;
    },
    notifyTick(tick: number): void {
      // Drain any tick-gated steps the harness queued for this tick or
      // earlier, in queue order, synchronously — see the doc comment on
      // WorldforgeHook.notifyTick for why this is not a poll.
      const w = window as unknown as { __WORLDFORGE_TICK_QUEUE__?: TickQueueEntry[] };
      const queue = w.__WORLDFORGE_TICK_QUEUE__;
      if (!queue || queue.length === 0) return;
      for (const entry of queue) {
        if (entry.done || entry.atTick > tick) continue;
        entry.done = true;
        try {
          entry.run();
        } catch (err) {
          entry.error = String(err);
        }
      }
    },
    info: { app: opts.app, tickRateHz: opts.tickRateHz ?? TICK_RATE_HZ },
  };
  if (opts.pointer) hook.pointer = opts.pointer;
  if (opts.tickTimings) hook.tickTimings = opts.tickTimings;
  if (opts.screenRect) hook.screenRect = opts.screenRect;
  if (opts.frameStats) hook.frameStats = opts.frameStats;
  if (opts.startPaused) {
    let released = false;
    hook.startBarrier = {
      get released(): boolean {
        return released;
      },
      release(): void {
        released = true;
      },
    };
  }
  window.__WORLDFORGE__ = hook;
  return hook;
}
