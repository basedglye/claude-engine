/**
 * Desk feedback stamp — host-side, presentation-only (creative-org cycle 4,
 * the desk-feedback half of DECISIONS.md item 1).
 *
 * When the player resolves a check-in at the desk, the RESERVA screen gets an
 * immediate readable reaction: a stamped word flashes over the lower screen
 * and fades. It is driven entirely by the sim's own event stream
 * (desk.fraudCaught / desk.fraudMissed / desk.falseDeny / guest.checkedIn /
 * guest.denied), so nothing here is hashed and no golden moves — the exact
 * reason the stamp lives in the host and not in `ScreenViewData` (which would
 * have needed a new sim field and re-pinned every scenario).
 *
 * It never draws over the calibration strip (top-right of the screen, which
 * the `reserva-readability` gate samples), and desk decisions never happen
 * during that scenario, so the gate never sees a stamp. `Math.*` and
 * wall-clock are fine here (outside the purity roots, never re-enters the
 * sim).
 */
import * as THREE from "three";
import type { GameEvent } from "@claude-engine/core";
import { SCREEN_W_M, SCREEN_H_M } from "./screens.js";

interface StampLook {
  text: string;
  rgb: string;
}

/** Which desk event maps to which stamp. Order matters: a fraud caught also
 *  emits guest.denied, and a missed fraud also emits guest.checkedIn, so the
 *  more specific fraud verdict is chosen first. */
function stampFor(types: Set<string>): StampLook | undefined {
  if (types.has("desk.fraudCaught")) return { text: "FRAUD CAUGHT", rgb: "#39d353" };
  if (types.has("desk.fraudMissed")) return { text: "FRAUD MISSED", rgb: "#ff4d4d" };
  if (types.has("desk.falseDeny")) return { text: "WRONGLY DENIED", rgb: "#ffb020" };
  if (types.has("guest.checkedIn")) return { text: "CHECKED IN", rgb: "#39d353" };
  if (types.has("guest.denied")) return { text: "DENIED", rgb: "#ff4d4d" };
  return undefined;
}

const DESK_EVENT_TYPES = new Set([
  "desk.fraudCaught",
  "desk.fraudMissed",
  "desk.falseDeny",
  "guest.checkedIn",
  "guest.denied",
]);

function makeStampTexture(look: StampLook): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  // Rubber-stamp look: a rotated rounded rect outline + the word, ink colour.
  g.translate(c.width / 2, c.height / 2);
  g.rotate((-8 * Math.PI) / 180);
  g.strokeStyle = look.rgb;
  g.lineWidth = 7;
  g.globalAlpha = 0.9;
  const w = 460;
  const h = 110;
  const r = 14;
  g.beginPath();
  g.moveTo(-w / 2 + r, -h / 2);
  g.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  g.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  g.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  g.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  g.closePath();
  g.stroke();
  g.fillStyle = look.rgb;
  g.font = "bold 58px Georgia, 'Times New Roman', serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(look.text, 0, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export interface DeskStamp {
  /** Feed the frame's NEW sim events plus the focused terminal group (or
   *  undefined when no screen is focused). Call once per frame. */
  update(newEvents: readonly GameEvent[], focusedGroup: THREE.Group | undefined, dtMs: number): void;
  dispose(): void;
}

const STAMP_LIFE_MS = 1100;
const STAMP_W_M = SCREEN_W_M * 0.62;

export function createDeskStamp(): DeskStamp {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, opacity: 0 }));
  sprite.scale.set(STAMP_W_M, STAMP_W_M * (160 / 512), 1);
  // Lower third of the screen, clear of the top-right calibration strip.
  sprite.position.set(0, -SCREEN_H_M * 0.22, 0.06);
  sprite.renderOrder = 999;
  sprite.visible = false;
  let ageMs = STAMP_LIFE_MS + 1;
  let parented: THREE.Group | undefined;
  let currentTex: THREE.CanvasTexture | undefined;

  function fire(look: StampLook): void {
    const mat = sprite.material as THREE.SpriteMaterial;
    if (currentTex) currentTex.dispose();
    currentTex = makeStampTexture(look);
    mat.map = currentTex;
    mat.needsUpdate = true;
    ageMs = 0;
  }

  return {
    update(newEvents, focusedGroup, dtMs): void {
      // Re-parent to whatever screen is focused this frame (only one is).
      if (focusedGroup !== parented) {
        sprite.removeFromParent();
        parented = focusedGroup;
        if (focusedGroup) focusedGroup.add(sprite);
      }
      if (focusedGroup) {
        const types = new Set<string>();
        for (const e of newEvents) if (DESK_EVENT_TYPES.has(e.type)) types.add(e.type);
        const look = stampFor(types);
        if (look) fire(look);
      }
      // Animate: pop in, hold, fade.
      const mat = sprite.material as THREE.SpriteMaterial;
      if (ageMs <= STAMP_LIFE_MS && parented) {
        ageMs += dtMs;
        const t = ageMs / STAMP_LIFE_MS;
        const opacity = t < 0.12 ? t / 0.12 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
        const pop = t < 0.12 ? 0.85 + 0.15 * (t / 0.12) : 1;
        mat.opacity = opacity;
        sprite.scale.set(STAMP_W_M * pop, STAMP_W_M * (160 / 512) * pop, 1);
        sprite.visible = opacity > 0.01;
      } else {
        sprite.visible = false;
        mat.opacity = 0;
      }
    },
    dispose(): void {
      sprite.removeFromParent();
      if (currentTex) currentTex.dispose();
      (sprite.material as THREE.SpriteMaterial).dispose();
    },
  };
}
