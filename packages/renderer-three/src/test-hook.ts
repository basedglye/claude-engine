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

export interface WorldforgeHook {
  world: IWorld;
  /** The ONLY sim-affecting capability — standard command ingress. */
  submit(command: Command): void;
  /** Every command submitted through this hook, in order. */
  commandLog(): readonly Command[];
  info: { app: string; tickRateHz: number };
  /** Present iff the app registered a pointer pipeline (player-fps does). */
  pointer?: SyntheticPointer;
  /** Present iff the app wired tick timing (see sim-tick-ms probe). */
  tickTimings?(): readonly number[];
  /** Present iff `installTestHook` was called with `startPaused: true`. */
  startBarrier?: StartBarrier;
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
    info: { app: opts.app, tickRateHz: opts.tickRateHz ?? TICK_RATE_HZ },
  };
  if (opts.pointer) hook.pointer = opts.pointer;
  if (opts.tickTimings) hook.tickTimings = opts.tickTimings;
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
