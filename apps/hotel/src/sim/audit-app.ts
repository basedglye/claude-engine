/**
 * AUDIT — the night-audit figures screen (docs/PHASE-H1.md: "AUDIT renders
 * the night-audit figures (`econ.audit`'s payload shape). One screen, no
 * interaction, is acceptable."). Pure, same purity root as reserva-app.ts.
 */
import type { PaintNode, ScreenAppDef } from "@claude-engine/surface-ui";
import { GLYPH_H } from "@claude-engine/surface-ui";
import type { ScreenViewData } from "./screen-data.js";

/** No interactive state to hash beyond a placeholder — AUDIT has no
 *  controls, but ScreenAppDef<S> still needs a JSON-plain S. */
export interface AuditState {
  opened: number;
}

export const auditApp: ScreenAppDef<AuditState> = {
  id: "audit",

  init(): AuditState {
    return { opened: 0 };
  },

  reduce(state) {
    return state;
  },

  layout() {
    return {};
  },

  paintSpec(_state, view) {
    const data = view.data as unknown as ScreenViewData;
    const { ledger } = data;
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    nodes.push({ kind: "text", x: 8, y: 4, text: "AUDIT - NIGHT LEDGER", color: 11 });
    // Cycle 3 lane 2 (CYCLE-3.md "Lane 2"): the one line this screen owed
    // the walkthrough's "run the audit" step -- AUDIT has no button because
    // the audit already ran itself (H1 ruling, this file's header); this
    // says so on the screen instead of leaving that only in a doc comment.
    nodes.push({ kind: "text", x: 8, y: 16, text: "The audit runs itself at midnight. This screen is the report.", color: 14 });
    nodes.push({ kind: "text", x: 8, y: 36, text: `Day: ${ledger.day}`, color: 8 });
    nodes.push({ kind: "text", x: 8, y: 48, text: `Revenue (rooms): ${ledger.revenueMinor}`, color: 9 });
    nodes.push({ kind: "text", x: 8, y: 60, text: `Expenses: ${ledger.expenseMinor}`, color: 10 });
    nodes.push({ kind: "hline", x: 8, y: 72, w: 200, color: 14 });
    nodes.push({ kind: "text", x: 8, y: 80, text: `Closing cash: ${ledger.closingCashMinor}`, color: 8 });

    // The day's objectives. Added in the H2a review pass: they were sim-real
    // — posted, progressed, settled, carried in `econ.audit`'s payload and
    // gate-asserted — and shown on no screen at all, which is the
    // "verified but invisible" shape this project keeps catching. The audit
    // is where every other day-granularity fact lands, so it is where these
    // belong. Targets and rewards are printed verbatim: the player is meant
    // to know exactly what earns what (DESIGN §6).
    nodes.push({ kind: "text", x: 8, y: 104, text: "TODAY'S OBJECTIVES", color: 12 });
    if (data.objectives.length === 0) {
      nodes.push({ kind: "text", x: 8, y: 120, text: "None posted.", color: 14 });
      return nodes;
    }
    let y = 120;
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
