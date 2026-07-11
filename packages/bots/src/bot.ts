import { Rng, type IWorld } from "@claude-engine/core";
import type { CommandIntent } from "@claude-engine/net";

/** Reads IWorld, returns intents. Never touches a Sim (invariant #4 by
 *  construction — a bot has no submit() capability at all). */
export interface BotDriver {
  readonly actor: string;
  act(world: IWorld, tick: number): readonly CommandIntent[];
}

export interface BotContext {
  rng: Rng;
  memory: Record<string, unknown>;
  actor: string;
}

export type BotBehavior = (
  world: IWorld,
  tick: number,
  ctx: BotContext
) => readonly CommandIntent[];

/** Wraps a BotBehavior closure with its own seeded Rng and scratch memory —
 *  deterministic and headless-harness-friendly (same seed => same intents). */
export function createBot(opts: { actor: string; seed: string; behavior: BotBehavior }): BotDriver {
  const ctx: BotContext = { rng: new Rng(opts.seed), memory: {}, actor: opts.actor };
  return {
    actor: opts.actor,
    act(world: IWorld, tick: number): readonly CommandIntent[] {
      return opts.behavior(world, tick, ctx);
    },
  };
}

/** Emits a fixed set of intents at specific ticks — deterministic scripted
 *  traffic, the bot-driver equivalent of Scenario.commands. */
export function scripted(
  steps: readonly { atTick: number; intents: readonly CommandIntent[] }[]
): BotBehavior {
  const byTick = new Map<number, readonly CommandIntent[]>();
  for (const step of steps) byTick.set(step.atTick, step.intents);
  return (_world: IWorld, tick: number): readonly CommandIntent[] => byTick.get(tick) ?? [];
}

/** Emits a movement intent every `every` ticks in a bot-chosen random
 *  direction. Command types are game vocabulary the engine doesn't know, so
 *  the caller supplies commandType + a payload factory. */
export function randomWalk(opts: {
  commandType: string;
  payloadFor: (dx: number, dz: number) => unknown;
  every?: number; // ticks between moves, default 1
}): BotBehavior {
  const every = opts.every ?? 1;
  const DIRECTIONS: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  return (_world: IWorld, tick: number, ctx: BotContext): readonly CommandIntent[] => {
    if (tick % every !== 0) return [];
    const [dx, dz] = ctx.rng.pick(DIRECTIONS);
    return [{ type: opts.commandType, payload: opts.payloadFor(dx, dz) }];
  };
}
