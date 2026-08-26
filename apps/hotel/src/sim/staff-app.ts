/**
 * STAFF — the interview screen (DESIGN §4). Pure; same purity root as
 * reserva-app.ts.
 *
 * The shape is RESERVA's on purpose. A candidate's details sit beside their
 * resume the way a guest's documents sit beside their reservation, and
 * HIRE / PASS are the same two buttons in the same place as ACCEPT / DENY,
 * flowing through the same kind of validated effect. By the time the player
 * hires someone the gesture is muscle memory, which is the point: hiring is
 * a desk decision about a person and their paperwork (docs/PHASE-H2.md §8).
 *
 * Every hire has a flaw, and the flaw is printed here in plain text before
 * the player commits — never hidden, never a surprise later (DESIGN §7).
 */
import type { PaintNode, Rect, ScreenAppDef, ScreenEffect, ScreenWorldView } from "@claude-engine/surface-ui";
import { GLYPH_H, hitRect } from "@claude-engine/surface-ui";
import type { ScreenViewData } from "./screen-data.js";

/** `selectedCandidateEntity` 0 = none selected. Hashed verbatim. */
export interface StaffState {
  selectedCandidateEntity: number;
}

const LIST_X = 8;
const LIST_Y = 80;
const ROW_H = 20;
const ROW_W = 260;
const HIRE_RECT: Rect = { x: 8, y: 420, w: 96, h: 18 };
const PASS_RECT: Rect = { x: 112, y: 420, w: 96, h: 18 };
const DETAIL_X = 300;

function viewData(view: ScreenWorldView): ScreenViewData {
  return view.data as unknown as ScreenViewData;
}

function candidateRowKey(entity: number): string {
  return `candidate:${entity}`;
}

function layoutRects(view: ScreenWorldView): Record<string, Rect> {
  const rects: Record<string, Rect> = { hire: HIRE_RECT, pass: PASS_RECT };
  let y = LIST_Y;
  for (const candidate of viewData(view).staff.candidates) {
    rects[candidateRowKey(candidate.candidateEntity)] = { x: LIST_X, y, w: ROW_W, h: ROW_H };
    y += ROW_H;
  }
  return rects;
}

function formatMinor(minor: number): string {
  const major = Math.trunc(minor / 100);
  const cents = minor % 100;
  return `$${major}.${cents < 10 ? "0" : ""}${cents}`;
}

export const staffApp: ScreenAppDef<StaffState> = {
  id: "staff",

  init(): StaffState {
    return { selectedCandidateEntity: 0 };
  },

  reduce(state, input, view) {
    if (input.kind !== "click") return state;
    const data = viewData(view);
    const hit = hitRect(layoutRects(view), input.px, input.py);
    if (hit === undefined) return state;

    if (hit.startsWith("candidate:")) {
      return { selectedCandidateEntity: Number.parseInt(hit.slice("candidate:".length), 10) };
    }

    if (hit !== "hire" && hit !== "pass") return state;

    // The guard, in two parts. No candidate selected is nothing to decide.
    // Not enough cash for the first wage is a refusal the player can SEE
    // before clicking, because the figure is printed beside the button —
    // and it is re-checked by `applyStaffDecision` regardless, because the
    // app's output is a proposal, never an authority.
    if (state.selectedCandidateEntity === 0) return state;
    const candidate = data.staff.candidates.find((c) => c.candidateEntity === state.selectedCandidateEntity);
    if (!candidate) return state;
    if (hit === "hire" && data.staff.cashMinor < candidate.wageAsk) return state;

    const effect: ScreenEffect = {
      type: "staff.hire",
      payload: { candidateEntity: candidate.candidateEntity, accept: hit === "hire" },
    };
    return { state: { selectedCandidateEntity: 0 }, effect };
  },

  layout(_state, view) {
    return layoutRects(view);
  },

  paintSpec(state, view) {
    const data = viewData(view);
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    nodes.push({ kind: "text", x: 8, y: 4, text: "STAFF - HIRING", color: 11 });

    const budgetLine = data.staff.hireUnlocked
      ? `STAFF BUDGET UNLOCKED - cash ${formatMinor(data.staff.cashMinor)}`
      : `STAFF BUDGET LOCKED - unlocks at ${formatMinor(data.staff.hireThresholdMinor)}`;
    nodes.push({ kind: "text", x: 8, y: 24, text: budgetLine, color: data.staff.hireUnlocked ? 9 : 14 });

    nodes.push({ kind: "text", x: 8, y: 44, text: "ON PAYROLL", color: 8 });
    if (data.staff.hired.length === 0) {
      nodes.push({ kind: "text", x: 8, y: 56, text: "Nobody. You are the hotel.", color: 14 });
    } else {
      let hy = 56;
      for (const member of data.staff.hired) {
        nodes.push({ kind: "text", x: 8, y: hy, text: `${member.name} - ${member.job}, ${formatMinor(member.wage)}/day`, color: 8 });
        hy += GLYPH_H + 2;
      }
    }

    nodes.push({ kind: "text", x: 8, y: LIST_Y - 12, text: "CANDIDATES", color: 8 });
    if (data.staff.candidates.length === 0) {
      nodes.push({ kind: "text", x: 8, y: LIST_Y, text: "No candidates waiting.", color: 14 });
    } else {
      let y = LIST_Y;
      for (const candidate of data.staff.candidates) {
        nodes.push({
          kind: "button",
          rect: { x: LIST_X, y, w: ROW_W, h: ROW_H },
          label: `${candidate.name} (${candidate.state})`,
          color: 15,
          pressed: candidate.candidateEntity === state.selectedCandidateEntity,
        });
        y += ROW_H;
      }
    }

    const selected = data.staff.candidates.find((c) => c.candidateEntity === state.selectedCandidateEntity);
    if (selected) {
      nodes.push({ kind: "text", x: DETAIL_X, y: 44, text: "RESUME", color: 12 });
      const lines = [
        `Name:  ${selected.name}`,
        `Wants: ${formatMinor(selected.wageAsk)} per day`,
        `Skill: ${Math.trunc(selected.skillPermille / 100)}/10`,
        `Quirk: ${selected.quirk}`,
        "",
        "Every hire has a flaw. This is theirs.",
      ];
      let dy = 60;
      for (const line of lines) {
        nodes.push({ kind: "text", x: DETAIL_X, y: dy, text: line, color: 8 });
        dy += GLYPH_H + 3;
      }
      if (data.staff.cashMinor < selected.wageAsk) {
        nodes.push({ kind: "text", x: DETAIL_X, y: dy + 8, text: "Not enough cash for the first wage.", color: 10 });
      }
    } else {
      nodes.push({ kind: "text", x: DETAIL_X, y: 44, text: "Select a candidate.", color: 14 });
    }

    nodes.push({ kind: "button", rect: HIRE_RECT, label: "HIRE", color: 9 });
    nodes.push({ kind: "button", rect: PASS_RECT, label: "PASS", color: 10 });
    return nodes;
  },
};
