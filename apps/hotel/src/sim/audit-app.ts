/**
 * AUDIT — the night-audit figures screen (docs/PHASE-H1.md: "AUDIT renders
 * the night-audit figures (`econ.audit`'s payload shape). One screen, no
 * interaction, is acceptable."). Pure, same purity root as reserva-app.ts.
 */
import type { PaintNode, ScreenAppDef } from "@claude-engine/surface-ui";
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
    nodes.push({ kind: "text", x: 8, y: 24, text: `Day: ${ledger.day}`, color: 8 });
    nodes.push({ kind: "text", x: 8, y: 36, text: `Revenue (rooms): ${ledger.revenueMinor}`, color: 9 });
    nodes.push({ kind: "text", x: 8, y: 48, text: `Expenses: ${ledger.expenseMinor}`, color: 10 });
    nodes.push({ kind: "hline", x: 8, y: 60, w: 200, color: 14 });
    nodes.push({ kind: "text", x: 8, y: 68, text: `Closing cash: ${ledger.closingCashMinor}`, color: 8 });
    return nodes;
  },
};
