// Phase H2a exit gate 2, "first-hire" (docs/PHASE-H2.md, "Exit criteria"
// and §8). The phase's payload beat, and the gate that proves "unaided"
// STRUCTURALLY rather than by inspection.
//
// WHAT "UNAIDED" MEANS HERE, AND WHY IT IS PROVABLE. The hired clerk
// submits `interact` and `desk.decision` as actor `staff:<entity>`, through
// the same `interactSystem` and `deskSystem` the player's own input
// reaches — there is no clerk-only code path and no relaxed validation. So
// the claim "the clerk ran the desk by itself" reduces to facts on the
// record, all asserted below: after `staff.hired` there is not one desk
// decision attributed to "player", the check-ins and the fraud catch carry
// `staff:*` attribution, and the owner is physically outside the desk
// radius at the end. The owner's absence is ENFORCED, not assumed — the bot
// is given a walk-away cell and stands down from the desk entirely the
// moment a clerk exists.
//
// One honest qualification, asserted rather than glossed: the player DOES
// touch one screen after the hire, the STAFF app, to PASS the second
// candidate. That is hiring, not desk work. The gate says so explicitly and
// asserts the precise thing that must hold instead — no other app is ever
// opened again, and once hiring is settled the terminal is untouched.
//
// Config pins opening cash above HIRE_THRESHOLD_MINOR so the day-1 audit
// unlocks the staff budget, and pins the guest schedule to start after the
// hire, so every check-in in the run is necessarily the clerk's.
//
// DERIVED FACTS for seed "hotel-h2-hire-1" (re-derive by running the config
// and printing the event log): the day-1 audit lands at tick 6,000 and
// unlocks the budget; `mailSystem` posts the applications mail and prints
// two resumes on the same tick; both candidates walk in and reach "waiting"
// by ~tick 6,020; the owner interviews and hires the first and PASSes the
// second, which then walks out; guests begin arriving at tick 6,200 and are
// worked entirely by the clerk.
import { setupWithConfig, DEFAULTS, PLAYER_ENTITY } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { makeOwnerBot, scan } from "./lib/hotel-owner.mjs";

const SEED = "hotel-h2-hire-1";
const TICKS = 14_000;
/** HIRE_THRESHOLD_MINOR is $600.00; open above it so day 1 unlocks. */
const STARTING_CASH_MINOR = 70_000;

const floor = generateGroundFloor(SEED);
const grid = floor.grid;

const CONFIG = {
  ...DEFAULTS,
  guestCount: 8,
  // After the hire, deliberately: every check-in in this run is the
  // clerk's, because there is no guest for the owner to serve before it.
  spawnTickMin: 6_200,
  fraudRatePermille: 500,
  fixture: "normal",
  upkeep: true,
  arrivals: "fixed",
  startingCashMinor: STARTING_CASH_MINOR,
};

/** Where the owner goes to be visibly out of the way: the lobby spawn cell,
 *  which is nowhere near the desk. Derived from the floor, not guessed. */
const AWAY_CELL = {
  cx: Math.floor(floor.spawn.xMm / 250),
  cz: Math.floor(floor.spawn.zMm / 250),
};

function setupHire(sim) {
  setupWithConfig(sim, CONFIG);
}

const ownerBot = makeOwnerBot({
  floor,
  grid,
  playerEntity: PLAYER_ENTITY,
  afterHireCell: AWAY_CELL,
  // The owner does not clean or repair in this gate: the point is to
  // isolate the desk, and a cleaning round would put the owner back in
  // motion for reasons unrelated to what is being proved.
  enable: { clean: false, repair: false },
});

function eventsOfType(sim, type) {
  return sim.eventsSince(0).filter((e) => e.type === type);
}

function hireTick(sim) {
  const hired = eventsOfType(sim, "staff.hired")[0];
  return hired ? hired.tick : undefined;
}

export default {
  name: "first-hire",
  seed: SEED,
  ticks: TICKS,
  setup: setupHire,
  bots: [ownerBot],
  assertions: [
    {
      description: "the day-1 audit unlocked the staff budget",
      check: (s) => eventsOfType(s, "econ.hireUnlocked").length === 1,
    },
    {
      description: "two resumes PRINTED as real document entities in the tray",
      check: (s) => {
        const printed = eventsOfType(s, "printer.printed");
        if (printed.length !== 2) return false;
        // Two DISTINCT documents were printed...
        const ids = new Set(printed.map((e) => e.payload.documentEntity));
        if (ids.size !== 2 || !printed.every((e) => e.payload.docType === "resume")) return false;
        // ...and a printed resume is a real object in the world, not a log
        // line: it has a position and its full field set. The REJECTED
        // candidate takes theirs with them when they leave, so the surviving
        // one is the hire's — checking "both still exist" would assert the
        // opposite of the intended cleanup.
        const resumes = scan(s, "document").filter(([, d]) => d.docType === "resume");
        if (resumes.length !== 1) return false;
        const [resumeEntity, resume] = resumes[0];
        return (
          ids.has(resumeEntity) &&
          resume.fields.name !== undefined &&
          resume.fields.wageAsk !== undefined &&
          resume.fields.skill !== undefined &&
          resume.fields.quirk !== undefined &&
          s.getComponent(resumeEntity, "pos") !== undefined
        );
      },
    },
    {
      description: "candidates walked in and waited in person, and an interview started",
      check: (s) =>
        eventsOfType(s, "staff.candidateArrived").length === 2 &&
        eventsOfType(s, "staff.interviewStarted").length >= 1,
    },
    {
      description: "exactly one clerk was hired, through the STAFF app, by the player",
      check: (s) => {
        const hired = eventsOfType(s, "staff.hired");
        return hired.length === 1 && hired[0].payload.actor === "player" && scan(s, "staffed").length === 1;
      },
    },
    {
      description: "the PASS branch was covered: the second candidate was rejected and left",
      check: (s) =>
        eventsOfType(s, "staff.rejected").length >= 1 && eventsOfType(s, "staff.candidateLeft").length >= 1,
    },
    {
      description: "the hire became a second ACTOR (actorId staff:<entity>), not a special case",
      check: (s) => {
        const staff = scan(s, "staffed")[0];
        if (!staff) return false;
        const actorId = s.getComponent(staff[0], "actorId");
        return actorId !== undefined && actorId.actor === `staff:${staff[0]}`;
      },
    },
    {
      // UNAIDED, asserted on the record rather than by inspection.
      //
      // Asserting on EVENTS rather than on the command array is deliberate:
      // assertions are evaluated against a sim rebuilt from the recorded
      // log during `--verify-replay`, so an event-based claim is checked
      // twice — once live, once on the replayed sim — while a claim about
      // the command array would only ever be checked against itself.
      description: "UNAIDED: after the hire, zero desk decisions attributed to \"player\"",
      check: (s) => {
        const at = hireTick(s);
        if (at === undefined) return false;
        const deskTypes = new Set([
          "guest.checkedIn",
          "guest.denied",
          "desk.fraudCaught",
          "desk.fraudMissed",
          "desk.falseDeny",
          "desk.denied-room",
        ]);
        return !s.eventsSince(at + 1).some((e) => deskTypes.has(e.type) && e.payload.actor === "player");
      },
    },
    {
      // The narrower half of the same claim, stated honestly. The player
      // DOES touch one screen after the hire — the STAFF app, to PASS the
      // second candidate — and pretending otherwise would be a fake
      // assertion. What must be true is that they never open a working
      // screen again, and that once hiring is settled they stop touching
      // the terminal at all.
      description: "after the hire the player opens only STAFF, and after the last hiring decision, no screen at all",
      check: (s) => {
        const at = hireTick(s);
        if (at === undefined) return false;
        const afterHire = s.eventsSince(at + 1);
        const openedSomethingElse = afterHire.some(
          (e) => e.type === "screen.appOpened" && e.payload.actor === "player" && e.payload.appId !== "staff",
        );
        if (openedSomethingElse) return false;
        const hiringDone = Math.max(
          at,
          ...eventsOfType(s, "staff.rejected").map((e) => e.tick),
          ...eventsOfType(s, "staff.hired").map((e) => e.tick),
        );
        return !s
          .eventsSince(hiringDone + 1)
          .some(
            (e) =>
              (e.type === "screen.appOpened" || e.type === "screen.actionTaken") && e.payload.actor === "player",
          );
      },
    },
    {
      description: "the clerk checked at least 2 guests in, all attributed to staff:*",
      check: (s) => {
        const at = hireTick(s);
        if (at === undefined) return false;
        const checkIns = eventsOfType(s, "guest.checkedIn");
        return (
          checkIns.length >= 2 &&
          checkIns.every((e) => String(e.payload.actor).startsWith("staff:")) &&
          checkIns.every((e) => e.tick > at)
        );
      },
    },
    {
      description: "the clerk caught at least one planted fraud, attributed to staff:*",
      check: (s) =>
        eventsOfType(s, "desk.fraudCaught").some(
          (e) => String(e.payload.actor).startsWith("staff:") && e.payload.plantedViolations.length > 0,
        ),
    },
    {
      description: "the owner physically walked away from the desk and is not standing at it",
      check: (s) => {
        const pos = s.getComponent(PLAYER_ENTITY, "pos");
        if (!pos) return false;
        const dx = pos.xMm - floor.desk.xMm;
        const dz = pos.zMm - floor.desk.zMm;
        // Outside the desk decision radius (1500mm), by a clear margin.
        return dx * dx + dz * dz > 2500 * 2500;
      },
    },
    {
      description: "zero nav.stuck events",
      check: (s) => eventsOfType(s, "nav.stuck").length === 0,
    },
  ],
};
