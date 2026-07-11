/**
 * Core-only sim module (imports ONLY @claude-engine/core and the pure root
 * of @claude-engine/assets — must run headless). This exact compiled module
 * (via `npm run build:game` -> dist-game/game.js) is what both the browser
 * (through renderer-three) and the headless harness run, proving they
 * exercise identical sim logic.
 *
 * Terrain/props are NOT stored as components (that would bloat stateHash()
 * and snapshots with bulk generated data) — generateWorldTerrain/
 * generateWorldProps are pure functions of the world seed alone, so both
 * this module (for ground-following gameplay) and the renderer (for visuals)
 * call them independently and get byte-identical results without touching
 * the live sim.rng stream.
 */
import { Rng, type Command, type EntityId, type IWorld, type Sim } from "@claude-engine/core";
import { generateTerrain, generatePropMesh, heightAt, type TerrainData, type MeshData } from "@claude-engine/assets";

export const PLAYER_ENTITY: EntityId = 1;

export interface PlayerPos {
  x: number;
  z: number;
}

export interface PlayerHp {
  value: number;
}

export interface PropSpec {
  kind: "rock" | "tree" | "crystal";
  x: number;
  z: number;
  propSeed: number;
}

const MOVE_SPEED = 3;
const TERRAIN_OPTIONS = { size: 40, resolution: 33, heightScale: 2, octaves: 3 };
const PROP_COUNT = 8;
const PROP_KINDS: readonly PropSpec["kind"][] = ["rock", "tree", "crystal"];

/** Pure function of the world seed alone — never touches the live sim.rng. */
export function generateWorldTerrain(seed: string): TerrainData {
  return generateTerrain(new Rng(seed).fork("terrain"), TERRAIN_OPTIONS);
}

/** Pure function of the world seed alone — never touches the live sim.rng. */
export function generateWorldProps(seed: string): PropSpec[] {
  const rng = new Rng(seed).fork("props");
  const half = TERRAIN_OPTIONS.size / 2 - 4;
  const specs: PropSpec[] = [];
  for (let i = 0; i < PROP_COUNT; i++) {
    specs.push({
      kind: rng.pick(PROP_KINDS),
      x: rng.int(-half, half),
      z: rng.int(-half, half),
      propSeed: rng.int(0, 0x7fffffff),
    });
  }
  return specs;
}

/** Regenerate one prop's mesh deterministically from its stored seed — used
 *  by the renderer only; not part of sim state. */
export function generatePropMeshFor(spec: PropSpec): MeshData {
  return generatePropMesh(new Rng(spec.propSeed), spec.kind);
}

export function setup(sim: Sim): void {
  const terrain = generateWorldTerrain(sim.seed);

  const player = sim.spawn(); // == PLAYER_ENTITY: first entity spawned
  sim.setComponent<PlayerPos>(player, "pos", { x: 0, z: 0 });
  sim.setComponent<PlayerPos>(player, "prevPos", { x: 0, z: 0 });
  sim.setComponent<PlayerHp>(player, "hp", { value: 100 });
  const hazard = sim.rng.fork("hazard");

  // Movement system: consumes "move" commands, ground-follows via heightAt
  // (a legitimate sim concern — the terrain shape affects gameplay, unlike
  // the terrain *mesh*, which is a rendering-only concern for main.ts).
  sim.addSystem((s) => {
    const pos = s.getComponent<PlayerPos>(player, "pos")!;
    s.setComponent<PlayerPos>(player, "prevPos", { x: pos.x, z: pos.z });
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const { dx, dz } = c.payload as { dx: number; dz: number };
      pos.x = clamp(pos.x + dx, -TERRAIN_OPTIONS.size / 2, TERRAIN_OPTIONS.size / 2);
      pos.z = clamp(pos.z + dz, -TERRAIN_OPTIONS.size / 2, TERRAIN_OPTIONS.size / 2);
      s.emit("moved", { x: pos.x, z: pos.z, y: heightAt(terrain, pos.x, pos.z) });
    }
  });

  // Hazard system: deterministic random damage, same pattern as the demo,
  // demonstrating the seeded/forked Rng contract.
  sim.addSystem((s) => {
    if (s.tick % 60 !== 0) return;
    const hp = s.getComponent<PlayerHp>(player, "hp")!;
    hp.value -= hazard.int(1, 3);
    s.emit("damaged", { hp: hp.value });
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function moveCommand(tick: number, actor: string, dx: number, dz: number): Command {
  return { tick, actor, type: "move", payload: { dx: dx * MOVE_SPEED, dz: dz * MOVE_SPEED } };
}

/** KeyboardEvent.code -> Command factory for WASD movement. */
export function movementKeymap(actor: string): Record<string, (world: IWorld) => Command | null> {
  const dir = (dx: number, dz: number) => (world: IWorld): Command =>
    moveCommand(world.tick + 1, actor, dx, dz);
  return {
    KeyW: dir(0, -1),
    KeyS: dir(0, 1),
    KeyA: dir(-1, 0),
    KeyD: dir(1, 0),
  };
}
