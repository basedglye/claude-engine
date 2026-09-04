/**
 * Demand, pricing bounds, and daily objective generation (docs/PHASE-H2.md
 * §6 and §12). Pure integer helpers — same purity root and the same no-float
 * rule as reviews.ts: every ratio here is permille with truncating division.
 *
 * The anti-dark-pattern stance (DESIGN §6) shows up in this file as a
 * concrete constraint: every number the player is asked to plan against —
 * the hire threshold, the rate bounds, the objective targets and rewards —
 * is a committed constant they can be shown verbatim on a screen. Nothing
 * here is hidden, and nothing here is a variable-ratio schedule.
 */
import type { Rng } from "@claude-engine/core";

// -- Pricing -----------------------------------------------------------

/** PRICER's bounds and step, in minor units. The step exists so a rate is
 *  always a round number on a 1990s screen, and so `pricer.setRate`'s
 *  validation is a simple integer test rather than a float comparison. */
export const MIN_RATE_MINOR = 2000;
export const MAX_RATE_MINOR = 25000;
export const RATE_STEP_MINOR = 500;

export function isValidRate(rateMinor: number): boolean {
  if (!Number.isInteger(rateMinor)) return false;
  if (rateMinor < MIN_RATE_MINOR || rateMinor > MAX_RATE_MINOR) return false;
  return rateMinor % RATE_STEP_MINOR === 0;
}

// -- Hotel (renovation) tier --------------------------------------------

/** Highest reachable hotel tier this phase: 0 Motel, 1 Hotel, 2 Grand
 *  Foyer. */
export const MAX_HOTEL_TIER = 2;

/** Indexed by TARGET hotel tier; index 0 unused (you never renovate to 0).
 *  $800.00 then $1,500.00 — tuned 2026-09-02 (COO) against the
 *  `alpha-loop` bot so tier 1 lands on day 3 and tier 2 on day 7 of a
 *  14-day run, leaving a week of headroom rather than a cliff. */
export const RENOVATE_COST_MINOR: readonly number[] = [0, 80_000, 150_000];

/** Stars required to renovate INTO that tier. MAX_STARS is 2 this phase
 *  (reviews.ts), so 2 is the ceiling and cash is the real gate. */
export const RENOVATE_STAR_REQ: readonly number[] = [0, 2, 2];

/** Lowest hotel tier at which a segment books at all. CEO ruling
 *  2026-09-02: the motel must be a viable if grim business, so tier 0
 *  books the two cheap segments and only the premium one waits for the
 *  Grand Foyer. Shapes BOTH the arrival quota (`arrivalsForDay`, which
 *  segment gets ANY RNG draws at all) and the arrival mix
 *  (`guestSpawnSystem`'s archetype filter, game.ts, which segment an
 *  actual spawned guest can BE) — closed in that second half by
 *  docs/alpha-loop/reviews/W1.md round 2 item 1. */
export const SEGMENT_MIN_HOTEL_TIER: Readonly<Record<string, number>> = {
  family: 0,
  leisure: 0,
  business: 2,
};

/** Multiplies the capture rate, indexed by hotel tier. Tier 0 is
 *  deliberately unpenalised (1000): the tier reward is the multiplier
 *  ABOVE it, not a punishment below it — a 700 here starved the motel
 *  into insolvency and neither the hire nor a renovation was reachable. */
export const TIER_DEMAND_MULT_PERMILLE: readonly number[] = [1000, 1300, 1600];

/** PRICER's ceiling, indexed by hotel tier. Each ceiling sits at or just
 *  above the LOWEST willingness among the segments that book at that tier,
 *  because `arrivalsForDay` prices every segment against the cheapest room
 *  rate on offer: a ceiling above that point lets a rate-maximising player
 *  (or bot) price the whole hotel out of its own market in one day. The
 *  original 12,000/25,000 did exactly that and collapsed demand to zero
 *  the day after the first renovation. */
export const MAX_RATE_BY_TIER_MINOR: readonly number[] = [6_000, 6_500, 7_500];

function clampHotelTier(hotelTier: number): number {
  if (hotelTier < 0) return 0;
  if (hotelTier > MAX_HOTEL_TIER) return MAX_HOTEL_TIER;
  return hotelTier;
}

export function maxRateForHotelTier(hotelTier: number): number {
  const tier = clampHotelTier(hotelTier);
  return MAX_RATE_BY_TIER_MINOR[tier] ?? MAX_RATE_MINOR;
}

export function isValidRateForHotelTier(rateMinor: number, hotelTier: number): boolean {
  if (!Number.isInteger(rateMinor)) return false;
  if (rateMinor < MIN_RATE_MINOR || rateMinor > maxRateForHotelTier(hotelTier)) return false;
  return rateMinor % RATE_STEP_MINOR === 0;
}

// -- The hire threshold ------------------------------------------------

/** $600.00. Diegetic and printed: LEDGER shows the locked STAFF BUDGET
 *  line and the audit repeats the shrinking gap nightly, so the player
 *  always knows exactly what earns what (DESIGN §6). */
export const HIRE_THRESHOLD_MINOR = 60_000;

// -- Demand ------------------------------------------------------------

/** The city's guest pool, per segment, per day, before price and
 *  reputation are applied. Coarse on purpose — PRICER ships at its
 *  coarsest fidelity and the "sharpening" upgrade track is Phase 4. */
export const SEGMENT_POOL: Readonly<Record<string, number>> = {
  business: 4,
  leisure: 4,
  family: 3,
};

/** What each segment considers a fair nightly rate, in minor units. Price
 *  sensitivity is the ratio of your rate to this. */
export const SEGMENT_WILLINGNESS_MINOR: Readonly<Record<string, number>> = {
  business: 9000,
  leisure: 6000,
  family: 5000,
};

/**
 * Capture rate for one segment, in permille, as a function of your price
 * against that segment's willingness, its reputation of you, and your star
 * tier. All integer permille with truncating division.
 *
 * Shape: price is the dominant term (halving your rate roughly doubles
 * interest, up to a cap), reputation scales it, and each star adds a flat
 * bonus. Deliberately legible — the player is meant to be able to reason
 * "cheaper and better-liked means fuller", not to reverse-engineer a curve.
 */
export function capturePermille(
  rateMinor: number,
  willingnessMinor: number,
  reputationPermille: number,
  stars: number,
  tierMultPermille = 1000,
): number {
  if (willingnessMinor <= 0) return 0;
  // priceTerm: 1000 at exactly the willingness price, more below it, less
  // above, clamped so neither end runs away.
  const ratioPermille = Math.trunc((rateMinor * 1000) / willingnessMinor);
  let priceTerm = 2000 - ratioPermille;
  if (priceTerm < 100) priceTerm = 100;
  if (priceTerm > 1400) priceTerm = 1400;

  // reputationTerm: 500 permille reputation is neutral (1000), 0 is half,
  // 1000 is one and a half.
  const reputationTerm = 500 + reputationPermille;

  const starBonus = 1000 + (stars - 1) * 100;

  let capture = Math.trunc((priceTerm * reputationTerm) / 1000);
  capture = Math.trunc((capture * starBonus) / 1000);
  capture = Math.trunc(capture / 2);
  // Tier multiplier applies before the final clamp (§4.3).
  capture = Math.trunc((capture * tierMultPermille) / 1000);
  if (capture < 0) capture = 0;
  if (capture > 1000) capture = 1000;
  return capture;
}

/**
 * Tomorrow's arrivals, per segment. `rng` is drawn exactly once per segment
 * (a single integer roll against the capture rate per pool member), at the
 * day rollover and nowhere else — draw-at-generation, per H2 determinism
 * rule 3. Segments are iterated in sorted order so the draw sequence
 * depends only on the segment names, never on object key order.
 */
export function arrivalsForDay(
  rng: Rng,
  rateByTier: Record<string, number>,
  repBySegment: Record<string, number>,
  stars: number,
  defaultReputationPermille: number,
  hotelTier: number,
): Record<string, number> {
  // Segments book against the cheapest tier on offer — a coarse model, and
  // the honest one for a hotel with two tiers and no per-tier preference.
  let rate = MAX_RATE_MINOR;
  for (const key of Object.keys(rateByTier).sort()) {
    const value = rateByTier[key]!;
    if (value < rate) rate = value;
  }

  const out: Record<string, number> = {};
  for (const segment of Object.keys(SEGMENT_POOL).sort()) {
    // Below its minimum hotel tier, the segment neither books nor draws
    // RNG — the stream must stay deterministic and skip in lockstep with
    // which segments are even eligible.
    if ((SEGMENT_MIN_HOTEL_TIER[segment] ?? 0) > hotelTier) {
      out[segment] = 0;
      continue;
    }
    const pool = SEGMENT_POOL[segment]!;
    const willingness = SEGMENT_WILLINGNESS_MINOR[segment] ?? MAX_RATE_MINOR;
    const reputation = repBySegment[segment] ?? defaultReputationPermille;
    const tierMult = TIER_DEMAND_MULT_PERMILLE[clampHotelTier(hotelTier)] ?? 1000;
    const capture = capturePermille(rate, willingness, reputation, stars, tierMult);
    let count = 0;
    for (let i = 0; i < pool; i++) {
      if (rng.int(0, 999) < capture) count++;
    }
    out[segment] = count;
  }
  return out;
}

/** Total arrivals across segments. */
export function totalArrivals(bySegment: Record<string, number>): number {
  let total = 0;
  for (const segment of Object.keys(bySegment).sort()) total += bySegment[segment]!;
  return total;
}

// -- Daily objectives --------------------------------------------------

/** One objective template. `target` is derived from world state at posting
 *  time so an objective is always achievable from where the player
 *  actually is — sim-derived, per DESIGN §6, never a fixed grind. */
export interface ObjectiveSpec {
  kind: string;
  target: number;
  rewardMinor: number;
}

/** The three kinds H2a posts. Kept as data so a later phase appends rather
 *  than edits. `event` is the event type whose occurrences count toward
 *  progress; `perUnitReward` is paid per target unit. */
export const OBJECTIVE_KINDS: readonly { kind: string; event: string; perUnitReward: number }[] = [
  { kind: "check-in-guests", event: "guest.checkedIn", perUnitReward: 800 },
  { kind: "clean-messes", event: "room.messCleaned", perUnitReward: 500 },
  { kind: "catch-fraud", event: "desk.fraudCaught", perUnitReward: 2500 },
];

/**
 * Three objectives for the coming day, in a deterministic order.
 *
 * `expectedArrivals` and `roomCount` shape the targets so a slow day does
 * not post an impossible check-in count. `rng` is drawn once per objective,
 * at the rollover — again draw-at-generation.
 */
export function generateObjectives(
  rng: Rng,
  expectedArrivals: number,
  roomCount: number,
): ObjectiveSpec[] {
  const out: ObjectiveSpec[] = [];
  for (const template of OBJECTIVE_KINDS) {
    let target: number;
    switch (template.kind) {
      case "check-in-guests":
        // At most what could plausibly arrive, at least one.
        target = clampInt(Math.trunc((expectedArrivals * 2) / 3) + rng.int(0, 1), 1, Math.max(1, expectedArrivals));
        break;
      case "clean-messes":
        // Bounded by the rooms that could actually turn over today.
        target = clampInt(1 + rng.int(0, 2), 1, Math.max(1, roomCount));
        break;
      default:
        // Fraud is rare and not under the player's control, so the target
        // is always 1: "catch the one that shows up", never a quota that
        // punishes a clean day.
        target = 1;
        break;
    }
    out.push({ kind: template.kind, target, rewardMinor: target * template.perUnitReward });
  }
  return out;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// -- Fixed daily costs -------------------------------------------------

export const DAILY_UTILITIES_MINOR = 1500;
/** The owner's own draw. Wages for HIRED staff are additional and come from
 *  the `staffed` components. */
export const DAILY_OVERHEAD_MINOR = 3000;

// -- Fraud chargeback (CYCLE-3 lane 5, CEO ruling) ----------------------

/** The ledger account a missed-fraud guest's check-in charge is reversed
 *  through at checkout: debitAccount CHARGEBACK_ACCOUNT, creditAccount
 *  "cash", amountMinor = what they paid -- the same double-entry shape
 *  every other ledger line in this file's callers uses. expense:-prefixed
 *  on purpose, exactly like expense:capex: the day-close sweep
 *  (dayPhaseSystem, game.ts) already folds every expense:-prefixed debit
 *  into expenseMinor with no per-account allowlist, so a missed fraud's
 *  cost shows up in the nightly total the instant this account exists --
 *  no separate wiring needed there. The audit ALSO breaks this one
 *  account out by name (fraudLossMinor) so it is legible as its own line,
 *  not just folded anonymously into "expenses". */
export const CHARGEBACK_ACCOUNT = "expense:chargeback";
