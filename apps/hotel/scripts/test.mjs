// Unit tests for apps/hotel's sim/rules.ts, run against the built
// dist-game/ (npm run test builds via build:game first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs's style
// (PASS:/FAIL: lines, process.exit(1) on any failure) rather than pulling in
// a test framework.
import { Rng, Sim } from "@claude-engine/core";
import { findOverflowingNodes } from "@claude-engine/surface-ui";
import { generateGroundFloor } from "@claude-engine/interiors";
import {
  H1_RULES,
  evaluateRules,
  plantViolation,
  plantableRules,
  rulesForStars,
  describeRule,
} from "../dist-game/sim/rules.js";
import { ARCHETYPES } from "../dist-game/sim/guests.js";
import { reservaApp } from "../dist-game/sim/reserva-app.js";
import { auditApp } from "../dist-game/sim/audit-app.js";
import {
  setupWithConfig,
  DEFAULTS,
  PLAYER_ENTITY,
  interactCommand,
  deskDecisionCommand,
  screenClickCommand,
  hotelShell,
  buildScreenWorldView,
  HOTEL_APPS,
  pricerSetRateCommand,
  staffHireCommand,
  renovateCommand,
} from "../dist-game/sim/game.js";
import { jitter } from "../dist-game/sim/nav.js";
import {
  scoreReview,
  reputationBySegment,
  overallReputation,
  starsFromReputation,
  MAX_STARS,
  DEFAULT_REP_PERMILLE,
} from "../dist-game/sim/reviews.js";
import {
  capturePermille,
  arrivalsForDay,
  generateObjectives,
  isValidRate,
  isValidRateForHotelTier,
  maxRateForHotelTier,
  OBJECTIVE_KINDS,
  SEGMENT_POOL,
  SEGMENT_MIN_HOTEL_TIER,
  MIN_RATE_MINOR,
  MAX_RATE_MINOR,
  MAX_RATE_BY_TIER_MINOR,
  MAX_HOTEL_TIER,
  RENOVATE_COST_MINOR,
  RENOVATE_STAR_REQ,
  RATE_STEP_MINOR,
  CHARGEBACK_ACCOUNT,
} from "../dist-game/sim/economy.js";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

function cleanDocs() {
  return [
    { docType: "id", fields: { name: "Alex Rivera", docNumber: "X123", expiresDay: "500" } },
    { docType: "resSlip", fields: { guestName: "Alex Rivera", resCode: "RC-9001" } },
  ];
}

function cleanRes() {
  return { guestName: "Alex Rivera", resCode: "RC-9001" };
}

const ctx = { day: 100, lists: {} };
/** The fixture blacklist the H2a `listed` rows are planted and evaluated
 *  against. Contains the clean fixture's own guest name plus decoys, so
 *  planting has a real value to choose and evaluation has a real list to
 *  miss. */
const BLACKLIST_FIXTURE = ["Vex Harrow", "Ines Calloway", "Ruben Tasse"];
const ctxWithBlacklist = { day: 100, lists: { blacklist: BLACKLIST_FIXTURE } };

/**
 * An Rng whose FIRST pick() returns a chosen rule and whose every other
 * draw is the real seeded stream. Lets the round-trip property force one
 * specific row while still handing `plantViolation` the FULL rule table —
 * which matters, because the planter's cross-row propagation (keeping a
 * planted blacklist name from also breaking `name-match`) is driven by that
 * table. The old single-row-table trick silently removed the very rows the
 * propagation has to see.
 */
function forcedRng(rule, seed) {
  const real = new Rng(seed);
  let firstPick = true;
  return {
    pick(arr) {
      if (firstPick) {
        firstPick = false;
        return rule;
      }
      return real.pick(arr);
    },
    int(min, max) {
      return real.int(min, max);
    },
  };
}

// --- H1_RULES shape ----------------------------------------------------
{
  check("H1_RULES has >= 5 rows", H1_RULES.length >= 5);
  const kinds = new Set(H1_RULES.map((r) => r.check.kind));
  check(
    "H1_RULES uses only the four spec'd check kinds",
    [...kinds].every((k) => ["fieldMatch", "docPresent", "notExpired", "listed"].includes(k)),
  );
  check("H1_RULES has docPresent(id)", H1_RULES.some((r) => r.check.kind === "docPresent" && r.check.docType === "id"));
  check(
    "H1_RULES has docPresent(resSlip)",
    H1_RULES.some((r) => r.check.kind === "docPresent" && r.check.docType === "resSlip"),
  );
  check("H1_RULES has a fieldMatch on guest name", H1_RULES.some((r) => r.check.kind === "fieldMatch" && r.check.docField === "name"));
  check(
    "H1_RULES has a fieldMatch on reservation code",
    H1_RULES.some((r) => r.check.kind === "fieldMatch" && r.check.docField === "resCode"),
  );
  check("H1_RULES has a notExpired on the ID", H1_RULES.some((r) => r.check.kind === "notExpired" && r.check.docType === "id"));
  // H2a appends the blacklist row at minStars 2 — the first row the star
  // tier actually gates. Everything H1 shipped stays at 1.
  check(
    "the rule table is H1's five minStars-1 rows plus exactly one minStars-2 row (H2a's blacklist)",
    H1_RULES.filter((r) => r.minStars === 1).length === 5 &&
      H1_RULES.filter((r) => r.minStars === 2).length === 1 &&
      H1_RULES.filter((r) => r.minStars === 2)[0].id === "blacklist",
  );
  const ids = new Set(H1_RULES.map((r) => r.id));
  check("H1_RULES ids are unique", ids.size === H1_RULES.length);
  const flags = new Set(H1_RULES.map((r) => r.failFlag));
  check("H1_RULES failFlags are unique", flags.size === H1_RULES.length);
  check("describeRule returns a non-empty string for every row", H1_RULES.every((r) => typeof describeRule(r) === "string" && describeRule(r).length > 0));
}

// --- clean docs evaluate to [] ------------------------------------------
{
  const flags = evaluateRules(H1_RULES, cleanDocs(), cleanRes(), ctx);
  check("a clean document pair evaluates to []", Array.isArray(flags) && flags.length === 0);
}

// --- multiple simultaneous violations, table order -----------------------
{
  const docs = cleanDocs();
  // Remove the ID doc entirely (fails id-present AND name-match AND
  // id-not-expired, since all three read the "id" doc) and also break the
  // res-code match.
  const noId = docs.filter((d) => d.docType !== "id");
  const res = { ...cleanRes(), resCode: "WRONG-CODE" };
  const flags = evaluateRules(H1_RULES, noId, res, ctx);
  const expectedOrder = H1_RULES.filter((r) => flags.includes(r.failFlag)).map((r) => r.failFlag);
  check("multiple simultaneous violations return all flags in table order", JSON.stringify(flags) === JSON.stringify(expectedOrder));
  check("multiple simultaneous violations includes id-missing", flags.includes("id-missing"));
  check("multiple simultaneous violations includes res-code-mismatch", flags.includes("res-code-mismatch"));
  check(
    "an absent document does not cascade into name-mismatch/id-expired (those rows pass when the doc is simply gone)",
    !flags.includes("name-mismatch") && !flags.includes("id-expired"),
  );
  check("multiple simultaneous violations count is exactly 2 (id-missing, res-code-mismatch)", flags.length === 2);
}

// --- notExpired boundary --------------------------------------------------
{
  const docs = cleanDocs();
  docs[0].fields.expiresDay = "100"; // == ctx.day
  const flagsEq = evaluateRules(H1_RULES, docs, cleanRes(), ctx);
  check("notExpired: expiresDay == day passes (not expired)", !flagsEq.includes("id-expired"));

  docs[0].fields.expiresDay = "99"; // < ctx.day
  const flagsBelow = evaluateRules(H1_RULES, docs, cleanRes(), ctx);
  check("notExpired: expiresDay < day fails (expired)", flagsBelow.includes("id-expired"));

  docs[0].fields.expiresDay = "101"; // > ctx.day
  const flagsAbove = evaluateRules(H1_RULES, docs, cleanRes(), ctx);
  check("notExpired: expiresDay > day passes", !flagsAbove.includes("id-expired"));
}

// --- minStars filtering ---------------------------------------------------
{
  const tieredRules = [
    ...H1_RULES,
    {
      id: "loyalty-tier-check",
      minStars: 2,
      check: { kind: "listed", listId: "loyalty", docType: "id", docField: "docNumber", mustBe: "present" },
      failFlag: "not-loyalty",
      description: "Guest ID must be on the loyalty roll.",
    },
  ];
  const star1 = rulesForStars(tieredRules, 1);
  const star2 = rulesForStars(tieredRules, 2);
  check("minStars filtering excludes higher-tier rows at star 1", !star1.some((r) => r.id === "loyalty-tier-check"));
  check("minStars filtering includes the higher-tier row at star 2", star2.some((r) => r.id === "loyalty-tier-check"));
  check("minStars filtering keeps every minStars-1 row at star 1", star1.length === H1_RULES.filter((r) => r.minStars === 1).length);

  // A guest who fails the star-2-only rule must NOT show up as a violation
  // when evaluated at star 1 (the row isn't even in the table passed in).
  const docs = cleanDocs(); // docNumber not on any loyalty list
  const flagsStar1 = evaluateRules(star1, docs, cleanRes(), { day: 100, lists: { loyalty: [] } });
  check("star-2 rule does not fire when evaluated with the star-1 table", !flagsStar1.includes("not-loyalty"));
  const flagsStar2 = evaluateRules(star2, docs, cleanRes(), { day: 100, lists: { loyalty: [] } });
  check("star-2 rule fires when evaluated with the star-2 table", flagsStar2.includes("not-loyalty"));
}

// --- listed: absent and present modes -------------------------------------
{
  const listedRulesPresent = [
    {
      id: "must-be-loyal",
      minStars: 1,
      check: { kind: "listed", listId: "loyalty", docType: "id", docField: "docNumber", mustBe: "present" },
      failFlag: "not-on-loyalty",
      description: "test",
    },
  ];
  const listedRulesAbsent = [
    {
      id: "must-not-be-banned",
      minStars: 1,
      check: { kind: "listed", listId: "banlist", docType: "id", docField: "docNumber", mustBe: "absent" },
      failFlag: "on-banlist",
      description: "test",
    },
  ];
  const docs = cleanDocs(); // docNumber === "X123"

  const ctxWithLoyalty = { day: 100, lists: { loyalty: ["X123", "Y999"] } };
  const ctxWithoutLoyalty = { day: 100, lists: { loyalty: ["Y999"] } };
  check(
    "listed mustBe present: passes when doc value IS on the list",
    evaluateRules(listedRulesPresent, docs, cleanRes(), ctxWithLoyalty).length === 0,
  );
  check(
    "listed mustBe present: fails when doc value is NOT on the list",
    evaluateRules(listedRulesPresent, docs, cleanRes(), ctxWithoutLoyalty).includes("not-on-loyalty"),
  );

  const ctxOnBanlist = { day: 100, lists: { banlist: ["X123"] } };
  const ctxNotOnBanlist = { day: 100, lists: { banlist: ["Z000"] } };
  check(
    "listed mustBe absent: fails when doc value IS on the list",
    evaluateRules(listedRulesAbsent, docs, cleanRes(), ctxOnBanlist).includes("on-banlist"),
  );
  check(
    "listed mustBe absent: passes when doc value is NOT on the list",
    evaluateRules(listedRulesAbsent, docs, cleanRes(), ctxNotOnBanlist).length === 0,
  );
}

// --- plantViolation determinism -------------------------------------------
{
  const rngA = new Rng("plant-determinism-seed");
  const rngB = new Rng("plant-determinism-seed");
  const a = plantViolation(H1_RULES, rngA, cleanDocs(), cleanRes(), ctxWithBlacklist);
  const b = plantViolation(H1_RULES, rngB, cleanDocs(), cleanRes(), ctxWithBlacklist);
  check("plantViolation is deterministic for a given Rng state", JSON.stringify(a) === JSON.stringify(b));
}

// --- THE load-bearing property: plant/evaluate round-trip ------------------
// For every seed and every rule row: plant that rule's violation, then
// evaluate — the returned flags must be EXACTLY [thatRule.failFlag].
{
  const SEEDS = 100;
  let ranSeedRowPairs = 0;
  let allExact = true;
  let firstFailure = null;

  for (let seedIdx = 0; seedIdx < SEEDS; seedIdx++) {
    for (const rule of H1_RULES) {
      const seed = `plant-property-seed-${seedIdx}`;
      // Force the Rng to pick THIS rule while still passing the FULL
      // table, isolating "does this rule's planter produce exactly this
      // rule's flag" from "does rng.pick distribute correctly" (rng.pick
      // itself is exercised by the multi-row determinism test above and by
      // packages/core's own rng tests).
      const planted = plantViolation(H1_RULES, forcedRng(rule, seed), cleanDocs(), cleanRes(), ctxWithBlacklist);
      const flags = evaluateRules(H1_RULES, planted.docs, planted.resFields, ctxWithBlacklist);
      ranSeedRowPairs++;
      const exact = flags.length === 1 && flags[0] === rule.failFlag;
      if (!exact && firstFailure === null) {
        firstFailure = { seed, ruleId: rule.id, expected: rule.failFlag, got: flags };
      }
      if (!exact) allExact = false;
    }
  }

  check(
    `plant/evaluate property holds exactly for ${SEEDS} seeds x ${H1_RULES.length} rules (${ranSeedRowPairs} pairs), INCLUDING the listed/absent blacklist row against a fixture list`,
    allExact,
  );
  // The property above is only meaningful for the blacklist row if that row
  // was actually exercised. H1a's version silently could not cover a
  // `listed` row at all (the planter wrote a sentinel that was on no list,
  // so the row passed and the "planted" fraud was uncatchable). Assert the
  // row is in the table and its flag was one of the ones round-tripped.
  const listedRow = H1_RULES.find((r) => r.check.kind === "listed");
  check("round-trip actually covered a listed row (the H1a committed-wrong branch)", listedRow !== undefined);
  if (!allExact) {
    console.log("First failure:", JSON.stringify(firstFailure));
  }
}

// --- plantViolation via the full table (rng.pick path), sanity -----------
{
  const SEEDS = 100;
  let allExact = true;
  for (let seedIdx = 0; seedIdx < SEEDS; seedIdx++) {
    const rng = new Rng(`plant-full-table-seed-${seedIdx}`);
    const planted = plantViolation(H1_RULES, rng, cleanDocs(), cleanRes(), ctxWithBlacklist);
    const flags = evaluateRules(H1_RULES, planted.docs, planted.resFields, ctxWithBlacklist);
    const exact = flags.length === 1 && flags[0] === planted.failFlag;
    if (!exact) allExact = false;
  }
  check(`plant/evaluate property also holds when rng.pick selects the rule (${SEEDS} seeds, full table)`, allExact);
}

// --- plantableRules: a listed/absent row is only plantable with a list ----
// H1a review item 3's other half. Planting the blacklist row against an
// EMPTY blacklist is unsatisfiable — there is no value that is on an empty
// list — so the row must not be offered to the planter at all, or the desk
// gets handed a "fraud" no check can catch.
{
  const listedRow = H1_RULES.find((r) => r.check.kind === "listed");
  const emptyCtx = { day: 100, lists: {} };
  check(
    "plantableRules: the listed/absent row is EXCLUDED when its list is empty",
    !plantableRules(H1_RULES, emptyCtx).some((r) => r.id === listedRow.id),
  );
  check(
    "plantableRules: the listed/absent row is INCLUDED once the list is non-empty",
    plantableRules(H1_RULES, ctxWithBlacklist).some((r) => r.id === listedRow.id),
  );
  check(
    "plantableRules: every non-listed row is always plantable",
    plantableRules(H1_RULES, emptyCtx).length === H1_RULES.length - 1,
  );
  // And the planter refuses rather than planting something uncatchable.
  let threw = false;
  try {
    plantViolation([listedRow], forcedRng(listedRow, "plant-empty-list"), cleanDocs(), cleanRes(), emptyCtx);
  } catch {
    threw = true;
  }
  check("plantViolation throws rather than plant a listed/absent row with an empty list", threw);

  // The planted value must come FROM the list — that is what makes it
  // catchable — and it must not break the name-match row on the way.
  const planted = plantViolation(H1_RULES, forcedRng(listedRow, "plant-blacklist-1"), cleanDocs(), cleanRes(), ctxWithBlacklist);
  const idDoc = planted.docs.find((d) => d.docType === "id");
  check(
    "plantViolation(listed/absent) writes a value that IS on the list",
    BLACKLIST_FIXTURE.includes(idDoc.fields.name),
  );
  check(
    "plantViolation(listed/absent) moves the reservation and slip with it, so name-match still passes",
    planted.resFields.guestName === idDoc.fields.name &&
      planted.docs.find((d) => d.docType === "resSlip").fields.guestName === idDoc.fields.name,
  );
  check(
    "plantViolation(listed/absent) is caught by evaluateRules as EXACTLY the blacklist flag",
    JSON.stringify(evaluateRules(H1_RULES, planted.docs, planted.resFields, ctxWithBlacklist)) ===
      JSON.stringify([listedRow.failFlag]),
  );
  check(
    "the same planted documents are CLEAN against an empty blacklist (the row is data-driven, not baked in)",
    evaluateRules(H1_RULES, planted.docs, planted.resFields, emptyCtx).length === 0,
  );
}

// --- star tiers gate the blacklist row -----------------------------------
{
  check("rulesForStars(1) excludes the blacklist row", !rulesForStars(H1_RULES, 1).some((r) => r.id === "blacklist"));
  check("rulesForStars(2) includes the blacklist row", rulesForStars(H1_RULES, 2).some((r) => r.id === "blacklist"));
  check("rulesForStars(1) is exactly H1's five rows", rulesForStars(H1_RULES, 1).length === 5);
}

// ============================================================================
// H1a sim tests: game.ts / components.ts / nav.ts, driving a Sim directly
// (no harness, no clerkBot — those are later lanes). See docs/PHASE-H1.md.
// ============================================================================

function findGuestAtQueueHead(sim) {
  for (const [e, g] of sim.withComponent("guest")) {
    if (g.state === "queued" && g.queueIndex === 0) return [e, g];
  }
  return undefined;
}

function findReservationForGuest(sim, guestEntity) {
  for (const [e, r] of sim.withComponent("reservation")) {
    if (r.guestEntity === guestEntity) return [e, r];
  }
  return undefined;
}

function findVacantRoom(sim) {
  for (const [e, r] of sim.withComponent("roomUnit")) {
    if (r.occupantEntity === 0) return [e, r];
  }
  return undefined;
}

/** Teleports the player next to `targetEntity`, facing it (south of it,
 *  yaw 0 — matches the layout's default spawn yaw, so no face command is
 *  needed), within interact/desk range. Test-only convenience: a real host
 *  would submit face/move commands, but the FSM/ledger/queue properties
 *  under test don't depend on how the player got there. */
function teleportPlayerNextTo(sim, targetEntity) {
  const targetPos = sim.getComponent(targetEntity, "pos");
  sim.setComponent(PLAYER_ENTITY, "pos", { xMm: targetPos.xMm, zMm: targetPos.zMm - 500 });
  sim.setComponent(PLAYER_ENTITY, "yaw", { mdeg: 0 });
}

function runUntil(sim, maxTicks, predicate) {
  for (let i = 0; i < maxTicks; i++) {
    sim.step();
    if (predicate(sim)) return true;
  }
  return false;
}

const FSM_CONFIG = { guestCount: 2, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" };

// --- Guest FSM: accepted guest reaches inRoom -------------------------------
{
  const sim = new Sim("hotel-h1a-fsm-accept-1");
  setupWithConfig(sim, FSM_CONFIG);

  const reachedHead = runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  check("FSM(accept): a guest reaches the queue head", reachedHead);
  const [guestEntity] = findGuestAtQueueHead(sim);

  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();
  check("FSM(accept): guest transitions to presenting", sim.getComponent(guestEntity, "guest").state === "presenting");

  const [resEntity] = findReservationForGuest(sim, guestEntity);
  const [roomEntity] = findVacantRoom(sim);
  // Move the player to the desk terminal itself for the decision (deskSystem
  // checks range against the desk anchor, not the guest).
  const deskTerminalPos = (() => {
    for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
    return undefined;
  })();
  sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);

  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
  sim.step();
  const resAfter = sim.getComponent(resEntity, "reservation");
  check("FSM(accept): reservation decided+accepted", resAfter.decided === true && resAfter.accepted === true);

  const reachedInRoom = runUntil(sim, 4000, (s) => {
    const g = s.getComponent(guestEntity, "guest");
    return g !== undefined && g.state === "inRoom";
  });
  check("FSM(accept): guest FSM reaches inRoom", reachedInRoom);
}

// --- Guest FSM: denied guest reaches left (despawned) -----------------------
{
  const sim = new Sim("hotel-h1a-fsm-deny-1");
  setupWithConfig(sim, FSM_CONFIG);

  runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();

  const [resEntity] = findReservationForGuest(sim, guestEntity);
  const deskTerminalPos = (() => {
    for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
    return undefined;
  })();
  sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, false));
  sim.step();
  const resAfter = sim.getComponent(resEntity, "reservation");
  check("FSM(deny): reservation decided, not accepted", resAfter.decided === true && resAfter.accepted === false);
  // deskSystem (system-order item 8) sets `reservation.decided` THIS tick;
  // guestBrainSystem (item 4) runs BEFORE deskSystem in the same tick, so
  // it reacts to the decision on the NEXT tick — one more step() needed.
  // W1 round-4 §4.2: re-verified directly (a throwaway instrumented run of
  // this exact fixture) that this fixture's guest is still, and only,
  // "leaving" on that exact next tick — it has not yet reached the street
  // region (reachedStreetRegion requires either the exact door cell or a
  // stuckTicks-gated region match, neither true one tick after the
  // transition) — and is despawned the tick after THAT. So the state is
  // reliably observable at a fixed offset; asserting it directly (not
  // OR-ed with the despawn check two lines below, which made the previous
  // version of this check unfalsifiable) is honest coverage of the
  // "leaving" state, not decoration.
  sim.step();
  const guestAfterDeny = sim.getComponent(guestEntity, "guest");
  check(
    "FSM(deny): guest transitions to leaving",
    guestAfterDeny !== undefined && guestAfterDeny.state === "leaving",
  );

  let sawLeftEvent = false;
  const despawned = runUntil(sim, 4000, (s) => {
    for (const e of s.eventsSince(s.tick)) {
      if (e.type === "guest.left" && e.payload?.guestEntity === guestEntity) sawLeftEvent = true;
    }
    return s.getComponent(guestEntity, "guest") === undefined;
  });
  check("FSM(deny): guest FSM reaches 'left' (despawned)", despawned);
  check("FSM(deny): a guest.left event was emitted for this guest", sawLeftEvent);
}

// --- Overflow wait-cell allocation: distinct cells under real concurrency ---
// W1 round-4 fix, blocking 4.1 (docs/alpha-loop/reviews/W1.md ROUND 4):
// `overflowWaitCellFor(entity) = pool[entity % pool.length]` let two
// SIMULTANEOUSLY-overflowing guests land on the SAME goal cell whenever
// their ids happened to differ by exactly the pool size — the one case
// where the sidestep the yield rule offers is a guaranteed no-op
// (`findJitteredPath` ignores `avoidIdx` at the goal), because the first
// guest to arrive parks there (empty path, standing on its own goal) and
// the second is a wall away from ever moving. Fixed by allocating by RANK
// among the guests overflowing THIS TICK, which is guaranteed distinct.
//
// 10 guests, one 8-slot queue, all spawned on tick 1 (arrivals: "fixed",
// spawnTickMin === spawnTickMax === 1): exactly 2 guests overflow, on the
// SAME tick, which is the one case that actually exercises concurrent
// allocation (staggered arrivals never contend for a rank at all). Their
// goal cells must be distinct from each other and from the street door.
{
  const sim = new Sim("hotel-overflow-alloc-1");
  setupWithConfig(sim, {
    guestCount: 10,
    spawnTickMin: 1,
    spawnTickMax: 1,
    // The spawn CADENCE is spawnIntervalMin/MaxTicks (50-150 by default,
    // "every 50-150 ticks"), not spawnTickMin/Max (only the FIRST guest's
    // tick) — pinning the interval to 1 is what actually bursts all ten
    // arrivals back-to-back instead of spreading them over ~500-1500
    // ticks.
    spawnIntervalMinTicks: 1,
    spawnIntervalMaxTicks: 1,
    fraudRatePermille: 0,
    fixture: "normal",
    upkeep: false,
    arrivals: "fixed",
  });
  // guestSpawnSystem (item 3) spawns one guest per tick while
  // `hotel.nextGuestAtTick` allows, and guestBrainSystem (item 4) assigns
  // queue slots the same tick a guest becomes "arriving". Stepping 15
  // ticks is generous headroom for all ten to have spawned (one per tick
  // at minimum) and for the queue-assignment loop to have run against the
  // full set at least once.
  for (let i = 0; i < 15; i++) sim.step();

  const overflowing = [...sim.withComponent("guest")]
    .filter(([, g]) => g.state === "arriving")
    .map(([entity]) => ({ entity, agent: sim.getComponent(entity, "navAgent") }));
  check("overflow alloc: exactly 2 of 10 guests overflow the 8-slot queue", overflowing.length === 2);
  check(
    "overflow alloc: every overflowing guest has a navAgent goal",
    overflowing.every(({ agent }) => agent !== undefined),
  );
  const goalKeys = overflowing.map(({ agent }) => `${agent.goalCx},${agent.goalCz}`);
  check(
    "overflow alloc: the two overflow goal cells are DISTINCT (the round-4 4.1 bug: id-modulo could collide them)",
    new Set(goalKeys).size === overflowing.length,
  );

  const floor = generateGroundFloor("hotel-overflow-alloc-1");
  const streetDoor = floor.doors[floor.entranceDoorIndex];
  const streetCellKey = `${Math.floor(streetDoor.xMm / 250)},${Math.floor(streetDoor.zMm / 250)}`;
  const queueCellKeys = new Set(floor.desk.queueCells.map((c) => `${c.cx},${c.cz}`));
  check(
    "overflow alloc: neither overflow goal is the street door cell (round-3 fact 2/3: never stack the departure goal)",
    goalKeys.every((k) => k !== streetCellKey),
  );
  check(
    "overflow alloc: neither overflow goal is a queue cell (queue slots are for slotted guests only)",
    goalKeys.every((k) => !queueCellKeys.has(k)),
  );
}

// --- Double-entry ledger -----------------------------------------------------
{
  const sim = new Sim("hotel-h1a-ledger-1");
  setupWithConfig(sim, { guestCount: 3, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });

  let accepted = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
    const head = findGuestAtQueueHead(sim);
    if (!head) break;
    const [guestEntity] = head;
    teleportPlayerNextTo(sim, guestEntity);
    sim.submit(interactCommand(sim.tick + 1, guestEntity));
    sim.step();
    const [resEntity] = findReservationForGuest(sim, guestEntity);
    const vacant = findVacantRoom(sim);
    if (!vacant) break;
    const [roomEntity] = vacant;
    const deskTerminalPos = (() => {
      for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
      return undefined;
    })();
    sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);
    sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
    sim.step();
    const res = sim.getComponent(resEntity, "reservation");
    if (res.accepted) accepted++;
  }
  check("ledger: at least one guest was accepted for the ledger test", accepted > 0);

  let debitCash = 0;
  let creditRevenue = 0;
  let debitExpense = 0;
  let creditCash = 0;
  for (const [, entry] of sim.withComponent("ledgerEntry")) {
    if (entry.debitAccount === "cash") debitCash += entry.amountMinor;
    if (entry.creditAccount === "revenue:rooms") creditRevenue += entry.amountMinor;
    if (entry.debitAccount.startsWith("expense:")) debitExpense += entry.amountMinor;
    if (entry.creditAccount === "cash") creditCash += entry.amountMinor;
  }
  check("ledger: every charge's debit(cash) equals its credit(revenue:rooms) in aggregate", debitCash === creditRevenue);
  const hotel = (() => {
    for (const [, h] of sim.withComponent("hotel")) return h;
    return undefined;
  })();
  check(
    "ledger: hotel.cash equals opening(0) + sum(charges) - sum(expenses)",
    hotel.cash === 0 + creditRevenue - debitExpense,
  );
  check("ledger: expense debits equal expense credits(cash) in aggregate", debitExpense === creditCash);
}

// --- Queue: distinct slots, chain advances -----------------------------------
{
  const sim = new Sim("hotel-h1a-queue-1");
  setupWithConfig(sim, { guestCount: 8, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });

  const allQueued = runUntil(sim, 5000, (s) => {
    let n = 0;
    for (const [, g] of s.withComponent("guest")) if (g.state === "queued") n++;
    return n >= 8;
  });
  check("queue: 8 guests reach 'queued'", allQueued);

  const indices = [];
  for (const [, g] of sim.withComponent("guest")) {
    if (g.state === "queued") indices.push(g.queueIndex);
  }
  const distinct = new Set(indices);
  check("queue: 8 guests have distinct queueIndex values", distinct.size === 8);
  check("queue: queueIndex values are exactly {0..7}", [...distinct].sort((a, b) => a - b).join(",") === "0,1,2,3,4,5,6,7");

  const [headEntity] = findGuestAtQueueHead(sim);
  teleportPlayerNextTo(sim, headEntity);
  sim.submit(interactCommand(sim.tick + 1, headEntity));
  sim.step();
  const [resEntity] = findReservationForGuest(sim, headEntity);
  const deskTerminalPos = (() => {
    for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
    return undefined;
  })();
  sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, false));
  sim.step(); // deskSystem applies the decision this tick.
  sim.step(); // guestBrainSystem reacts: head guest leaves "queued".
  // guestBrainSystem compacts queueIndex every tick: once the head guest
  // leaves the active (queued|presenting) set, the chain must shift down.
  sim.step();
  const indicesAfter = [];
  for (const [, g] of sim.withComponent("guest")) {
    if (g.state === "queued") indicesAfter.push(g.queueIndex);
  }
  const distinctAfter = new Set(indicesAfter);
  check("queue: chain advances after the head clears (no gap, no duplicate)", distinctAfter.size === indicesAfter.length);
  check(
    "queue: after the head clears, a new guest occupies slot 0",
    indicesAfter.includes(0),
  );
}

// --- Restore fidelity: the load-bearing property ----------------------------
{
  const seed = "hotel-h1a-restore-1";
  const config = { guestCount: 5, spawnTickMin: 1, spawnTickMax: 50, fraudRatePermille: 300, fixture: "normal" };

  const simA = new Sim(seed);
  setupWithConfig(simA, config);
  for (let i = 0; i < 400; i++) simA.step();

  // A decision, mid-run, on whatever's at the queue head (if any).
  const headA = findGuestAtQueueHead(simA);
  if (headA) {
    const [guestEntity] = headA;
    teleportPlayerNextTo(simA, guestEntity);
    simA.submit(interactCommand(simA.tick + 1, guestEntity));
    simA.step();
    const [resEntity] = findReservationForGuest(simA, guestEntity);
    const vacant = findVacantRoom(simA);
    const deskTerminalPos = (() => {
      for (const [e] of simA.withComponent("terminal")) return simA.getComponent(e, "pos");
      return undefined;
    })();
    simA.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);
    simA.submit(deskDecisionCommand(simA.tick + 1, resEntity, vacant !== undefined, vacant ? vacant[0] : undefined));
    simA.step();
  }
  for (let i = 0; i < 200; i++) simA.step();

  const snap = simA.snapshot();
  for (let i = 0; i < 800; i++) simA.step();
  const hashContinuous = simA.stateHash();

  const simB = new Sim(seed);
  setupWithConfig(simB, config);
  simB.restore(snap);
  for (let i = 0; i < 800; i++) simB.step();
  const hashRestored = simB.stateHash();

  check(
    "restore fidelity: continuous run and fresh-setup+restore+continue reach an identical stateHash",
    hashContinuous === hashRestored,
  );
  if (hashContinuous !== hashRestored) {
    console.log(`  continuous=${hashContinuous} restored=${hashRestored}`);
  }
}

// --- Jitter is stateless ------------------------------------------------------
{
  const a1 = jitter(12345, 3, 7, 64);
  const a2 = jitter(12345, 3, 7, 64);
  const a3 = jitter(12345, 3, 7, 64);
  check("jitter: repeated calls with the same inputs return the same value", a1 === a2 && a2 === a3);
  check("jitter: result is in range 0..3", a1 >= 0 && a1 <= 3);

  const b = jitter(999, 3, 7, 64);
  // Not a correctness requirement that they differ (a hash COULD collide),
  // but assert the function is a pure function of its inputs by checking a
  // different seed is evaluated independently (no shared mutable state
  // between calls — verified by re-deriving `a1` after computing `b`).
  const a4 = jitter(12345, 3, 7, 64);
  check("jitter: interleaving calls with other inputs does not perturb prior results", a4 === a1);
  void b;
}

// --- default fraudRatePermille is non-zero (C3-W2, CYCLE-3.md "Lane 2") -----
// C2-W1's COO review found the app's *default* setup config wired
// `fraudRatePermille: 0`, so the shipped game never spawned a fraudulent
// guest even though every headless gate that cared about fraud passed its
// own explicit rate. The CEO ruling moved the default to 200 (game.ts's
// `DEFAULTS`). This is the non-vacuity pair for that ruling: run a
// 200-guest headless stream at the DEFAULT rate and confirm at least one
// guest actually gets a planted violation, then run the same stream with
// the rate forced back to 0 and confirm none do — so a future regression
// back to 0 (or a broken plant path) fails loudly either direction.
{
  const spawnAllGuests = (config) => {
    const sim = new Sim("hotel-c3w2-fraud-nonvacuity-1");
    setupWithConfig(sim, config);
    runUntil(sim, 50_000, (s) => {
      const hotelEntity = [...s.withComponent("hotel")][0]?.[0];
      const hotel = hotelEntity !== undefined ? s.getComponent(hotelEntity, "hotel") : undefined;
      return hotel !== undefined && hotel.guestsSpawned >= config.guestCount;
    });
    let plantedCount = 0;
    for (const [, r] of sim.withComponent("reservation")) {
      if (r.plantedViolations.length > 0) plantedCount++;
    }
    return plantedCount;
  };

  const defaultRateConfig = {
    ...DEFAULTS,
    guestCount: 200,
    spawnTickMin: 1,
    spawnIntervalMinTicks: 1,
    spawnIntervalMaxTicks: 1,
    fixture: "normal",
    upkeep: false,
    arrivals: "fixed",
  };
  const plantedAtDefault = spawnAllGuests(defaultRateConfig);
  check(
    `fraud non-vacuity: default fraudRatePermille (${DEFAULTS.fraudRatePermille}) plants at least one violation across 200 guests (got ${plantedAtDefault})`,
    plantedAtDefault > 0,
  );

  const plantedAtZero = spawnAllGuests({ ...defaultRateConfig, fraudRatePermille: 0 });
  check(
    `fraud non-vacuity: fraudRatePermille 0 plants no violations across 200 guests (got ${plantedAtZero})`,
    plantedAtZero === 0,
  );
}

// --- despawn clears departed guests and their documents ----------------------
{
  const sim = new Sim("hotel-h1a-despawn-1");
  setupWithConfig(sim, { guestCount: 1, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });

  const baseline = new Set([...sim.entities()]);

  runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  let docCount = 0;
  for (const [, d] of sim.withComponent("document")) {
    if (d.ownerEntity === guestEntity) docCount++;
  }
  check("despawn: the spawned guest has documents before departure", docCount > 0);

  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();
  const [resEntity] = findReservationForGuest(sim, guestEntity);
  const deskTerminalPos = (() => {
    for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
    return undefined;
  })();
  sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, false));
  sim.step();

  runUntil(sim, 4000, (s) => s.getComponent(guestEntity, "guest") === undefined);
  check("despawn: the guest entity is gone after departure", sim.getComponent(guestEntity, "guest") === undefined);

  let docCountAfter = 0;
  for (const [, d] of sim.withComponent("document")) {
    if (d.ownerEntity === guestEntity) docCountAfter++;
  }
  check("despawn: the guest's documents are gone after departure", docCountAfter === 0);
  check("despawn: the guest's reservation entity is gone after departure", sim.getComponent(resEntity, "reservation") === undefined);

  const finalEntities = new Set([...sim.entities()]);
  check(
    "despawn: total entity count returns to baseline (guest + its documents + reservation, minus the ledger/hotel/etc. entities that persist regardless)",
    !finalEntities.has(guestEntity) && [...baseline].every((e) => finalEntities.has(e)),
  );
}

// --- RESERVA's decision path: room click -> ACCEPT/DENY -> desk.decision
// effect -> check-in (docs/reviews/phase-H1b.md item 1, BLOCKING) --------
//
// The phase's headline feature — click a room, click ACCEPT, guest checks
// in — had zero test coverage anywhere: every other exercise of
// `applyDeskDecision` in this file goes in through `deskDecisionCommand`
// (the `deskSystem` command form), bypassing the shell, RESERVA's hit
// rects, and `screenSystem`'s effect-application branch entirely. This
// block drives the SAME path a real player does: focus the terminal via
// `interact`, then submit `screen.click` commands at rects taken from
// `hotelShell.layout()` at runtime — never hardcoded pixel literals, since
// the whole point of the shared-layout design is that hit rects cannot
// drift from what is painted.
function findTerminalEntity(sim) {
  for (const [e] of sim.withComponent("terminal")) return e;
  return undefined;
}

/** Click point inside `rect` — its own center, so a click is unambiguously
 *  a hit regardless of rect size/rounding, without hand-picking a pixel. */
function rectClickPoint(rect) {
  return { px: rect.x + Math.floor(rect.w / 2), py: rect.y + Math.floor(rect.h / 2) };
}

function reservaRects(sim, terminalEntity) {
  const screenApp = sim.getComponent(terminalEntity, "screenApp");
  const view = buildScreenWorldView(sim);
  return hotelShell.layout(screenApp.state, view);
}

function focusTerminal(sim, terminalEntity) {
  teleportPlayerNextTo(sim, terminalEntity);
  sim.submit(interactCommand(sim.tick + 1, terminalEntity));
  sim.step();
}

// --- ACCEPT branch: room + ACCEPT clicks check the guest in end to end ---
{
  const sim = new Sim("hotel-h1b-decision-accept-1");
  setupWithConfig(sim, { guestCount: 1, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });

  runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();
  check("decision(accept): guest reaches presenting", sim.getComponent(guestEntity, "guest").state === "presenting");

  const [resEntity] = findReservationForGuest(sim, guestEntity);
  const [roomEntity] = findVacantRoom(sim);
  const terminalEntity = findTerminalEntity(sim);

  focusTerminal(sim, terminalEntity);
  check(
    "decision(accept): interact focuses the terminal for the player actor",
    sim.getComponent(terminalEntity, "terminal").focusedBy === "player",
  );

  let rects = reservaRects(sim, terminalEntity);
  const roomKey = `app:room:${roomEntity}`;
  check("decision(accept): layout() exposes a hit rect for the vacant room", rects[roomKey] !== undefined);
  let click = rectClickPoint(rects[roomKey]);
  sim.submit(screenClickCommand(sim.tick + 1, click.px, click.py));
  sim.step();

  rects = reservaRects(sim, terminalEntity);
  check("decision(accept): layout() exposes a hit rect for ACCEPT", rects["app:accept"] !== undefined);
  click = rectClickPoint(rects["app:accept"]);
  sim.submit(screenClickCommand(sim.tick + 1, click.px, click.py));
  sim.step();

  const checkedInEvents = sim.eventsSince(0).filter((e) => e.type === "guest.checkedIn" && e.payload?.guestEntity === guestEntity);
  check("decision(accept): guest.checkedIn fired for this guest", checkedInEvents.length === 1);

  const resAfter = sim.getComponent(resEntity, "reservation");
  check(
    "decision(accept): reservation reads {decided:true, accepted:true, room assigned}",
    resAfter.decided === true && resAfter.accepted === true && resAfter.roomEntity === roomEntity,
  );

  const roomAfter = sim.getComponent(roomEntity, "roomUnit");
  check("decision(accept): the room's occupantEntity is set to the guest", roomAfter.occupantEntity === guestEntity);
}

// --- Guard: clicking ACCEPT with no room selected does not decide -------
{
  const sim = new Sim("hotel-h1b-decision-guard-1");
  setupWithConfig(sim, { guestCount: 1, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });

  runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();

  const [resEntity] = findReservationForGuest(sim, guestEntity);
  const terminalEntity = findTerminalEntity(sim);
  focusTerminal(sim, terminalEntity);

  // No room click submitted -- go straight for ACCEPT.
  const rects = reservaRects(sim, terminalEntity);
  const click = rectClickPoint(rects["app:accept"]);
  sim.submit(screenClickCommand(sim.tick + 1, click.px, click.py));
  sim.step();

  const resAfter = sim.getComponent(resEntity, "reservation");
  check(
    "decision(guard): ACCEPT with no room selected does not decide the reservation",
    resAfter.decided === false,
  );
}

// --- DENY branch: a planted violation is caught and the guest leaves ----
{
  const sim = new Sim("hotel-h1b-decision-deny-1");
  setupWithConfig(sim, { guestCount: 1, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 1000, fixture: "normal", upkeep: false, arrivals: "fixed" });

  runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();

  const [resEntity, resBefore] = findReservationForGuest(sim, guestEntity);
  check("decision(deny): the presenting guest's reservation carries a planted violation", resBefore.plantedViolations.length > 0);

  const terminalEntity = findTerminalEntity(sim);
  focusTerminal(sim, terminalEntity);

  const rects = reservaRects(sim, terminalEntity);
  check("decision(deny): layout() exposes a hit rect for DENY", rects["app:deny"] !== undefined);
  const click = rectClickPoint(rects["app:deny"]);
  sim.submit(screenClickCommand(sim.tick + 1, click.px, click.py));
  sim.step();

  const fraudCaught = sim.eventsSince(0).filter((e) => e.type === "desk.fraudCaught" && e.payload?.reservationEntity === resEntity);
  check("decision(deny): desk.fraudCaught fired for this reservation", fraudCaught.length === 1);

  const resAfter = sim.getComponent(resEntity, "reservation");
  check(
    "decision(deny): reservation reads {decided:true, accepted:false}",
    resAfter.decided === true && resAfter.accepted === false,
  );

  // deskSystem sets `reservation.decided` this tick; guestBrainSystem
  // reacts on the NEXT tick (system order, same as the FSM(deny) block
  // above) -- one more step() before the guest's FSM has moved.
  sim.step();
  check("decision(deny): the guest ends up leaving", sim.getComponent(guestEntity, "guest").state === "leaving");

  // CYCLE-3 lane 5 (c): a CAUGHT fraud is unchanged by the missed-fraud
  // ruling -- it never even sets `fraudMissed`, so none of the checkout-
  // time consequences (chargeback, synthetic review) apply to it.
  check("decision(deny): a caught fraud never sets guest.fraudMissed", sim.getComponent(guestEntity, "guest").fraudMissed === false);
  const despawnedDenied = runUntil(sim, 4000, (s) => s.getComponent(guestEntity, "guest") === undefined);
  check("decision(deny): the denied guest eventually despawns (never checked in, never a checkout)", despawnedDenied);
  check(
    "decision(deny): no chargeback ledger entry exists anywhere (a denied guest was never charged)",
    [...sim.withComponent("ledgerEntry")].every(([, e]) => e.debitAccount !== CHARGEBACK_ACCOUNT),
  );
  check(
    "decision(deny): no synthetic fraud-missed review exists anywhere",
    [...sim.withComponent("review")].every(([, r]) => !r.factors.includes("fraud-missed")),
  );
}

// --- CYCLE-3 lane 5: a missed fraud must cost something -----------------
// CEO ruling (docs/alpha-loop/CYCLE-3.md "Lane 5"): accepting a guest
// despite a real rules violation is a SKIP at checkout -- the check-in
// charge is reversed via an expense:chargeback ledger line, the guest
// files no review, but a synthetic one-star Review row still lands in
// the reputation window for that guest's segment.
{
  const sim = new Sim("hotel-fraud-missed-1");
  setupWithConfig(sim, { guestCount: 1, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 1000, fixture: "normal", upkeep: false, arrivals: "fixed" });

  runUntil(sim, 3000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  teleportPlayerNextTo(sim, guestEntity);
  sim.submit(interactCommand(sim.tick + 1, guestEntity));
  sim.step();

  const [resEntity, resBefore] = findReservationForGuest(sim, guestEntity);
  check("fraud missed: the presenting guest's reservation carries a planted violation", resBefore.plantedViolations.length > 0);
  const [roomEntity] = findVacantRoom(sim);

  const deskTerminalPos = (() => {
    for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
    return undefined;
  })();
  sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPos);

  // Accept DESPITE the violation -- a missed fraud.
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
  sim.step();

  const missedEvents = sim.eventsSince(0).filter(
    (e) => e.type === "desk.fraudMissed" && e.payload?.reservationEntity === resEntity,
  );
  check("fraud missed: desk.fraudMissed fired for this reservation", missedEvents.length === 1);
  const guestAfterAccept = sim.getComponent(guestEntity, "guest");
  check("fraud missed: guest.fraudMissed is set", guestAfterAccept.fraudMissed === true);
  const paidMinor = guestAfterAccept.paidMinor;
  check("fraud missed: the guest was actually charged something at check-in", paidMinor > 0);

  const hotelEntry = () => [...sim.withComponent("hotel")][0];
  const cashAfterCheckin = hotelEntry()[1].cash;

  const checkedOut = runUntil(sim, 4000, (s) => {
    for (const e of s.eventsSince(s.tick)) {
      if (e.type === "guest.checkedOut" && e.payload?.guestEntity === guestEntity) return true;
    }
    return false;
  });
  check("fraud missed: the guest eventually checks out", checkedOut);

  const chargebackEntries = [...sim.withComponent("ledgerEntry")]
    .map(([, e]) => e)
    .filter((e) => e.debitAccount === CHARGEBACK_ACCOUNT && e.creditAccount === "cash");
  check(
    "fraud missed: exactly one chargeback ledger entry, matching what was paid",
    chargebackEntries.length === 1 && chargebackEntries[0].amountMinor === paidMinor,
  );

  const cashAfterCheckout = hotelEntry()[1].cash;
  check(
    "fraud missed: the chargeback exactly reverses the check-in charge (net zero cash from this guest -- pays nothing)",
    cashAfterCheckout === cashAfterCheckin - paidMinor,
  );

  check(
    "fraud missed: no guest.reviewed event was emitted (files no review)",
    sim.eventsSince(0).filter((e) => e.type === "guest.reviewed" && e.payload?.guestEntity === guestEntity).length === 0,
  );
  check(
    "fraud missed: no guest.complained event either",
    sim.eventsSince(0).filter((e) => e.type === "guest.complained" && e.payload?.guestEntity === guestEntity).length === 0,
  );

  const fraudReview = [...sim.withComponent("review")]
    .map(([, r]) => r)
    .find((r) => r.segment === guestAfterAccept.segment && r.score === 1 && r.factors.includes("fraud-missed"));
  check(
    "fraud missed: a synthetic one-star Review row lands in the reputation window for the guest's segment",
    fraudReview !== undefined,
  );

  // Ledger still balances overall: every account's debit/credit pair nets
  // to zero, same check the harness scenarios run.
  const allEntries = [...sim.withComponent("ledgerEntry")].map(([, e]) => e);
  const byAccount = new Map();
  for (const e of allEntries) {
    if (!Number.isInteger(e.amountMinor)) continue;
    byAccount.set(e.debitAccount, (byAccount.get(e.debitAccount) ?? 0) + e.amountMinor);
    byAccount.set(e.creditAccount, (byAccount.get(e.creditAccount) ?? 0) - e.amountMinor);
  }
  let net = 0;
  for (const v of byAccount.values()) net += v;
  check("fraud missed: the ledger still balances (every debit/credit pair nets to zero)", net === 0);
}

// --- Screen overflow gate (surface-ui's findOverflowingNodes) ------------
//
// H1b review round 3: a clipped guest name and a crowded, dropped-looking
// PROCEDURES wrap got past eyeballing a screenshot -- the front-desk loop
// is entirely "the player reads a field and compares it by eye" (rules.ts's
// header), so a field the surface cannot display is a fraud the player
// cannot catch. This block is the mechanical gate: it builds RESERVA's and
// AUDIT's worst-case `ScreenWorldView.data` from the ACTUAL generator/rule
// data (never a hand-picked string) and asserts `findOverflowingNodes`
// returns zero violations against that worst case, then proves the checker
// is not a no-op by widening a string past the surface and asserting it
// DOES flag it.
{
  const allNames = ARCHETYPES.flatMap((a) => a.names);
  const longestName = allNames.reduce((a, b) => (b.length > a.length ? b : a));
  check("overflow-gate setup: longest guest name is non-trivial (>= 10 chars)", longestName.length >= 10);

  // Widest star tier H1_RULES ships -- if a later phase appends a higher
  // tier, this picks it up automatically rather than staying pinned at 1.
  const maxStars = Math.max(...H1_RULES.map((r) => r.minStars));
  const widestRules = rulesForStars(H1_RULES, maxStars);
  check("overflow-gate setup: widest star tier includes every H1 rule", widestRules.length === H1_RULES.length);

  // Reservation code / doc number are fixed-width by construction
  // (makeResCode/makeDocNumber in guests.js always emit a 4-digit / 6-digit
  // number), so their worst case is their format's max width, not a
  // hand-picked example.
  const worstResCode = "RC-9999";
  const worstDocNumber = "X999999";
  const worstExpiresDay = "99999";

  // The generator ships exactly 4 bedrooms per floor (layout.ts's
  // ROOM_1..ROOM_4), tiers 1-2 -- a full vacant-room list is all 4 at once.
  const worstRooms = [
    { roomEntity: 3, roomId: 3, tier: 1 },
    { roomEntity: 4, roomId: 4, tier: 2 },
    { roomEntity: 5, roomId: 5, tier: 1 },
    { roomEntity: 6, roomId: 6, tier: 2 },
  ];

  function worstCaseView(guestName) {
    return {
      tick: 1,
      data: {
        queue: {
          reservationEntity: 1,
          guestEntity: 2,
          docFields: {
            id: { name: guestName, docNumber: worstDocNumber, expiresDay: worstExpiresDay },
            resSlip: { guestName, resCode: worstResCode },
          },
          resFields: { guestName, resCode: worstResCode },
        },
        rooms: worstRooms,
        // H2a: RESERVA derives its procedures card from `stars` now, so a
        // view WITHOUT this key paints zero procedure lines and the
        // overflow gate silently stops testing the widest thing on the
        // screen. Worst case is the highest reachable tier.
        stars: MAX_STARS,
        ledger: { day: 99999, revenueMinor: 999999999, expenseMinor: 999999999, closingCashMinor: -999999999 },
        // AUDIT paints the day's objectives as of the H2a review pass, so a
        // view WITHOUT this key stops testing the widest rows on that
        // screen — the same silent hole the missing `stars` key opened in
        // RESERVA. Worst case is three objectives with the longest kind
        // slug and absurd figures.
        objectives: OBJECTIVE_KINDS.map((t) => ({
          day: 99999,
          kind: t.kind,
          target: 999999,
          progress: 999999,
          done: false,
          rewardMinor: 999999999,
        })),
      },
    };
  }

  const view = worstCaseView(longestName);
  const reservaNodes = reservaApp.paintSpec(reservaApp.init(), view);
  check(
    `overflow-gate setup: the worst-case paint actually contains all ${widestRules.length} procedure lines`,
    widestRules.every((rule) => JSON.stringify(reservaNodes).includes(rule.description.slice(0, 24))),
  );
  const reservaViolations = findOverflowingNodes(reservaNodes);
  check(
    `RESERVA: worst-case data (name=${JSON.stringify(longestName)}, all ${widestRules.length} rules, 4 vacant rooms) has zero surface overflows`,
    reservaViolations.length === 0,
  );
  if (reservaViolations.length > 0) console.log(JSON.stringify(reservaViolations, null, 2));

  // AUDIT reveals its rows on a tick cadence after open (audit-app.ts), so
  // the worst-case paint is the fully revealed one: a view well past the
  // last reveal threshold.
  const auditNodes = auditApp.paintSpec(auditApp.init(), { ...view, tick: 1000 });
  check(
    "overflow-gate setup: the worst-case AUDIT paint actually contains all three objective rows",
    OBJECTIVE_KINDS.every((t) => JSON.stringify(auditNodes).includes(t.kind)),
  );
  const auditViolations = findOverflowingNodes(auditNodes);
  check("AUDIT: worst-case ledger figures and objective rows have zero surface overflows", auditViolations.length === 0);
  if (auditViolations.length > 0) console.log(JSON.stringify(auditViolations, null, 2));

  // Negative control: the checker must actually be capable of catching an
  // overflow, not just passing because it never fires. Widen the guest
  // name well past anything the surface can hold and confirm it's flagged.
  const absurdName = "X".repeat(200);
  const absurdView = worstCaseView(absurdName);
  const absurdNodes = reservaApp.paintSpec(reservaApp.init(), absurdView);
  const absurdViolations = findOverflowingNodes(absurdNodes);
  check(
    "overflow gate is not a no-op: a 200-char guest name IS flagged as overflowing",
    absurdViolations.length > 0,
  );

  // --- Composed shell tree overflow (H1b review item 2) -------------------
  // findOverflowingNodes above only ever ran over each APP's own worst-case
  // nodes -- shell chrome (taskbar, the calibration strip, the reference
  // glyph row) exists ONLY in the composed `hotelShell.paintSpec` tree,
  // which is exactly why the glyph row (painted at CALIB_RECT.x=600, 9
  // glyphs wide at GLYPH_W=8 -> x=672 on a 640-wide surface) ran 32px off
  // the edge and rendered as "AaBbC" without this gate ever seeing it. Run
  // the gate over the real composed tree, for every registered app, at the
  // same worst-case data the app-level checks above use.
  for (const appId of ["reserva", "audit"]) {
    const shellState = { openAppId: appId, appStates: {} };
    const nodes = hotelShell.paintSpec(shellState, view);
    const violations = findOverflowingNodes(nodes);
    check(`composed shell tree (${appId} focused, worst-case data) has zero surface overflows`, violations.length === 0);
    if (violations.length > 0) console.log(JSON.stringify(violations, null, 2));
  }

  // Negative control: the gate must actually be capable of catching shell
  // CHROME overflowing (not just app content). Reconstructs the exact
  // pre-fix glyph-row node -- painted at CALIB_RECT.x=600 -- and confirms
  // findOverflowingNodes flags it; this does not depend on shell.ts still
  // having the bug, so it stays a real negative control after the fix.
  const preFixGlyphRow = { kind: "text", x: 600, y: 12, text: "AaBbCc123", color: 15 };
  const preFixViolations = findOverflowingNodes([preFixGlyphRow]);
  check(
    "overflow gate is not a no-op on shell chrome: the pre-fix glyph-row position IS flagged",
    preFixViolations.length > 0,
  );
}

// ============================================================================
// H2a: housekeeping and maintenance (docs/PHASE-H2.md §9)
// ============================================================================

/** Every entity carrying `component`, as [entity, value]. */
function scanAll(sim, component) {
  return [...sim.withComponent(component)];
}

/** interact from a pose that is guaranteed in range and arc, the same way
 *  every other decision test in this file does it. */
function interactWith(sim, targetEntity) {
  teleportPlayerNextTo(sim, targetEntity);
  sim.submit(interactCommand(sim.tick + 1, targetEntity));
  sim.step();
}

const UPKEEP_ON = { guestCount: 1, spawnTickMin: 1, fraudRatePermille: 0, fixture: "normal", upkeep: true, arrivals: "fixed" };

// --- the component shapes ARE the zen ruling ------------------------------
// DESIGN §6 / H2 spec §9: "no per-room timer ... consequences only at day
// granularity". The enforcement is structural, not disciplinary: if `mess`
// or `prop` carried any timestamp, decay/expiry/compounding would become
// expressible, and a later phase would express it. This asserts the shape.
{
  const sim = new Sim("hotel-h2-zen-shape-1");
  setupWithConfig(sim, UPKEEP_ON);
  const props = scanAll(sim, "prop");
  check("upkeep: one prop per bedroom at setup", props.length === scanAll(sim, "roomUnit").length);
  const propKeys = Object.keys(props[0][1]).sort();
  check(
    `prop carries exactly {broken, kind, repairProgress, roomEntity} -- no timestamp of any kind (got ${propKeys.join(",")})`,
    JSON.stringify(propKeys) === JSON.stringify(["broken", "kind", "repairProgress", "roomEntity"]),
  );
  const off = new Sim("hotel-h2-zen-shape-2");
  setupWithConfig(off, { ...UPKEEP_ON, upkeep: false });
  check("upkeep: no props are created when config.upkeep is false", scanAll(off, "prop").length === 0);
}

// --- a checkout leaves 2..4 messes; wiping them removes them --------------
{
  const sim = new Sim("hotel-h2-zen-mess-1");
  setupWithConfig(sim, UPKEEP_ON);

  runUntil(sim, 4000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  interactWith(sim, guestEntity);
  const [resEntity] = findReservationForGuest(sim, guestEntity);
  const [roomEntity] = findVacantRoom(sim);
  teleportPlayerNextTo(sim, findTerminalEntity(sim));
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
  sim.step();
  check("zen: the guest checked in", sim.getComponent(roomEntity, "roomUnit").occupantEntity === guestEntity);

  const checkedOut = runUntil(sim, 6000, (s) => s.eventsSince(0).some((e) => e.type === "guest.checkedOut"));
  check("zen: the guest eventually checks out", checkedOut);

  const room = sim.getComponent(roomEntity, "roomUnit");
  const messes = scanAll(sim, "mess").filter(([, m]) => m.roomEntity === roomEntity);
  check(`zen: checkout left 2..4 messes (got ${messes.length})`, messes.length >= 2 && messes.length <= 4);
  check("zen: roomUnit.messCount agrees with a live mess scan", room.messCount === messes.length);
  check("zen: the room is vacant after checkout", room.occupantEntity === 0);

  // RESERVA must not offer a room the desk would refuse.
  const viewDirty = buildScreenWorldView(sim);
  check(
    "zen: RESERVA's vacant-room list excludes the dirty room",
    !viewDirty.data.rooms.some((r) => r.roomEntity === roomEntity),
  );

  // Wipe them all, one interact each.
  const messCountBefore = messes.length;
  for (const [messEntity] of messes) interactWith(sim, messEntity);
  const cleanedEvents = sim.eventsSince(0).filter((e) => e.type === "room.messCleaned");
  check(
    `zen: one room.messCleaned per wipe (${cleanedEvents.length} of ${messCountBefore})`,
    cleanedEvents.length === messCountBefore,
  );
  check(
    "zen: every mess entity is despawned",
    scanAll(sim, "mess").filter(([, m]) => m.roomEntity === roomEntity).length === 0,
  );
  check("zen: roomUnit.messCount is back to 0", sim.getComponent(roomEntity, "roomUnit").messCount === 0);
  const viewClean = buildScreenWorldView(sim);
  check(
    "zen: RESERVA lists the room again once it is wiped",
    viewClean.data.rooms.some((r) => r.roomEntity === roomEntity),
  );

  // The zen property: nothing about the DELAY produced a penalty. Messes
  // never multiplied while dirty, and no penalty-class event exists at all.
  const penaltyish = sim.eventsSince(0).filter((e) => /penal|fine|decay|expire|worsen|cascade/i.test(e.type));
  check("zen: zero penalty-class events anywhere in the run", penaltyish.length === 0);
}

// --- the desk refuses a dirty or broken room, and says why ----------------
{
  const sim = new Sim("hotel-h2-zen-deny-1");
  setupWithConfig(sim, { ...UPKEEP_ON, guestCount: 2 });
  runUntil(sim, 4000, (s) => findGuestAtQueueHead(s) !== undefined);
  const [guestEntity] = findGuestAtQueueHead(sim);
  const [roomEntity] = findVacantRoom(sim);

  // Dirty the room directly -- the desk's rule is what is under test here,
  // not the checkout that would normally produce the mess.
  const room = sim.getComponent(roomEntity, "roomUnit");
  sim.setComponent(roomEntity, "roomUnit", { ...room, messCount: 1 });

  interactWith(sim, guestEntity);
  const [resEntity] = findReservationForGuest(sim, guestEntity);
  teleportPlayerNextTo(sim, findTerminalEntity(sim));
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
  sim.step();
  check(
    "zen: accepting onto a dirty room does not decide the reservation",
    sim.getComponent(resEntity, "reservation").decided === false,
  );
  check(
    "zen: the desk emits desk.denied-room {reason: not-ready}",
    sim
      .eventsSince(0)
      .some((e) => e.type === "desk.denied-room" && e.payload.reason === "not-ready" && e.payload.roomEntity === roomEntity),
  );

  // Same shape for a broken prop, with the room perfectly clean.
  sim.setComponent(roomEntity, "roomUnit", { ...sim.getComponent(roomEntity, "roomUnit"), messCount: 0 });
  const propEntry = scanAll(sim, "prop").find(([, pr]) => pr.roomEntity === roomEntity);
  sim.setComponent(propEntry[0], "prop", { ...propEntry[1], broken: true, repairProgress: 0 });
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
  sim.step();
  check(
    "zen: a clean room with a BROKEN prop is also refused",
    sim.getComponent(resEntity, "reservation").decided === false,
  );
  check(
    "zen: RESERVA excludes a clean room with a broken prop",
    !buildScreenWorldView(sim).data.rooms.some((r) => r.roomEntity === roomEntity),
  );

  // Repair it: N presses, visible partial progress, then sellable again.
  interactWith(sim, propEntry[0]);
  const midway = sim.getComponent(propEntry[0], "prop");
  check("zen: one repair press advances repairProgress without finishing", midway.repairProgress === 1 && midway.broken === true);
  interactWith(sim, propEntry[0]);
  interactWith(sim, propEntry[0]);
  const repaired = sim.getComponent(propEntry[0], "prop");
  check("zen: the third press completes the repair", repaired.broken === false && repaired.repairProgress === 0);
  check(
    "zen: prop.repaired fired",
    sim.eventsSince(0).some((e) => e.type === "prop.repaired" && e.payload.propEntity === propEntry[0]),
  );
  interactWith(sim, propEntry[0]);
  check(
    "zen: interacting with an unbroken prop is denied, not a free repair",
    sim.eventsSince(0).some((e) => e.type === "interact-denied" && e.payload.reason === "not-broken"),
  );

  teleportPlayerNextTo(sim, findTerminalEntity(sim));
  sim.submit(deskDecisionCommand(sim.tick + 1, resEntity, true, roomEntity));
  sim.step();
  check("zen: the room is sellable once wiped and repaired", sim.getComponent(resEntity, "reservation").decided === true);
}

// --- partial repair survives a save/restore round trip --------------------
// "Partial progress persists indefinitely" is a design ruling; restore() is
// exactly where a half-finished job would silently reset.
{
  const sim = new Sim("hotel-h2-zen-restore-1");
  setupWithConfig(sim, UPKEEP_ON);
  sim.step();
  const [propEntity, prop] = scanAll(sim, "prop")[0];
  sim.setComponent(propEntity, "prop", { ...prop, broken: true, repairProgress: 0 });
  interactWith(sim, propEntity);
  const snapshot = sim.snapshot();
  const restored = new Sim("hotel-h2-zen-restore-1");
  setupWithConfig(restored, UPKEEP_ON);
  restored.restore(snapshot);
  const after = restored.getComponent(propEntity, "prop");
  check("zen: half-done repair survives snapshot/restore", after.broken === true && after.repairProgress === 1);
  check("zen: the restored sim hashes identically to the source", restored.stateHash() === snapshot.stateHash);
}

// ============================================================================
// H2a: reviews, reputation, stars, demand, objectives (docs/PHASE-H2.md §10)
// ============================================================================

// --- scoreReview is a pure function of objective stay facts --------------
{
  const perfect = { waitedTicks: 0, brokenPropNights: 0, paidMinor: 5000, tierBaselineMinor: 5000 };
  check("review: a flawless stay at the baseline rate scores 5", scoreReview(perfect).score === 5);

  const waited = scoreReview({ ...perfect, waitedTicks: 700 });
  check("review: a long wait costs a star and names itself", waited.score === 4 && waited.factors.includes("waited-long"));
  const waitedMore = scoreReview({ ...perfect, waitedTicks: 1300 });
  check("review: a very long wait costs two", waitedMore.score === 3 && waitedMore.factors.includes("waited-very-long"));

  const broken = scoreReview({ ...perfect, brokenPropNights: 1 });
  check("review: a broken-prop night costs a star", broken.score === 4 && broken.factors.includes("broken-prop"));
  check(
    "review: broken-prop damage CAPS at two stars, however many nights (no cascade)",
    scoreReview({ ...perfect, brokenPropNights: 2 }).score === scoreReview({ ...perfect, brokenPropNights: 9 }).score,
  );

  const gouged = scoreReview({ ...perfect, paidMinor: 7000 });
  check("review: charging well over baseline costs a star", gouged.score === 4 && gouged.factors.includes("overpriced"));
  const bargain = scoreReview({ ...perfect, waitedTicks: 700, paidMinor: 3000 });
  check(
    "review: a bargain buys back at most one star",
    bargain.score === 5 && bargain.factors.includes("good-value"),
  );

  check("review: the score never leaves 1..5", scoreReview({ waitedTicks: 99999, brokenPropNights: 9, paidMinor: 25000, tierBaselineMinor: 5000 }).score === 1);

  // The anti-dark-pattern requirement, asserted: the same stay always
  // scores the same. A randomised review score would be a variable-ratio
  // schedule, which DESIGN §6 explicitly rules out.
  const a = scoreReview({ waitedTicks: 640, brokenPropNights: 1, paidMinor: 6100, tierBaselineMinor: 5000 });
  const b = scoreReview({ waitedTicks: 640, brokenPropNights: 1, paidMinor: 6100, tierBaselineMinor: 5000 });
  check("review: scoring is deterministic — identical facts, identical outcome", JSON.stringify(a) === JSON.stringify(b));
}

// --- reputation is recomputed from a rolling window, in integers ---------
{
  const rows = [
    { day: 10, segment: "business", score: 5 },
    { day: 10, segment: "business", score: 3 },
    { day: 10, segment: "leisure", score: 1 },
    // Older than the window from day 10 — must be ignored.
    { day: 2, segment: "business", score: 1 },
  ];
  const rep = reputationBySegment(rows, 10);
  check("reputation: 5 and 3 average to 750 permille (integer, truncating)", rep.business === 750);
  check("reputation: a 1-star review is 0 permille", rep.leisure === 0);
  check("reputation: reviews outside the 7-day window are excluded", Object.keys(rep).length === 2);
  check(
    "reputation: every value is an integer",
    Object.keys(rep).every((k) => Number.isInteger(rep[k])),
  );
  check(
    "reputation: the key order is sorted, so the hashed component order depends only on the names",
    JSON.stringify(Object.keys(rep)) === JSON.stringify(["business", "leisure"]),
  );
  check("reputation: no reviews at all falls back to the neutral default", overallReputation({}) === DEFAULT_REP_PERMILLE);
}

// --- stars: a tier is earned, and the floor is 1 -------------------------
{
  check("stars: one glowing review does not promote a hotel", starsFromReputation(1000, 1) === 1);
  check("stars: enough good reviews reach 2", starsFromReputation(750, 5) === 2);
  check("stars: a mediocre record stays at 1", starsFromReputation(400, 9) === 1);
  check(
    `stars: capped at MAX_STARS (${MAX_STARS}) this phase, because that is how far the CONTENT goes`,
    starsFromReputation(1000, 50) === MAX_STARS,
  );
  check("stars: the floor is 1, never 0 (the recoverable one-man show)", starsFromReputation(0, 50) === 1);
}

// --- demand: price, reputation and stars move capture the right way ------
{
  const cheap = capturePermille(3000, 6000, 500, 1);
  const dear = capturePermille(12000, 6000, 500, 1);
  check("demand: a cheaper rate captures more of a segment", cheap > dear);
  const liked = capturePermille(6000, 6000, 900, 1);
  const disliked = capturePermille(6000, 6000, 100, 1);
  check("demand: a better-liked hotel captures more at the same price", liked > disliked);
  check("demand: a star tier is worth something", capturePermille(6000, 6000, 500, 2) > capturePermille(6000, 6000, 500, 1));
  check(
    "demand: capture stays in 0..1000 at the extremes",
    capturePermille(MAX_RATE_MINOR, 1000, 0, 1) >= 0 && capturePermille(MIN_RATE_MINOR, 25000, 1000, 5) <= 1000,
  );
  check(
    "demand: every capture value is an integer (no floats reach sim state)",
    [cheap, dear, liked, disliked].every((v) => Number.isInteger(v)),
  );

  // Draw-at-generation: the same Rng state produces the same day.
  const one = arrivalsForDay(new Rng("demand-1"), { 1: 5000, 2: 8000 }, {}, 1, DEFAULT_REP_PERMILLE, 2);
  const two = arrivalsForDay(new Rng("demand-1"), { 1: 5000, 2: 8000 }, {}, 1, DEFAULT_REP_PERMILLE, 2);
  check("demand: arrivalsForDay is deterministic for a given Rng state", JSON.stringify(one) === JSON.stringify(two));
  check(
    "demand: arrivals are integers and bounded by the segment pools",
    Object.keys(one).every((k) => Number.isInteger(one[k]) && one[k] >= 0 && one[k] <= SEGMENT_POOL[k]),
  );
}

// --- pricing bounds ------------------------------------------------------
{
  check("pricer: the opening rates are valid", isValidRate(5000) && isValidRate(8000));
  check("pricer: below the floor is invalid", !isValidRate(MIN_RATE_MINOR - RATE_STEP_MINOR));
  check("pricer: above the ceiling is invalid", !isValidRate(MAX_RATE_MINOR + RATE_STEP_MINOR));
  check("pricer: an off-step rate is invalid", !isValidRate(MIN_RATE_MINOR + 1));
  check("pricer: a non-integer rate is invalid", !isValidRate(5000.5));

  // back-compat: capturePermille's four-argument form is unchanged.
  check(
    "demand: capturePermille's four-argument form returns exactly today's value",
    capturePermille(6000, 6000, 500, 1) === 500 && capturePermille(3000, 6000, 500, 1) === capturePermille(3000, 6000, 500, 1, 1000),
  );

  // isValidRateForHotelTier at each tier's boundary and one step past it.
  for (let tier = 0; tier <= MAX_HOTEL_TIER; tier++) {
    const ceiling = MAX_RATE_BY_TIER_MINOR[tier];
    check(`pricer: tier ${tier}'s ceiling rate is valid`, isValidRateForHotelTier(ceiling, tier));
    check(`pricer: one step past tier ${tier}'s ceiling is invalid`, !isValidRateForHotelTier(ceiling + RATE_STEP_MINOR, tier));
    check(`pricer: maxRateForHotelTier(${tier}) matches the table`, maxRateForHotelTier(tier) === ceiling);
  }

  // arrivalsForDay: business books at 0/1 only at tier 2.
  {
    const rates = { 1: MIN_RATE_MINOR, 2: MIN_RATE_MINOR };
    const tier0 = arrivalsForDay(new Rng("tier-gate-1"), rates, {}, 2, DEFAULT_REP_PERMILLE, 0);
    const tier1 = arrivalsForDay(new Rng("tier-gate-1"), rates, {}, 2, DEFAULT_REP_PERMILLE, 1);
    check("demand: business contributes zero arrivals at hotel tier 0", tier0.business === 0);
    check("demand: business contributes zero arrivals at hotel tier 1", tier1.business === 0);
    check(
      "demand: SEGMENT_MIN_HOTEL_TIER gates business at tier 2",
      SEGMENT_MIN_HOTEL_TIER.business === 2,
    );
    let sawNonZeroBusiness = false;
    for (let i = 0; i < 40; i++) {
      const tier2 = arrivalsForDay(new Rng(`tier-gate-2-${i}`), rates, {}, 2, DEFAULT_REP_PERMILLE, 2);
      if (tier2.business > 0) sawNonZeroBusiness = true;
    }
    check("demand: business is non-zero-capable at hotel tier 2", sawNonZeroBusiness);
  }
}

// --- applyRenovate: the four refusal reasons, driven through renovateCommand ---
{
  function deniedReasons(sim) {
    return sim.eventsSince(0).filter((e) => e.type === "screen.denied").map((e) => e.payload?.reason);
  }
  function deskTerminalPosOf(sim) {
    for (const [e] of sim.withComponent("terminal")) return sim.getComponent(e, "pos");
    return undefined;
  }

  // 1. out-of-range: player nowhere near the desk (default spawn).
  {
    const sim = new Sim("hotel-renovate-out-of-range-1");
    setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, spawnTickMax: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
    const [hotelEntity, hotel0] = [...sim.withComponent("hotel")][0];
    sim.setComponent(hotelEntity, "hotel", { ...hotel0, cash: 1_000_000, stars: 2 });
    sim.submit(renovateCommand(sim.tick + 1));
    sim.step();
    check("applyRenovate: out-of-range is refused when the player is away from the desk", deniedReasons(sim).includes("out-of-range"));
  }

  // 2. max-tier: at MAX_HOTEL_TIER already.
  {
    const sim = new Sim("hotel-renovate-max-tier-1");
    setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, spawnTickMax: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
    sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPosOf(sim));
    const [hotelEntity, hotel0] = [...sim.withComponent("hotel")][0];
    sim.setComponent(hotelEntity, "hotel", { ...hotel0, cash: 1_000_000, stars: 2, tier: MAX_HOTEL_TIER });
    sim.submit(renovateCommand(sim.tick + 1));
    sim.step();
    check("applyRenovate: renovating past MAX_HOTEL_TIER is refused", deniedReasons(sim).includes("max-tier"));
  }

  // 3. stars-too-low.
  {
    const sim = new Sim("hotel-renovate-stars-1");
    setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, spawnTickMax: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
    sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPosOf(sim));
    const [hotelEntity, hotel0] = [...sim.withComponent("hotel")][0];
    sim.setComponent(hotelEntity, "hotel", { ...hotel0, cash: 1_000_000, stars: 1, tier: 0 });
    sim.submit(renovateCommand(sim.tick + 1));
    sim.step();
    check("applyRenovate: too few stars is refused", deniedReasons(sim).includes("stars-too-low"));
  }

  // 4. insufficient-cash.
  {
    const sim = new Sim("hotel-renovate-cash-1");
    setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, spawnTickMax: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
    sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPosOf(sim));
    const [hotelEntity, hotel0] = [...sim.withComponent("hotel")][0];
    sim.setComponent(hotelEntity, "hotel", { ...hotel0, cash: 0, stars: 2, tier: 0 });
    sim.submit(renovateCommand(sim.tick + 1));
    sim.step();
    check("applyRenovate: insufficient cash is refused", deniedReasons(sim).includes("insufficient-cash"));
  }

  // Success path, for contrast: at the desk, enough stars and cash.
  {
    const sim = new Sim("hotel-renovate-success-1");
    setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, spawnTickMax: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
    sim.setComponent(PLAYER_ENTITY, "pos", deskTerminalPosOf(sim));
    const [hotelEntity, hotel0] = [...sim.withComponent("hotel")][0];
    sim.setComponent(hotelEntity, "hotel", { ...hotel0, cash: RENOVATE_COST_MINOR[1], stars: RENOVATE_STAR_REQ[1], tier: 0 });
    sim.submit(renovateCommand(sim.tick + 1));
    sim.step();
    const hotelAfter = sim.getComponent(hotelEntity, "hotel");
    check("applyRenovate: a fully-qualified renovation succeeds and moves to tier 1", hotelAfter.tier === 1 && hotelAfter.cash === 0);
    const renovatedEvents = sim.eventsSince(0).filter((e) => e.type === "hotel.renovated");
    check("applyRenovate: emits hotel.renovated with from/to", renovatedEvents.length === 1 && renovatedEvents[0].payload.from === 0 && renovatedEvents[0].payload.to === 1);
  }
}

// --- objectives: sim-derived targets, no punishment ----------------------
{
  const specs = generateObjectives(new Rng("obj-1"), 6, 4);
  check("objectives: exactly three are posted", specs.length === 3);
  check(
    "objectives: every target is a positive integer and every reward is a positive integer",
    specs.every((o) => Number.isInteger(o.target) && o.target >= 1 && Number.isInteger(o.rewardMinor) && o.rewardMinor > 0),
  );
  check(
    "objectives: the check-in target never exceeds what could actually arrive",
    specs.find((o) => o.kind === "check-in-guests").target <= 6,
  );
  check(
    "objectives: the fraud objective is always 1 — never a quota that punishes a clean day",
    specs.find((o) => o.kind === "catch-fraud").target === 1,
  );
  check(
    "objectives: generation is deterministic for a given Rng state",
    JSON.stringify(generateObjectives(new Rng("obj-1"), 6, 4)) === JSON.stringify(specs),
  );
  // A slow day must not post an impossible target.
  const slow = generateObjectives(new Rng("obj-2"), 1, 4);
  check("objectives: a one-arrival day posts a reachable check-in target", slow.find((o) => o.kind === "check-in-guests").target === 1);
}

// --- the audit recomputes from truth, and survives a restore -------------
{
  const sim = new Sim("hotel-h2-audit-1");
  setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
  const hotelEntity = [...sim.withComponent("hotel")][0][0];

  // Plant a week of strong reviews directly — the audit's job is to
  // RECOMPUTE from these, so they are the input under test.
  for (let i = 0; i < 5; i++) {
    const e = sim.spawn();
    sim.setComponent(e, "review", { day: 1, segment: "business", score: 5, factors: [] });
  }
  const untilRollover = 6000 - sim.tick;
  for (let t = 0; t < untilRollover; t++) sim.step();

  const hotel = sim.getComponent(hotelEntity, "hotel");
  check("audit: stars recomputed from the review window (5x five-star -> 2 stars)", hotel.stars === 2);
  check("audit: repBySegment recomputed and non-default", hotel.repBySegment.business === 1000);
  const starsChanged = sim.eventsSince(0).filter((e) => e.type === "hotel.starsChanged");
  check("audit: hotel.starsChanged {1 -> 2} fired exactly once", starsChanged.length === 1 && starsChanged[0].payload.from === 1 && starsChanged[0].payload.to === 2);
  const audit = sim.eventsSince(0).find((e) => e.type === "econ.audit");
  check(
    "audit: econ.audit carries stars, repBySegment, forecastArrivals, objectives and the printed hire threshold",
    audit !== undefined &&
      audit.payload.stars === 2 &&
      typeof audit.payload.repBySegment === "object" &&
      typeof audit.payload.forecastArrivals === "number" &&
      Array.isArray(audit.payload.objectives) &&
      audit.payload.objectives.length === 3 &&
      audit.payload.hireThresholdMinor > 0,
  );
  check("audit: three objectives posted for the new day", [...sim.withComponent("objective")].length === 3);
  check(
    "audit: objective.posted fired once per objective",
    sim.eventsSince(0).filter((e) => e.type === "objective.posted").length === 3,
  );

  // Recompute-from-truth means a restore mid-week is trivially correct: a
  // fresh sim restored to this snapshot recomputes the SAME stars at the
  // next audit, because nothing was accumulated anywhere.
  const snapshot = sim.snapshot();
  const restored = new Sim("hotel-h2-audit-1");
  setupWithConfig(restored, { guestCount: 0, spawnTickMin: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
  restored.restore(snapshot);
  check("audit: the restored sim hashes identically", restored.stateHash() === snapshot.stateHash);
  for (let t = 0; t < 6000; t++) {
    sim.step();
    restored.step();
  }
  check(
    "audit: a sim restored mid-week recomputes the identical stars and reputation a day later",
    sim.stateHash() === restored.stateHash() &&
      sim.getComponent(hotelEntity, "hotel").stars === restored.getComponent(hotelEntity, "hotel").stars,
  );
}

// --- wages appear on the expense line only once someone is hired ---------
{
  const sim = new Sim("hotel-h2-wages-1");
  setupWithConfig(sim, { guestCount: 0, spawnTickMin: 100000, fraudRatePermille: 0, fixture: "normal", upkeep: false, arrivals: "fixed" });
  for (let t = sim.tick; t < 6000; t++) sim.step();
  const beforeStaffEntries = [...sim.withComponent("ledgerEntry")].filter(([, e]) => e.debitAccount === "expense:staff");
  check("wages: no staff expense line before anyone is hired", beforeStaffEntries.length === 0);

  const clerk = sim.spawn();
  sim.setComponent(clerk, "staffed", {
    job: "clerk",
    wage: 2500,
    skillPermille: 800,
    moralePermille: 500,
    quirk: "hums",
    hiredDay: 2,
    seed: 7,
  });
  for (let t = sim.tick; t < 12000; t++) sim.step();
  const staffEntries = [...sim.withComponent("ledgerEntry")].filter(([, e]) => e.debitAccount === "expense:staff");
  check("wages: a hired clerk's wage lands on the expense line at the next audit", staffEntries.length === 1 && staffEntries[0][1].amountMinor === 2500);
}

// ============================================================================
// H2a: the app decision-path suite (docs/PHASE-H2.md exit gate 5).
//
// The H1b pattern obligation, applied to all four new apps: clicks at
// coordinates derived from `hotelShell.layout()` at runtime (never pixel
// literals), BOTH branches of every decision, and the guard. Every one of
// these drives the same seam a human does — screen.click -> shell.reduce ->
// app.reduce -> effect -> the sim's validated apply function.
// ============================================================================

function shellRects(sim, terminalEntity) {
  const screenApp = sim.getComponent(terminalEntity, "screenApp");
  return hotelShell.layout(screenApp.state, buildScreenWorldView(sim));
}

/** Click a rect by key, deriving its centre fresh from layout() first. */
function clickRect(sim, terminalEntity, key) {
  const rects = shellRects(sim, terminalEntity);
  const rect = rects[key];
  if (!rect) throw new Error(`no rect ${key} in layout(): ${Object.keys(rects).join(",")}`);
  const point = rectClickPoint(rect);
  sim.submit(screenClickCommand(sim.tick + 1, point.px, point.py));
  sim.step();
}

function openApp(sim, terminalEntity, appId) {
  clickRect(sim, terminalEntity, `taskbar:${appId}`);
}

/** A sim with the player parked at the terminal, focused, and nothing else
 *  going on — the smallest world in which a screen decision is legal. */
function terminalSim(seed, extraConfig) {
  const sim = new Sim(seed);
  setupWithConfig(sim, {
    guestCount: 0,
    spawnTickMin: 100000,
    fraudRatePermille: 0,
    fixture: "normal",
    upkeep: false,
    arrivals: "fixed",
    ...extraConfig,
  });
  const terminalEntity = findTerminalEntity(sim);
  focusTerminal(sim, terminalEntity);
  return { sim, terminalEntity };
}

// --- the shell registers exactly the six H2a apps -----------------------
{
  const { sim, terminalEntity } = terminalSim("hotel-h2-apps-registry");
  const rects = shellRects(sim, terminalEntity);
  const registered = HOTEL_APPS.map((a) => a.id);
  check(
    `shell registry is exactly the six H2a apps (got ${registered.join(",")})`,
    JSON.stringify(registered) === JSON.stringify(["reserva", "audit", "ledger", "pricer", "mailbox", "staff"]),
  );
  check(
    "every registered app has a taskbar hit rect",
    registered.every((id) => rects[`taskbar:${id}`] !== undefined),
  );
}

// --- PRICER: rate up, rate down, and the two guards ---------------------
{
  const { sim, terminalEntity } = terminalSim("hotel-h2-pricer-1");
  const hotelEntity = [...sim.withComponent("hotel")][0][0];
  openApp(sim, terminalEntity, "pricer");
  check("pricer: opens", sim.getComponent(terminalEntity, "screenApp").state.openAppId === "pricer");

  const before = sim.getComponent(hotelEntity, "hotel").rateByTier["1"];

  // Guard: RATE + with no tier selected must not change anything.
  clickRect(sim, terminalEntity, "app:up");
  check(
    "pricer(guard): RATE + with no tier selected changes no rate",
    sim.getComponent(hotelEntity, "hotel").rateByTier["1"] === before,
  );

  clickRect(sim, terminalEntity, "app:tier:1");
  clickRect(sim, terminalEntity, "app:up");
  const up = sim.getComponent(hotelEntity, "hotel").rateByTier["1"];
  check(`pricer: RATE + raises tier 1 by one step (${before} -> ${up})`, up === before + RATE_STEP_MINOR);
  check(
    "pricer: econ.rateSet fired with the actor",
    sim.eventsSince(0).some((e) => e.type === "econ.rateSet" && e.payload.tier === 1 && e.payload.actor === "player"),
  );

  clickRect(sim, terminalEntity, "app:down");
  check("pricer: RATE - lowers it back", sim.getComponent(hotelEntity, "hotel").rateByTier["1"] === before);

  // Guard: the bounds. Walk the rate to the floor and try to go under it.
  let guardTicks = 0;
  while (sim.getComponent(hotelEntity, "hotel").rateByTier["1"] > MIN_RATE_MINOR && guardTicks < 200) {
    clickRect(sim, terminalEntity, "app:down");
    guardTicks++;
  }
  check("pricer: the rate reaches the committed floor", sim.getComponent(hotelEntity, "hotel").rateByTier["1"] === MIN_RATE_MINOR);
  clickRect(sim, terminalEntity, "app:down");
  check(
    "pricer(guard): RATE - at the floor is refused, not clamped silently past it",
    sim.getComponent(hotelEntity, "hotel").rateByTier["1"] === MIN_RATE_MINOR,
  );

  // And the sim refuses an out-of-bounds rate even when the app is bypassed
  // entirely — the app's guard is a courtesy, this is the rule.
  sim.submit(pricerSetRateCommand(sim.tick + 1, 1, MAX_RATE_MINOR + RATE_STEP_MINOR));
  sim.step();
  check(
    "pricer: the COMMAND form is validated too (out-of-bounds rate refused)",
    sim.getComponent(hotelEntity, "hotel").rateByTier["1"] === MIN_RATE_MINOR &&
      sim.eventsSince(0).some((e) => e.type === "screen.denied" && e.payload.reason === "rate-out-of-bounds"),
  );
  sim.submit(pricerSetRateCommand(sim.tick + 1, 1, MIN_RATE_MINOR + 1));
  sim.step();
  check(
    "pricer: an off-step rate is refused",
    sim.getComponent(hotelEntity, "hotel").rateByTier["1"] === MIN_RATE_MINOR,
  );
}

// --- MAILBOX: open a message, the read flag, and the re-read guard ------
{
  const { sim, terminalEntity } = terminalSim("hotel-h2-mailbox-1");
  const mailEntity = sim.spawn();
  sim.setComponent(mailEntity, "mail", {
    day: 1,
    kind: "bulletin",
    subjectKey: "mail.bulletin",
    fields: { names: "Vex Harrow" },
    read: false,
  });
  openApp(sim, terminalEntity, "mailbox");
  check("mailbox: opens", sim.getComponent(terminalEntity, "screenApp").state.openAppId === "mailbox");
  check("mailbox: the message starts unread", sim.getComponent(mailEntity, "mail").read === false);

  clickRect(sim, terminalEntity, `app:mail:${mailEntity}`);
  check("mailbox: opening a message marks it read", sim.getComponent(mailEntity, "mail").read === true);
  check(
    "mailbox: mail.read fired once, with the actor",
    sim.eventsSince(0).filter((e) => e.type === "mail.read" && e.payload.actor === "player").length === 1,
  );

  // Guard: re-opening an already-read message is a view change and nothing
  // more — no second effect, no second event.
  clickRect(sim, terminalEntity, "app:back");
  clickRect(sim, terminalEntity, `app:mail:${mailEntity}`);
  check(
    "mailbox(guard): re-opening a read message emits no second mail.read",
    sim.eventsSince(0).filter((e) => e.type === "mail.read").length === 1,
  );
}

// --- LEDGER: paging back and forward, and the clamp at both ends --------
{
  // Twelve REAL closed days, run through the sim, rather than faked
  // `ledgerEntry` rows plus a faked `hotel.day` — dayPhaseSystem recomputes
  // the day from the tick, so a faked day is overwritten on the very next
  // step and the history silently empties. (It did, and this test caught
  // it.) Twelve days at 6,000 ticks each is under a second.
  const sim = new Sim("hotel-h2-ledger-1");
  setupWithConfig(sim, {
    guestCount: 0,
    spawnTickMin: 100000,
    fraudRatePermille: 0,
    fixture: "normal",
    upkeep: false,
    arrivals: "fixed",
  });
  for (let t = 0; t < 6000 * 13; t++) sim.step();
  const terminalEntity = findTerminalEntity(sim);
  focusTerminal(sim, terminalEntity);
  check(
    "ledger: twelve closed days of real history exist",
    buildScreenWorldView(sim).data.ledgerDays.length >= 12,
  );

  openApp(sim, terminalEntity, "ledger");
  check("ledger: opens", sim.getComponent(terminalEntity, "screenApp").state.openAppId === "ledger");
  const stateOf = () => sim.getComponent(terminalEntity, "screenApp").state.appStates.ledger;
  check("ledger: starts on the newest page", stateOf().pageOffset === 0);

  // Guard at the newest end: NEWER on page 0 does nothing.
  clickRect(sim, terminalEntity, "app:next");
  check("ledger(guard): NEWER on the newest page does not page past it", stateOf().pageOffset === 0);

  clickRect(sim, terminalEntity, "app:prev");
  check("ledger: OLDER pages back", stateOf().pageOffset === 1);
  clickRect(sim, terminalEntity, "app:next");
  check("ledger: NEWER pages forward again", stateOf().pageOffset === 0);

  // Guard at the oldest end.
  for (let i = 0; i < 10; i++) clickRect(sim, terminalEntity, "app:prev");
  const deepest = stateOf().pageOffset;
  clickRect(sim, terminalEntity, "app:prev");
  check(`ledger(guard): OLDER stops at the oldest page (${deepest})`, stateOf().pageOffset === deepest);

  // The STAFF BUDGET line is printed whether or not it is unlocked.
  const view = buildScreenWorldView(sim);
  check("ledger: the view carries the hire threshold so the locked line can print it", view.data.ledger.hireThresholdMinor > 0);
  const painted = JSON.stringify(hotelShell.paintSpec(sim.getComponent(terminalEntity, "screenApp").state, view));
  check("ledger: the STAFF BUDGET line is on screen", painted.includes("STAFF BUDGET"));
}

// --- STAFF: HIRE and PASS, and the two guards ---------------------------
function spawnInterviewingCandidate(sim, wageAsk) {
  const entity = sim.spawn();
  sim.setComponent(entity, "person", { kind: "candidate", name: "Desmond Pike", seed: 4242 });
  sim.setComponent(entity, "candidate", {
    wageAsk,
    skillPermille: 800,
    quirk: "hums showtunes",
    state: "interviewing",
    resumeEntity: 0,
  });
  return entity;
}

{
  const { sim, terminalEntity } = terminalSim("hotel-h2-staff-hire-1");
  const hotelEntity = [...sim.withComponent("hotel")][0][0];
  sim.setComponent(hotelEntity, "hotel", { ...sim.getComponent(hotelEntity, "hotel"), cash: 50000, hireUnlocked: true });
  const candidateEntity = spawnInterviewingCandidate(sim, 3000);

  openApp(sim, terminalEntity, "staff");
  check("staff: opens", sim.getComponent(terminalEntity, "screenApp").state.openAppId === "staff");

  // Guard 1: HIRE with nobody selected decides nothing.
  clickRect(sim, terminalEntity, "app:hire");
  check(
    "staff(guard): HIRE with no candidate selected hires nobody",
    sim.getComponent(candidateEntity, "staffed") === undefined,
  );

  clickRect(sim, terminalEntity, `app:candidate:${candidateEntity}`);
  clickRect(sim, terminalEntity, "app:hire");
  const staffed = sim.getComponent(candidateEntity, "staffed");
  check("staff: HIRE puts the candidate on the payroll", staffed !== undefined && staffed.wage === 3000);
  check(
    "staff: the hire gains an actorId, which is what makes it a second ACTOR",
    sim.getComponent(candidateEntity, "actorId").actor === `staff:${candidateEntity}`,
  );
  check(
    "staff: staff.hired fired with the wage and the deciding actor",
    sim.eventsSince(0).some((e) => e.type === "staff.hired" && e.payload.wage === 3000 && e.payload.actor === "player"),
  );
  check("staff: the hire is no longer interactable as a candidate", sim.getComponent(candidateEntity, "interactable") === undefined);
}

{
  const { sim, terminalEntity } = terminalSim("hotel-h2-staff-pass-1");
  const hotelEntity = [...sim.withComponent("hotel")][0][0];
  sim.setComponent(hotelEntity, "hotel", { ...sim.getComponent(hotelEntity, "hotel"), cash: 50000, hireUnlocked: true });
  const candidateEntity = spawnInterviewingCandidate(sim, 3000);
  // A candidate that can be sent away needs somewhere to walk to.
  sim.setComponent(candidateEntity, "navAgent", {
    goalCx: 0, goalCz: 0, path: [], pathIdx: 0, repathAtTick: 0, jitterSeed: 1, stuckTicks: 0, avoidCx: -1, avoidCz: -1,
  });

  openApp(sim, terminalEntity, "staff");
  clickRect(sim, terminalEntity, `app:candidate:${candidateEntity}`);
  clickRect(sim, terminalEntity, "app:pass");
  check("staff: PASS rejects the candidate", sim.getComponent(candidateEntity, "candidate").state === "rejected");
  check("staff: nobody was put on the payroll", sim.getComponent(candidateEntity, "staffed") === undefined);
  check(
    "staff: staff.rejected fired",
    sim.eventsSince(0).some((e) => e.type === "staff.rejected" && e.payload.candidateEntity === candidateEntity),
  );
}

{
  const { sim, terminalEntity } = terminalSim("hotel-h2-staff-cash-1");
  const hotelEntity = [...sim.withComponent("hotel")][0][0];
  sim.setComponent(hotelEntity, "hotel", { ...sim.getComponent(hotelEntity, "hotel"), cash: 100, hireUnlocked: true });
  const candidateEntity = spawnInterviewingCandidate(sim, 3000);

  openApp(sim, terminalEntity, "staff");
  clickRect(sim, terminalEntity, `app:candidate:${candidateEntity}`);
  clickRect(sim, terminalEntity, "app:hire");
  check(
    "staff(guard): HIRE with less cash than the first wage hires nobody",
    sim.getComponent(candidateEntity, "staffed") === undefined,
  );

  // And the sim refuses it even when the app's guard is bypassed.
  sim.submit(staffHireCommand(sim.tick + 1, candidateEntity, true));
  sim.step();
  check(
    "staff: the COMMAND form re-checks cash too (screen.denied insufficient-cash)",
    sim.getComponent(candidateEntity, "staffed") === undefined &&
      sim.eventsSince(0).some((e) => e.type === "screen.denied" && e.payload.reason === "insufficient-cash"),
  );
}

// --- RESERVA's procedures card is derived from stars, not frozen --------
// H1 froze the active table in a module constant at import. If that came
// back, the card would be identical at both tiers and the escalation system
// would be decorative. The card only paints while a guest is presenting, so
// this drives paintSpec with a synthetic view rather than staging a guest.
{
  const cardAt = (stars) => {
    const view = {
      tick: 1,
      data: {
        queue: {
          reservationEntity: 1,
          guestEntity: 2,
          docFields: { id: { name: "Alex Rivera", docNumber: "X1", expiresDay: "500" } },
          resFields: { guestName: "Alex Rivera", resCode: "RC-1" },
        },
        rooms: [],
        stars,
        ledger: { day: 1, revenueMinor: 0, expenseMinor: 0, closingCashMinor: 0 },
      },
    };
    return JSON.stringify(reservaApp.paintSpec(reservaApp.init(), view));
  };
  const blacklistRow = H1_RULES.find((r) => r.id === "blacklist");
  const atOne = cardAt(1);
  const atTwo = cardAt(2);
  // A distinctive tail, not a prefix: the blacklist row and the name-match
  // row share their first two dozen characters ("The name on the ID must"),
  // so a prefix match would report the blacklist line as present at 1 star.
  const blacklistPhrase = "blacklist bulletin";
  check("reserva(setup): the phrase used below is unique to the blacklist row", blacklistRow.description.includes(blacklistPhrase));
  check("reserva: the blacklist procedure is ABSENT at 1 star", !atOne.includes(blacklistPhrase));
  check("reserva: the blacklist procedure APPEARS at 2 stars", atTwo.includes(blacklistPhrase));
  check("reserva: the two cards genuinely differ", atOne !== atTwo);
  check(
    "reserva: the card grew by exactly the rows the tier activates",
    rulesForStars(H1_RULES, 2).length === rulesForStars(H1_RULES, 1).length + 1,
  );
}

// --- the composed-shell overflow gate, DERIVED from the registry --------
// H1b's loop hardcoded ["reserva","audit"]. Deriving it from HOTEL_APPS is
// the pattern obligation: registering app seven can never silently skip the
// gate, because there is no list to forget to update.
{
  const { sim, terminalEntity } = terminalSim("hotel-h2-overflow-1");
  const hotelEntity = [...sim.withComponent("hotel")][0][0];
  sim.setComponent(hotelEntity, "hotel", {
    ...sim.getComponent(hotelEntity, "hotel"),
    stars: 2,
    cash: 999999,
    hireUnlocked: true,
    repBySegment: { business: 1000, leisure: 1000, family: 1000 },
  });
  // Worst-case content for every app at once.
  for (let day = 1; day <= 20; day++) {
    const e = sim.spawn();
    sim.setComponent(e, "ledgerEntry", { day, debitAccount: "expense:staff", creditAccount: "cash", amountMinor: 999999, memo: "x" });
  }
  for (let i = 0; i < 20; i++) {
    const e = sim.spawn();
    sim.setComponent(e, "mail", {
      day: 20,
      kind: "complaint",
      subjectKey: "mail.complaint",
      fields: { segment: "business", score: "1", factors: "waited-very-long,broken-prop,overpriced" },
      read: false,
    });
  }
  for (const kind of ["check-in-guests", "clean-messes", "catch-fraud"]) {
    const e = sim.spawn();
    sim.setComponent(e, "objective", { day: sim.getComponent(hotelEntity, "hotel").day, kind, target: 99, progress: 0, done: false, rewardMinor: 99999 });
  }
  for (let i = 0; i < 3; i++) {
    const e = sim.spawn();
    sim.setComponent(e, "person", { kind: "candidate", name: "Marguerite Oyelaran", seed: i });
    sim.setComponent(e, "candidate", { wageAsk: 3500, skillPermille: 950, quirk: "will not touch the fax machine", state: "waiting", resumeEntity: 0 });
  }
  const e = sim.spawn();
  sim.setComponent(e, "person", { kind: "staff", name: "Marguerite Oyelaran", seed: 9 });
  sim.setComponent(e, "staffed", { job: "clerk", wage: 3500, skillPermille: 950, quirk: "will not touch the fax machine", hiredDay: 1, seed: 9 });

  let overflowing = 0;
  const covered = [];
  for (const app of HOTEL_APPS) {
    openApp(sim, terminalEntity, app.id);
    const state = sim.getComponent(terminalEntity, "screenApp").state;
    const violations = findOverflowingNodes(hotelShell.paintSpec(state, buildScreenWorldView(sim)));
    covered.push(app.id);
    if (violations.length > 0) {
      overflowing++;
      console.log(`  overflow in ${app.id}: ${JSON.stringify(violations.slice(0, 3))}`);
    }
  }
  check(
    `composed-shell overflow gate covers every registered app, derived from the registry (${covered.join(",")})`,
    covered.length === HOTEL_APPS.length,
  );
  check("composed-shell overflow gate: zero overflowing nodes at worst-case data", overflowing === 0);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
  process.exit(0);
}
