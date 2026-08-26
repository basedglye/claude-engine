/**
 * Shapes for `ScreenWorldView.data`, prepared once by `screenSystem`
 * (game.ts) and shared by every registered app. Kept in its own module so
 * game.ts (which composes the shell) and the apps (which only need the data
 * shape) don't form an import cycle. Pure/JSON-plain — this crosses into
 * `surface-ui`'s `ScreenWorldView.data: Record<string, unknown>` bag, so
 * every field here must itself be JSON-plain (no EntityId branding beyond
 * plain numbers).
 *
 * THE KEY BUDGET (docs/PHASE-H2.md risk 3, carried from H1's risk 2): at
 * most 9 top-level keys total, and each app reads at most 3. H2a lands
 * exactly 9 and every app is inside its 3:
 *
 *   RESERVA  queue, rooms, stars        MAILBOX  mail
 *   AUDIT    ledger, objectives         STAFF    staff
 *   LEDGER   ledger, ledgerDays         PRICER   pricing
 *
 * The budget exists because "ScreenViewData becomes the kitchen sink" is
 * the named failure mode for a phase that quadruples the app count. If a
 * tenth key is ever needed, that is the moment to ask whether the view
 * should be per-app rather than shared — not the moment to add the key.
 */

/** The queue head's raw document fields beside its raw reservation
 *  fields — RESERVA displays these AS-IS. Never an evaluation result:
 *  the player runs the rule table in their head (DESIGN.md §4). */
export interface ScreenQueueView {
  reservationEntity: number;
  guestEntity: number;
  /** docType -> field name -> value, exactly as held on the `document`
   *  components owned by the presenting guest. */
  docFields: Record<string, Record<string, string>>;
  /** The reservation's own fields (guestName, resCode, ...). */
  resFields: Record<string, string>;
}

export interface ScreenRoomView {
  roomEntity: number;
  roomId: number;
  tier: number;
}

/** Today's running ledger figures, in `econ.audit`'s payload shape, plus
 *  the STAFF BUDGET line LEDGER and AUDIT both print. The threshold is
 *  shown whether or not it has been reached — the player always knows
 *  exactly what earns what (DESIGN §6). */
export interface ScreenLedgerView {
  day: number;
  revenueMinor: number;
  expenseMinor: number;
  closingCashMinor: number;
  cashMinor: number;
  hireUnlocked: boolean;
  hireThresholdMinor: number;
}

/** One past day's closed figures, for LEDGER's paging. Ascending by day. */
export interface ScreenLedgerDayView {
  day: number;
  revenueMinor: number;
  expenseMinor: number;
}

export interface ScreenObjectiveView {
  day: number;
  kind: string;
  target: number;
  progress: number;
  done: boolean;
  rewardMinor: number;
}

/** PRICER's editable state and its bounds. `demandBuckets` is DISPLAY data
 *  only — a deliberately coarse, deterministic fuzz derived by stateless
 *  hash of (day, tier), never an Rng draw and never sim state (H2
 *  determinism rule 5). */
export interface ScreenPricingView {
  /** tier (as a string key, because the component is JSON-plain) -> rate. */
  rateByTier: Record<string, number>;
  minRateMinor: number;
  maxRateMinor: number;
  stepMinor: number;
  /** Per-tier bars, 0..8, in ascending tier order. */
  demandBuckets: { tier: number; bucket: number }[];
}

export interface ScreenMailView {
  mailEntity: number;
  day: number;
  kind: string;
  subjectKey: string;
  fields: Record<string, string>;
  read: boolean;
}

export interface ScreenCandidateView {
  candidateEntity: number;
  name: string;
  wageAsk: number;
  skillPermille: number;
  quirk: string;
  state: string;
}

export interface ScreenStaffMemberView {
  staffEntity: number;
  name: string;
  job: string;
  wage: number;
  skillPermille: number;
  quirk: string;
}

export interface ScreenStaffView {
  candidates: ScreenCandidateView[];
  hired: ScreenStaffMemberView[];
  cashMinor: number;
  hireUnlocked: boolean;
  hireThresholdMinor: number;
}

export interface ScreenViewData {
  /** null when nobody is currently `presenting` at the desk. */
  queue: ScreenQueueView | null;
  /** Rooms that can actually be sold right now: vacant, wiped, unbroken. */
  rooms: ScreenRoomView[];
  /** The hotel's star tier — RESERVA's procedures card is derived from it
   *  live, never from a constant frozen at import (that constant is exactly
   *  the state an escalation system cannot tolerate). */
  stars: number;
  ledger: ScreenLedgerView;
  /** Closed days, ascending. */
  ledgerDays: ScreenLedgerDayView[];
  /** Today's objectives, in posting order. */
  objectives: ScreenObjectiveView[];
  pricing: ScreenPricingView;
  /** Newest first — the order MAILBOX lists them in. */
  mail: ScreenMailView[];
  staff: ScreenStaffView;
}
