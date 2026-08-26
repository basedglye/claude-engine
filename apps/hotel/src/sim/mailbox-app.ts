/**
 * MAILBOX — complaints, bulletins, applications and vendor spam
 * (DESIGN §4). Pure; same purity root as reserva-app.ts.
 *
 * THE RULING THIS APP EXISTS TO HONOUR (docs/PHASE-H2.md §10): a bulletin
 * takes effect at DELIVERY, not on read. Reading is how the player LEARNS
 * what changed — it is never how the change activates. The alternative
 * (effect-on-read) would mean a player could dodge escalation by never
 * opening their mail, i.e. optimal play would be not engaging with the
 * content. `mailbox.read` therefore sets one boolean and nothing else, and
 * the blacklist row is already live in the rule table by the time the
 * player sees the name that went onto it.
 */
import type { PaintNode, Rect, ScreenAppDef, ScreenEffect, ScreenWorldView } from "@claude-engine/surface-ui";
import { GLYPH_H, GLYPH_W, SCREEN_W, hitRect } from "@claude-engine/surface-ui";
import type { ScreenMailView, ScreenViewData } from "./screen-data.js";

/** `openMailEntity` 0 = the list view. Integers only — hashed verbatim. */
export interface MailboxState {
  openMailEntity: number;
}

const LIST_X = 8;
const LIST_Y = 40;
const ROW_H = 18;
const ROW_W = 280;
const MAX_ROWS = 18;
const BACK_RECT: Rect = { x: 8, y: 420, w: 96, h: 18 };

const BODY_X = 300;
const BODY_Y = 40;
const BODY_MAX_CHARS = Math.floor((SCREEN_W - BODY_X - 8) / GLYPH_W);

function viewData(view: ScreenWorldView): ScreenViewData {
  return view.data as unknown as ScreenViewData;
}

function mailRowKey(mailEntity: number): string {
  return `mail:${mailEntity}`;
}

function layoutRects(view: ScreenWorldView): Record<string, Rect> {
  const rects: Record<string, Rect> = { back: BACK_RECT };
  let y = LIST_Y;
  for (const mail of viewData(view).mail.slice(0, MAX_ROWS)) {
    rects[mailRowKey(mail.mailEntity)] = { x: LIST_X, y, w: ROW_W, h: ROW_H };
    y += ROW_H;
  }
  return rects;
}

/** Subject lines. i18n keys per house style — English only in source, and
 *  the app is the one place that turns a key into words. */
function subjectFor(mail: ScreenMailView): string {
  switch (mail.subjectKey) {
    case "mail.complaint":
      return `Complaint: ${mail.fields.segment ?? "guest"} rated us ${mail.fields.score ?? "?"}/5`;
    case "mail.bulletin":
      return "Industry bulletin: blacklist update";
    case "mail.applications":
      return `Applications received (${mail.fields.count ?? "?"})`;
    case "mail.spam":
      return mail.fields.subject ?? "A message from our sponsors";
    default:
      return mail.subjectKey;
  }
}

function bodyFor(mail: ScreenMailView): string[] {
  switch (mail.subjectKey) {
    case "mail.complaint":
      return [
        `A ${mail.fields.segment ?? "guest"} guest left us ${mail.fields.score ?? "?"} out of 5.`,
        "",
        `They mentioned: ${(mail.fields.factors ?? "").split(",").filter((f) => f.length > 0).join(", ") || "nothing specific"}.`,
      ];
    case "mail.bulletin":
      return [
        "The following names have been added to the industry",
        "blacklist. Front desk staff must not check them in.",
        "",
        ...(mail.fields.names ?? "").split(",").filter((n) => n.length > 0).map((n) => `  - ${n}`),
        "",
        "This bulletin is already in force.",
      ];
    case "mail.applications":
      return [
        `${mail.fields.count ?? "?"} people answered the advert.`,
        "",
        "Their resumes are printing at the desk. Read them,",
        "then interview whoever walks in.",
      ];
    default:
      return [mail.fields.body ?? "(no content)"];
  }
}

/** Greedy word-wrap, same approach as RESERVA's procedures card. */
function wrapText(text: string, maxChars: number): string[] {
  if (text.length === 0) return [""];
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

export const mailboxApp: ScreenAppDef<MailboxState> = {
  id: "mailbox",

  init(): MailboxState {
    return { openMailEntity: 0 };
  },

  reduce(state, input, view) {
    if (input.kind !== "click") return state;
    const hit = hitRect(layoutRects(view), input.px, input.py);
    if (hit === undefined) return state;

    if (hit === "back") {
      return state.openMailEntity === 0 ? state : { openMailEntity: 0 };
    }

    if (hit.startsWith("mail:")) {
      const mailEntity = Number.parseInt(hit.slice("mail:".length), 10);
      const mail = viewData(view).mail.find((m) => m.mailEntity === mailEntity);
      // The guard: re-opening something already read is a state change and
      // nothing more. Emitting the effect again would be harmless but
      // dishonest — the sim would apply a write that changes nothing.
      if (!mail || mail.read) return { openMailEntity: mailEntity };
      const effect: ScreenEffect = { type: "mailbox.read", payload: { mailEntity } };
      return { state: { openMailEntity: mailEntity }, effect };
    }

    return state;
  },

  layout(_state, view) {
    return layoutRects(view);
  },

  paintSpec(state, view) {
    const data = viewData(view);
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    const unread = data.mail.filter((m) => !m.read).length;
    nodes.push({ kind: "text", x: 8, y: 4, text: `MAILBOX - ${data.mail.length} messages, ${unread} unread`, color: 11 });

    if (data.mail.length === 0) {
      nodes.push({ kind: "text", x: 8, y: 24, text: "No mail.", color: 14 });
      nodes.push({ kind: "button", rect: BACK_RECT, label: "BACK", color: 15 });
      return nodes;
    }

    let y = LIST_Y;
    for (const mail of data.mail.slice(0, MAX_ROWS)) {
      const marker = mail.read ? " " : "*";
      nodes.push({
        kind: "button",
        rect: { x: LIST_X, y, w: ROW_W, h: ROW_H },
        label: `${marker} d${mail.day} ${subjectFor(mail)}`,
        color: mail.read ? 8 : 15,
        pressed: mail.mailEntity === state.openMailEntity,
      });
      y += ROW_H;
    }

    const open = data.mail.find((m) => m.mailEntity === state.openMailEntity);
    if (open) {
      nodes.push({ kind: "text", x: BODY_X, y: 24, text: `[${open.kind}]`, color: 12 });
      let by = BODY_Y;
      for (const paragraph of bodyFor(open)) {
        for (const line of wrapText(paragraph, BODY_MAX_CHARS)) {
          nodes.push({ kind: "text", x: BODY_X, y: by, text: line, color: 8 });
          by += GLYPH_H + 3;
        }
      }
    } else {
      nodes.push({ kind: "text", x: BODY_X, y: 24, text: "Select a message.", color: 14 });
    }

    nodes.push({ kind: "button", rect: BACK_RECT, label: "BACK", color: 15 });
    return nodes;
  },
};
