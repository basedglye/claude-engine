/**
 * Core-only sim module (imports ONLY @claude-engine/core — must run
 * headless). This exact compiled module (via `npm run build:game` ->
 * dist-game/game.js) is what both the browser (through renderer-three) and
 * the headless harness run, proving they exercise identical sim logic.
 *
 * Item placement is a pure function of the world seed (generateWorldItems),
 * never touching the live sim.rng — the renderer regenerates the same
 * layout independently to draw icon sprites, without the sim storing bulk
 * generated data as components.
 */
import { Rng, type Command, type EntityId, type IWorld, type Sim } from "@claude-engine/core";

export const PLAYER_ENTITY: EntityId = 1;
export const TILE_SIZE = 1;
export const GRID_HALF = 6;

export interface GridPos {
  x: number;
  y: number;
}

export interface PlayerHp {
  value: number;
}

export interface ItemSpec {
  x: number;
  y: number;
  iconSeed: number;
}

const ITEM_COUNT = 6;

/** Pure function of the world seed alone — never touches the live sim.rng. */
export function generateWorldItems(seed: string): ItemSpec[] {
  const rng = new Rng(seed).fork("items");
  const specs: ItemSpec[] = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    specs.push({
      x: rng.int(-GRID_HALF, GRID_HALF),
      y: rng.int(-GRID_HALF, GRID_HALF),
      iconSeed: rng.int(0, 0x7fffffff),
    });
  }
  return specs;
}

export function setup(sim: Sim): void {
  const player = sim.spawn(); // == PLAYER_ENTITY: first entity spawned
  sim.setComponent<GridPos>(player, "pos", { x: 0, y: 0 });
  sim.setComponent<GridPos>(player, "prevPos", { x: 0, y: 0 });
  sim.setComponent<PlayerHp>(player, "hp", { value: 100 });
  const hazard = sim.forkRng("hazard");

  // Grid movement system: one tile per "move" command.
  sim.addSystem((s) => {
    const pos = s.getComponent<GridPos>(player, "pos")!;
    s.setComponent<GridPos>(player, "prevPos", { x: pos.x, y: pos.y });
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const { dx, dy } = c.payload as { dx: number; dy: number };
      // Write-through, never in-place: Sim.stateHash() caches a
      // per-component digest keyed off setComponent() calls, so an in-place
      // mutation is invisible to the hash (and to replay divergence).
      const cur = s.getComponent<GridPos>(player, "pos")!;
      const next: GridPos = {
        x: clamp(cur.x + dx, -GRID_HALF, GRID_HALF),
        y: clamp(cur.y + dy, -GRID_HALF, GRID_HALF),
      };
      s.setComponent<GridPos>(player, "pos", next);
      s.emit("moved", { x: next.x, y: next.y });
    }
  });

  // Hazard system: deterministic random damage, same pattern as the other
  // template, demonstrating the seeded/forked Rng contract.
  sim.addSystem((s) => {
    if (s.tick % 60 !== 0) return;
    const hp = s.getComponent<PlayerHp>(player, "hp")!;
    const value = hp.value - hazard.int(1, 3);
    s.setComponent<PlayerHp>(player, "hp", { value });
    s.emit("damaged", { hp: value });
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function moveCommand(tick: number, actor: string, dx: number, dy: number): Command {
  return { tick, actor, type: "move", payload: { dx, dy } };
}

/** KeyboardEvent.code -> Command factory for grid WASD movement. One tile
 *  per held tick — deliberately coarser than the 3D template's continuous
 *  movement, matching a top-down grid game's feel. */
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
