/**
 * LEDGER — finance and the night-audit history (DESIGN §4). Pure: same
 * purity root as reserva-app.ts, imports only surface-ui's pure entry.
 *
 * Two jobs, both diegetic-transparency jobs. It pages back through closed
 * days so the player can see where the money actually went, and it prints
 * the STAFF BUDGET line — locked with its exact threshold and the exact
 * gap — from day one. Showing the price tag of the thing you are saving
 * for, every night, is the anti-dark-pattern stance made concrete
 * (DESIGN §6: transparent, proportionate, simulation-intrinsic), and it is
 * what makes the first-hire beat land as a release rather than a surprise.
 */
import type { PaintNode, Rect, ScreenAppDef, ScreenWorldView } from "@claude-engine/surface-ui";
import { GLYPH_H, hitRect } from "@claude-engine/surface-ui";
import type { ScreenViewData } from "./screen-data.js";

/** `pageOffset` counts days back from the newest closed day. Integers only —
 *  this lives verbatim in the `screenApp` component and is hashed. */
export interface LedgerState {
  pageOffset: number;
}

const PREV_RECT: Rect = { x: 8, y: 420, w: 96, h: 18 };
const NEXT_RECT: Rect = { x: 112, y: 420, w: 96, h: 18 };
const ROWS_PER_PAGE = 8;

function viewData(view: ScreenWorldView): ScreenViewData {
  return view.data as unknown as ScreenViewData;
}

/** The one geometry source: reduce hit-tests it, paintSpec places from it. */
function layoutRects(): Record<string, Rect> {
  return { prev: PREV_RECT, next: NEXT_RECT };
}

/** How many pages of closed days exist. Always at least 1 so the guard
 *  below has something coherent to clamp against on an empty ledger. */
function pageCount(days: number): number {
  if (days <= 0) return 1;
  return Math.trunc((days - 1) / ROWS_PER_PAGE) + 1;
}

function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = negative ? -minor : minor;
  const major = Math.trunc(abs / 100);
  const cents = abs % 100;
  return `${negative ? "-" : ""}$${major}.${cents < 10 ? "0" : ""}${cents}`;
}

export const ledgerApp: ScreenAppDef<LedgerState> = {
  id: "ledger",

  init(): LedgerState {
    return { pageOffset: 0 };
  },

  reduce(state, input, view) {
    if (input.kind !== "click") return state;
    const hit = hitRect(layoutRects(), input.px, input.py);
    if (hit === undefined) return state;
    const pages = pageCount(viewData(view).ledgerDays.length);
    if (hit === "prev") {
      // Guard: never page past the oldest recorded day. Paging is the
      // decision path this app carries coverage for, and its guard is the
      // clamp at both ends.
      const next = state.pageOffset + 1;
      return next >= pages ? state : { pageOffset: next };
    }
    if (hit === "next") {
      return state.pageOffset <= 0 ? state : { pageOffset: state.pageOffset - 1 };
    }
    return state;
  },

  layout() {
    return layoutRects();
  },

  paintSpec(state, view) {
    const data = viewData(view);
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    nodes.push({ kind: "text", x: 8, y: 4, text: "LEDGER - FINANCE", color: 11 });

    nodes.push({ kind: "text", x: 8, y: 24, text: `Cash on hand: ${formatMinor(data.ledger.cashMinor)}`, color: 8 });
    nodes.push({ kind: "text", x: 8, y: 36, text: `Today (day ${data.ledger.day}) revenue: ${formatMinor(data.ledger.revenueMinor)}`, color: 9 });
    nodes.push({ kind: "text", x: 8, y: 48, text: `Today expenses: ${formatMinor(data.ledger.expenseMinor)}`, color: 10 });

    // The STAFF BUDGET line, printed every day, locked or not.
    const gap = data.ledger.hireThresholdMinor - data.ledger.cashMinor;
    const budgetLine = data.ledger.hireUnlocked
      ? "STAFF BUDGET - UNLOCKED"
      : `STAFF BUDGET - locked, unlocks at ${formatMinor(data.ledger.hireThresholdMinor)} (${formatMinor(gap > 0 ? gap : 0)} to go)`;
    nodes.push({ kind: "text", x: 8, y: 68, text: budgetLine, color: data.ledger.hireUnlocked ? 9 : 14 });

    nodes.push({ kind: "hline", x: 8, y: 84, w: 400, color: 14 });

    const pages = pageCount(data.ledgerDays.length);
    const offset = state.pageOffset >= pages ? pages - 1 : state.pageOffset < 0 ? 0 : state.pageOffset;
    // Newest page first: offset 0 is the most recent ROWS_PER_PAGE days.
    const ascending = data.ledgerDays;
    const end = ascending.length - offset * ROWS_PER_PAGE;
    const start = end - ROWS_PER_PAGE < 0 ? 0 : end - ROWS_PER_PAGE;
    const page = ascending.slice(start < 0 ? 0 : start, end < 0 ? 0 : end);

    nodes.push({ kind: "text", x: 8, y: 92, text: "CLOSED DAYS", color: 12 });
    if (page.length === 0) {
      nodes.push({ kind: "text", x: 8, y: 108, text: "No days closed yet.", color: 14 });
    } else {
      let y = 108;
      for (let i = page.length - 1; i >= 0; i--) {
        const row = page[i]!;
        const net = row.revenueMinor - row.expenseMinor;
        nodes.push({
          kind: "text",
          x: 8,
          y,
          text: `Day ${row.day}  rev ${formatMinor(row.revenueMinor)}  exp ${formatMinor(row.expenseMinor)}  net ${formatMinor(net)}`,
          color: net >= 0 ? 9 : 10,
        });
        y += GLYPH_H + 4;
      }
    }

    nodes.push({ kind: "text", x: 8, y: 404, text: `Page ${offset + 1} of ${pages}`, color: 8 });
    nodes.push({ kind: "button", rect: PREV_RECT, label: "OLDER", color: 15 });
    nodes.push({ kind: "button", rect: NEXT_RECT, label: "NEWER", color: 15 });
    return nodes;
  },
};
