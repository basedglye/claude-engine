// Shared front-desk wiring for the Phase H1a headless gates `checkin-rush`
// and `fraud-catch` (docs/PHASE-H1.md, "Exit criteria" gates 2 and 3).
//
// Why this file exists: both gates need the same three things — a clerk
// actor standing at the desk, a `decide` callback that runs the SAME rule
// table the sim runs, and a way to total the ledger — and duplicating them
// across two scenario files is how the two copies drift apart. Nothing
// here is game logic: `decide` only reads the world and returns an intent,
// exactly as `packages/bots`' contract requires (a bot never touches a
// Sim). Everything the sim actually decides still happens inside
// `deskSystem`, behind the one validated `desk.decision` path.
import { H1_RULES, evaluateRules } from "../../apps/hotel/dist-game/sim/rules.js";
import { cellOfMm } from "../../packages/space/dist/index.js";

/** The clerk is a second actor, never "the player" (ARCHITECTURE B9). */
export const CLERK_ACTOR = "clerk";

/**
 * Spawns the clerk: a `player`-component entity (that component is what
 * `game.ts`'s `findActorEntity` resolves an actor string through) parked on
 * the terminal anchor cell, facing the queue head.
 *
 * It has no `collider` and no `navAgent`, so it never moves and never
 * participates in nav — which matters, because the terminal anchor cell is
 * deliberately flush against the desk's FURNITURE row (see
 * packages/interiors/scripts/test.mjs's terminal-anchor property) and is
 * therefore not occupiable by a 300mm-radius *moving* agent.
 *
 * The yaw is not a magic number: `interactSystem` re-validates range AND a
 * +/-30000 mdeg arc on every `interact`, so the clerk must actually be
 * looking at the queue head. It is computed here from the two committed
 * cell positions with the same integer `atan2Mdeg` the sim uses.
 */
export function spawnClerk(sim, floor, atan2Mdeg) {
  const head = floor.desk.queueCells[0];
  const headXMm = head.cx * 250 + 125;
  const headZMm = head.cz * 250 + 125;
  const clerk = sim.spawn();
  sim.setComponent(clerk, "pos", { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
  sim.setComponent(clerk, "prevPos", { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
  const yawMdeg = atan2Mdeg(headXMm - floor.desk.xMm, headZMm - floor.desk.zMm);
  sim.setComponent(clerk, "yaw", { mdeg: yawMdeg });
  sim.setComponent(clerk, "prevYaw", { mdeg: yawMdeg });
  sim.setComponent(clerk, "player", { actor: CLERK_ACTOR });
  return clerk;
}

/** IWorld exposes `entities()` + `getComponent` only (no `withComponent`),
 *  so every lookup below is an ascending-entity-id scan — deterministic by
 *  construction, which is the point. */
function scan(world, component) {
  const out = [];
  for (const entity of world.entities()) {
    const c = world.getComponent(entity, component);
    if (c !== undefined) out.push([entity, c]);
  }
  return out;
}

/**
 * The clerk's brain, as a `decide` callback for `clerkBot`.
 *
 * Two-step cadence, because check-in is two sim commands:
 *   1. nobody presenting -> `interact` the queue head (only once it has
 *      physically ARRIVED at queue slot 0; `interactSystem` range-checks).
 *   2. somebody presenting -> evaluate `H1_RULES` over that guest's own
 *      document components and their reservation's fields, and submit
 *      `desk.decision`.
 *
 * `accept` is *only* "the rule table found no violation". Room vacancy is
 * NOT folded into the accept/deny decision — a full hotel means the same
 * accept is re-submitted on the next cadence tick and `deskSystem` no-ops
 * it until a room frees (that is check-in serialising behind checkout, and
 * it is what lets 8 guests share 4 rooms). Folding vacancy into `accept`
 * would turn "no room right now" into a *fraud* verdict and fire
 * `desk.falseDeny`.
 */
export function makeDecide(grid, floor) {
  const head = floor.desk.queueCells[0];
  return (world) => {
    const hotel = scan(world, "hotel")[0]?.[1];
    if (!hotel) return undefined;

    const guests = scan(world, "guest");
    const presenting = guests.find(([, g]) => g.state === "presenting");
    if (presenting) {
      const [guestEntity] = presenting;
      const found = scan(world, "reservation").find(
        ([, r]) => r.guestEntity === guestEntity && !r.decided
      );
      if (!found) return undefined;
      const [reservationEntity, res] = found;
      const docs = scan(world, "document")
        .filter(([, d]) => d.ownerEntity === guestEntity)
        .map(([, d]) => ({ docType: d.docType, fields: d.fields }));
      const violations = evaluateRules(H1_RULES, docs, res.fields, { day: hotel.day, lists: {} });
      const accept = violations.length === 0;
      const vacant = scan(world, "roomUnit").find(([, r]) => r.occupantEntity === 0);
      return {
        type: "desk.decision",
        payload: { reservationEntity, accept, roomEntity: vacant ? vacant[0] : undefined },
      };
    }

    const waiting = guests.find(([entity, g]) => {
      if (g.state !== "queued" || g.queueIndex !== 0) return false;
      const pos = world.getComponent(entity, "pos");
      if (!pos) return false;
      const cell = cellOfMm(grid, pos.xMm, pos.zMm);
      return cell.cx === head.cx && cell.cz === head.cz;
    });
    if (waiting) return { type: "interact", payload: { target: waiting[0] } };
    return undefined;
  };
}

/** "Always wrong" for `clerkBot`'s error roll: flip the accept flag, and
 *  ONLY that. An `interact` (step 1 above) is not a verdict and is passed
 *  through untouched — inverting it would mean the erroring clerk simply
 *  never talks to anybody, which is a different failure than the one
 *  `fraud-catch` run B is testing (accept the fraud, deny the clean). */
export function invertDecision(decision) {
  if (decision.type !== "desk.decision") return decision;
  return { ...decision, payload: { ...decision.payload, accept: !decision.payload.accept } };
}

/** Double-entry totals straight off the `ledgerEntry` components. */
export function ledgerTotals(sim) {
  const perPair = new Map();
  let charges = 0;
  let expenses = 0;
  for (const [, e] of sim.withComponent("ledgerEntry")) {
    const key = `${e.debitAccount}->${e.creditAccount}`;
    perPair.set(key, (perPair.get(key) ?? 0) + e.amountMinor);
    if (e.creditAccount === "revenue:rooms") charges += e.amountMinor;
    if (e.debitAccount.startsWith("expense:")) expenses += e.amountMinor;
  }
  return { perPair, charges, expenses };
}
