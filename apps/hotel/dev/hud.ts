import { createHud, type HudState } from "../src/render/hud.js";
import type { InteractableKind } from "../src/sim/components.js";

const hud = createHud(document.body);
const panel = document.getElementById("dev-panel")!;

const TARGETS: InteractableKind[] = ["door", "terminal", "guest", "mess", "prop", "candidate", "document"];

const state: HudState = {
  phase: "entry",
  locked: false,
  thirdPerson: false,
  target: undefined,
  loading: { pending: 0, ok: 0, missing: 0, manifest: "ok" },
};

function render(): void {
  // hud.update() diffs against the previously passed object, so pass a
  // fresh snapshot each call rather than the live, in-place-mutated state
  // (mirrors how main.ts's per-frame state literal works).
  hud.update({ ...state, loading: { ...state.loading } });
  panel.textContent = [
    "HUD dev harness",
    "1 = loading  2 = entry  3 = playing  4 = focused",
    "t/y/g/m/p/c/d = target (door/terminal/guest/mess/prop/candidate/document)",
    "0 = clear target   x = toggle missing assets   n = cycle pending count",
    "",
    `phase: ${state.phase}`,
    `target: ${state.target ?? "(none)"}`,
    `loading: pending=${state.loading.pending} missing=${state.loading.missing} manifest=${state.loading.manifest}`,
  ].join("\n");
}

const KEY_TO_TARGET: Record<string, InteractableKind> = {
  t: "door",
  y: "terminal",
  g: "guest",
  m: "mess",
  p: "prop",
  c: "candidate",
  d: "document",
};

window.addEventListener("keydown", (ev) => {
  const key = ev.key.toLowerCase();
  if (key === "1") state.phase = "loading";
  else if (key === "2") state.phase = "entry";
  else if (key === "3") state.phase = "playing";
  else if (key === "4") state.phase = "focused";
  else if (key === "0") state.target = undefined;
  else if (key === "x") {
    state.loading.missing = state.loading.missing > 0 ? 0 : 3;
    state.loading.manifest = state.loading.manifest === "missing" ? "ok" : "missing";
  } else if (key === "n") {
    state.loading.pending = state.loading.pending > 0 ? 0 : 4;
  } else if (key in KEY_TO_TARGET) {
    state.target = KEY_TO_TARGET[key];
  } else {
    return;
  }
  render();
});

render();

// Expose for Playwright-driven screenshots (avoids relying purely on
// synthetic keyboard timing).
(window as unknown as { __hudDev: { state: HudState; render: () => void } }).__hudDev = { state, render };
