// Phase H1a exit gate 3, "fraud-catch" -- RUN B (docs/PHASE-H1.md, "Exit
// criteria"): the same seed, config and 2400-tick budget as run A, with
// `clerkBot`'s `errorRatePermille` at 1000 -- every verdict inverted.
//
// See `fraud-catch.scenario.mjs`'s header for why this is a second FILE
// rather than a second export: the harness loader resolves a bare
// scenario name to exactly one module with exactly one default-exported
// Scenario, and has no variant flag. Everything shared (seed, config,
// setup, clerk factory, the derived planted-fraud count) is imported from
// run A so the two runs cannot drift apart.
//
// WHAT "ALWAYS WRONG" MEANS HERE. `clerkBot` applies its error roll by
// calling the caller-supplied `invert`; ours (scenarios/lib/hotel-desk.mjs)
// flips the `accept` boolean and nothing else. So at 1000 permille the
// clerk accepts every set of forged papers and denies every clean one --
// which is the *fraudMissed* direction the spec's run B asks for, plus
// `falseDeny` on the clean guests as a side effect. An `interact` (the
// clerk's other intent) is passed through uninverted: inverting it would
// mean the erroring clerk simply never talks to anybody, which is a
// different failure than the one this run is testing.
//
// DERIVATION (same method as run A: a throwaway node script running this
// exact wiring for 2400 ticks and printing the event histogram). Seed
// "hotel-h1-fraud-1", errorRatePermille 1000:
//   guest.arrived 6, guest.presenting 6
//   desk.fraudMissed 2  (the 2 planted guests -- both let in)
//   guest.checkedIn 2   (at ticks 245 and 490: the SAME two guests)
//   desk.falseDeny 4, guest.denied 4 (the 4 clean guests -- all turned away)
//   guest.checkedOut 2, guest.left 6, nav.stuck 0.
// The point of the run is the last line of the spec's gate: the
// failure path is a real path, not a crash.
import fraudCatchA, {
  SEED,
  TICKS,
  GUEST_COUNT,
  PLANTED_FRAUD_COUNT,
  setupFraud,
  makeClerk,
} from "./fraud-catch.scenario.mjs";

// Referenced purely so this module fails loudly if run A's default export
// ever stops being the scenario these two runs share.
if (fraudCatchA.seed !== SEED) {
  throw new Error("fraud-catch-b: run A's scenario no longer uses the shared seed");
}

const eventsOfType = (s, type) => s.eventsSince(0).filter((e) => e.type === type);

export default {
  name: "fraud-catch-b",
  seed: SEED,
  ticks: TICKS,
  setup: setupFraud,
  bots: [makeClerk(1000)],
  assertions: [
    {
      description: "at least one desk.fraudMissed (the always-wrong clerk waves forged papers through)",
      check: (s) => eventsOfType(s, "desk.fraudMissed").length >= 1,
    },
    {
      description: `every planted violation was missed (desk.fraudMissed === ${PLANTED_FRAUD_COUNT}) and none was caught`,
      check: (s) =>
        eventsOfType(s, "desk.fraudMissed").length === PLANTED_FRAUD_COUNT &&
        eventsOfType(s, "desk.fraudCaught").length === 0,
    },
    {
      description:
        "guests whose fraud was missed still reach guest.checkedIn: every desk.fraudMissed is accompanied by a guest.checkedIn on the same tick",
      check: (s) => {
        const missed = eventsOfType(s, "desk.fraudMissed");
        if (missed.length === 0) return false;
        const checkedInTicks = eventsOfType(s, "guest.checkedIn").map((e) => e.tick);
        return missed.every((e) => checkedInTicks.includes(e.tick));
      },
    },
    {
      description:
        "the failure path is a real path, not a crash: all 6 guests presented, checkedIn + denied === 6, and every guest eventually left",
      check: (s) => {
        const presenting = eventsOfType(s, "guest.presenting").length;
        const checkedIn = eventsOfType(s, "guest.checkedIn").length;
        const denied = eventsOfType(s, "guest.denied").length;
        const left = eventsOfType(s, "guest.left").length;
        return (
          presenting === GUEST_COUNT && checkedIn + denied === GUEST_COUNT && left === GUEST_COUNT
        );
      },
    },
    {
      description: "the clean guests were falsely denied (desk.falseDeny === guests - planted)",
      check: (s) =>
        eventsOfType(s, "desk.falseDeny").length === GUEST_COUNT - PLANTED_FRAUD_COUNT,
    },
    {
      description: "zero nav.stuck events",
      check: (s) => s.eventsSince(0).every((e) => e.type !== "nav.stuck"),
    },
  ],
};
