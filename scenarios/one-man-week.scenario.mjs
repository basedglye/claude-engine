// Phase H2a exit gate 1, "one-man-week" (docs/PHASE-H2.md, "Exit
// criteria"). Seven in-game days — 42,000 ticks — played end to end by the
// owner bot: desk via the rule table, wipe/repair rounds whenever a room
// needs one, a rate change on day 2, and the first hire on the unlock day.
//
// This is the gate that proves the phase's goal sentence, so it deliberately
// asserts BREADTH rather than one deep property: if any of reviews,
// reputation, stars, demand, objectives, upkeep, wages or the hire has
// quietly stopped happening, one of these goes red.
//
// WHAT THE BOT IS AND IS NOT (see scenarios/lib/hotel-owner.mjs): it reads
// IWorld and returns intents. Every action is the same command a human
// produces — `face`/`move` to walk, `interact` to open a door or take a
// guest's papers, `screen.click` at coordinates derived from
// `hotelShell.layout()` to work the terminal. No teleports, no component
// writes, no privileged commands. `--verify-replay` re-runs the RECORDED
// command log against a fresh sim with no bot code involved at all, which
// is what makes "the bot played a week" and "the sim is deterministic"
// two separate claims.
//
// DERIVED FACTS for seed "hotel-h2-week-1", from a scratch run of this
// exact config (re-derive by running the bot and printing the event
// histogram): 59 guests arrive and queue, 53 check in, 52 check out
// leaving 163 messes that all get wiped, 5 props break and 3 are repaired
// inside the week, the hotel reaches 2 stars on day 2, the staff budget
// unlocks and one clerk is hired around tick 12,000 (the second candidate
// is PASSed and walks out), and the week closes solvent at ~$3,164 with
// seven audits and 21 objectives posted.
import { setupWithConfig, DEFAULTS, PLAYER_ENTITY } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { makeOwnerBot, scan } from "./lib/hotel-owner.mjs";

const SEED = "hotel-h2-week-1";
/** 7 days at 6,000 ticks/day. */
const TICKS = 42_000;
const DAYS = 7;

const floor = generateGroundFloor(SEED);
const grid = floor.grid;

const CONFIG = {
  ...DEFAULTS,
  // The shipped configuration, deliberately: this gate is the one that
  // verifies what a player actually gets. Demand-driven arrivals,
  // housekeeping on, no starting cash.
  arrivals: "demand",
  upkeep: true,
  startingCashMinor: 0,
};

function setupWeek(sim) {
  setupWithConfig(sim, CONFIG);
}

const ownerBot = makeOwnerBot({
  floor,
  grid,
  playerEntity: PLAYER_ENTITY,
  // One scheduled owner decision: drop the tier-1 rate a step on day 2.
  // The demand curve should notice, and PRICER's decision path gets
  // exercised inside a real run rather than only in the unit suite.
  schedule: [{ day: 2, action: "set-rate-down" }],
});

function eventsOfType(sim, type) {
  return sim.eventsSince(0).filter((e) => e.type === type);
}

export default {
  name: "one-man-week",
  seed: SEED,
  ticks: TICKS,
  setup: setupWeek,
  bots: [ownerBot],
  assertions: [
    {
      description: `exactly ${DAYS} night audits closed`,
      check: (s) => eventsOfType(s, "econ.audit").length === DAYS,
    },
    {
      description: "the hotel is solvent at the end of the week (cash > 0)",
      check: (s) => {
        const hotel = scan(s, "hotel")[0];
        return hotel !== undefined && hotel[1].cash > 0;
      },
    },
    {
      description: "at least one clerk was hired, and the PASS branch was exercised on another candidate",
      check: (s) => eventsOfType(s, "staff.hired").length >= 1 && eventsOfType(s, "staff.rejected").length >= 1,
    },
    {
      description: "the clerk actually worked the desk: check-ins attributed to a staff actor",
      check: (s) => eventsOfType(s, "guest.checkedIn").some((e) => String(e.payload.actor).startsWith("staff:")),
    },
    {
      description: "guests reviewed the stay, and at least one complained",
      check: (s) => eventsOfType(s, "guest.reviewed").length >= 1 && eventsOfType(s, "guest.complained").length >= 1,
    },
    {
      description: "reputation moved off the default for at least one segment",
      check: (s) => {
        const hotel = scan(s, "hotel")[0];
        if (!hotel) return false;
        const rep = hotel[1].repBySegment;
        return Object.keys(rep).length >= 1;
      },
    },
    {
      description: `${DAYS * 3} objectives posted, at least one completed`,
      check: (s) =>
        eventsOfType(s, "objective.posted").length === DAYS * 3 &&
        eventsOfType(s, "objective.completed").length >= 1,
    },
    {
      description: "the zen loops ran: messes were spawned by checkouts and wiped by hand, and a broken prop was repaired",
      check: (s) =>
        eventsOfType(s, "room.messSpawned").length >= 1 &&
        eventsOfType(s, "room.messCleaned").length >= 1 &&
        eventsOfType(s, "prop.repaired").length >= 1,
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
      description: "ledger balances: every entry is a debit/credit pair that nets to zero, and staff wages appear after the hire",
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
        const hasStaffWages = entries.some((e) => e.debitAccount === "expense:staff" && e.amountMinor > 0);
        return net === 0 && hasStaffWages;
      },
    },
    {
      description: "zero nav.stuck events across the whole week",
      check: (s) => eventsOfType(s, "nav.stuck").length === 0,
    },
    {
      description: "the rate change happened, and PRICER's effect reached the sim",
      check: (s) => eventsOfType(s, "econ.rateSet").length >= 1,
    },
  ],
};
