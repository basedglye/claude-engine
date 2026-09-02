import type { InteractableKind } from "../sim/components.js";
import { t } from "./i18n.js";

/** First-person HUD state. There is no management-style HUD in this game
 *  (see docs/DESIGN.md §1, §4) — this covers only a reticle, an interaction
 *  prompt, and an entry/loading overlay. */
export interface HudState {
  phase: "loading" | "entry" | "playing" | "focused";
  locked: boolean;
  thirdPerson: boolean;
  target?: InteractableKind | undefined;
  loading: {
    pending: number;
    ok: number;
    missing: number;
    manifest: "pending" | "ok" | "missing";
  };
}

export interface Hud {
  update(state: HudState): void;
  destroy(): void;
}

const PROMPT_KEY: Record<InteractableKind, string> = {
  door: "prompt.door",
  terminal: "prompt.terminal",
  guest: "prompt.guest",
  mess: "prompt.mess",
  prop: "prompt.prop",
  candidate: "prompt.candidate",
  document: "prompt.document",
};

const STYLE_ID = "hud-style";
const STYLE = `
#hud {
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
  font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  color: #fff;
}
#hud[data-phase="focused"] {
  display: none;
}

/* --- entry / loading overlay --- */
#hud .hud-entry {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background:
    radial-gradient(ellipse at center, rgba(5,4,3,0.45) 0%, rgba(5,4,3,0.82) 80%);
  opacity: 1;
  transition: opacity 150ms ease;
}
#hud[data-phase="playing"] .hud-entry,
#hud[data-phase="focused"] .hud-entry {
  opacity: 0;
  visibility: hidden;
}
#hud .hud-wordmark {
  font-family: Georgia, "Times New Roman", Times, serif;
  font-size: 56px;
  letter-spacing: 0.14em;
  color: #d4af37;
  text-shadow: 0 2px 18px rgba(212, 175, 55, 0.35);
}
#hud .hud-rule {
  width: 120px;
  height: 1px;
  margin: 18px 0;
  background: linear-gradient(90deg, transparent, #d4af37, transparent);
}
#hud .hud-cta {
  font-family: Georgia, "Times New Roman", Times, serif;
  font-size: 18px;
  letter-spacing: 0.04em;
  color: #f2e9d8;
  margin-bottom: 22px;
}
#hud .hud-controls {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: #9c9284;
  text-transform: uppercase;
}
#hud .hud-assets-missing {
  position: absolute;
  left: 16px;
  bottom: 16px;
  font-size: 11px;
  color: #8a8378;
  letter-spacing: 0.02em;
}
#hud .hud-loading-status {
  position: absolute;
  left: 16px;
  bottom: 34px;
  font-size: 11px;
  color: #cfc7b8;
  letter-spacing: 0.04em;
  transition: opacity 150ms ease;
}

/* --- reticle + prompt --- */
#hud .hud-reticle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.7);
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.6));
  transition: width 150ms ease, height 150ms ease, border-color 150ms ease;
  opacity: 0;
}
#hud[data-phase="playing"] .hud-reticle {
  opacity: 1;
}
#hud .hud-reticle[data-target="1"] {
  width: 10px;
  height: 10px;
  border: 2px solid #d4af37;
}
#hud .hud-prompt {
  position: absolute;
  left: 50%;
  top: calc(50% + 18px);
  transform: translate(-50%, 0);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #f2e9d8;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.9);
  opacity: 0;
  transition: opacity 150ms ease;
  white-space: nowrap;
}
#hud .hud-prompt[data-visible="1"] {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  #hud, #hud * {
    transition: none !important;
  }
}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  doc.head.appendChild(style);
}

export function createHud(root: HTMLElement = document.body): Hud {
  const doc = root.ownerDocument ?? document;
  ensureStyle(doc);

  const el = doc.createElement("div");
  el.id = "hud";
  el.style.pointerEvents = "none";
  el.innerHTML = `
    <div class="hud-entry">
      <div class="hud-wordmark">${escapeHtml(t("wordmark"))}</div>
      <div class="hud-rule"></div>
      <div class="hud-cta">${escapeHtml(t("entry.cta"))}</div>
      <div class="hud-controls">${escapeHtml(t("entry.controls"))}</div>
      <div class="hud-assets-missing" hidden></div>
      <div class="hud-loading-status" hidden></div>
    </div>
    <div class="hud-reticle"></div>
    <div class="hud-prompt"></div>
  `;
  root.appendChild(el);

  const reticle = el.querySelector<HTMLDivElement>(".hud-reticle")!;
  const prompt = el.querySelector<HTMLDivElement>(".hud-prompt")!;
  const assetsMissing = el.querySelector<HTMLDivElement>(".hud-assets-missing")!;
  const loadingStatus = el.querySelector<HTMLDivElement>(".hud-loading-status")!;

  function update(state: HudState): void {
    // NOTE: deliberately does not diff against a stored `last` state object
    // to decide *whether* to touch the DOM — a caller that mutates one
    // HudState object in place (same reference passed every frame) would
    // make any such diff silently no-op forever, since `last` and `state`
    // would alias. Each DOM write below is cheap (attribute/text/hidden
    // toggles) and is idempotent, so just applying it unconditionally is
    // both simpler and safe against that failure mode.
    el.dataset.phase = state.phase;

    const targetVisible = state.phase === "playing" && !!state.target;
    reticle.dataset.target = targetVisible ? "1" : "0";
    if (targetVisible && state.target) {
      prompt.textContent = t(PROMPT_KEY[state.target]);
      prompt.dataset.visible = "1";
    } else {
      prompt.dataset.visible = "0";
    }

    // Only the whole pack being absent is worth a footer: a manifest that
    // deliberately omits one optional model (the code has a fallback for
    // every model) still counts as "installed".
    const missing = state.loading.manifest === "missing";
    if (missing) {
      assetsMissing.textContent = t("entry.assetsMissing");
      assetsMissing.hidden = false;
    } else {
      assetsMissing.hidden = true;
    }

    const isLoading = state.phase === "loading";
    if (isLoading && state.loading.pending > 0) {
      loadingStatus.textContent = t("loading.pending").replace("{n}", String(state.loading.pending));
      loadingStatus.hidden = false;
    } else if (isLoading) {
      loadingStatus.textContent = t("loading.ready");
      loadingStatus.hidden = false;
    } else {
      loadingStatus.hidden = true;
    }
  }

  function destroy(): void {
    el.remove();
  }

  return { update, destroy };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
