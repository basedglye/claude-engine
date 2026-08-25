// Unit tests for apps/hotel's sim/rules.ts, run against the built
// dist-game/ (npm run test builds via build:game first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs's style
// (PASS:/FAIL: lines, process.exit(1) on any failure) rather than pulling in
// a test framework.
import { Rng } from "@claude-engine/core";
import { H1_RULES, evaluateRules, plantViolation, rulesForStars, describeRule } from "../dist-game/sim/rules.js";

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

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
  process.exit(0);
}
