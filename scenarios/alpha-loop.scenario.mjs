// GRAND FOYER alpha cycle 1 exit gate, "alpha-loop" (apps/hotel/docs/alpha-loop
// briefs/W1-sim-tier-renovate.md §4.7). Fourteen in-game days — 84,000
// ticks — played end to end by the owner bot with `renovate: true`: the
// same desk/hire/clean/repair/rate loop `one-man-week` proves, plus
// pressing LEDGER's RENOVATE button whenever it is actually affordable and
// chasing PRICER's new ceiling after each renovation.
//
// This is the gate that proves the goal sentence in §1: the hotel tier is
// a real sim fact, RENOVATE is a real one-press action, and demand/rate
// ceiling actually scale with it — end to end, from a Motel earning
// family-only bookings to a Grand Foyer that has unlocked the business
// segment.
//
// WHAT THE BOT IS AND IS NOT (see scenarios/lib/hotel-owner.mjs): it reads
// IWorld and returns intents. Every action is the same command a human
// produces — `face`/`move` to walk, `interact` to open a door or take a
// guest's papers, `screen.click` at coordinates derived from
// `hotelShell.layout()` to work the terminal, including the RENOVATE
// click. No teleports, no component writes, no privileged commands.
// `--verify-replay` re-runs the RECORDED command log against a fresh sim
// with no bot code involved at all.
//
// DERIVED FACTS for seed "hotel-alpha-loop-1", from a scratch run of this
// exact config (re-derive by running the bot and reading the verdict
// JSON's assertion detail / event histogram): the hotel renovates to tier
// 1 partway through the first week and to tier 2 (Grand Foyer) within the
// 14-day run, business-segment arrivals begin only after the tier-2
// renovation, and the hotel closes the run solvent.
import { setupWithConfig, DEFAULTS, PLAYER_ENTITY } from "../apps/hotel/dist-game/sim/game.js";
import { RENOVATE_COST_MINOR } from "../apps/hotel/dist-game/sim/economy.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { makeOwnerBot, scan } from "./lib/hotel-owner.mjs";

const SEED = "hotel-alpha-loop-1";
/** 14 days at 6,000 ticks/day. */
const TICKS = 84_000;
const DAYS = 14;

const floor = generateGroundFloor(SEED);
const grid = floor.grid;

const CONFIG = {
  ...DEFAULTS,
  arrivals: "demand",
  upkeep: true,
  startingCashMinor: 0,
};

function setupAlphaLoop(sim) {
  setupWithConfig(sim, CONFIG);
}

const ownerBot = makeOwnerBot({
  floor,
  grid,
  playerEntity: PLAYER_ENTITY,
  // One scheduled owner decision, same beat one-man-week exercises: drop
  // the tier-1 rate a step on day 2 so PRICER's down path is proven live
  // as well as its up path (exercised continuously by `renovate`'s
  // rate-chasing once a tier unlocks a higher ceiling).
  schedule: [{ day: 2, action: "set-rate-down" }],
  renovate: true,
});

function eventsOfType(sim, type) {
  return sim.eventsSince(0).filter((e) => e.type === type);
}

export default {
  name: "alpha-loop",
  seed: SEED,
  ticks: TICKS,
  setup: setupAlphaLoop,
  bots: [ownerBot],
  assertions: [
    {
      description: `exactly ${DAYS} night audits closed`,
      check: (s) => eventsOfType(s, "econ.audit").length === DAYS,
    },
    {
      description: "exactly two hotel.renovated events, to tier 1 then tier 2 in that order",
      check: (s) => {
        const events = eventsOfType(s, "hotel.renovated");
        return (
          events.length === 2 &&
          events[0].payload.to === 1 &&
          events[1].payload.to === 2
        );
      },
    },
    {
      description: "the hotel ends at tier 2",
      check: (s) => {
        const hotel = scan(s, "hotel")[0];
        return hotel !== undefined && hotel[1].tier === 2;
      },
    },
    {
      description: "the hotel is solvent at the end of the run (cash > 0)",
      check: (s) => {
        const hotel = scan(s, "hotel")[0];
        return hotel !== undefined && hotel[1].cash > 0;
      },
    },
    {
      description: "no business-segment guest arrives before the tier-2 renovation, and at least one arrives after",
      check: (s) => {
        const events = s.eventsSince(0);
        const renoIdx = events.findIndex((e) => e.type === "hotel.renovated" && e.payload.to === 2);
        if (renoIdx < 0) return false;
        const businessArrivals = events
          .map((e, i) => ({ e, i }))
          .filter(({ e }) => e.type === "guest.arrived" && e.payload.segment === "business");
        if (businessArrivals.length === 0) return false;
        const anyBefore = businessArrivals.some(({ i }) => i < renoIdx);
        const anyAfter = businessArrivals.some(({ i }) => i > renoIdx);
        return !anyBefore && anyAfter;
      },
    },
    {
      description: "the money gate was actually felt: a renovation was preceded by an insufficient-cash denial, or some closed day's audit shows closing cash below the next tier's cost",
      check: (s) => {
        const events = s.eventsSince(0);
        const firstRenoIdx = events.findIndex((e) => e.type === "hotel.renovated");
        if (firstRenoIdx < 0) return false;
        const deniedBefore = events
          .slice(0, firstRenoIdx)
          .some((e) => e.type === "screen.denied" && e.payload?.reason === "insufficient-cash");
        if (deniedBefore) return true;
        // Derived from real history, not assumed: every night's audit
        // records that night's closing cash (econ.audit.closingCashMinor).
        // The gate was actually felt if at least one audit BEFORE the
        // first renovation closed with less cash than tier 1 costs — the
        // hotel opens at startingCashMinor: 0, so this is expected to be
        // true from night one, and would go false (this assertion would
        // then need the screen.denied branch instead) only if the numbers
        // changed enough to make tier 1 affordable on day one.
        const audits = eventsOfType(s, "econ.audit");
        return audits.some(
          (a) => a.tick < events[firstRenoIdx].tick && a.payload.closingCashMinor < RENOVATE_COST_MINOR[1],
        );
      },
    },
    {
      description: "zero nav.stuck events across the whole run",
      check: (s) => eventsOfType(s, "nav.stuck").length === 0,
    },
    {
      description: "roomUnit.messCount agrees with a live mess scan for every room",
      check: (s) => {
        const actual = new Map();
        for (const [, mess] of scan(s, "mess")) {
          actual.set(mess.roomEntity, (actual.get(mess.roomEntity) ?? 0) + 1);
        }
        return scan(s, "roomUnit").every(([entity, room]) => room.messCount === (actual.get(entity) ?? 0));
      },
    },
    {
      description: "the ledger balances: every entry is a debit/credit pair netting to zero, and at least one expense:capex entry exists",
      check: (s) => {
        const entries = scan(s, "ledgerEntry").map(([, e]) => e);
        if (entries.length === 0) return false;
        const byAccount = new Map();
        for (const e of entries) {
          if (!Number.isInteger(e.amountMinor)) return false;
          byAccount.set(e.debitAccount, (byAccount.get(e.debitAccount) ?? 0) + e.amountMinor);
          byAccount.set(e.creditAccount, (byAccount.get(e.creditAccount) ?? 0) - e.amountMinor);
        }
        let net = 0;
        for (const v of byAccount.values()) net += v;
        const hasCapex = entries.some((e) => e.debitAccount === "expense:capex" && e.amountMinor > 0);
        return net === 0 && hasCapex;
      },
    },
  ],
};
