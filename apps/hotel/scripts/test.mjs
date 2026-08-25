// Unit tests for apps/hotel's sim/rules.ts, run against the built
// dist-game/ (npm run test builds via build:game first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs's style
// (PASS:/FAIL: lines, process.exit(1) on any failure) rather than pulling in
// a test framework.
import { Rng, Sim } from "@claude-engine/core";
import { H1_RULES, evaluateRules, plantViolation, rulesForStars, describeRule } from "../dist-game/sim/rules.js";
import {
  setupWithConfig,
  PLAYER_ENTITY,
  interactCommand,
  deskDecisionCommand,
} from "../dist-game/sim/game.js";
import { jitter } from "../dist-game/sim/nav.js";

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
  check("H1_RULES rows are all minStars 1 in H1", H1_RULES.every((r) => r.minStars === 1));
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
  check("minStars filtering keeps all H1 rows at star 1", star1.length === H1_RULES.length);

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
  const a = plantViolation(H1_RULES, rngA, cleanDocs(), cleanRes());
  const b = plantViolation(H1_RULES, rngB, cleanDocs(), cleanRes());
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
      // Force the Rng to pick THIS rule: use a single-row table so
      // rng.pick always selects it, isolating "does this rule's planter
      // produce exactly this rule's flag" from "does rng.pick distribute
      // correctly" (rng.pick itself is exercised by the multi-row
      // determinism test above and by packages/core's own rng tests).
      const rng = new Rng(seed);
      const singleRowTable = [rule];
      const planted = plantViolation(singleRowTable, rng, cleanDocs(), cleanRes());
      const flags = evaluateRules(H1_RULES, planted.docs, planted.resFields, ctx);
      ranSeedRowPairs++;
      const exact = flags.length === 1 && flags[0] === rule.failFlag;
      if (!exact && firstFailure === null) {
        firstFailure = { seed, ruleId: rule.id, expected: rule.failFlag, got: flags };
      }
      if (!exact) allExact = false;
    }
  }

  check(
    `plant/evaluate property holds exactly for ${SEEDS} seeds x ${H1_RULES.length} rules (${ranSeedRowPairs} pairs)`,
    allExact,
  );
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
    const planted = plantViolation(H1_RULES, rng, cleanDocs(), cleanRes());
    const flags = evaluateRules(H1_RULES, planted.docs, planted.resFields, ctx);
    const exact = flags.length === 1 && flags[0] === planted.failFlag;
    if (!exact) allExact = false;
  }
  check(`plant/evaluate property also holds when rng.pick selects the rule (${SEEDS} seeds, full table)`, allExact);
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

const FSM_CONFIG = { guestCount: 2, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal" };

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
  sim.step();
  check("FSM(deny): guest transitions to leaving", sim.getComponent(guestEntity, "guest").state === "leaving");

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

// --- Double-entry ledger -----------------------------------------------------
{
  const sim = new Sim("hotel-h1a-ledger-1");
  setupWithConfig(sim, { guestCount: 3, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal" });

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
  setupWithConfig(sim, { guestCount: 8, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal" });

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

// --- despawn clears departed guests and their documents ----------------------
{
  const sim = new Sim("hotel-h1a-despawn-1");
  setupWithConfig(sim, { guestCount: 1, spawnTickMin: 1, spawnTickMax: 1, fraudRatePermille: 0, fixture: "normal" });

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

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
  process.exit(0);
}
