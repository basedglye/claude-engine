/**
 * RESERVA — the check-in screen app (apps/hotel/docs/DESIGN.md §4). Pure:
 * lives under the `apps/hotel/src/sim` purity root and imports only
 * `@claude-engine/surface-ui`'s pure entry (never `/host`).
 *
 * The ruling this file exists to honour (DESIGN.md §4, docs/PHASE-H1.md
 * "one oracle, three consumers"): RESERVA shows the queue head's RAW
 * document fields beside the RAW reservation fields, plus the active rule
 * table's DESCRIPTIONS as a diegetic "procedures card" — and NEVER an
 * evaluation result. Comparing them by eye against the rule descriptions is
 * the whole game; `evaluateRules`/`describeRule` are two deliberately
 * separate code paths (rules.ts's header) so the card can never leak a
 * verdict. This module calls `describeRule` only, never `evaluateRules`.
 */
import type { PaintNode, Rect, ScreenAppDef, ScreenWorldView } from "@claude-engine/surface-ui";
import { GLYPH_H, GLYPH_W, SCREEN_W, hitRect } from "@claude-engine/surface-ui";
import { H1_RULES, describeRule, rulesForStars } from "./rules.js";
import type { ScreenViewData } from "./screen-data.js";

/** State lives verbatim in the `screenApp` component and is hashed — plain
 *  integers only. `selectedRoomEntity`: 0 = none selected. */
export interface ReservaState {
  selectedRoomEntity: number;
}

const ACCEPT_RECT: Rect = { x: 8, y: 434, w: 120, h: 20 };
const DENY_RECT: Rect = { x: 136, y: 434, w: 120, h: 20 };
const ROOM_LIST_X = 8;
/** The room list used to float at y=220 with a wide gap above it and the
 *  ACCEPT/DENY bar 200px below. Both halves of that were wrong: an idle
 *  screen was mostly empty blue, and the action was nowhere near the choice
 *  it acts on. The list now sits directly under the left column's content
 *  and directly above the action bar, so "pick a room, then accept" is one
 *  vertical read. */
const ROOM_LIST_Y = 296;
const ROOM_ROW_H = 20;
const ROOM_ROW_W = 248;

/** Horizontal rule under the title, and above the action bar. A 2px panel
 *  is the cheapest structural cue this surface has, and the screen had none
 *  -- every element floated in one undivided field of blue. */
const HEADER_RULE_Y = 18;
const ACTION_RULE_Y = 424;
const RIGHT_COLUMN_TOP = 26;

// H1 froze the active rule table in a module constant at import time. H2a
// deletes it: the star tier is world state now, the procedures card growing
// a new line IS the player-facing difficulty curve (DESIGN's escalation
// ruling), and a constant computed once at import is exactly the kind of
// frozen state an escalation system cannot tolerate. The card is derived
// from `view.data.stars` on every paint, like everything else on this
// screen.

// PROCEDURES column starts at x=320 and the surface ends at SCREEN_W=640;
// rule descriptions run well past that in one line (H1b review: "THE NAME
// ON THE ID MUST MATCH THE RESE" clipped off the edge) -- wrap to the
// column's actual pixel width instead of guessing a fixed character count,
// so the procedures card stays legible if the layout ever moves.
const RIGHT_COLUMN_X = 300;
const PROCEDURES_X = RIGHT_COLUMN_X;
const PROCEDURES_MARGIN_PX = 8;
const PROCEDURES_MAX_CHARS = Math.floor((SCREEN_W - PROCEDURES_X - PROCEDURES_MARGIN_PX) / GLYPH_W);
const PROCEDURES_LINE_H = GLYPH_H + 3;
const PROCEDURES_RULE_GAP = 4;

/** Greedy word-wrap to at most `maxChars` per line. Never splits a word
 *  mid-token; a single word longer than `maxChars` is hard-cut (there are
 *  none in H1's rule descriptions, but this keeps the function total). */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (candidate.length <= maxChars) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    line = word.length > maxChars ? word.slice(0, maxChars) : word;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function viewData(view: ScreenWorldView): ScreenViewData {
  return view.data as unknown as ScreenViewData;
}

function roomRectKey(roomEntity: number): string {
  return `room:${roomEntity}`;
}

function layoutRects(state: ReservaState, view: ScreenWorldView): Record<string, Rect> {
  const data = viewData(view);
  const rects: Record<string, Rect> = { accept: ACCEPT_RECT, deny: DENY_RECT };
  let y = ROOM_LIST_Y;
  for (const room of data.rooms) {
    rects[roomRectKey(room.roomEntity)] = { x: ROOM_LIST_X, y, w: ROOM_ROW_W, h: ROOM_ROW_H };
    y += ROOM_ROW_H;
  }
  void state; // layout does not depend on selection, only on the room list
  return rects;
}

export const reservaApp: ScreenAppDef<ReservaState> = {
  id: "reserva",

  init(): ReservaState {
    return { selectedRoomEntity: 0 };
  },

  reduce(state, input, view) {
    if (input.kind !== "click") return state;
    const data = viewData(view);
    const rects = layoutRects(state, view);
    const hit = hitRect(rects, input.px, input.py);
    if (hit === undefined) return state;

    if (hit.startsWith("room:")) {
      const roomEntity = Number.parseInt(hit.slice("room:".length), 10);
      // Only vacant rooms are ever laid out, so any hit here is legal to
      // select; the desk still re-validates vacancy at decision time.
      return { ...state, selectedRoomEntity: roomEntity };
    }

    if (hit === "accept") {
      if (!data.queue || state.selectedRoomEntity === 0) return state; // nothing to accept / no room chosen
      return {
        state: { selectedRoomEntity: 0 },
        effect: {
          type: "desk.decision",
          payload: { reservationEntity: data.queue.reservationEntity, accept: true, roomEntity: state.selectedRoomEntity },
        },
      };
    }

    if (hit === "deny") {
      if (!data.queue) return state;
      return {
        state: { selectedRoomEntity: 0 },
        effect: {
          type: "desk.decision",
          payload: { reservationEntity: data.queue.reservationEntity, accept: false },
        },
      };
    }

    return state;
  },

  layout(state, view) {
    return layoutRects(state, view);
  },

  paintSpec(state, view) {
    const data = viewData(view);
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    nodes.push({ kind: "text", x: 8, y: 4, text: "RESERVA - CHECK-IN", color: 11 });
    nodes.push({ kind: "panel", rect: { x: 8, y: HEADER_RULE_Y, w: 624, h: 2 }, fill: 8 });

    if (!data.queue) {
      // IDLE IS A STATE, NOT AN ABSENCE. The old idle screen printed one
      // line and left ~400px of empty blue, which read as a broken app
      // rather than a quiet desk. It now says what it is waiting for and
      // keeps the procedures card up, so the rules can be read BEFORE a
      // guest is standing there -- which is when a player actually has time
      // to read them.
      nodes.push({ kind: "text", x: 8, y: 26, text: "DESK CLEAR", color: 14 });
      nodes.push({ kind: "text", x: 8, y: 40, text: "No guest presenting.", color: 8 });
      nodes.push({ kind: "text", x: 8, y: 56, text: "Waiting for arrivals.", color: 8 });
    } else {
      // -- raw document fields (left column) --
      nodes.push({ kind: "text", x: 8, y: 26, text: "PRESENTED DOCUMENTS", color: 8 });
      let y = 42;
      for (const docType of Object.keys(data.queue.docFields).sort()) {
        nodes.push({ kind: "text", x: 8, y, text: `[${docType}]`, color: 12 });
        y += GLYPH_H + 2;
        const fields = data.queue.docFields[docType] ?? {};
        for (const field of Object.keys(fields).sort()) {
          nodes.push({ kind: "text", x: 16, y, text: `${field}: ${fields[field]}`, color: 8 });
          y += GLYPH_H + 2;
        }
        y += 4;
      }

      // -- raw reservation fields (right column) --
      nodes.push({ kind: "text", x: RIGHT_COLUMN_X, y: RIGHT_COLUMN_TOP, text: "RESERVATION ON FILE", color: 8 });
      let ry = RIGHT_COLUMN_TOP + 16;
      for (const field of Object.keys(data.queue.resFields).sort()) {
        nodes.push({ kind: "text", x: RIGHT_COLUMN_X, y: ry, text: `${field}: ${data.queue.resFields[field]}`, color: 8 });
        ry += GLYPH_H + 2;
      }
    }

    // -- procedures card: descriptions only, never results -- extra
    // leading (PROCEDURES_LINE_H > GLYPH_H, PROCEDURES_RULE_GAP between
    // rules) so wrapped lines read as visually distinct rows rather than
    // crowding into an 8px-tall stack (H1b review round 3: "set the
    // leading so wrapped lines are comfortably distinct").
    //
    // Painted in BOTH states now (it used to live inside the guest branch).
    // The card is the game's rulebook; hiding it until the moment you are
    // under time pressure was precisely backwards.
    nodes.push({ kind: "text", x: PROCEDURES_X, y: 140, text: "PROCEDURES", color: 12 });
    nodes.push({ kind: "panel", rect: { x: PROCEDURES_X, y: 152, w: SCREEN_W - PROCEDURES_X - 8, h: 1 }, fill: 8 });
    let py = 160;
    for (const rule of rulesForStars(H1_RULES, data.stars)) {
      const wrapped = wrapText(`- ${describeRule(rule)}`, PROCEDURES_MAX_CHARS);
      for (const wrappedLine of wrapped) {
        nodes.push({ kind: "text", x: PROCEDURES_X, y: py, text: wrappedLine, color: 14 });
        py += PROCEDURES_LINE_H;
      }
      py += PROCEDURES_RULE_GAP;
    }

    // -- vacant rooms --
    nodes.push({ kind: "text", x: 8, y: ROOM_LIST_Y - 16, text: "VACANT ROOMS", color: 8 });
    if (data.rooms.length === 0) {
      nodes.push({ kind: "text", x: 8, y: ROOM_LIST_Y + 4, text: "None ready.", color: 14 });
    }
    let ry2 = ROOM_LIST_Y;
    for (const room of data.rooms) {
      const rect = { x: ROOM_LIST_X, y: ry2, w: ROOM_ROW_W, h: ROOM_ROW_H };
      nodes.push({
        kind: "button",
        rect,
        label: `Room ${room.roomId} (tier ${room.tier})`,
        color: 15,
        pressed: room.roomEntity === state.selectedRoomEntity,
      });
      ry2 += ROOM_ROW_H;
    }

    // -- ACCEPT / DENY, under a rule so the action bar reads as a bar --
    nodes.push({ kind: "panel", rect: { x: 8, y: ACTION_RULE_Y, w: 624, h: 2 }, fill: 8 });
    nodes.push({ kind: "button", rect: ACCEPT_RECT, label: "ACCEPT", color: 9 });
    nodes.push({ kind: "button", rect: DENY_RECT, label: "DENY", color: 10 });

    return nodes;
  },
};
