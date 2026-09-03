/**
 * AUDIT — the night-audit figures screen (docs/PHASE-H1.md: "AUDIT renders
 * the night-audit figures (`econ.audit`'s payload shape). One screen, no
 * interaction, is acceptable."). Pure, same purity root as reserva-app.ts.
 *
 * C4-W1 (DECISIONS.md item 1): the audit becomes a proper end-of-day
 * ritual with a deterministic reveal cadence instead of a flat list that
 * is all there the instant the app opens. `state.opened` is stamped with
 * `view.tick` the moment a `{ kind: "open" }` input arrives (the shell
 * sends this on every app switch, per `packages/surface-ui/src/types.ts`'s
 * `ScreenInput`); `paintSpec` then reveals lines strictly as a function of
 * `view.tick - state.opened`, never wall-clock. Reopening the app restarts
 * the ritual, which is the correct feel for "read tonight's numbers again."
 */
import type { PaintNode, ScreenAppDef } from "@claude-engine/surface-ui";
import { GLYPH_H } from "@claude-engine/surface-ui";
import type { ScreenViewData } from "./screen-data.js";

/** State lives verbatim in the `screenApp` component and is hashed — plain
 *  integers only. `opened`: the `view.tick` this app was last opened at
 *  (0 until the shell delivers its first `{ kind: "open" }`). */
export interface AuditState {
  opened: number;
}

// Reveal cadence, in ticks since open (20 Hz -> 20 ticks = 1s). Named
// constants, not magic numbers, per the brief -- each is the elapsed-tick
// threshold at which the NEXT line joins the report; the day header is
// always visible from tick 0.
const REVEAL_FIGURES_TICKS = 20; // revenue / expenses / fraud loss
const REVEAL_STARS_TICKS = 40; // star tier
const REVEAL_CASH_TICKS = 60; // closing cash
const REVEAL_FORECAST_TICKS = 80; // tomorrow's forecast line
const REVEAL_OBJECTIVES_TICKS = 100; // today's objectives (existing loop)

export const auditApp: ScreenAppDef<AuditState> = {
  id: "audit",

  init(): AuditState {
    return { opened: 0 };
  },

  reduce(state, input, view) {
    // The shell delivers this once per app switch (createShell, per
    // packages/surface-ui/src/types.ts's ScreenInput union) -- stamping
    // `opened` here, and only here, is what lets the reveal be a pure
    // function of `view.tick - state.opened` in paintSpec with no other
    // state to track.
    if (input.kind === "open") {
      return { opened: view.tick };
    }
    return state;
  },

  layout() {
    return {};
  },

  paintSpec(state, view) {
    const data = view.data as unknown as ScreenViewData;
    const { ledger } = data;
    const elapsed = view.tick - state.opened;
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    nodes.push({ kind: "text", x: 8, y: 4, text: "AUDIT - NIGHT LEDGER", color: 11 });
    // Cycle 3 lane 2 (CYCLE-3.md "Lane 2"): the one line this screen owed
    // the walkthrough's "run the audit" step -- AUDIT has no button because
    // the audit already ran itself (H1 ruling, this file's header); this
    // says so on the screen instead of leaving that only in a doc comment.
    nodes.push({ kind: "text", x: 8, y: 16, text: "The audit runs itself at midnight. This screen is the report.", color: 14 });
    // Day header: always visible, the ritual's fixed opening line.
    nodes.push({ kind: "text", x: 8, y: 36, text: `Day: ${ledger.day}`, color: 8 });

    if (elapsed < REVEAL_FIGURES_TICKS) return nodes;
    nodes.push({ kind: "text", x: 8, y: 48, text: `Revenue (rooms): ${ledger.revenueMinor}`, color: 9 });
    nodes.push({ kind: "text", x: 8, y: 60, text: `Expenses: ${ledger.expenseMinor}`, color: 10 });
    // CYCLE-3 lane 5 (CEO ruling): a missed fraud costs the hotel a
    // chargeback — printed on its own line, whether or not it happened
    // today (0 is still an answer, same anti-dark-pattern stance as the
    // STAFF BUDGET line elsewhere), so it is never a number the player
    // only discovers by noticing expenses look a little high.
    nodes.push({ kind: "text", x: 8, y: 72, text: `Fraud loss: ${ledger.fraudLossMinor}`, color: 10 });

    if (elapsed < REVEAL_STARS_TICKS) return nodes;
    // Star TIER, honestly: `data.stars` is the live tier, the same value
    // RESERVA's procedures card reads. A true night-over-night DELTA would
    // need yesterday's tier, which is not currently plumbed anywhere this
    // file can read (`ledgerDays` carries only revenue/expense/fraudLoss,
    // no stars) -- printing an invented delta would be exactly the
    // "invent new simulated data" the brief rules out. See this lane's
    // report for the `Hotel.previousStars`-style field that would unblock
    // a real delta line next cycle.
    nodes.push({ kind: "text", x: 8, y: 84, text: `Star tier: ${data.stars}`, color: 12 });

    if (elapsed < REVEAL_CASH_TICKS) return nodes;
    nodes.push({ kind: "hline", x: 8, y: 96, w: 200, color: 14 });
    nodes.push({ kind: "text", x: 8, y: 104, text: `Closing cash: ${ledger.closingCashMinor}`, color: 8 });

    if (elapsed < REVEAL_FORECAST_TICKS) return nodes;
    // Minimal, honest forecast: no simulated tomorrow-arrivals/demand data
    // is plumbed to this screen, so this names the day and nothing it
    // cannot back up (brief §3b: "do not invent new simulated forecast
    // data, that is out of scope").
    nodes.push({ kind: "text", x: 8, y: 116, text: `Day ${ledger.day + 1} begins.`, color: 14 });

    if (elapsed < REVEAL_OBJECTIVES_TICKS) return nodes;
    // The day's objectives. Added in the H2a review pass: they were sim-real
    // — posted, progressed, settled, carried in `econ.audit`'s payload and
    // gate-asserted — and shown on no screen at all, which is the
    // "verified but invisible" shape this project keeps catching. The audit
    // is where every other day-granularity fact lands, so it is where these
    // belong. Targets and rewards are printed verbatim: the player is meant
    // to know exactly what earns what (DESIGN §6).
    nodes.push({ kind: "text", x: 8, y: 132, text: "TODAY'S OBJECTIVES", color: 12 });
    if (data.objectives.length === 0) {
      nodes.push({ kind: "text", x: 8, y: 148, text: "None posted.", color: 14 });
      return nodes;
    }
    let y = 148;
    for (const objective of data.objectives) {
      const mark = objective.done ? "[x]" : "[ ]";
      nodes.push({
        kind: "text",
        x: 8,
        y,
        text: `${mark} ${objective.kind}: ${objective.progress}/${objective.target} - pays ${objective.rewardMinor}`,
        color: objective.done ? 9 : 8,
      });
      y += GLYPH_H + 4;
    }
    nodes.push({ kind: "text", x: 8, y: y + 4, text: "A missed objective costs nothing.", color: 14 });
    return nodes;
  },
};
