/**
 * The RESERVA rule table — Phase H1a's forward-compatibility keystone (see
 * docs/PHASE-H1.md, "The RESERVA rule table"). Rows are DATA; the evaluator
 * is the only code. Later star tiers append rows (and at most new
 * `check.kind` variants) — nothing here restructures.
 *
 * Purity: this file lives under the `apps/hotel/src/sim` purity root
 * (banTranscendentals). No Math.sin/cos/tan/atan2/pow/exp/log/hypot/cbrt,
 * no Math.random — all randomness is the passed-in seeded Rng. No floats:
 * `day` and every date field are integer sim days, never `Date`.
 *
 * One oracle, three consumers (docs/PHASE-H1.md): `deskSystem` uses
 * `evaluateRules` for ground truth (comparing the result against
 * `reservation.plantedViolations`), `clerkBot`'s `decide` callback uses it
 * to choose accept/deny, and the RESERVA app calls `describeRule` to render
 * the diegetic "procedures card" — descriptions only, never results. The
 * player is the one running the evaluator in their head; that's the game.
 */
import type { Rng } from "@claude-engine/core";

/** One verification rule. Rows are DATA — see file header. */
export interface RuleSpec {
  /** Stable slug, e.g. "name-match". Never reused across rows. */
  id: string;
  /** Escalation gate: a rule is active only when the desk's current star
   *  tier is >= minStars. H1 ships every row at minStars 1 (all active from
   *  day one); later phases append rows at minStars 2+. */
  minStars: number;
  check:
    | { kind: "fieldMatch"; docType: string; docField: string; resField: string }
    | { kind: "docPresent"; docType: string }
    | { kind: "notExpired"; docType: string; dateField: string } // vs sim day
    | { kind: "listed"; listId: string; docType: string; docField: string; mustBe: "absent" | "present" };
  // Phase 3+ adds variants: crossRef, loyaltyTier, billingCode — additive.
  /** Violation slug emitted on failure. Unique per row (doubles as the row's
   *  stable identity for plant/evaluate round-tripping). */
  failFlag: string;
  /** Human-readable description of what the rule checks, for RESERVA's
   *  diegetic "procedures card". Never used for evaluation — describing a
   *  rule and evaluating it are deliberately separate code paths so the
   *  card can never leak evaluation results. */
  description: string;
}

/** What `evaluateRules` needs about the current world, besides the rows
 *  themselves and the documents/reservation fields (H1: `lists` is always
 *  empty — MAILBOX starts populating it in Phase 3). */
export interface RuleContext {
  /** Current sim day, integer. Compared against `notExpired` date fields. */
  day: number;
  /** Named lists (blacklists, loyalty rolls) — H1: empty. MAILBOX delivers
   *  list updates in Phase 3 by writing components this is built from. */
  lists: Record<string, readonly string[]>;
}

/** A minimal view of one document's fields, as read off the `document`
 *  component (`{ docType, fields }`). `evaluateRules`/`plantViolation` only
 *  need `docType` and `fields` — not the full component shape (ownerEntity,
 *  heldBy are irrelevant to rule evaluation). */
export interface RuleDoc {
  docType: string;
  fields: Record<string, string>;
}

/** The reservation's own fields (guest name, code, etc.) — separate from
 *  `docs` because a `fieldMatch` row compares a document field against a
 *  reservation field, and the reservation is not itself a document. */
export type ResFields = Record<string, string>;

// --- H1_RULES ---------------------------------------------------------------
//
// Field-name convention (open question 1 — implementer's call, documented
// here so later phases don't have to reverse-engineer it):
//   - "id" document: fields { name, docNumber, expiresDay }  (expiresDay is
//     an integer sim day, e.g. 400 — no Date objects anywhere).
//   - "resSlip" document: fields { guestName, resCode }
//   - reservation fields: { guestName, resCode }
// `fieldMatch` compares a document field against a *reservation* field
// (never document-to-document) — the reservation is the ground truth the
// desk is checking presented documents against, matching how a real front
// desk cross-references a printed confirmation.

export const H1_RULES: readonly RuleSpec[] = [
  {
    id: "id-present",
    minStars: 1,
    check: { kind: "docPresent", docType: "id" },
    failFlag: "id-missing",
    description: "Guest must present a valid ID document.",
  },
  {
    id: "res-slip-present",
    minStars: 1,
    check: { kind: "docPresent", docType: "resSlip" },
    failFlag: "res-slip-missing",
    description: "Guest must present a reservation slip.",
  },
  {
    id: "name-match",
    minStars: 1,
    check: { kind: "fieldMatch", docType: "id", docField: "name", resField: "guestName" },
    failFlag: "name-mismatch",
    description: "The name on the ID must match the reservation's guest name.",
  },
  {
    id: "res-code-match",
    minStars: 1,
    check: { kind: "fieldMatch", docType: "resSlip", docField: "resCode", resField: "resCode" },
    failFlag: "res-code-mismatch",
    description: "The reservation code on the slip must match the booking's reservation code.",
  },
  {
    id: "id-not-expired",
    minStars: 1,
    check: { kind: "notExpired", docType: "id", dateField: "expiresDay" },
    failFlag: "id-expired",
    description: "The ID must not be expired as of today.",
  },
];

/** Finds the document of the given type, or undefined if absent. Docs are a
 *  small array (one guest presents at most a handful), so a linear scan is
 *  simplest and deterministic (first match in array order — array order is
 *  itself deterministic, set by `guestSpawnSystem`). */
function findDoc(docs: readonly RuleDoc[], docType: string): RuleDoc | undefined {
  for (const doc of docs) {
    if (doc.docType === docType) return doc;
  }
  return undefined;
}

/** Runs one rule's check against the given docs/resFields/ctx. Returns true
 *  iff the rule PASSES (no violation). A missing document or field counts
 *  as a failure for any check that reads it, so a guest who simply doesn't
 *  present a document fails every rule that reads that document's fields,
 *  not just `docPresent` — matching real-desk behaviour (you can't check a
 *  name match against an ID that isn't there). */
function checkPasses(rule: RuleSpec, docs: readonly RuleDoc[], resFields: ResFields, ctx: RuleContext): boolean {
  const check = rule.check;
  switch (check.kind) {
    case "docPresent": {
      return findDoc(docs, check.docType) !== undefined;
    }
    case "fieldMatch": {
      // A missing document is NOT this rule's concern — `docPresent` is the
      // dedicated row for that, and it fires on its own. Treating "doc
      // absent" as a pass here (rather than a failure) keeps a single
      // planted violation from cascading into unrelated rows: removing the
      // ID document should trip exactly `id-missing`, not also
      // `name-mismatch` because there's nothing left to compare.
      const doc = findDoc(docs, check.docType);
      if (doc === undefined) return true;
      const docValue = doc.fields[check.docField];
      const resValue = resFields[check.resField];
      if (docValue === undefined || resValue === undefined) return false;
      return docValue === resValue;
    }
    case "notExpired": {
      // Same reasoning as fieldMatch: no document to check means this rule
      // has nothing to say, so it passes and lets docPresent own the flag.
      const doc = findDoc(docs, check.docType);
      if (doc === undefined) return true;
      const raw = doc.fields[check.dateField];
      if (raw === undefined) return false;
      const expiresDay = Number.parseInt(raw, 10);
      if (!Number.isFinite(expiresDay)) return false;
      return expiresDay >= ctx.day;
    }
    case "listed": {
      // Same reasoning again: absence is docPresent's problem, not this
      // rule's.
      const doc = findDoc(docs, check.docType);
      if (doc === undefined) return true;
      const value = doc.fields[check.docField];
      if (value === undefined) return true;
      const list = ctx.lists[check.listId] ?? [];
      const isPresent = list.includes(value);
      return check.mustBe === "present" ? isPresent : !isPresent;
    }
  }
}

/** Pure evaluator: returns the violated failFlags, in table order (`rules`
 *  array order — deterministic, matches the spec's "in table order").
 *  Rows with `minStars` above the active tier are simply not in the
 *  `rules` array passed in — see design note below on where the filter
 *  lives. */
export function evaluateRules(
  rules: readonly RuleSpec[],
  docs: readonly RuleDoc[],
  resFields: ResFields,
  ctx: RuleContext,
): string[] {
  const flags: string[] = [];
  for (const rule of rules) {
    if (!checkPasses(rule, docs, resFields, ctx)) {
      flags.push(rule.failFlag);
    }
  }
  return flags;
}

/** Filters a rule table down to the rows active at the given star tier.
 *  Exported so callers apply it once and pass the filtered table to both
 *  `evaluateRules` and `plantViolation` — see design note below on why the
 *  filter lives here rather than inside `evaluateRules`'s signature. */
export function rulesForStars(rules: readonly RuleSpec[], stars: number): RuleSpec[] {
  return rules.filter((r) => r.minStars <= stars);
}

/**
 * The inverse of evaluation: picks one rule via the given Rng, then mutates
 * a *copy* of docs/resFields so that exactly that rule fails and no other
 * row in `rules` does. Returns the chosen rule's `failFlag`.
 *
 * Pure function of (rules, rng state, inputs) — the only side effect is
 * advancing the passed-in Rng (which the caller owns and snapshots via
 * `forkRng`, per determinism rule 4: fraud planting draws only from
 * registered forks).
 *
 * Guarantees (the load-bearing plant/evaluate property, see rules.test.mjs):
 * for every seed and every rule row, planting that row's violation and then
 * evaluating the resulting docs/resFields against the same `rules` table
 * yields EXACTLY `[thatRule.failFlag]` — not a superset, not a subset. This
 * is what makes every plantable fraud catchable and unambiguous.
 */
export function plantViolation(
  rules: readonly RuleSpec[],
  rng: Rng,
  docs: readonly RuleDoc[],
  resFields: ResFields,
): { docs: RuleDoc[]; resFields: ResFields; failFlag: string } {
  if (rules.length === 0) {
    throw new Error("plantViolation: rules table is empty");
  }
  const rule = rng.pick(rules);

  // Deep-ish copy: docs is a small array of small field maps.
  const nextDocs: RuleDoc[] = docs.map((d) => ({ docType: d.docType, fields: { ...d.fields } }));
  const nextResFields: ResFields = { ...resFields };

  const check = rule.check;
  switch (check.kind) {
    case "docPresent": {
      // Remove the document entirely — the only way to fail docPresent
      // without incidentally failing any other row's check that reads a
      // DIFFERENT document (fields on other docs are left untouched).
      const idx = nextDocs.findIndex((d) => d.docType === check.docType);
      if (idx >= 0) nextDocs.splice(idx, 1);
      break;
    }
    case "fieldMatch": {
      // Mutate the document field so it no longer matches the reservation
      // field. Leave the reservation field alone (mutating the doc side
      // keeps this row's failure from touching any other row that reads
      // the reservation field directly, since H1 rules don't).
      const doc = nextDocs.find((d) => d.docType === check.docType);
      const original = doc?.fields[check.docField];
      const mutated = mutateString(original ?? "", rng);
      if (doc) doc.fields[check.docField] = mutated;
      break;
    }
    case "notExpired": {
      const doc = nextDocs.find((d) => d.docType === check.docType);
      if (doc) doc.fields[check.dateField] = "0"; // day 0: always expired
      break;
    }
    case "listed": {
      const doc = nextDocs.find((d) => d.docType === check.docType);
      if (doc) {
        if (check.mustBe === "present") {
          // Must NOT be on the list to violate "must be present" —
          // simplest guaranteed-absent sentinel value.
          doc.fields[check.docField] = "__not-on-any-list__";
        } else {
          // mustBe "absent": to violate, the value must BE on the list.
          // H1 ships no lists, so there is no value guaranteed to be on
          // an empty list; this branch is unreachable with H1_RULES (no
          // "listed" row ships), but is implemented for forward
          // compatibility per the spec's contract.
          doc.fields[check.docField] = "__unreachable-h1-listed-present__";
        }
      }
      break;
    }
  }

  return { docs: nextDocs, resFields: nextResFields, failFlag: rule.failFlag };
}

/** Deterministically perturbs a string so it differs from `original`, using
 *  only the passed-in Rng (no Math.random). Appends a short suffix drawn
 *  from the Rng — guaranteed to differ from `original` since the suffix is
 *  never empty. */
function mutateString(original: string, rng: Rng): string {
  const suffix = rng.int(0, 999999);
  return `${original}~${suffix}`;
}

/** Human-readable description of a rule, for RESERVA's "procedures card".
 *  A thin accessor (not just `rule.description`) so the app has one stable
 *  import to call regardless of whether description ends up derived later —
 *  currently a direct field read. */
export function describeRule(rule: RuleSpec): string {
  return rule.description;
}
