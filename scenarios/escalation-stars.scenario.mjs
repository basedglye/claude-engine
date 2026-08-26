// Phase H2a exit gate 4, "escalation-stars" (docs/PHASE-H2.md, "Exit
// criteria" and §10). The difficulty curve, end to end: reviews become a
// star tier, the star tier activates a rule row, MAILBOX delivers the list
// that row reads, and the desk then catches a fraud that was IMPOSSIBLE to
// plant a day earlier.
//
// THE CONTROL, AND WHAT IT ACTUALLY DISCRIMINATES. The blacklist row needs
// two separate things before it can be violated: the star tier must have
// activated it (minStars 2) and its list must be non-empty. The first draft
// of this gate ran with an EMPTY list before the bulletin, which confounded
// the two — deleting the star filter entirely left the gate green, because
// the empty list was excluding the row anyway. Caught by perturbation, and
// fixed by seeding the list at setup:
//
//   ticks 400-6,000   list non-empty, 1 star  -> excluded by minStars ALONE
//   ticks 6,000+      list non-empty, 2 stars -> plantable, and caught
//
// So the pre-tier control below discriminates exactly one thing — the star
// gate — and goes red if `rulesForStars` stops filtering. The other gate,
// "a listed/absent row with an EMPTY list is unplantable", is discriminated
// in the hotel unit suite, where restoring H1a's sentinel reproduces the
// original bug and reds the round-trip property.
//
// The bulletin still does its real job here and is asserted: mid-run it
// APPENDS a second name to the live list, and it takes effect at delivery
// while the mail announcing it is still unread.
//
// The reviews that earn the second star are seeded at setup rather than
// played out: earning them would take a clean week, and what this gate is
// about is what HAPPENS at 2 stars, not how you get there (one-man-week
// covers that). Everything downstream — the audit's recompute, the
// bulletin, the planting filter, the desk's evaluation — is the real code.
//
// DERIVED FACTS for seed "hotel-h2-stars-1" (re-derive by running the
// config and printing the event log): the day-1 audit at tick 6,000 raises
// the hotel to 2 stars; `mailSystem` delivers a blacklist bulletin naming
// "Alex Rivera" at the tick-12,000 rollover (day 3); guests arrive densely from
// tick 400 at a 100% fraud rate, so every one of them carries exactly one
// planted violation and the owner denies every one of them.
import { setupWithConfig, DEFAULTS, PLAYER_ENTITY } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { H1_RULES } from "../apps/hotel/dist-game/sim/rules.js";
import { makeOwnerBot, scan } from "./lib/hotel-owner.mjs";

const SEED = "hotel-h2-stars-1";
const TICKS = 30_000;
/** The rollover at which the seeded reviews become 2 stars. */
const STAR_TICK = 6_000;
/** Seeded onto the blacklist at setup — a real name from the archetype
 *  pool, so it is a name that can actually walk through the door. */
const SEEDED_BLACKLIST_NAME = "Casey Nguyen";

const floor = generateGroundFloor(SEED);
const grid = floor.grid;

const CONFIG = {
  ...DEFAULTS,
  guestCount: 60,
  spawnTickMin: 400,
  // Every guest carries a planted violation, so the sample of planted rows
  // is as large as the run allows and the blacklist row's share of it is
  // not left to a handful of coin flips.
  fraudRatePermille: 1000,
  fixture: "normal",
  upkeep: true,
  arrivals: "fixed",
  spawnIntervalMinTicks: 150,
  spawnIntervalMaxTicks: 250,
};

function setupEscalation(sim) {
  setupWithConfig(sim, CONFIG);
  // Seed the reviews that earn the second star at the day-1 audit. Real
  // `review` components, read by the same rolling-window recompute the
  // audit runs on reviews guests leave — nothing about the star math is
  // stubbed.
  for (let i = 0; i < 5; i++) {
    const entity = sim.spawn();
    sim.setComponent(entity, "review", { day: 1, segment: "business", score: 5, factors: [] });
  }
  // Seed the blacklist BEFORE the tier that reads it exists. This is what
  // makes the pre-tier control discriminate the STAR gate rather than the
  // empty-list gate — see the header.
  const listEntity = sim.spawn();
  sim.setComponent(listEntity, "noticeList", { listId: "blacklist", values: [SEEDED_BLACKLIST_NAME] });
}

const ownerBot = makeOwnerBot({
  floor,
  grid,
  playerEntity: PLAYER_ENTITY,
  // The owner works the desk at zero error, exactly like `clerkBot` at
  // errorRatePermille 0: it evaluates the same rule table the sim does and
  // denies anything the table flags. No hire in this gate — a clerk with a
  // skill roll would put a coin flip between the rule row and the catch.
  enable: { hire: false, clean: false, repair: false },
});

function eventsOfType(sim, type) {
  return sim.eventsSince(0).filter((e) => e.type === type);
}

const BLACKLIST_ROW = H1_RULES.find((r) => r.id === "blacklist");

export default {
  name: "escalation-stars",
  seed: SEED,
  ticks: TICKS,
  setup: setupEscalation,
  bots: [ownerBot],
  assertions: [
    {
      description: `the audit raised the hotel to 2 stars (hotel.starsChanged {1 -> 2}) at tick ${STAR_TICK}`,
      check: (s) => {
        const changed = eventsOfType(s, "hotel.starsChanged");
        return (
          changed.length === 1 &&
          changed[0].payload.from === 1 &&
          changed[0].payload.to === 2 &&
          changed[0].tick === STAR_TICK
        );
      },
    },
    {
      description: "the hotel is still at 2 stars at the end (the tier is recomputed every audit, not latched)",
      check: (s) => {
        const hotel = scan(s, "hotel")[0];
        return hotel !== undefined && hotel[1].stars === 2;
      },
    },
    {
      description: "MAILBOX delivered a blacklist bulletin, and APPENDED its name to the live list",
      check: (s) => {
        const delivered = eventsOfType(s, "mail.bulletinDelivered");
        if (delivered.length < 1) return false;
        const list = scan(s, "noticeList").find(([, l]) => l.listId === "blacklist");
        if (!list) return false;
        // Appended, not replaced: the name seeded at setup is still there.
        return (
          list[1].values.includes(SEEDED_BLACKLIST_NAME) &&
          list[1].values.includes(delivered[0].payload.name) &&
          list[1].values.length >= 2
        );
      },
    },
    {
      description: "the bulletin is READABLE mail as well as live rule data (a mail{kind:'bulletin'} names the same person)",
      check: (s) => {
        const delivered = eventsOfType(s, "mail.bulletinDelivered")[0];
        if (!delivered) return false;
        return scan(s, "mail").some(
          ([, m]) => m.kind === "bulletin" && (m.fields.names ?? "").includes(delivered.payload.name),
        );
      },
    },
    {
      description: "the bulletin took effect at DELIVERY, not on read: the mail is still unread and the row is already live",
      check: (s) => {
        const delivered = eventsOfType(s, "mail.bulletinDelivered")[0];
        if (!delivered) return false;
        const bulletinMail = scan(s, "mail").find(([, m]) => m.kind === "bulletin");
        if (!bulletinMail || bulletinMail[1].read) return false;
        // ...and a blacklist violation was nevertheless caught afterwards.
        return eventsOfType(s, "desk.fraudCaught").some(
          (e) => e.tick > delivered.tick && e.payload.violations.includes(BLACKLIST_ROW.failFlag),
        );
      },
    },
    {
      description: `CONTROL (the STAR gate): the list was already non-empty before tick ${STAR_TICK}, yet the blacklist row was never planted and never flagged`,
      check: (s) => {
        const before = s.eventsSince(0).filter((e) => e.tick <= STAR_TICK);
        const planted = before.some(
          (e) =>
            (e.type === "desk.fraudCaught" || e.type === "desk.fraudMissed") &&
            (e.payload.plantedViolations ?? []).includes(BLACKLIST_ROW.failFlag),
        );
        const flagged = before.some(
          (e) =>
            (e.type === "desk.fraudCaught" || e.type === "desk.fraudMissed") &&
            (e.payload.violations ?? []).includes(BLACKLIST_ROW.failFlag),
        );
        return !planted && !flagged;
      },
    },
    {
      description: `CONTROL IS NOT VACUOUS: plenty of OTHER violations were planted and caught before tick ${STAR_TICK}`,
      check: (s) => eventsOfType(s, "desk.fraudCaught").filter((e) => e.tick <= STAR_TICK).length >= 5,
    },
    {
      description: `after the tier opened at tick ${STAR_TICK}, the blacklist row WAS planted — a row that was inactive minutes earlier`,
      check: (s) =>
        eventsOfType(s, "desk.fraudCaught").some(
          (e) => e.tick > STAR_TICK && (e.payload.plantedViolations ?? []).includes(BLACKLIST_ROW.failFlag),
        ),
    },
    {
      description: "and the desk CAUGHT it: the evaluated violation is exactly the blacklist flag, on a guest whose name is on the list",
      check: (s) => {
        const list = scan(s, "noticeList").find(([, l]) => l.listId === "blacklist");
        if (!list) return false;
        return eventsOfType(s, "desk.fraudCaught").some(
          (e) =>
            e.tick > STAR_TICK &&
            JSON.stringify(e.payload.violations) === JSON.stringify([BLACKLIST_ROW.failFlag]) &&
            (e.payload.plantedViolations ?? []).includes(BLACKLIST_ROW.failFlag),
        );
      },
    },
    {
      description: "zero false denies: the owner never denied a guest the rule table cleared",
      check: (s) => eventsOfType(s, "desk.falseDeny").length === 0,
    },
    {
      description: "zero nav.stuck events",
      check: (s) => eventsOfType(s, "nav.stuck").length === 0,
    },
  ],
};
