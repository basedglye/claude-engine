// Phase H1a exit gate 3, "fraud-catch" -- RUN A (docs/PHASE-H1.md, "Exit
// criteria"). 6 guests, fraud rate 500 permille planted through
// `rules.ts`'s `plantViolation`, worked by `clerkBot` with
// `errorRatePermille: 0` (a perfect clerk), 2400 ticks, headless.
//
// WHY TWO FILES RATHER THAN TWO RUNS FROM ONE. The gate is specified as
// two runs, and the obvious thing to want is one module exporting both.
// The harness loader does not support that: `loadScenario` in
// packages/harness/src/cli.ts takes `mod.default ?? mod.scenario` and
// nothing else, `resolveScenarioPath` maps a bare name straight to
// `scenarios/<name>.scenario.mjs`, and there is no variant/selector flag
// in `parseArgs`. Inventing a `fraud-catch:runB` syntax would mean
// changing the harness CLI, which is not this lane's contract. So run B
// lives in `fraud-catch-b.scenario.mjs`, and everything the two runs
// share -- config, clerk wiring, the derived planted-fraud count -- is
// imported from this file so the pair cannot drift.
//
// DERIVATION of PLANTED_FRAUD_COUNT. A throwaway node script (scratchpad,
// outside the repo) ran this exact seed and config with NO clerk at all,
// so no reservation is ever decided and `cleanupSystem` never despawns
// one, then dumped every `reservation` component's `plantedViolations`
// after all 6 guests had spawned. For seed "hotel-h1-fraud-1":
//   reservation 18 (guest 15): []
//   reservation 22 (guest 19): ["res-code-mismatch"]
//   reservation 26 (guest 23): []
//   reservation 29 (guest 27): ["res-slip-missing"]
//   reservation 33 (guest 30): []
//   reservation 37 (guest 34): []
// => exactly 2 of the 6 guests carry a planted violation. (500 permille
// is a per-guest coin flip off `forkRng("guest-fraud")`, not a quota, so
// 2-of-6 is this seed's draw, not 3.)
//
// A second script then ran the full run-A wiring for 2400 ticks and
// printed the event histogram:
//   guest.arrived 6 (ticks 100, 189, 328, 437, 537, 630)
//   guest.presenting 6, guest.checkedIn 4 (ticks 150, 380, 590, 680)
//   guest.denied 2, desk.fraudCaught 2, desk.fraudMissed 0,
//   desk.falseDeny 0, guest.checkedOut 4, guest.left 6, nav.stuck 0.
// The fraudCaught count matching the independently-derived planted count
// is the property this gate exists to prove.
import { setupWithConfig, DEFAULTS } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { atan2Mdeg } from "../packages/space/dist/index.js";
import { clerkBot } from "../packages/bots/dist/index.js";
import { CLERK_ACTOR, spawnClerk, makeDecide, invertDecision } from "./lib/hotel-desk.mjs";

export const SEED = "hotel-h1-fraud-1";
export const TICKS = 2400;
export const GUEST_COUNT = 6;
/** Derived, not guessed -- see the header's derivation block. */
export const PLANTED_FRAUD_COUNT = 2;

export const floor = generateGroundFloor(SEED);
export const grid = floor.grid;

export const CONFIG = {
  ...DEFAULTS,
  guestCount: GUEST_COUNT,
  spawnTickMin: 100,
  fraudRatePermille: 500,
  fixture: "normal",
};

export function setupFraud(sim) {
  setupWithConfig(sim, CONFIG);
  spawnClerk(sim, floor, atan2Mdeg);
}

/** Both runs differ in exactly one number, so they are built the same way. */
export function makeClerk(errorRatePermille) {
  return clerkBot({
    actor: CLERK_ACTOR,
    seed: `${SEED}-clerk`,
    decide: makeDecide(grid, floor),
    invert: invertDecision,
    errorRatePermille,
    everyTicks: 5,
  });
}

const eventsOfType = (s, type) => s.eventsSince(0).filter((e) => e.type === type);

export default {
  name: "fraud-catch",
  seed: SEED,
  ticks: TICKS,
  setup: setupFraud,
  bots: [makeClerk(0)],
  assertions: [
    {
      description: `desk.fraudCaught count === the planted violation count for this seed (${PLANTED_FRAUD_COUNT}), and it is non-zero`,
      check: (s) =>
        PLANTED_FRAUD_COUNT > 0 && eventsOfType(s, "desk.fraudCaught").length === PLANTED_FRAUD_COUNT,
    },
    {
      description: "every desk.fraudCaught names at least one violation flag",
      check: (s) =>
        eventsOfType(s, "desk.fraudCaught").every(
          (e) => Array.isArray(e.payload.violations) && e.payload.violations.length > 0
        ),
    },
    {
      description: "zero desk.fraudMissed",
      check: (s) => eventsOfType(s, "desk.fraudMissed").length === 0,
    },
    {
      description: "zero desk.falseDeny (the perfect clerk never denies clean papers)",
      check: (s) => eventsOfType(s, "desk.falseDeny").length === 0,
    },
    {
      description:
        "the clerk actually worked the whole line: all 6 guests presented, and checkedIn + denied === 6",
      check: (s) => {
        const presenting = eventsOfType(s, "guest.presenting").length;
        const checkedIn = eventsOfType(s, "guest.checkedIn").length;
        const denied = eventsOfType(s, "guest.denied").length;
        return presenting === GUEST_COUNT && checkedIn + denied === GUEST_COUNT;
      },
    },
    {
      description: "every denied guest reached guest.left",
      check: (s) => {
        const denied = eventsOfType(s, "guest.denied").map((e) => e.payload.guestEntity);
        if (denied.length !== PLANTED_FRAUD_COUNT) return false;
        const left = new Set(eventsOfType(s, "guest.left").map((e) => e.payload.guestEntity));
        return denied.every((g) => left.has(g));
      },
    },
    {
      description: "zero nav.stuck events",
      check: (s) => s.eventsSince(0).every((e) => e.type !== "nav.stuck"),
    },
  ],
};
