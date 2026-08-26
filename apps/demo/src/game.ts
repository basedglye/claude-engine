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

/**
 * Derived from the "owner" component on every use, never cached in a
 * setup-closure Map. A closure Map is exactly the cross-tick state
 * Sim.restore() cannot rebuild: restore() replaces component stores, but a
 * fresh setup() call runs first and would populate a new, empty Map with no
 * knowledge of entities the snapshot already contains — every replayed
 * command for an actor who joined before the last snapshot would then
 * silently no-op. Deriving the lookup from components means restore()
 * rebuilding component state is automatically correct; there is no separate
 * index to go stale. See references/core-api.md's restore section.
 */
function findEntityByOwner(s: Sim, owner: string): EntityId | undefined {
  for (const [entity, value] of s.withComponent<string>("owner")) {
    if (value === owner) return entity;
  }
  return undefined;
}

export function setup(sim: Sim): void {
  // Offline mode always submits actor "player" (see movementKeymap below);
  // spawning it here — with the same "owner" component networked actors
  // get — means the systems below serve single-player and net mode
  // identically, with no special-casing. Networked actors are the
  // server-assigned "player:<id>" string, added on @net/join and removed on
  // @net/leave — session lifecycle enters entirely through this
  // reserved-command path, never as a host-side mutation.
  const player = spawnPlayer(sim, "player"); // == PLAYER_ENTITY: first entity spawned
  const hazard = sim.forkRng("hazard");

  // Session lifecycle: only relevant in net mode (offline mode never
  // submits @net/join or @net/leave — the sole entity is spawned above).
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type === "@net/join") {
        // Idempotent per actor: never spawn a second entity for an actor
        // that already has one (e.g. a superseded connection's leave and
        // the new connection's join arriving close together).
        if (findEntityByOwner(s, c.actor) !== undefined) continue;
        const payload = c.payload as { playerId: string };
        spawnPlayer(s, c.actor);
        s.emit("joined", { playerId: payload.playerId });
      } else if (c.type === "@net/leave") {
        const entity = findEntityByOwner(s, c.actor);
        if (entity !== undefined) {
          s.removeComponent(entity, "pos");
          s.removeComponent(entity, "prevPos");
          s.removeComponent(entity, "hp");
          s.removeComponent(entity, "owner");
        }
      }
    }
  });

  // Movement system: consumes "move" commands per actor, keeps a previous-
  // position component so hosts can interpolate render position between
  // ticks without engine-owned snapshot history (see docs/PHASE-1.md
  // interpolation note — IWorld exposes only current state).
  sim.addSystem((s) => {
    for (const [entity] of s.withComponent<string>("owner")) {
      const pos = s.getComponent<PlayerPos>(entity, "pos");
      if (pos) s.setComponent<PlayerPos>(entity, "prevPos", { x: pos.x, y: pos.y });
    }
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const entity = findEntityByOwner(s, c.actor);
      if (entity === undefined) continue;
      const pos = s.getComponent<PlayerPos>(entity, "pos");
      if (!pos) continue;
      const { dx, dy } = c.payload as { dx: number; dy: number };
      // Write-through, never in-place (`pos.x += dx`): as of Phase H2,
      // Sim.stateHash() caches a per-component digest invalidated by
      // setComponent(), so an in-place mutation would be invisible to the
      // hash. Same state, same value — only the write path changed.
      const next = { x: pos.x + dx, y: pos.y + dy };
      s.setComponent<PlayerPos>(entity, "pos", next);
      s.emit("moved", { actor: c.actor, x: next.x, y: next.y });
    }
  });

  // Hazard system: deterministic random damage to the offline demo's single
  // player, same pattern as the smoke scenario — demonstrates the seeded/
  // forked Rng contract. Not extended to networked players (Non-goals).
  sim.addSystem((s) => {
    if (s.tick % 40 !== 0) return;
    const hp = s.getComponent<PlayerHp>(player, "hp")!;
    const value = hp.value - hazard.int(1, 3);
    s.setComponent<PlayerHp>(player, "hp", { value });
    s.emit("damaged", { hp: value });
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
