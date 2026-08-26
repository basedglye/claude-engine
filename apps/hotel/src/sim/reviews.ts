/**
 * Review scoring and the reputation/star math (docs/PHASE-H2.md §10).
 *
 * Purity: this file lives under the `apps/hotel/src/sim` purity root. No
 * `Math.*` transcendentals, no `Math.random`, and — the rule this file is
 * most exposed to — **no floats**. Every average here is integer permille
 * with truncating division, because a float average would be the easiest
 * way in the whole codebase to smuggle platform-dependent rounding into
 * `stateHash`.
 *
 * Design rulings this file encodes (DESIGN §6, H2 spec §10):
 *   - The score is a function of objective STAY FACTS, not of the guest's
 *     archetype. Archetypes are flavour; a hard-to-please personality
 *     modifier would make the same service score differently for reasons
 *     the player cannot see, which is the opposite of the transparency
 *     stance.
 *   - Reputation and stars are RECOMPUTED from a rolling window of review
 *     components at each audit, never accumulated in place. A mid-week
 *     `Sim.restore()` is then trivially correct: there is no running total
 *     to get out of step with the reviews that produced it.
 */

/** The objective facts of one completed stay. All integers. */
export interface StayFacts {
  /** Ticks the guest spent in the queue before being served. */
  waitedTicks: number;
  /** Nights slept in a room with a broken prop. */
  brokenPropNights: number;
  /** What this stay was actually charged, in minor units. */
  paidMinor: number;
  /** The opening rate for the room's tier — the "is this fair?" reference. */
  tierBaselineMinor: number;
}

export interface ReviewOutcome {
  /** 1..5. */
  score: number;
  /** Stable slugs naming what moved the score, for MAILBOX complaint text
   *  and for gates that want to assert WHY a review was bad. */
  factors: string[];
}

/** A wait longer than this many ticks costs a star; twice this costs two.
 *  ~30s and ~60s of real time at 20 Hz. */
const WAIT_ANNOY_TICKS = 600;
/** Charging more than baseline + this many permille reads as gouging. */
const GOUGE_PERMILLE = 300;

/**
 * The 1..5 score. Starts perfect and comes down for things the player did
 * (or failed to do) — never for a dice roll, so a given stay always scores
 * the same. That is a design requirement, not an implementation detail:
 * "variable-ratio reward schedules" is on DESIGN's explicit dark-pattern
 * avoid-list, and a randomised review score is exactly that shape.
 */
export function scoreReview(facts: StayFacts): ReviewOutcome {
  const factors: string[] = [];
  let score = 5;

  if (facts.waitedTicks >= WAIT_ANNOY_TICKS * 2) {
    score -= 2;
    factors.push("waited-very-long");
  } else if (facts.waitedTicks >= WAIT_ANNOY_TICKS) {
    score -= 1;
    factors.push("waited-long");
  }

  if (facts.brokenPropNights > 0) {
    // One star for the first broken night, one more for a second — and
    // then it stops. A stay cannot spiral: a broken prop is a broken prop
    // (H2 spec §9, "no incident cascade").
    score -= facts.brokenPropNights >= 2 ? 2 : 1;
    factors.push("broken-prop");
  }

  if (facts.tierBaselineMinor > 0) {
    const paidPermille = Math.trunc((facts.paidMinor * 1000) / facts.tierBaselineMinor);
    if (paidPermille > 1000 + GOUGE_PERMILLE) {
      score -= 1;
      factors.push("overpriced");
    } else if (paidPermille < 1000) {
      // A bargain buys back at most the one star it can.
      score += 1;
      factors.push("good-value");
    }
  }

  if (score < 1) score = 1;
  if (score > 5) score = 5;
  return { score, factors };
}

/** One review, as `reputationBySegment` reads them. */
export interface ReviewRow {
  day: number;
  segment: string;
  score: number;
}

/** How many days of reviews reputation and stars are computed over. */
export const REVIEW_WINDOW_DAYS = 7;
/** Reputation of a segment nobody has reviewed yet — the middle of the
 *  road, so an unreviewed segment is neither a bonus nor a penalty. */
export const DEFAULT_REP_PERMILLE = 500;

/**
 * Per-segment reputation in permille, recomputed from scratch over the
 * trailing `REVIEW_WINDOW_DAYS` ending at `today`. A 1..5 score maps
 * linearly onto 0..1000, so 3 stars is exactly 500 — the same value an
 * unreviewed segment gets, which keeps the first review from being a
 * cliff. Truncating integer division throughout.
 */
export function reputationBySegment(reviews: readonly ReviewRow[], today: number): Record<string, number> {
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  for (const review of reviews) {
    if (review.day <= today - REVIEW_WINDOW_DAYS) continue;
    sum.set(review.segment, (sum.get(review.segment) ?? 0) + scoreToPermille(review.score));
    count.set(review.segment, (count.get(review.segment) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  // Sorted so the component's key order — which IS hashed — depends only
  // on the segment names present, never on Map insertion order.
  for (const segment of [...sum.keys()].sort()) {
    out[segment] = Math.trunc(sum.get(segment)! / count.get(segment)!);
  }
  return out;
}

function scoreToPermille(score: number): number {
  const clamped = score < 1 ? 1 : score > 5 ? 5 : score;
  return Math.trunc(((clamped - 1) * 1000) / 4);
}

/** Overall reputation in permille: the straight mean of the per-segment
 *  values present, or the default when there are none. */
export function overallReputation(repBySegment: Record<string, number>): number {
  const segments = Object.keys(repBySegment).sort();
  if (segments.length === 0) return DEFAULT_REP_PERMILLE;
  let total = 0;
  for (const segment of segments) total += repBySegment[segment]!;
  return Math.trunc(total / segments.length);
}

/** Permille reputation at or above which each tier is earned. Indexed by
 *  tier, so index 2 is the second star. Tiers 3-5 are committed here and
 *  unreachable this phase (see MAX_STARS) so a later phase raises a cap
 *  rather than inventing a formula. */
export const STAR_THRESHOLDS_PERMILLE: readonly number[] = [0, 0, 600, 750, 875];

/** Minimum number of reviews in the window before a tier can be earned at
 *  all — one glowing review should not promote a hotel. */
export const STAR_MIN_REVIEWS = 3;

/**
 * The highest tier this phase can reach. H2a ships CONTENT for two stars —
 * one star-gated rule row (the blacklist) and nothing above it — so the
 * math is capped to match. Raising this is a content decision (more rule
 * rows, amenities, guest tiers), not a formula change, and the cap is here
 * rather than in the threshold table so the thresholds for 3-5 stay
 * committed and reviewable while being unreachable.
 */
export const MAX_STARS = 2;

/**
 * The star tier, recomputed at the audit from the window. Clamped to
 * 1..MAX_STARS. Never drops below 1: the floor is a recoverable 1-star
 * one-man show (DESIGN §7's failure-spiral ruling).
 */
export function starsFromReputation(reputationPermille: number, reviewCount: number): number {
  if (reviewCount < STAR_MIN_REVIEWS) return 1;
  let stars = 1;
  for (let tier = 2; tier < STAR_THRESHOLDS_PERMILLE.length; tier++) {
    if (reputationPermille >= STAR_THRESHOLDS_PERMILLE[tier]!) stars = tier;
  }
  return stars > MAX_STARS ? MAX_STARS : stars;
}
