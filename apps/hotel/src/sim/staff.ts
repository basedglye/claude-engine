/**
 * Candidate generation and the hired clerk's decision behaviour
 * (docs/PHASE-H2.md §8). Pure integer helpers; same purity root as
 * reviews.ts and economy.ts.
 *
 * THE DETERMINISM RULE THIS FILE EXISTS FOR (H2 rule 3, "draw at
 * generation, hash at decision"): a candidate's wage, skill and quirk are
 * drawn ONCE, from `forkRng("staff")`, at the moment the candidate is
 * created. The clerk's per-decision mistakes are NOT draws — they are a
 * stateless hash of `(staffed.seed, reservationEntity)`. If they were
 * draws, how OFTEN the clerk decided would advance an Rng stream, and
 * decision frequency depends on guest arrivals, player interference and
 * timing — so the same seed would replay differently the moment anything
 * upstream shifted by a tick. This is the same reasoning as nav jitter.
 */
import type { Rng } from "@claude-engine/core";
import { hash32 } from "./nav.js";

/** Every hire has a flaw, stated up front (DESIGN §7). H2a's quirks are
 *  DATA only — no system reads them, by design, so the first hire is about
 *  trust rather than about stat-shopping. */
export const QUIRKS: readonly string[] = [
  "hums showtunes",
  "afraid of the elevator",
  "over-explains the wifi",
  "collects hotel pens",
  "will not touch the fax machine",
  "calls every guest 'chief'",
];

export const CANDIDATE_NAMES: readonly string[] = [
  "Marguerite Oyelaran",
  "Desmond Pike",
  "Hattie Vance",
  "Cyril Nakamura",
  "Bernadette Osei",
  "Lorne Whitaker",
];

/** Wage ask, in minor units per day. Narrow and legible: the point of the
 *  first hire is that the player can afford it and can see the trade. */
export const MIN_WAGE_MINOR = 2000;
export const MAX_WAGE_MINOR = 3500;
export const WAGE_STEP_MINOR = 250;

/** Skill band. A clerk is competent but not perfect — the trust loop needs
 *  them to be occasionally, discoverably wrong. */
export const MIN_SKILL_PERMILLE = 650;
export const MAX_SKILL_PERMILLE = 950;

export interface CandidateSpec {
  name: string;
  wageAsk: number;
  skillPermille: number;
  quirk: string;
  /** Feeds the stateless decision-error hash once hired. */
  seed: number;
}

/**
 * One candidate, drawn from the "staff" fork. `index` disambiguates the
 * candidates generated in the same batch so two of them cannot land on the
 * same name.
 */
export function generateCandidate(rng: Rng, index: number): CandidateSpec {
  const name = CANDIDATE_NAMES[(rng.int(0, CANDIDATE_NAMES.length - 1) + index) % CANDIDATE_NAMES.length]!;
  const steps = Math.trunc((MAX_WAGE_MINOR - MIN_WAGE_MINOR) / WAGE_STEP_MINOR);
  const wageAsk = MIN_WAGE_MINOR + rng.int(0, steps) * WAGE_STEP_MINOR;
  const skillPermille = MIN_SKILL_PERMILLE + rng.int(0, MAX_SKILL_PERMILLE - MIN_SKILL_PERMILLE);
  const quirk = rng.pick(QUIRKS);
  return { name, wageAsk, skillPermille, quirk, seed: rng.int(0, 0x7fffffff) };
}

/** How many candidates a hiring round produces (open question 3). */
export const CANDIDATES_PER_ROUND = 2;

/**
 * How long the clerk visibly deliberates before deciding, in ticks. Skill
 * shortens it, and the floor is long enough that a player standing in
 * their own lobby can WATCH the decision happen — that pause is the beat
 * (docs/PHASE-H2.md §8), not a delay to be tuned away.
 */
export function decisionDelayTicks(skillPermille: number): number {
  const clamped = skillPermille < 0 ? 0 : skillPermille > 1000 ? 1000 : skillPermille;
  // 40 ticks (2s) at skill 1000, 70 ticks (3.5s) at skill 0.
  return 40 + Math.trunc(((1000 - clamped) * 30) / 1000);
}

/**
 * Does this clerk get THIS decision wrong? A pure function of the clerk's
 * seed and the reservation they are deciding — so re-deciding the same
 * reservation is the same answer, and deciding a different one is
 * independent, with no stream advanced either way.
 */
export function clerkErrs(seed: number, reservationEntity: number, skillPermille: number): boolean {
  const roll = hash32((seed ^ (reservationEntity * 2654435761)) >>> 0) % 1000;
  return roll >= skillPermille;
}
