/**
 * Shapes for `ScreenWorldView.data`, prepared once by `screenSystem`
 * (game.ts) and shared by every registered app (reserva-app.ts,
 * audit-app.ts). Kept in its own module so game.ts (which composes the
 * shell) and the apps (which only need the data shape) don't form an
 * import cycle. Pure/JSON-plain — this crosses into `surface-ui`'s
 * `ScreenWorldView.data: Record<string, unknown>` bag, so every field here
 * must itself be JSON-plain (no EntityId branding beyond plain numbers).
 *
 * Exactly 3 top-level keys — see docs/PHASE-H1.md spec risk 2 ("RESERVA
 * should need <= 5 data keys"); RESERVA itself only reads `queue` and
 * `rooms`, AUDIT only reads `ledger`.
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

/** Today's running ledger figures, in `econ.audit`'s payload shape. */
export interface ScreenLedgerView {
  day: number;
  revenueMinor: number;
  expenseMinor: number;
  closingCashMinor: number;
}

export interface ScreenViewData {
  /** null when nobody is currently `presenting` at the desk. */
  queue: ScreenQueueView | null;
  /** Vacant rooms only, sorted by roomId ascending. */
  rooms: ScreenRoomView[];
  ledger: ScreenLedgerView;
}
