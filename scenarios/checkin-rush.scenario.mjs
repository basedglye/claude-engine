// Phase H1a exit gate 2, "checkin-rush" (docs/PHASE-H1.md, "Exit
// criteria"). 8 guests arriving over ticks 100-900 into a 4-bedroom
// hotel, worked by `clerkBot` with a zero error rate, over 2400 ticks.
// Headless, against the same compiled sim module the browser app runs.
//
// 8 GUESTS, 4 ROOMS -- WHAT ACTUALLY HAPPENS, AND WHY IT IS DELIBERATE.
// All 8 do check in, serialised behind checkout: the first four take the
// four rooms almost immediately, sit out their stay, check out (freeing
// their `roomUnit`), and the four still waiting in the queue are then
// admitted. Nobody is structurally turned away, because `clerkBot`'s
// `decide` (scenarios/lib/hotel-desk.mjs) never folds room vacancy into
// the accept/deny verdict -- a full hotel just means `deskSystem` no-ops
// the accept and the clerk re-submits it on the next cadence tick.
// Folding vacancy into `accept` would report "no room right now" as a
// FRAUD verdict and fire `desk.falseDeny`.
//
// That behaviour is tuned, not stumbled into. `STAY_TICKS` in
// apps/hotel/src/sim/game.ts is 1600 (it was 500), chosen against this
// gate's fixed numbers so that both halves of the assertion set have
// something real to check: short enough that the room pool turns over and
// all 8 guests get in, long enough that the run does NOT end with an
// empty hotel -- at 500 the last guest had left by ~tick 1500 and the
// occupancy-consistency and guest-is-in-their-room assertions were
// comparing 0 against 0, the exact hardcoded-`[]` vacuity H0's review
// round 1 rejected. See that constant's comment for the arithmetic.
//
// DERIVATION. A throwaway node script (scratchpad, outside the repo)
// imported the built packages/interiors dist and printed
// generateGroundFloor("hotel-h1-rush-1"), then imported
// apps/hotel/dist-game/sim/game.js plus packages/bots/dist, ran this exact
// setup + bot wiring for 2400 ticks and printed the event histogram, the
// per-event tick lists, every guest's final state/room/cell/`roomAt`, the
// hotel singleton and every `ledgerEntry`. Key derived facts for seed
// "hotel-h1-rush-1":
//   - grid 48x41; the desk terminal anchor is at (1375,3625) mm = cell
//     (5,14); the desk FURNITURE row is cz 13; the 8 queue cells are
//     (2..9, 11); the four bedrooms are entities 8..11 with roomIds 3,4,5,6.
//   - `guest.arrived` at ticks 100, 234, 314, 367, 497, 572, 640, 737 --
//     i.e. the spec's "8 guests over ticks 100-900" window.
//   - `guest.checkedIn` at ticks 170, 295, 380, 430 (the first four rooms)
//     then 1775, 1900, 1985, 2035 (the same four rooms, re-let after the
//     first four guests check out at stay-end). 8 in total.
//   - final state: 4 guests `inRoom`, 4 `roomUnit`s occupied, each guest
//     standing inside the room its `roomEntity` names (checked through
//     space's `roomAt` against the generated rooms map), 4 `guest.left`.
//   - ledger: one account pair only, "cash->revenue:rooms", 52000 minor
//     (8 charges: 5000 for a tier-1 room, 8000 for tier-2), and
//     `hotel.cash` == 52000 == 0 opening + 52000 charges - 0 expenses.
//     Expenses are 0 because DAY_TICKS is 6000, so this 2400-tick run
//     never crosses a day rollover -- `economySystem` posts nothing and
//     `econ.audit` never fires. The debits-equal-credits check below is
//     still real (it re-totals every `ledgerEntry` component from
//     scratch); the expense term is simply zero for this run's length.
//   - zero `nav.stuck` for the whole run (4 `nav.yield`s -- guests do
//     contend around the queue, and the yield rule resolves it).
//
// `perf.avgTickMs` is REPORTED by the verdict, never asserted (assertions
// see the Sim, not the verdict) -- the review gate reads it against the
// spec's <= 2 ms headless budget.
import { setupWithConfig, DEFAULTS } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { atan2Mdeg, roomAt } from "../packages/space/dist/index.js";
import { clerkBot } from "../packages/bots/dist/index.js";
import {
  CLERK_ACTOR,
  spawnClerk,
  makeDecide,
  invertDecision,
  ledgerTotals,
} from "./lib/hotel-desk.mjs";

const SEED = "hotel-h1-rush-1";
const TICKS = 2400;
const GUEST_COUNT = 8;
/** Opening cash: `setupWithConfig` starts the hotel singleton at 0. */
const OPENING_CASH_MINOR = 0;

const floor = generateGroundFloor(SEED);
const grid = floor.grid;

const CONFIG = {
  ...DEFAULTS,
  guestCount: GUEST_COUNT,
  spawnTickMin: 100,
  fraudRatePermille: 0,
  fixture: "normal",
  // H2a: this is an H1 gate. Housekeeping is pinned OFF here — the gate's
  // 8-guests-through-4-rooms turnover (and STAY_TICKS, tuned against it)
  // is H1 behaviour, and letting an H2 content change dirty the rooms
  // would silently re-tune it. zen-clean and one-man-week verify the
  // shipped default (true) instead.
  upkeep: false,
};

function setupRush(sim) {
  setupWithConfig(sim, CONFIG);
  spawnClerk(sim, floor, atan2Mdeg);
}

const clerk = clerkBot({
  actor: CLERK_ACTOR,
  seed: `${SEED}-clerk`,
  decide: makeDecide(grid, floor),
  invert: invertDecision,
  errorRatePermille: 0,
  // 5 rather than the 20-tick default: check-in is two commands (interact
  // the queue head, then decide), so the cadence sets how fast the line
  // moves. At 20 the eight-guest queue did not clear inside 2400 ticks.
  everyTicks: 5,
});

/** roomId of the `roomUnit` an entity id names. */
function roomIdOf(s, roomEntity) {
  const unit = s.getComponent(roomEntity, "roomUnit");
  return unit ? unit.roomId : undefined;
}

export default {
  name: "checkin-rush",
  seed: SEED,
  ticks: TICKS,
  setup: setupRush,
  bots: [clerk],
  assertions: [
    {
      description: `exactly ${GUEST_COUNT} guest.checkedIn events (all 8 guests get a room, serialised behind checkout)`,
      check: (s) => s.eventsSince(0).filter((e) => e.type === "guest.checkedIn").length === GUEST_COUNT,
    },
    {
      description:
        "occupancy consistency: the number of occupied roomUnits equals the number of guests in state inRoom, and both are non-zero",
      check: (s) => {
        const occupied = [...s.withComponent("roomUnit")].filter(([, r]) => r.occupantEntity !== 0);
        const inRoom = [...s.withComponent("guest")].filter(([, g]) => g.state === "inRoom");
        if (occupied.length === 0) return false; // never let this pass vacuously
        if (occupied.length !== inRoom.length) return false;
        // ...and they are the SAME guests, not merely the same count.
        const occupants = new Set(occupied.map(([, r]) => r.occupantEntity));
        return inRoom.every(([entity]) => occupants.has(entity));
      },
    },
    {
      description:
        "every guest still checked in is physically inside the room its roomEntity names (via space.roomAt)",
      check: (s) => {
        const inRoom = [...s.withComponent("guest")].filter(([, g]) => g.state === "inRoom");
        if (inRoom.length === 0) return false;
        return inRoom.every(([entity, guest]) => {
          const pos = s.getComponent(entity, "pos");
          if (!pos || guest.roomEntity === 0) return false;
          return roomAt(floor.rooms, grid, pos.xMm, pos.zMm) === roomIdOf(s, guest.roomEntity);
        });
      },
    },
    {
      description:
        "ledger balances: every ledgerEntry is a debit/credit pair that nets to zero per account pair, and hotel.cash === opening + charges - expenses",
      check: (s) => {
        const entries = [...s.withComponent("ledgerEntry")];
        if (entries.length === 0) return false;
        // Double entry: re-total the pair both ways round. Every entry
        // credits exactly one account for exactly what it debits another,
        // so the signed sum over all accounts must be exactly zero.
        const byAccount = new Map();
        for (const [, e] of entries) {
          if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0) return false;
          if (e.debitAccount === e.creditAccount) return false;
          byAccount.set(e.debitAccount, (byAccount.get(e.debitAccount) ?? 0) + e.amountMinor);
          byAccount.set(e.creditAccount, (byAccount.get(e.creditAccount) ?? 0) - e.amountMinor);
        }
        let net = 0;
        for (const v of byAccount.values()) net += v;
        if (net !== 0) return false;

        const { charges, expenses } = ledgerTotals(s);
        const hotel = [...s.withComponent("hotel")][0]?.[1];
        if (!hotel) return false;
        return hotel.cash === OPENING_CASH_MINOR + charges - expenses;
      },
    },
    {
      description:
        "the ledger agrees with the events: one econ-bearing ledgerEntry per guest.checkedIn, and charges > 0",
      check: (s) => {
        const events = s.eventsSince(0);
        const checkedIn = events.filter((e) => e.type === "guest.checkedIn").length;
        const charges = [...s.withComponent("ledgerEntry")].filter(
          ([, e]) => e.creditAccount === "revenue:rooms"
        );
        const total = charges.reduce((sum, [, e]) => sum + e.amountMinor, 0);
        return charges.length === checkedIn && total > 0;
      },
    },
    {
      description: "zero nav.stuck events",
      check: (s) => s.eventsSince(0).every((e) => e.type !== "nav.stuck"),
    },
    {
      description: "no guest was ever denied and no false-deny fired (fraud rate is 0 in this gate)",
      check: (s) =>
        s
          .eventsSince(0)
          .every((e) => e.type !== "guest.denied" && e.type !== "desk.falseDeny"),
    },
  ],
};
