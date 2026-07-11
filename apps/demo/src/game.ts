/**
 * Core-only sim module for the Phase 1 demo. Imports ONLY
 * `@claude-engine/core` — this exact compiled module (via
 * `npm run build:game` -> dist-game/game.js) is what both the browser
 * (through renderer-three) and the headless harness
 * (scenarios/demo-walk.scenario.mjs) run, proving they exercise identical
 * sim logic. Enforced structurally by tsconfig.game.json (no DOM lib, empty
 * ambient types) even though this package isn't packages/core itself.
 */
import type { Command, EntityId, IWorld, Sim } from "@claude-engine/core";

export const PLAYER_ENTITY: EntityId = 1;

export interface PlayerPos {
  x: number;
  y: number;
}

export interface PlayerHp {
  value: number;
}

const MOVE_SPEED = 1;

export function setup(sim: Sim): void {
  const player = sim.spawn(); // == PLAYER_ENTITY: first entity spawned
  sim.setComponent<PlayerPos>(player, "pos", { x: 0, y: 0 });
  sim.setComponent<PlayerPos>(player, "prevPos", { x: 0, y: 0 });
  sim.setComponent<PlayerHp>(player, "hp", { value: 100 });
  const hazard = sim.rng.fork("hazard");

  // Movement system: consumes "move" commands, keeps a previous-position
  // component so hosts can interpolate render position between ticks
  // without engine-owned snapshot history (see docs/PHASE-1.md interpolation
  // note — IWorld exposes only current state in Phase 1).
  sim.addSystem((s) => {
    const pos = s.getComponent<PlayerPos>(player, "pos")!;
    s.setComponent<PlayerPos>(player, "prevPos", { x: pos.x, y: pos.y });
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const { dx, dy } = c.payload as { dx: number; dy: number };
      pos.x += dx;
      pos.y += dy;
      s.emit("moved", { x: pos.x, y: pos.y });
    }
  });

  // Hazard system: deterministic random damage, same pattern as the smoke
  // scenario, so the demo also demonstrates the seeded/forked Rng contract.
  sim.addSystem((s) => {
    if (s.tick % 40 !== 0) return;
    const hp = s.getComponent<PlayerHp>(player, "hp")!;
    hp.value -= hazard.int(1, 3);
    s.emit("damaged", { hp: hp.value });
  });
}

export function moveCommand(tick: number, actor: string, dx: number, dy: number): Command {
  return { tick, actor, type: "move", payload: { dx: dx * MOVE_SPEED, dy: dy * MOVE_SPEED } };
}

/** KeyboardEvent.code -> Command factory for WASD movement, for renderer-three's keymap. */
export function movementKeymap(actor: string): Record<string, (world: IWorld) => Command | null> {
  const dir = (dx: number, dy: number) => (world: IWorld): Command =>
    moveCommand(world.tick + 1, actor, dx, dy);
  return {
    KeyW: dir(0, -1),
    KeyS: dir(0, 1),
    KeyA: dir(-1, 0),
    KeyD: dir(1, 0),
  };
}
