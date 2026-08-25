/**
 * Core-only sim module for Phase H0 "Walk the Lobby" — imports ONLY
 * @claude-engine/core, @claude-engine/space, and @claude-engine/interiors
 * (headless-safe: no three, no DOM, zero `Math.` transcendentals anywhere in
 * this file). This exact compiled module (via `npm run build:game` ->
 * dist-game/game.js) is what both the browser (through renderer-three) and
 * the headless harness run, proving they exercise identical sim logic. See
 * docs/PHASE-H0.md, "The apps/hotel skeleton" and "Determinism rules".
 *
 * Determinism rule 5 (no closure state, the Phase-3 item-1 lesson applied):
 * `generateGroundFloor(seed)` is a pure function of the seed alone. It is
 * called once here in `setup()` and captured by system closures — legal
 * because it is setup-derived deterministic data that never changes after
 * setup and is byte-identically re-derived by Sim.restore()'s fresh
 * setup() run. It is NOT stored in components (that would bloat
 * stateHash()/snapshots with bulk geometry data). Anything that changes
 * after tick 1 (door.open, positions) lives in components only. The
 * doorIndex -> door-entity mapping is likewise NEVER a closure Map — every
 * system that needs it re-derives it by scanning `withComponent("door")`.
 */
import type { Command, EntityId, Sim } from "@claude-engine/core";
import {
  atan2Mdeg,
  angleDeltaMdeg,
  cosMdeg,
  sinMdeg,
  FULL_TURN_MDEG,
  moveCircle,
  cellAt,
  cellOfMm,
  CELL,
  type NavGrid,
} from "@claude-engine/space";
import { generateGroundFloor, type GroundFloor } from "@claude-engine/interiors";

export const PLAYER_ENTITY: EntityId = 1;
export const PLAYER_ACTOR = "player";

/** 4 m/s at the sim's fixed 20 Hz tick rate. */
export const MOVE_SPEED_MM_PER_TICK = 200;
export const PLAYER_RADIUS_MM = 300;
export const INTERACTABLE_RADIUS_MM = 1500;
export const INTERACTABLE_ARC_MDEG = 60_000;

export interface Pos {
  xMm: number;
  zMm: number;
}
export interface Yaw {
  mdeg: number;
}
export interface Collider {
  radiusMm: number;
}
export interface Door {
  doorIndex: number;
  open: boolean;
  cx: number;
  cz: number;
}
export interface Interactable {
  kind: "door";
  xMm: number;
  zMm: number;
  radiusMm: number;
  arcMdeg: number;
}
export interface Player {
  actor: string;
}

/** Short, stable reason slugs for interact-denied events — the anti-cheat
 *  seam's documented vocabulary (docs/PHASE-H0.md determinism rule 4):
 *  - "no-interactable": target entity has no `interactable` component.
 *  - "out-of-range": squared distance from player to target exceeds
 *    radiusMm^2.
 *  - "out-of-arc": bearing to target is outside +/- arcMdeg/2 of the
 *    player's yaw.
 *  - "not-a-door": target has `interactable` but no `door` component (the
 *    only H0 interactable kind is "door", so this only fires if a future
 *    kind is added without matching interact-system handling — included
 *    for forward compatibility, unreachable in H0's own content). */
export type InteractDeniedReason = "no-interactable" | "out-of-range" | "out-of-arc" | "not-a-door";

/** Pure function of the seed alone — never touches the live sim.rng. Safe to
 *  call again outside setup() (e.g. from main.ts, across the module
 *  boundary) and get byte-identical results. */
export function loadGroundFloor(seed: string): GroundFloor {
  return generateGroundFloor(seed);
}

function wrapMdeg(mdeg: number): number {
  let m = mdeg % FULL_TURN_MDEG;
  if (m < 0) m += FULL_TURN_MDEG;
  return m;
}

export function setup(sim: Sim): void {
  const floor = loadGroundFloor(sim.seed);
  const grid: NavGrid = floor.grid;

  const player = sim.spawn(); // == PLAYER_ENTITY: first entity spawned
  sim.setComponent<Pos>(player, "pos", { xMm: floor.spawn.xMm, zMm: floor.spawn.zMm });
  sim.setComponent<Pos>(player, "prevPos", { xMm: floor.spawn.xMm, zMm: floor.spawn.zMm });
  sim.setComponent<Yaw>(player, "yaw", { mdeg: wrapMdeg(floor.spawn.yawMdeg) });
  sim.setComponent<Yaw>(player, "prevYaw", { mdeg: wrapMdeg(floor.spawn.yawMdeg) });
  sim.setComponent<Collider>(player, "collider", { radiusMm: PLAYER_RADIUS_MM });
  sim.setComponent<Player>(player, "player", { actor: PLAYER_ACTOR });

  for (const doorSpec of floor.doors) {
    const doorEntity = sim.spawn();
    sim.setComponent<Door>(doorEntity, "door", {
      doorIndex: doorSpec.doorIndex,
      open: false,
      cx: doorSpec.cx,
      cz: doorSpec.cz,
    });
    sim.setComponent<Interactable>(doorEntity, "interactable", {
      kind: "door",
      xMm: doorSpec.xMm,
      zMm: doorSpec.zMm,
      radiusMm: INTERACTABLE_RADIUS_MM,
      arcMdeg: INTERACTABLE_ARC_MDEG,
    });
  }

  /** True iff (cx,cz) is one of the cells spanned by some currently-open
   *  door. Doorways are DOOR_WIDTH_CELLS (4) grid cells wide (packages/
   *  interiors/src/layout.ts) — a single `door.cx`/`cz` names only the
   *  span's anchor cell, so membership is checked against the matching
   *  Portal's `cells` list. `floor.portals.portals[doorIndex]` is the same
   *  portal `addDoor` pushed for that door (doorIndex === portalId by
   *  construction), so this is closure data derivable byte-identically
   *  from `sim.seed` alone (determinism rule 5) — it is NOT a map from
   *  spawn-time state. Scans `withComponent("door")` every call, same as
   *  before, never a closure Map keyed by cell. */
  function isOpenAt(s: Sim, cx: number, cz: number): boolean {
    for (const [, door] of s.withComponent<Door>("door")) {
      if (!door.open) continue;
      const portal = floor.portals.portals[door.doorIndex];
      if (portal && portal.cells.some((c) => c.cx === cx && c.cz === cz)) return true;
    }
    return false;
  }

  // 1. snapshotPrevSystem — copy pos->prevPos, yaw->prevYaw (render
  //    interpolation source).
  function snapshotPrevSystem(s: Sim): void {
    const pos = s.getComponent<Pos>(player, "pos");
    const yaw = s.getComponent<Yaw>(player, "yaw");
    if (pos) s.setComponent<Pos>(player, "prevPos", { xMm: pos.xMm, zMm: pos.zMm });
    if (yaw) s.setComponent<Yaw>(player, "prevYaw", { mdeg: yaw.mdeg });
  }

  // 2. faceSystem — apply the first `face` command per actor this tick;
  //    wrap mod 360_000. Later duplicates in the same tick for the same
  //    actor are ignored (documented in the command vocabulary).
  function faceSystem(s: Sim): void {
    const seenActors = new Set<string>();
    for (const c of s.commands()) {
      if (c.type !== "face") continue;
      if (seenActors.has(c.actor)) continue;
      seenActors.add(c.actor);
      if (c.actor !== PLAYER_ACTOR) continue;
      const { yawMdeg } = c.payload as { yawMdeg: number };
      s.setComponent<Yaw>(player, "yaw", { mdeg: wrapMdeg(yawMdeg) });
    }
  }

  // 3. moveSystem — apply `move` intents through space.moveCircle with
  //    isOpen derived fresh from withComponent("door") every call.
  function moveSystem(s: Sim): void {
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      if (c.actor !== PLAYER_ACTOR) continue;
      const pos = s.getComponent<Pos>(player, "pos");
      const yaw = s.getComponent<Yaw>(player, "yaw");
      const collider = s.getComponent<Collider>(player, "collider");
      if (!pos || !yaw || !collider) continue;
      const { forwardMilli, strafeMilli } = c.payload as { forwardMilli: number; strafeMilli: number };
      const fw = clampMilli(forwardMilli);
      const sw = clampMilli(strafeMilli);

      // Forward is the sim yaw's facing direction; strafe is perpendicular
      // (90deg clockwise from forward). All trig via space's integer LUT —
      // never Math.sin/cos/atan2 (determinism rule 2).
      const sinYaw = sinMdeg(yaw.mdeg);
      const cosYaw = cosMdeg(yaw.mdeg);
      // Q16.16 fixed-point: sin/cos are in [-ONE, ONE] (ONE = 65536).
      const ONE = 65536;
      const dxMm = Math.trunc(
        (fw * sinYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE) +
          (sw * cosYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE)
      );
      const dzMm = Math.trunc(
        (fw * cosYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE) -
          (sw * sinYaw * MOVE_SPEED_MM_PER_TICK) / (1000 * ONE)
      );

      const resolved = moveCircle(grid, pos.xMm, pos.zMm, dxMm, dzMm, collider.radiusMm, (cx, cz) =>
        isOpenAt(s, cx, cz)
      );
      s.setComponent<Pos>(player, "pos", resolved);
    }
  }

  // 4. interactSystem — target must have `interactable`; squared-mm
  //    distance check (no sqrt) against radiusMm^2; bearing via atan2Mdeg
  //    within +/- arcMdeg/2 of yaw. On success flip door.open and emit
  //    "door". On rejection emit "interact-denied" { reason }.
  function interactSystem(s: Sim): void {
    for (const c of s.commands()) {
      if (c.type !== "interact") continue;
      if (c.actor !== PLAYER_ACTOR) continue;
      const { target } = c.payload as { target: EntityId };
      const pos = s.getComponent<Pos>(player, "pos");
      const yaw = s.getComponent<Yaw>(player, "yaw");
      if (!pos || !yaw) continue;

      const interactable = s.getComponent<Interactable>(target, "interactable");
      if (!interactable) {
        s.emit("interact-denied", { reason: "no-interactable" satisfies InteractDeniedReason });
        continue;
      }

      const dxMm = interactable.xMm - pos.xMm;
      const dzMm = interactable.zMm - pos.zMm;
      const distSqMm = dxMm * dxMm + dzMm * dzMm;
      const radiusSqMm = interactable.radiusMm * interactable.radiusMm;
      if (distSqMm > radiusSqMm) {
        s.emit("interact-denied", { reason: "out-of-range" satisfies InteractDeniedReason });
        continue;
      }

      const bearingMdeg = atan2Mdeg(dxMm, dzMm);
      const deltaMdeg = Math.abs(angleDeltaMdeg(bearingMdeg, yaw.mdeg));
      if (deltaMdeg > interactable.arcMdeg / 2) {
        s.emit("interact-denied", { reason: "out-of-arc" satisfies InteractDeniedReason });
        continue;
      }

      const door = s.getComponent<Door>(target, "door");
      if (!door) {
        s.emit("interact-denied", { reason: "not-a-door" satisfies InteractDeniedReason });
        continue;
      }

      const open = !door.open;
      s.setComponent<Door>(target, "door", { ...door, open });
      s.emit("door", { doorIndex: door.doorIndex, open });
    }
  }

  sim.addSystem(snapshotPrevSystem);
  sim.addSystem(faceSystem);
  sim.addSystem(moveSystem);
  sim.addSystem(interactSystem);
}

function clampMilli(v: number): number {
  return Math.max(-1000, Math.min(1000, v));
}

// -- Command factories -------------------------------------------------

export function faceCommand(tick: number, yawMdeg: number): Command {
  return { tick, actor: PLAYER_ACTOR, type: "face", payload: { yawMdeg: wrapMdeg(yawMdeg) } };
}

export function moveCommand(tick: number, forwardMilli: number, strafeMilli: number): Command {
  return {
    tick,
    actor: PLAYER_ACTOR,
    type: "move",
    payload: { forwardMilli: clampMilli(forwardMilli), strafeMilli: clampMilli(strafeMilli) },
  };
}

export function interactCommand(tick: number, target: EntityId): Command {
  return { tick, actor: PLAYER_ACTOR, type: "interact", payload: { target } };
}

export { cellAt, cellOfMm, CELL };
