import { TICK_RATE_HZ, type Command, type IWorld } from "@claude-engine/core";

/**
 * The page-side contract for browser-mode harness verification (see
 * docs/PHASE-2.md Scope E). Exposes exactly the same two capabilities a
 * keyboard host has: read via IWorld, mutate via submit(Command) — invariant
 * #4's shape, nothing more. Not a new mutation channel.
 */
export interface WorldforgeHook {
  world: IWorld;
  /** The ONLY sim-affecting capability — standard command ingress. */
  submit(command: Command): void;
  /** Every command submitted through this hook, in order. */
  commandLog(): readonly Command[];
  info: { app: string; tickRateHz: number };
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
  window.__WORLDFORGE__ = hook;
  return hook;
}
