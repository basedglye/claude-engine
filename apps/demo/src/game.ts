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

function spawnPlayer(s: Sim, owner: string): EntityId {
  const entity = s.spawn();
  s.setComponent<PlayerPos>(entity, "pos", { x: 0, y: 0 });
  s.setComponent<PlayerPos>(entity, "prevPos", { x: 0, y: 0 });
  s.setComponent<PlayerHp>(entity, "hp", { value: 100 });
  s.setComponent<string>(entity, "owner", owner);
  return entity;
}

export function setup(sim: Sim): void {
  // Keyed by actor: offline mode always submits actor "player" (see
  // movementKeymap below) and pre-registers PLAYER_ENTITY under it here, so
  // the same per-actor systems serve both the single-player demo and net
  // mode (Phase 3 Scope G) without duplicating movement/hazard logic.
  // Networked actors are the server-assigned "player:<id>" string, added on
  // @net/join and removed on @net/leave — session lifecycle enters entirely
  // through this reserved-command path, never as a host-side mutation.
  const entityByActor = new Map<string, EntityId>();
  const player = spawnPlayer(sim, "player"); // == PLAYER_ENTITY: first entity spawned
  entityByActor.set("player", player);
  const hazard = sim.forkRng("hazard");

  // Session lifecycle: only relevant in net mode (offline mode never
  // submits @net/join or @net/leave — the sole entity is spawned above).
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type === "@net/join") {
        const payload = c.payload as { playerId: string };
        entityByActor.set(c.actor, spawnPlayer(s, c.actor));
        s.emit("joined", { playerId: payload.playerId });
      } else if (c.type === "@net/leave") {
        const entity = entityByActor.get(c.actor);
        if (entity !== undefined) {
          s.removeComponent(entity, "pos");
          s.removeComponent(entity, "prevPos");
          s.removeComponent(entity, "hp");
          s.removeComponent(entity, "owner");
          entityByActor.delete(c.actor);
        }
      }
    }
  });

  // Movement system: consumes "move" commands per actor, keeps a previous-
  // position component so hosts can interpolate render position between
  // ticks without engine-owned snapshot history (see docs/PHASE-1.md
  // interpolation note — IWorld exposes only current state).
  sim.addSystem((s) => {
    for (const entity of entityByActor.values()) {
      const pos = s.getComponent<PlayerPos>(entity, "pos");
      if (pos) s.setComponent<PlayerPos>(entity, "prevPos", { x: pos.x, y: pos.y });
    }
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const entity = entityByActor.get(c.actor);
      if (entity === undefined) continue;
      const pos = s.getComponent<PlayerPos>(entity, "pos");
      if (!pos) continue;
      const { dx, dy } = c.payload as { dx: number; dy: number };
      pos.x += dx;
      pos.y += dy;
      s.emit("moved", { actor: c.actor, x: pos.x, y: pos.y });
    }
  });

  // Hazard system: deterministic random damage to the offline demo's single
  // player, same pattern as the smoke scenario — demonstrates the seeded/
  // forked Rng contract. Not extended to networked players (Non-goals).
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
