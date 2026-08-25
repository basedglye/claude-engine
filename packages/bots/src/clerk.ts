import { type IWorld } from "@claude-engine/core";
import type { CommandIntent } from "@claude-engine/net";

import { createBot, type BotContext, type BotDriver } from "./bot.js";

/** An opaque desk decision: a game-supplied intent shape. `bots` never
 *  inspects `payload` — only the game's `decide`/`invert` pair knows it. */
export interface DeskDecision {
  type: string;
  payload: unknown;
}

/**
 * A front-desk clerk bot: on a fixed cadence, asks the game-supplied
 * `decide` callback what the desk-head guest's document/reservation pair
 * resolves to under the RESERVA rule table, then emits that as a
 * `desk.decision`-shaped intent — except when a seeded error roll fires, in
 * which case it emits the *inverted* decision instead.
 *
 * `bots/src` is a purity root with zero hotel imports. `decide` (and the
 * optional `invert`) are how a game hands this bot its own rule table and
 * its own payload shape without `bots` ever knowing what a "reservation" or
 * an "accept" flag look like. This is deliberately the same payload-factory
 * pattern `randomWalk` uses for `payloadFor`.
 *
 * Determinism: the error roll is drawn from this bot's own seeded `Rng`
 * (via `createBot`'s per-bot `ctx.rng`), never from the sim's. Two clerk
 * bots built with the same seed and driven through the same `IWorld`
 * sequence emit identical intent streams; the roll never perturbs, and is
 * never perturbed by, sim randomness.
 */
export function clerkBot(opts: {
  actor: string;
  seed: string;
  /** Game-supplied: evaluate the SAME rule table the sim uses. Returns
   *  undefined when nobody is presenting at the desk head. */
  decide: (world: IWorld) => DeskDecision | undefined;
  /** Game-supplied: flip a correct decision into the wrong one (e.g. invert
   *  an `accept` boolean in the payload). Optional — if omitted, the error
   *  roll is drawn (so the Rng stream is unaffected by whether inversion is
   *  wired up) but never changes what is emitted, since there is nothing to
   *  invert to. */
  invert?: (decision: DeskDecision) => DeskDecision;
  /** 0 = never invert, 1000 = always invert. Values in between invert at
   *  that nominal rate (rolled from this bot's own Rng). Default 0. */
  errorRatePermille?: number;
  /** Decision cadence in ticks. Default 20. */
  everyTicks?: number;
}): BotDriver {
  const errorRatePermille = opts.errorRatePermille ?? 0;
  const everyTicks = opts.everyTicks ?? 20;

  return createBot({
    actor: opts.actor,
    seed: opts.seed,
    behavior: (world: IWorld, tick: number, ctx: BotContext): readonly CommandIntent[] => {
      if (tick % everyTicks !== 0) return [];

      const decision = opts.decide(world);
      if (decision === undefined) return [];

      // Draw the error roll from the bot's OWN seeded Rng, never the sim's,
      // so bot mistakes can never perturb sim randomness. Always drawn on a
      // decision tick (regardless of whether `invert` is wired) so the
      // stream position depends only on decision presence + cadence, not on
      // caller wiring.
      const roll = ctx.rng.int(0, 999);
      const shouldErr = roll < errorRatePermille;

      if (shouldErr && opts.invert) {
        return [opts.invert(decision)];
      }
      return [decision];
    },
  });
}
