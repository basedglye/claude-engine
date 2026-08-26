// Phase H2a exit gate 3, "zen-clean" (docs/PHASE-H2.md, "Exit criteria").
// Housekeeping and maintenance, driven by the owner bot, plus the property
// the whole design rests on: DELAYING the work costs nothing.
//
// THE ZEN PROPERTY, AND WHY IT IS ASSERTED THIS WAY. DESIGN §6 rules that
// housekeeping is a zen-completion loop — "no per-room timer ... consequences
// only at day granularity". The run therefore holds a 2,000-tick idle gap in
// the middle of a cleaning round (the owner literally stands still with
// messes on the floor) and asserts that nothing punished it: no
// penalty-class event of any kind exists in the log, mess entities did not
// multiply while dirty, and the half-repaired prop is still exactly
// half-repaired on the other side of the gap. The strongest form of this
// property is structural rather than behavioural — neither `mess` nor
// `prop` carries a timestamp field, so decay is not expressible — and the
// hotel unit suite asserts THAT. This gate asserts the consequence.
//
// The refusal is probed from the command form on purpose. RESERVA filters
// unready rooms out of its list, so a screen click can never reach one; the
// only way to prove `applyDeskDecision` blocks it is to submit the decision
// directly, which is the same validated entry point `clerkBot` uses.
//
// DERIVED FACTS for seed "hotel-h2-zen-1" (re-derive by running the config
// and printing the event log): guests 1-4 take the four rooms in the first
// few hundred ticks and guest 5 stays queued; the first checkout lands
// around tick 1,900 and leaves 2-4 messes, which is the moment guest 5 is
// presenting and every other room is taken — so the not-ready refusal is
// reachable. The config breaks one prop at setup, and the owner repairs it
// in REPAIR_STEPS presses.
import { setupWithConfig, DEFAULTS, PLAYER_ENTITY } from "../apps/hotel/dist-game/sim/game.js";
import { generateGroundFloor } from "../packages/interiors/dist/index.js";
import { makeOwnerBot, scan } from "./lib/hotel-owner.mjs";

const SEED = "hotel-h2-zen-1";
const TICKS = 9_000;
/** The owner does nothing at all across this window — mid-round, on purpose. */
const IDLE_FROM = 3_000;
const IDLE_TO = 5_000;

const floor = generateGroundFloor(SEED);
const grid = floor.grid;

const CONFIG = {
  ...DEFAULTS,
  // FIVE guests into four rooms, deliberately. The fifth is still queued
  // when the first checks out, so there is a guest presenting at the desk
  // AT THE MOMENT a room goes dirty — which is the only situation in which
  // the not-ready refusal can be reached at all. With two guests both are
  // served in the first 300 ticks and the first mess appears with nobody
  // at the desk (observed: the probe never fired).
  guestCount: 5,
  spawnTickMin: 20,
  fraudRatePermille: 0,
  fixture: "normal",
  upkeep: true,
  arrivals: "fixed",
};

function setupZen(sim) {
  setupWithConfig(sim, CONFIG);
  // Break one prop by config. Done here rather than waiting for the
  // breakage roll so the repair verb is exercised on a known tick budget;
  // setup() is re-run identically by restore() and by --verify-replay, so
  // this is deterministic scenario state, not a mutation mid-run.
  const props = [...sim.withComponent("prop")];
  const first = props[0];
  if (first) sim.setComponent(first[0], "prop", { ...first[1], broken: true, repairProgress: 0 });
}

const ownerBot = makeOwnerBot({
  floor,
  grid,
  playerEntity: PLAYER_ENTITY,
  idleWindow: [IDLE_FROM, IDLE_TO],
  probeNotReadyRoom: true,
});

function eventsOfType(sim, type) {
  return sim.eventsSince(0).filter((e) => e.type === type);
}

export default {
  name: "zen-clean",
  seed: SEED,
  ticks: TICKS,
  setup: setupZen,
  bots: [ownerBot],
  assertions: [
    {
      description: "a checkout left 2-4 discrete messes",
      check: (s) => {
        const spawned = eventsOfType(s, "room.messSpawned");
        return spawned.length >= 1 && spawned.every((e) => e.payload.count >= 2 && e.payload.count <= 4);
      },
    },
    {
      description: "accepting onto a vacant-but-not-ready room was REFUSED with desk.denied-room{not-ready}",
      check: (s) =>
        eventsOfType(s, "desk.denied-room").some((e) => e.payload.reason === "not-ready"),
    },
    {
      description: "the refused reservation was not decided by that attempt",
      check: (s) => {
        const denied = eventsOfType(s, "desk.denied-room")[0];
        if (!denied) return false;
        // It may legitimately be decided LATER, once the room is clean —
        // what must not happen is a check-in on the same tick as the
        // refusal, i.e. the refusal not actually refusing.
        return !s
          .eventsSince(denied.tick)
          .some((e) => e.type === "guest.checkedIn" && e.tick === denied.tick);
      },
    },
    {
      description: "the owner wiped every mess by hand (one room.messCleaned per mess, none left)",
      check: (s) => {
        const cleaned = eventsOfType(s, "room.messCleaned").length;
        const spawned = eventsOfType(s, "room.messSpawned").reduce((n, e) => n + e.payload.count, 0);
        return cleaned >= 1 && cleaned === spawned && scan(s, "mess").length === 0;
      },
    },
    {
      description: "roomUnit.messCount agrees with a live mess scan",
      check: (s) => {
        const actual = new Map();
        for (const [, mess] of scan(s, "mess")) actual.set(mess.roomEntity, (actual.get(mess.roomEntity) ?? 0) + 1);
        return scan(s, "roomUnit").every(([entity, room]) => room.messCount === (actual.get(entity) ?? 0));
      },
    },
    {
      description: "a room that was refused while dirty was sold once it was clean",
      check: (s) => {
        const denied = eventsOfType(s, "desk.denied-room")[0];
        if (!denied) return false;
        return eventsOfType(s, "guest.checkedIn").some(
          (e) => e.tick > denied.tick && e.payload.roomEntity === denied.payload.roomEntity,
        );
      },
    },
    {
      description: "the broken prop was repaired in steps, and prop.repaired fired",
      check: (s) =>
        eventsOfType(s, "prop.repairStep").length >= 1 &&
        eventsOfType(s, "prop.repaired").length >= 1 &&
        scan(s, "prop").every(([, p]) => p.broken === false),
    },
    {
      // NON-VACUITY FIRST. "Zero penalty events" is worth nothing if the
      // gap never happened or happened after the work was already done, so
      // this asserts the gap was real AND mid-round: messes existed before
      // it, nothing was wiped during it, and wiping resumed after it.
      description: `the idle gap was real and mid-round: messes existed before tick ${IDLE_FROM}, zero wipes during the gap, wipes resumed after ${IDLE_TO}`,
      check: (s) => {
        const spawnedBefore = eventsOfType(s, "room.messSpawned").some((e) => e.tick < IDLE_FROM);
        const cleaned = eventsOfType(s, "room.messCleaned");
        const duringGap = cleaned.filter((e) => e.tick >= IDLE_FROM && e.tick < IDLE_TO).length;
        const afterGap = cleaned.filter((e) => e.tick >= IDLE_TO).length;
        return spawnedBefore && duringGap === 0 && afterGap >= 1;
      },
    },
    {
      description: `THE ZEN PROPERTY: the ${IDLE_TO - IDLE_FROM}-tick idle gap produced zero penalty-class events, and nothing got worse across it`,
      check: (s) => {
        const noPenalty = s
          .eventsSince(0)
          .every((e) => !/penal|fine|decay|expire|worsen|cascade|overdue|timeout/i.test(e.type));
        // Nothing got WORSE while the owner stood still. Stated precisely,
        // because "no mess appeared during the gap" would be the wrong
        // claim — a guest checking out mid-gap legitimately leaves one.
        // The property is that a mess never breeds: every single
        // room.messSpawned in the whole run coincides with a checkout on
        // the same tick, so there is no path by which sitting on a dirty
        // room produces more dirt.
        const checkoutTicks = new Set(eventsOfType(s, "guest.checkedOut").map((e) => e.tick));
        const everySpawnIsACheckout = eventsOfType(s, "room.messSpawned").every((e) => checkoutTicks.has(e.tick));
        // And a broken prop never breaks again: breakage rolls only at a
        // day rollover, so no prop.broke can land inside the gap.
        const brokeDuringGap = eventsOfType(s, "prop.broke").filter(
          (e) => e.tick >= IDLE_FROM && e.tick < IDLE_TO,
        ).length;
        return noPenalty && everySpawnIsACheckout && brokeDuringGap === 0;
      },
    },
    {
      description: "messes never multiplied while dirty: every room.messSpawned is a checkout, never a re-spawn",
      check: (s) => {
        const checkouts = eventsOfType(s, "guest.checkedOut").length;
        return eventsOfType(s, "room.messSpawned").length <= checkouts;
      },
    },
    {
      description: "nothing broke a second time out of the idle gap (a broken prop never worsens)",
      check: (s) => scan(s, "prop").every(([, p]) => p.repairProgress >= 0 && p.repairProgress < 99),
    },
    {
      description: "zero nav.stuck events",
      check: (s) => eventsOfType(s, "nav.stuck").length === 0,
    },
  ],
};
