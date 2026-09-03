/**
 * Lane 3 (lighting + renderer). Host/presentation only — reads `IWorld` via
 * `getComponent`/`entities()` and floorplan geometry, never mutates sim
 * state. `Math.random()` is banned host-side per the lane brief; flicker is
 * a deterministic hash of `nowMs`, not a live RNG draw.
 *
 * A warm, classic-hotel look: a HemisphereLight + low AmbientLight base,
 * the PMREM environment (when it resolves) on `scene.environment`, one
 * shadow-casting chandelier PointLight in the lobby, non-shadow fill lights
 * in the lobby/corridor/bedrooms, and a shadow-casting "sun" DirectionalLight
 * out on the street. Hard budget (headless SwiftShader cost): at most 10
 * point/spot lights total, at most 2 shadow casters (chandelier + sun).
 */
import * as THREE from "three";
import type { GroundFloor } from "@claude-engine/interiors";
import type { IWorld } from "@claude-engine/core";
import { roomRects, ROOM, WALL_HEIGHT_M } from "./floorplan.js";
import type { Prop, Pos } from "../sim/game.js";
import { HIGH_QUALITY } from "./quality.js";
import { loadEnvironment } from "./assets.js";
import type { HotelTier } from "./procedural.js";

export type { HotelTier };

/** Warm 2700K-ish incandescent color for fixtures/lamps. */
const WARM_COLOR = 0xffb877;
/** Cooler daylight color for the street sun. */
const SUN_COLOR = 0xffceb0;
/** Cooler, greener, dimmer key light for tier 0 (sickly fluorescent). */
const MOTEL_COLOR = 0xcfe0c8;
/** Carry 1 (option b, layer separation): a Three.js render layer used
 *  ONLY to gate what the sun's shadow CAMERA samples. Every mesh in the
 *  scene stays on the default layer 0 (so the player's own camera, which
 *  only enables layer 0, keeps seeing everything normally) -- exterior.ts's
 *  "exterior" group additionally ENABLES this layer, and the sun's
 *  `shadow.camera.layers` is set to ONLY this layer. Interior architecture
 *  and decor are never touched and never enable it, so they cannot appear
 *  as casters in the sun's shadow map regardless of how the frustum is
 *  sized -- the sun is an exterior light and now structurally cannot
 *  sample interior geometry, rather than merely being sized to (hopefully)
 *  miss it. */
const SUN_SHADOW_LAYER = 1;

export interface LightingRig {
  group: THREE.Group;
  /** Per-room lights this rig owns, keyed by roomId — read by `update()`
   *  to flicker a room whose lamp prop is broken. */
  lightsByRoomId: Map<number, THREE.Light[]>;
  update(world: IWorld, nowMs: number): void;
  /** Removes the rig's group from the scene and disposes its lights and
   *  any materials it owns. Safe to call twice. */
  dispose(): void;
}

/** Renderer-wide config a game applies once. Shadow map on, soft PCF,
 *  filmic tone mapping — sRGB output is already r169's default. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = HIGH_QUALITY;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
}

/** Deterministic pseudo-random unit float from an integer seed (xorshift-
 *  style mix, no trig, no Math.random). */
function hash01(n: number): number {
  let x = n | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x = x | 0;
  return ((x >>> 0) % 10000) / 10000;
}

function addRoomLight(
  group: THREE.Group,
  lightsByRoomId: Map<number, THREE.Light[]>,
  roomId: number,
  light: THREE.Light
): void {
  group.add(light);
  const list = lightsByRoomId.get(roomId);
  if (list) list.push(light);
  else lightsByRoomId.set(roomId, [light]);
}

export function buildLighting(
  floor: GroundFloor,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  hotelTier: HotelTier
): LightingRig {
  const group = new THREE.Group();
  group.name = "lighting-rig";
  scene.add(group);

  const keyColor = hotelTier === 0 ? MOTEL_COLOR : WARM_COLOR;
  // Pushed down further per COO review item 4 (carried into cycle 2 as
  // reviews/W2.md item 4, closed here): tier 0 read as "clean office", not
  // "tired motel" -- the troughs/bare bulbs should be the only bright
  // thing in frame. This is a small further step from cycle 1's 0.45, not
  // a re-tune -- reserva-readability's calibration checkerboard is drawn
  // on the terminal's own (unlit) screen texture, not scene-lit geometry,
  // so it does not move with this.
  const dim = hotelTier === 0 ? 0.38 : 1;

  const lightsByRoomId = new Map<number, THREE.Light[]>();

  // -- base: warm sky / cool ground hemisphere + a touch of ambient fill --
  // Low tier carries the whole interior on these two (no point lights at
  // all -- each one is a per-fragment cost under software GL), so they
  // are brighter there; high tier lets the fixtures do the work. Tier 0
  // is cooler and dimmer (a sickly fluorescent-lit motel, not a warm hotel
  // hemisphere) -- same budget, same low-quality collapse.
  const hemiSky = hotelTier === 0 ? 0x9aa892 : 0xfff1d8;
  const hemiGround = hotelTier === 0 ? 0x28241c : 0x33313a;
  const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, (HIGH_QUALITY ? 0.55 : 1.4) * dim);
  const ambient = new THREE.AmbientLight(0xffffff, (HIGH_QUALITY ? 0.12 : 0.6) * dim);
  group.add(hemi, ambient);

  // -- environment map (PMREM), applied when it resolves; degrades gracefully --
  void loadEnvironment(renderer).then((envMap) => {
    if (!envMap) return;
    scene.environment = envMap;
    const sceneAny = scene as unknown as { environmentIntensity?: number };
    if (typeof sceneAny.environmentIntensity === "number" || "environmentIntensity" in scene) {
      sceneAny.environmentIntensity = 0.5;
    }
  });

  const rects = roomRects(floor);

  const lobby = rects.get(ROOM.LOBBY);
  if (lobby && HIGH_QUALITY) {
    // Chandelier: the one shadow-casting point light in the lobby.
    const chandelier = new THREE.PointLight(keyColor, 12 * dim, 14, 2);
    chandelier.position.set(lobby.centerXM, WALL_HEIGHT_M - 0.5, lobby.centerZM);
    // No shadow map on the point light: three renders point-light shadows
    // through a low-resolution cube atlas and the thin wainscot/chair-rail
    // geometry aliased into a sawtooth along every lobby wall. The sun
    // (directional, exterior) keeps its shadows; interiors rely on the
    // environment map and the textures' AO.
    chandelier.castShadow = false;
    chandelier.shadow.mapSize.set(2048, 2048);
    chandelier.shadow.bias = -0.0005;
    // Trim (chair rail, cornice, pilasters) is thin and close to the wall
    // it shadows; without a normal bias its shadow edge aliases into a
    // sawtooth along the whole wainscot.
    chandelier.shadow.normalBias = 0.03;
    addRoomLight(group, lightsByRoomId, ROOM.LOBBY, chandelier);

    // Two non-shadow fill lights toward the lobby's ends (along its longer axis).
    const alongX = lobby.widthM >= lobby.depthM;
    const fillPositions: Array<[number, number]> = alongX
      ? [
          [lobby.xM0 + lobby.widthM * 0.2, lobby.centerZM],
          [lobby.xM0 + lobby.widthM * 0.8, lobby.centerZM],
        ]
      : [
          [lobby.centerXM, lobby.zM0 + lobby.depthM * 0.2],
          [lobby.centerXM, lobby.zM0 + lobby.depthM * 0.8],
        ];
    for (const [x, z] of HIGH_QUALITY ? fillPositions : []) {
      const fill = new THREE.PointLight(keyColor, 4 * dim, 8, 2);
      fill.position.set(x, WALL_HEIGHT_M - 0.6, z);
      addRoomLight(group, lightsByRoomId, ROOM.LOBBY, fill);
    }
  }

  const corridor = rects.get(ROOM.CORRIDOR);
  if (corridor) {
    const alongX = corridor.widthM >= corridor.depthM;
    const positions: Array<[number, number]> = alongX
      ? [
          [corridor.xM0 + corridor.widthM * 0.3, corridor.centerZM],
          [corridor.xM0 + corridor.widthM * 0.7, corridor.centerZM],
        ]
      : [
          [corridor.centerXM, corridor.zM0 + corridor.depthM * 0.3],
          [corridor.centerXM, corridor.zM0 + corridor.depthM * 0.7],
        ];
    // Low tier (software GL): the corridor makes do with the hemisphere
    // base and the bedrooms' spill -- every point light is a fragment cost.
    for (const [x, z] of HIGH_QUALITY ? positions : []) {
      const light = new THREE.PointLight(keyColor, 3.5 * dim, 7, 2);
      light.position.set(x, WALL_HEIGHT_M - 0.4, z);
      addRoomLight(group, lightsByRoomId, ROOM.CORRIDOR, light);
    }
  }

  for (const [roomId, rect] of rects) {
    if (rect.kind !== "bedroom" || !HIGH_QUALITY) continue;
    const light = new THREE.PointLight(keyColor, 3.2 * dim, 6.5, 2);
    light.position.set(rect.centerXM, WALL_HEIGHT_M - 0.5, rect.centerZM);
    addRoomLight(group, lightsByRoomId, roomId, light);
  }

  const street = rects.get(ROOM.STREET);
  if (street) {
    const sun = new THREE.DirectionalLight(SUN_COLOR, 1.6);
    sun.position.set(street.centerXM - 6, 8, street.centerZM - 6);
    sun.target.position.set(street.centerXM, 0, street.centerZM);
    sun.castShadow = HIGH_QUALITY;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    // Carry 1: the sun is an exterior light -- its shadow frustum has no
    // business sampling interior architecture. The street strip is
    // shallow (STREET_WALK_ROWS in packages/interiors/src/layout.ts is a
    // few cells deep), so a tight box + a far plane clamped to the
    // light-to-target distance plus that same footprint radius covers the
    // street rect and its immediate apron only, and stops at the facade
    // instead of reaching tens of metres into the building's interior
    // volume the way the old fixed `far = 40` did.
    const halfW = Math.max(street.widthM, street.depthM) / 2 + 1;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfW;
    cam.bottom = -halfW;
    cam.near = 0.5;
    const lightToTarget = sun.position.distanceTo(sun.target.position);
    // The far plane must stop at the street's own DEPTH (how far the
    // frustum reaches along the light's view direction), not at `halfW`
    // -- halfW is sized off the street's WIDTH (needed for the box's
    // lateral extent, to keep the fence and both door jambs inside it),
    // which is several times the street's shallow depth. Using halfW for
    // `far` too let the frustum coast straight through the doorway and a
    // couple of metres into the corridor beyond it -- exactly far enough
    // for the chain-link fence (exterior.ts, ~1.2m off the door) to still
    // land its diagonal shadow on the first interior wall. Capping far at
    // the street's own depth (+ a small apron) stops the frustum at the
    // door instead.
    const streetDepthMargin = Math.max(street.depthM / 2, 1) + 0.5;
    cam.far = lightToTarget + streetDepthMargin;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    // Belt-and-suspenders half of carry 1: even with the tight frustum
    // above, interior architecture immediately past the street door sits
    // inside it (the street strip is shallow) and would still self-shadow
    // as a caster. Restricting the shadow CAMERA to `SUN_SHADOW_LAYER`
    // means only objects explicitly enabled on that layer (below, once
    // `exterior`'s group exists) can appear in the sun's shadow map at
    // all -- interior architecture and decor, left on the default layer
    // only, structurally cannot cast into it regardless of frustum size.
    cam.layers.set(SUN_SHADOW_LAYER);
    group.add(sun, sun.target);
  }

  function findBrokenLampRoom(world: IWorld): Set<number> {
    const broken = new Set<number>();
    for (const entity of world.entities()) {
      const prop = world.getComponent<Prop>(entity, "prop");
      if (!prop || prop.kind !== "lamp" || !prop.broken) continue;
      const pos = world.getComponent<Pos>(entity, "pos");
      if (!pos) continue;
      const xM = pos.xMm / 1000;
      const zM = pos.zMm / 1000;
      for (const [roomId, rect] of rects) {
        if (xM >= rect.xM0 && xM <= rect.xM1 && zM >= rect.zM0 && zM <= rect.zM1) {
          broken.add(roomId);
          break;
        }
      }
    }
    return broken;
  }

  let exteriorLayered = false;
  /** `exterior.ts`'s group is added to the scene by main.ts AFTER this
   *  rig is built (buildLighting() runs before `g.add(buildExterior(...))`
   *  in main.ts's setup), so it does not exist yet inside `buildLighting`
   *  itself. `update()` runs every frame once the game loop starts, which
   *  is always after that setup has finished, so the first call is a safe
   *  place to enable `SUN_SHADOW_LAYER` on every exterior mesh once and
   *  never again (the exterior geometry is static after setup). `enable`
   *  ADDS the layer without removing layer 0, so the player's own camera
   *  (which only has layer 0 on) still renders these objects normally --
   *  only the sun's shadow camera additionally sees them. */
  function layerExteriorForSunShadow(): void {
    if (exteriorLayered) return;
    const exterior = scene.getObjectByName("exterior");
    if (!exterior) return; // not added yet; try again next frame
    exterior.traverse((obj) => obj.layers.enable(SUN_SHADOW_LAYER));
    exteriorLayered = true;
  }

  function update(world: IWorld, nowMs: number): void {
    layerExteriorForSunShadow();
    const brokenRooms = findBrokenLampRoom(world);
    // Tier 0: one fixture always flickers -- the lobby's, per the vision
    // table ("drop-ceiling tiles with fluorescent tubes (one flickers)").
    // Reuses this same broken-lamp flicker machinery rather than adding a
    // second flicker system, per the brief.
    if (hotelTier === 0) brokenRooms.add(ROOM.LOBBY);
    for (const [roomId, lights] of lightsByRoomId) {
      const flickering = brokenRooms.has(roomId);
      for (const light of lights) {
        if (!flickering) {
          if (light.userData.baseIntensity !== undefined) {
            light.intensity = light.userData.baseIntensity as number;
          }
          continue;
        }
        if (light.userData.baseIntensity === undefined) {
          light.userData.baseIntensity = light.intensity;
        }
        const base = light.userData.baseIntensity as number;
        const bucket = Math.floor(nowMs / 60);
        const r = hash01(bucket * 2654435761 + roomId * 97);
        // Flicker between ~15% and 100% of base intensity.
        light.intensity = base * (0.15 + r * 0.85);
      }
    }
  }

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    group.traverse((obj) => {
      const light = obj as THREE.Light;
      if (!(light instanceof THREE.Light)) return;
      const shadow = (light as unknown as { shadow?: { map?: { dispose(): void }; dispose?(): void } }).shadow;
      shadow?.map?.dispose();
      shadow?.dispose?.();
      (light as unknown as { dispose?(): void }).dispose?.();
    });
    lightsByRoomId.clear();
  }

  return { group, lightsByRoomId, update, dispose };
}
