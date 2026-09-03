/**
 * Lane 4 — static, non-entity furniture that makes the hotel read as a
 * real hotel: lobby seating, corridor dressing, and bedroom furniture sets.
 * Host/presentation-only: builds a plain THREE.Group synchronously from
 * `GroundFloor` (a pure function of the seed), and upgrades individual
 * pieces in place when `assets.ts` resolves a glTF model. No component is
 * ever read or written here — decor never depends on live sim state, only
 * on the floorplan, so it is safe to build once and never touch again.
 *
 * Determinism note: this module is host-only, unhashed-into-sim,
 * presentation code (like render/characters.ts and render/upkeep.ts), so
 * `Math.*` is fine here. Any per-room "pick a wall/variant" choice is
 * derived by hashing the room id (component-independent, seed-derived
 * floorplan data), never `Math.random()`.
 */
import * as THREE from "three";
import type { GroundFloor } from "@claude-engine/interiors";
import { roomRects, deskRect, hasClearance, cellCenterM, doorRects, WALL_HEIGHT_M, ROOM, type RoomRect } from "./floorplan.js";
import { loadModel, fitToFootprint, makePbrMaterial } from "./assets.js";
import { neonSignTexture, type HotelTier } from "./procedural.js";

export type { HotelTier };

// -- deterministic per-room variety (no host-side randomness) --------------

function hashInt(n: number): number {
  let h = 0x811c9dc5 ^ n;
  h = Math.imul(h, 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

/** The tier `buildDecor` is currently building for. Every builder in this
 *  module runs synchronously inside `buildDecor`'s call, so `upgrade()`
 *  captures this into a local const AT SCHEDULE TIME (before the promise
 *  is ever awaited) -- safe even though this module-level flag itself
 *  changes on the next `buildDecor` call. See `upgrade()` below. */
let activeTier: HotelTier = 2;

// -- upgrade-in-place helper -------------------------------------------------

/** Adds a procedural fallback to `parent` now, and swaps in the real model
 *  (hiding the fallback) if/when it resolves. Both fallback and model sit
 *  under the SAME parent group so callers can position/rotate once.
 *
 *  The glTF upgrade path runs ONLY at tier 2 -- a marble side table in the
 *  motel is the failure everyone would spot first. `tierAtSchedule` is
 *  captured synchronously, before the `.then` is ever reached, so a later
 *  `buildDecor` call for a different tier (which reassigns `activeTier`)
 *  cannot retroactively flip an already-scheduled tier-2 upgrade or vice
 *  versa. */
function upgrade(
  parent: THREE.Object3D,
  fallback: THREE.Object3D,
  modelName: string,
  footprint: { w: number; d: number; h: number }
): void {
  parent.add(fallback);
  const tierAtSchedule = activeTier;
  if (tierAtSchedule !== 2) return;
  void loadModel(modelName).then((loaded) => {
    if (!loaded) return;
    fitToFootprint(loaded.scene, footprint);
    fallback.visible = false;
    parent.add(loaded.scene);
  });
}

/** Move `parent`'s current children into one group so `upgrade` can hide
 *  the whole procedural fallback when the glTF lands (passing an empty
 *  group left the fallback visible under the model). */
function wrapChildren(parent: THREE.Object3D): THREE.Group {
  const fb = new THREE.Group();
  for (const c of [...parent.children]) fb.add(c);
  return fb;
}

function shadowize(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
}

// -- shared materials (fallbacks; upgraded in place by makePbrMaterial) ----

/** Cache for tier-0/1 flat materials, keyed by (name, color, tier) so a
 *  rebuild is cheap and tier 1 never reuses tier 0's material instance. */
const flatMatCache = new Map<string, THREE.MeshStandardMaterial>();

function mat(name: string, color: THREE.ColorRepresentation, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
  if (activeTier === 2) return makePbrMaterial(name, { fallbackColor: color, roughness, metalness });
  // Tiers 0/1 stay fully procedural (no CC0 fetch): a flat colour is
  // procedural in the trivial sense and, critically, fetches nothing.
  // Tier 0 is desaturated and darkened a touch -- "flat scuffed paint" --
  // tier 1 keeps the same hue but clean and a little brighter.
  const key = `${name}:${String(color)}:${activeTier}`;
  let m = flatMatCache.get(key);
  if (m) return m;
  const c = new THREE.Color(color);
  if (activeTier === 0) {
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s * 0.55, Math.max(0.12, hsl.l * 0.82));
  }
  m = new THREE.MeshStandardMaterial({ color: c, roughness: Math.min(1, roughness + (activeTier === 0 ? 0.15 : 0)), metalness });
  flatMatCache.set(key, m);
  return m;
}

// ============================================================================
// Reusable furniture builders (all fallback geometry; each upgrades in place)
// ============================================================================

function buildSofa(): THREE.Group {
  const g = new THREE.Group();
  const fabric = mat("fabric", 0x7a3b3b);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 0.75), fabric);
  base.position.y = 0.21;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.18), fabric);
  back.position.set(0, 0.46 + 0.21, -0.75 / 2 + 0.09);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.75), fabric);
  armL.position.set(-1.8 / 2 + 0.08, 0.37, 0);
  const armR = armL.clone();
  armR.position.x = 1.8 / 2 - 0.08;
  g.add(base, back, armL, armR);
  shadowize(g);
  upgrade(g, wrapChildren(g), "sofa", { w: 1.8, d: 0.75, h: 0.85 });
  return g;
}

function buildArmchair(): THREE.Group {
  const g = new THREE.Group();
  const leather = mat("leather", 0x5a3a24, 0.6);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.68), leather);
  seat.position.y = 0.2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.16), leather);
  back.position.set(0, 0.2 + 0.35, -0.68 / 2 + 0.08);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.68), leather);
  armL.position.set(-0.7 / 2 + 0.07, 0.35, 0);
  const armR = armL.clone();
  armR.position.x = 0.7 / 2 - 0.07;
  g.add(seat, back, armL, armR);
  shadowize(g);
  upgrade(g, wrapChildren(g), "armchair", { w: 0.7, d: 0.68, h: 0.85 });
  return g;
}

function buildCoffeeTable(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat("wood-trim", 0x6b4a2f, 0.5);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.55), wood);
  top.position.y = 0.42;
  g.add(top);
  const legCorners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sz] of legCorners) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), wood);
    leg.position.set((sx * (1.0 - 0.08)) / 2, 0.21, (sz * (0.55 - 0.08)) / 2);
    g.add(leg);
  }
  shadowize(g);
  upgrade(g, wrapChildren(g), "coffee-table", { w: 1.0, d: 0.55, h: 0.44 });
  return g;
}

function buildRug(w: number, d: number): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(w, d);
  geom.rotateX(-Math.PI / 2);
  const material = mat("room-carpet", 0x8a2f2f, 0.95);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.y = 0.01;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPlant(): THREE.Group {
  const g = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: 0x7a5033, roughness: 0.9 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.35, 10), potMat);
  pot.position.y = 0.175;
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.8 });
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), leafMat);
  foliage.position.y = 0.35 + 0.42 * 0.7;
  foliage.scale.set(0.8, 1.3, 0.8);
  g.add(pot, foliage);
  shadowize(g);
  upgrade(g, wrapChildren(g), "plant", { w: 0.55, d: 0.55, h: 1.2 });
  return g;
}

function buildPainting(seed: number): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.04), mat("wood-trim", 0x5a3d24, 0.5));
  const h = hashInt(seed);
  const canvasColor = new THREE.Color().setHSL((h % 360) / 360, 0.35, 0.4);
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: canvasColor, roughness: 0.9 }));
  canvas.position.z = 0.025;
  g.add(frame, canvas);
  shadowize(g);
  upgrade(g, wrapChildren(g), "painting", { w: 0.7, d: 0.05, h: 0.5 });
  return g;
}

function buildLuggageCart(): THREE.Group {
  const g = new THREE.Group();
  const brass = mat("metal-brass", 0xb08d4a, 0.35, 0.8);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.4), brass);
  deck.position.y = 0.35;
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.4), brass);
  railL.position.set(-0.29, 0.55, 0);
  const railR = railL.clone();
  railR.position.x = 0.29;
  g.add(deck, railL, railR);
  const wheelCorners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sz] of wheelCorners) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set((sx * 0.5) / 2, 0.06, (sz * 0.32) / 2);
    g.add(wheel);
  }
  shadowize(g);
  upgrade(g, wrapChildren(g), "cart", { w: 0.6, d: 0.4, h: 0.6 });
  return g;
}

function buildBell(): THREE.Mesh {
  const brass = mat("metal-brass", 0xc9a24a, 0.3, 0.85);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.06, 12), brass);
  shadowize(mesh);
  return mesh;
}

function buildPhone(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.14), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5 }));
  body.position.y = 0.03;
  const handset = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.045), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5 }));
  handset.position.y = 0.075;
  g.add(body, handset);
  shadowize(g);
  upgrade(g, wrapChildren(g), "phone", { w: 0.16, d: 0.14, h: 0.09 });
  return g;
}

function buildKeyRack(): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), mat("wood-trim", 0x5a3d24, 0.5));
  g.add(board);
  const hookMat = new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 0.7, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.015), hookMat);
    hook.position.set(-0.11 + i * 0.075, -0.02, 0.02);
    g.add(hook);
  }
  shadowize(g);
  return g;
}

function buildUmbrellaStand(): THREE.Group {
  const g = new THREE.Group();
  const brass = mat("metal-brass", 0x8a6a35, 0.4, 0.7);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.5, 10), brass);
  stand.position.y = 0.25;
  g.add(stand);
  shadowize(g);
  return g;
}

function buildConsoleTable(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat("wood-trim", 0x6b4a2f, 0.5);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.35), wood);
  top.position.y = 0.75;
  g.add(top);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.3), wood);
    leg.position.set((sx * (0.9 - 0.1)) / 2, 0.375, 0);
    g.add(leg);
  }
  shadowize(g);
  upgrade(g, wrapChildren(g), "side-table", { w: 0.9, d: 0.35, h: 0.75 });
  return g;
}

function buildHousekeepingCart(): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7 }));
  frame.position.y = 0.45;
  g.add(frame);
  const towelMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.32), towelMat);
    towel.position.set(0, 0.9 + 0.06 + i * 0.09, 0);
    g.add(towel);
  }
  shadowize(g);
  upgrade(g, wrapChildren(g), "cart", { w: 0.7, d: 0.45, h: 0.9 });
  return g;
}

function buildBed(): THREE.Group {
  const g = new THREE.Group();
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 2.0), mat("fabric", 0xece4d3, 0.9));
  mattress.position.y = 0.35;
  const duvet = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.14, 1.5), new THREE.MeshStandardMaterial({ color: 0xf7f5ef, roughness: 0.85 }));
  duvet.position.set(0, 0.35 + 0.35 / 2 + 0.06, 0.2);
  const pillow1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  pillow1.position.set(-0.4, 0.35 + 0.35 / 2 + 0.08, -0.75);
  const pillow2 = pillow1.clone();
  pillow2.position.x = 0.4;
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 0.08), mat("wood-door", 0x3b2a1e, 0.6));
  headboard.position.set(0, 0.45, -1.0 - 0.04);
  g.add(mattress, duvet, pillow1, pillow2, headboard);
  shadowize(g);
  upgrade(g, wrapChildren(g), "bed-double", { w: 1.6, d: 2.0, h: 0.9 });
  return g;
}

function buildNightstand(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.35), mat("wood-trim", 0x5a3d24, 0.6));
  body.position.y = 0.25;
  g.add(body);
  shadowize(g);
  upgrade(g, wrapChildren(g), "nightstand", { w: 0.4, d: 0.35, h: 0.5 });
  return g;
}

function buildTableLamp(): THREE.Group {
  const g = new THREE.Group();
  const brass = mat("metal-brass", 0xb08d4a, 0.3, 0.8);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), brass);
  stem.position.y = 0.15;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), brass);
  base.position.y = 0.01;
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf2d9a0, emissive: 0xf2c060, emissiveIntensity: 1.5, roughness: 0.6 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.18, 12, 1, true), shadeMat);
  shade.position.y = 0.3 + 0.06;
  g.add(stem, base, shade);
  shadowize(g);
  upgrade(g, wrapChildren(g), "lamp-table", { w: 0.26, d: 0.26, h: 0.48 });
  return g;
}

function buildWardrobe(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.6), mat("wood-door", 0x4a3320, 0.6));
  body.position.y = 0.95;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.7, roughness: 0.3 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.05, 0.95, 0.31);
  g.add(body, handle);
  shadowize(g);
  upgrade(g, wrapChildren(g), "wardrobe", { w: 1.0, d: 0.6, h: 1.9 });
  return g;
}

function buildDesk(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), mat("desk-top", 0x6b4a2f, 0.5));
  top.position.y = 0.75;
  g.add(top);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.46), mat("wood-trim", 0x5a3d24, 0.5));
    leg.position.set((sx * (0.9 - 0.1)) / 2, 0.375, 0);
    g.add(leg);
  }
  shadowize(g);
  upgrade(g, wrapChildren(g), "desk", { w: 0.9, d: 0.5, h: 0.75 });
  return g;
}

function buildChair(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat("wood-trim", 0x5a3d24, 0.5);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), wood);
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.04), wood);
  back.position.set(0, 0.45 + 0.2, -0.18);
  g.add(seat, back);
  const chairLegCorners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sz] of chairLegCorners) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.45, 0.03), wood);
    leg.position.set((sx * 0.4) / 2 - sx * 0.02, 0.225, (sz * 0.4) / 2 - sz * 0.02);
    g.add(leg);
  }
  shadowize(g);
  upgrade(g, wrapChildren(g), "chair", { w: 0.4, d: 0.4, h: 0.85 });
  return g;
}

function buildDresserWithTv(): THREE.Group {
  const g = new THREE.Group();
  const dresser = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.4), mat("wood-trim", 0x5a3d24, 0.6));
  dresser.position.y = 0.25;
  g.add(dresser);
  const tv = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.04), new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.3 }));
  slab.position.y = 0.5 + 0.18;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.26), new THREE.MeshStandardMaterial({ color: 0x1a2a3a, emissive: 0x0d1a26, emissiveIntensity: 0.4 }));
  screen.position.set(0, 0.5 + 0.18, 0.021);
  tv.add(slab, screen);
  g.add(tv);
  shadowize(g);
  upgrade(g, wrapChildren(g), "wardrobe", { w: 0.9, d: 0.4, h: 0.5 }); // dresser reuses wardrobe-ish footprint model if present; tv slab stays procedural
  return g;
}

// -- tier 0 (motel) only: cheap, tired, a little funny -----------------

function buildFoldingChair(seed: number): THREE.Group {
  const g = new THREE.Group();
  const h = hashInt(seed);
  // Mismatched paint: a small set of grubby folding-chair colours picked
  // deterministically from the seed, never Math.random().
  const palette = [0x8a1f1f, 0x1f3a5f, 0x3a5f2a, 0x6b5a1f];
  const metal = mat("wood-trim", palette[h % palette.length]!, 0.7, 0.4);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.42), metal);
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.03), metal);
  back.position.set(0, 0.45 + 0.2, -0.19);
  g.add(seat, back);
  const legCorners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sz] of legCorners) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), metal);
    leg.position.set((sx * 0.42) / 2 - sx * 0.02, 0.225, (sz * 0.42) / 2 - sz * 0.02);
    g.add(leg);
  }
  shadowize(g);
  return g;
}

/** Vending machine: a plain box with an emissive front panel (the neon-
 *  sign texture generator doubles as a backlit-menu look). */
function buildVendingMachine(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.8, 0.7), mat("wood-door", 0x2a2f33, 0.6, 0.3));
  body.position.y = 0.9;
  g.add(body);
  const panelTex = neonSignTexture("COLD SODA");
  const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, emissiveMap: panelTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.0), panelMat);
  panel.position.set(0, 1.05, 0.351);
  g.add(panel);
  const kickplate = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.15, 0.72), mat("metal-brass", 0x3a3a3a, 0.7, 0.5));
  kickplate.position.y = 0.075;
  g.add(kickplate);
  shadowize(g);
  return g;
}

/** Cheap plastic ficus: a flat green cone (no real foliage detail) in a
 *  black plastic pot -- the tier-0 counterpart to `buildPlant()`. */
function buildPlasticFicus(): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.3, 8), mat("wood-trim", 0x1a1a1a, 0.6, 0.1));
  pot.position.y = 0.15;
  const foliage = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 6), mat("room-carpet", 0x2f5a2f, 0.85));
  foliage.position.y = 0.3 + 0.45;
  g.add(pot, foliage);
  shadowize(g);
  return g;
}

/** Cheap mismatched bedroom furniture: same layout roles as the tier-1/2
 *  set but built as plain, differently-proportioned boxes whose colour
 *  varies by room id (never Math.random()) so adjacent rooms look
 *  intentionally mismatched rather than uniform. */
function buildMotelBed(roomId: number): THREE.Group {
  const g = new THREE.Group();
  const h = hashInt(roomId);
  const palette = [0x8a6a55, 0x6b5540, 0x7a4a4a, 0x4a5a6b];
  const spreadColor = palette[h % palette.length]!;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.9), mat("fabric", 0xbdb6a5, 0.95));
  mattress.position.y = 0.3;
  const spread = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.5), mat("fabric", spreadColor, 0.95));
  spread.position.set(0, 0.3 + 0.15 + 0.05, 0.2);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.4), mat("fabric", 0xe6e1d2, 0.9));
  pillow.position.set(0, 0.3 + 0.15 + 0.07, -0.7);
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.05), mat("wood-door", 0x5a4a3a, 0.8));
  headboard.position.set(0, 0.4, -0.95 - 0.025);
  g.add(mattress, spread, pillow, headboard);
  shadowize(g);
  return g;
}

function buildMotelNightstand(roomId: number): THREE.Group {
  const g = new THREE.Group();
  const h = hashInt(roomId + 1);
  const palette = [0x5a3d24, 0x3a3a3a, 0x6b5540];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.3), mat("wood-trim", palette[h % palette.length]!, 0.9));
  body.position.y = 0.225;
  g.add(body);
  shadowize(g);
  return g;
}

function buildMotelWardrobe(roomId: number): THREE.Group {
  const g = new THREE.Group();
  const h = hashInt(roomId + 2);
  const palette = [0x4a3320, 0x33383a, 0x5a4a3a];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.5), mat("wood-door", palette[h % palette.length]!, 0.9));
  body.position.y = 0.85;
  g.add(body);
  shadowize(g);
  return g;
}

function buildCurtains(widthM: number): THREE.Group {
  const g = new THREE.Group();
  const fabric = mat("fabric", 0x8a2f2f, 0.9);
  const panelW = widthM * 0.28;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(panelW, 2.4), fabric);
  left.position.x = -widthM / 2 + panelW / 2;
  const right = left.clone();
  right.position.x = widthM / 2 - panelW / 2;
  g.add(left, right);
  shadowize(g);
  return g;
}

// ============================================================================
// Room assemblers
// ============================================================================

function buildLobby(group: THREE.Group, floor: GroundFloor, room: RoomRect): void {
  const desk = deskRect(floor);
  // Seating cluster in the east half, clear of the desk/queue lane and the
  // entrance->corridor walking lane (centred x-band near the room middle).
  const seatX = room.xM1 - Math.min(2.6, room.widthM * 0.4);
  const seatZ = room.centerZM + room.depthM * 0.15;

  const seating = new THREE.Group();
  if (activeTier === 0) {
    // Motel lobby: a vending machine plus a few mismatched folding chairs
    // instead of the sofa/armchair cluster -- no rug, no coffee table.
    const vending = buildVendingMachine();
    vending.position.set(0.9, 0, -0.6);
    seating.add(vending);
    const chairSpots: [number, number, number][] = [
      [-1.0, 0.4, 0],
      [-0.4, 0.6, Math.PI * 0.1],
      [0.2, 0.65, -Math.PI * 0.1],
    ];
    let seed = room.roomId * 7;
    for (const [x, z, ry] of chairSpots) {
      const chair = buildFoldingChair(seed++);
      chair.position.set(x, 0, z);
      chair.rotation.y = ry;
      seating.add(chair);
    }
  } else {
    seating.add(buildRug(2.6, 2.0));
    const sofa = buildSofa();
    sofa.rotation.y = Math.PI;
    sofa.position.set(0, 0, -0.7);
    seating.add(sofa);
    const chair1 = buildArmchair();
    chair1.position.set(-0.95, 0, 0.5);
    chair1.rotation.y = Math.PI * 0.15;
    seating.add(chair1);
    const chair2 = buildArmchair();
    chair2.position.set(0.95, 0, 0.5);
    chair2.rotation.y = -Math.PI * 0.15;
    seating.add(chair2);
    const table = buildCoffeeTable();
    table.position.set(0, 0, -0.05);
    seating.add(table);
  }
  seating.position.set(seatX, 0, seatZ);
  group.add(seating);

  // Potted plants in the lobby corners (tier 0: cheap plastic ficus).
  const corners: [number, number][] = [
    [room.xM0 + 0.4, room.zM0 + 0.4],
    [room.xM1 - 0.4, room.zM0 + 0.4],
  ];
  for (const [x, z] of corners) {
    const plant = activeTier === 0 ? buildPlasticFicus() : buildPlant();
    plant.position.set(x, 0, z);
    group.add(plant);
  }

  // Paintings on the long walls at 1.5m.
  // Both lobby doors (entrance, corridor) sit in the centred x-band, so
  // hang the paintings well off centre and skip any spot inside a door
  // span (plus a margin) -- a painting over a doorway was a real bug.
  const lobbyDoors = doorRects(floor).filter((d) => d.roomA === room.roomId || d.roomB === room.roomId);
  const clearOfDoors = (x: number): boolean => lobbyDoors.every((d) => x < d.xM0 - 0.6 || x > d.xM1 + 0.6);
  const paintSpots: [number, number, number][] = [];
  for (const dx of [-3.2, 3.2, -1.6, 1.6]) {
    const x = room.centerXM + dx;
    if (x < room.xM0 + 0.6 || x > room.xM1 - 0.6 || !clearOfDoors(x)) continue;
    paintSpots.push([x, room.zM0 + 0.03, 0]);
    paintSpots.push([x, room.zM1 - 0.03, Math.PI]);
    if (paintSpots.length >= 4) break;
  }
  let paintSeed = room.roomId * 97;
  for (const [x, z, ry] of paintSpots) {
    const painting = buildPainting(paintSeed++);
    painting.position.set(x, 1.5, z);
    painting.rotation.y = ry;
    group.add(painting);
  }

  if (desk) {
    // Luggage cart near the desk.
    const cart = buildLuggageCart();
    cart.position.set(desk.xM0 - 0.5, 0, desk.centerZM + 0.6);
    group.add(cart);

    // Reception counter top accessories: bell, phone, key rack.
    const counterTopY = 1.1;
    const bell = buildBell();
    bell.position.set(desk.centerXM - 0.3, counterTopY + 0.03, desk.zM1 - 0.15);
    group.add(bell);
    const phone = buildPhone();
    phone.position.set(desk.centerXM + 0.1, counterTopY, desk.zM1 - 0.2);
    group.add(phone);
    const keyRack = buildKeyRack();
    keyRack.position.set(desk.xM1 - 0.05, 1.6, desk.centerZM);
    keyRack.rotation.y = -Math.PI / 2;
    group.add(keyRack);
  }

  // Standing sign / umbrella stand by the entrance door.
  const entrance = doorRects(floor).find((d) => d.isEntrance);
  if (entrance) {
    const stand = buildUmbrellaStand();
    const offsetX = entrance.axis === "row" ? 0.6 : 0;
    const offsetZ = entrance.axis === "col" ? 0.6 : 0.6;
    stand.position.set(entrance.centerXM + offsetX, 0, entrance.centerZM + offsetZ);
    if (hasClearance(floor, Math.floor((entrance.centerXM + offsetX) / (room.widthM > 0 ? 1 : 1)), 0, 0)) {
      // clearance check is best-effort; geometry stays regardless
    }
    group.add(stand);
  }
}

function buildCorridor(group: THREE.Group, floor: GroundFloor, room: RoomRect): void {
  // Console table + plant at the far (max-Z) end.
  const console_ = buildConsoleTable();
  console_.position.set(room.centerXM, 0, room.zM1 - 0.3);
  console_.rotation.y = Math.PI;
  group.add(console_);
  const plant = buildPlant();
  plant.position.set(room.centerXM + 0.6, 0.75, room.zM1 - 0.3);
  group.add(plant);

  // Paintings every few metres along one long wall.
  const step = 2.5;
  let x = room.xM0 + 1.2;
  let seed = room.roomId * 31;
  while (x < room.xM1 - 0.5) {
    const painting = buildPainting(seed++);
    painting.position.set(x, 1.5, room.zM0 + 0.03);
    group.add(painting);
    x += step;
  }

  // Housekeeping cart against one wall, clear of the centred walking lane.
  const cart = buildHousekeepingCart();
  cart.position.set(room.xM0 + 0.4, 0, room.zM0 + 0.6);
  group.add(cart);
}

const WALL_SIDES = ["north", "south", "east", "west"] as const;
type WallSide = (typeof WALL_SIDES)[number];

function pickWall(roomId: number): WallSide {
  return WALL_SIDES[hashInt(roomId) % WALL_SIDES.length]!;
}

function buildBedroom(group: THREE.Group, floor: GroundFloor, room: RoomRect, bedroom: GroundFloor["bedrooms"][number]): void {
  const wall = pickWall(bedroom.roomId);
  const margin = 0.6;
  const goal = cellCenterM(bedroom.goalCx, bedroom.goalCz);

  const rug = buildRug(Math.min(room.widthM - 0.6, 2.4), Math.min(room.depthM - 0.6, 2.4));
  rug.position.set(room.centerXM, 0, room.centerZM);
  group.add(rug);

  // Bed against the chosen wall, headboard flush to that wall.
  const bed = activeTier === 0 ? buildMotelBed(bedroom.roomId) : buildBed();
  let bedX = room.centerXM;
  let bedZ = room.centerZM;
  let bedYaw = 0;
  let nsOffsets: [number, number][] = [];
  let curtainWall: WallSide | undefined;
  switch (wall) {
    case "north":
      bedZ = room.zM0 + margin + 1.0;
      bedYaw = Math.PI; // headboard faces -Z (against the north wall)
      nsOffsets = [
        [-1.1, 0],
        [1.1, 0],
      ];
      break;
    case "south":
      bedZ = room.zM1 - margin - 1.0;
      bedYaw = 0;
      nsOffsets = [
        [-1.1, 0],
        [1.1, 0],
      ];
      break;
    case "east":
      bedX = room.xM1 - margin - 1.0;
      bedYaw = -Math.PI / 2;
      nsOffsets = [
        [0, -1.1],
        [0, 1.1],
      ];
      break;
    case "west":
    default:
      bedX = room.xM0 + margin + 1.0;
      bedYaw = Math.PI / 2;
      nsOffsets = [
        [0, -1.1],
        [0, 1.1],
      ];
      curtainWall = "west";
      break;
  }
  // Small rooms (this tier's bedrooms can be as shallow as 2m) cannot fit a
  // full 2m-deep bed with margin on both sides -- clamp the bed (and the
  // nightstand offsets that ride along its headboard wall) down uniformly
  // rather than let it overflow past the far wall.
  const perpDimM = wall === "north" || wall === "south" ? room.depthM : room.widthM;
  const bedScale = Math.min(1, Math.max(0.55, (perpDimM - margin * 1.2) / 2.2));
  bed.scale.setScalar(bedScale);
  bed.position.set(bedX, 0, bedZ);
  bed.rotation.y = bedYaw;
  group.add(bed);

  // Two nightstands with lamps, flanking the bed along its headboard wall.
  for (const [dx0, dz0] of nsOffsets) {
    const dx = dx0 * bedScale;
    const dz = dz0 * bedScale;
    const nightstand = activeTier === 0 ? buildMotelNightstand(bedroom.roomId) : buildNightstand();
    nightstand.position.set(bedX + dx, 0, bedZ + dz);
    nightstand.rotation.y = bedYaw;
    group.add(nightstand);
    const lamp = buildTableLamp();
    lamp.position.set(bedX + dx, 0.5, bedZ + dz);
    group.add(lamp);
  }

  // Wardrobe, desk+chair, dresser+TV, painting -- placed on the remaining
  // walls, staying off the door span and the goal cell.
  const otherWalls = WALL_SIDES.filter((w) => w !== wall);
  const wallPos = (w: WallSide, along: number): { x: number; z: number; ry: number } => {
    switch (w) {
      case "north":
        return { x: room.xM0 + along, z: room.zM0 + margin * 0.6, ry: 0 };
      case "south":
        return { x: room.xM0 + along, z: room.zM1 - margin * 0.6, ry: Math.PI };
      case "east":
        return { x: room.xM1 - margin * 0.6, z: room.zM0 + along, ry: -Math.PI / 2 };
      case "west":
      default:
        return { x: room.xM0 + margin * 0.6, z: room.zM0 + along, ry: Math.PI / 2 };
    }
  };
  const near = (x: number, z: number): boolean => Math.hypot(x - goal.x, z - goal.z) < 0.9;

  const wardrobeSpot = wallPos(otherWalls[0]!, room.widthM * 0.28);
  if (!near(wardrobeSpot.x, wardrobeSpot.z)) {
    const wardrobe = activeTier === 0 ? buildMotelWardrobe(bedroom.roomId) : buildWardrobe();
    wardrobe.position.set(wardrobeSpot.x, 0, wardrobeSpot.z);
    wardrobe.rotation.y = wardrobeSpot.ry;
    group.add(wardrobe);
  }

  const deskSpot = wallPos(otherWalls[1] ?? otherWalls[0]!, room.widthM * 0.62);
  if (!near(deskSpot.x, deskSpot.z)) {
    const desk = buildDesk();
    desk.position.set(deskSpot.x, 0, deskSpot.z);
    desk.rotation.y = deskSpot.ry;
    group.add(desk);
    const chair = buildChair();
    const chairFwd = { x: Math.sin(deskSpot.ry) * 0.45, z: Math.cos(deskSpot.ry) * 0.45 };
    chair.position.set(deskSpot.x + chairFwd.x, 0, deskSpot.z + chairFwd.z);
    chair.rotation.y = deskSpot.ry + Math.PI;
    group.add(chair);
  }

  const dresserSpot = wallPos(otherWalls[2] ?? otherWalls[0]!, room.widthM * 0.28);
  if (!near(dresserSpot.x, dresserSpot.z)) {
    const dresser = buildDresserWithTv();
    dresser.position.set(dresserSpot.x, 0, dresserSpot.z);
    dresser.rotation.y = dresserSpot.ry;
    group.add(dresser);
  }

  const paintSpot = wallPos(otherWalls[0]!, room.widthM * 0.72);
  const painting = buildPainting(bedroom.roomId * 13);
  painting.position.set(paintSpot.x, 1.5, paintSpot.z);
  painting.rotation.y = paintSpot.ry;
  group.add(painting);

  // Curtains on an exterior-facing wall (best-effort: use the wall opposite
  // the bed when the bed is not already flush there).
  const drapeWall = curtainWall ?? otherWalls[otherWalls.length - 1]!;
  const drapeSpot = wallPos(drapeWall, room.widthM * 0.5);
  const curtains = buildCurtains(drapeWall === "north" || drapeWall === "south" ? room.widthM * 0.6 : room.depthM * 0.6);
  curtains.position.set(drapeSpot.x, 1.2, drapeSpot.z);
  curtains.rotation.y = drapeSpot.ry;
  group.add(curtains);
}

// ============================================================================
// Entry point
// ============================================================================

/** Builds every static decor piece for the ground floor, synchronously.
 *  Fallback geometry is added immediately; each piece upgrades in place
 *  when its glTF model resolves (see `upgrade()` above). Never reads or
 *  writes sim state -- pure function of the floorplan. */
export function buildDecor(floor: GroundFloor, hotelTier: HotelTier): THREE.Group {
  activeTier = hotelTier;
  const root = new THREE.Group();
  root.name = "decor";
  const rects = roomRects(floor);

  for (const room of rects.values()) {
    if (room.kind === "lobby") {
      buildLobby(root, floor, room);
    } else if (room.kind === "corridor") {
      buildCorridor(root, floor, room);
    } else if (room.kind === "bedroom") {
      const bedroom = floor.bedrooms.find((b) => b.roomId === room.roomId);
      if (bedroom) buildBedroom(root, floor, room, bedroom);
    }
  }

  return root;
}

export const DECOR_WALL_HEIGHT_M = WALL_HEIGHT_M; // re-export for callers that want the constant alongside decor
export { ROOM };
