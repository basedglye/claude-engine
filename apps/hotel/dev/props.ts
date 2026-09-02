/**
 * Lane 4 dev page: decor, characters, upkeep objects and the terminal
 * screen, all together on the real floor + lighting so this lane's work
 * can be screenshotted without depending on main.ts (which lane 4 is
 * forbidden from editing). Runs a real `Sim` (headless-identical setup)
 * and steps it at 20 Hz so guests actually walk into the lobby/queue, then
 * renders through a minimal hand-built `SceneContext` (same shape as
 * `packages/renderer-three/src/three-host.ts`'s `objectFor`/`scenery`).
 *
 * Query string: ?x=<m>&z=<m>&yaw=<deg>&pitch=<deg> poses the camera
 * (default: the sim's own spawn point); ?fly=1 gives a WASD+mouse fly
 * camera; ?forceMess=1 stamps a fake `mess`/`prop` entity into a bedroom
 * so a mess/broken-prop set can be screenshotted without waiting on real
 * guest checkouts (dev-only -- the game itself never does this).
 */
import * as THREE from "three";
import { Sim, type EntityId, type IWorld } from "@claude-engine/core";
import {
  setup,
  loadGroundFloor,
  PLAYER_ENTITY,
  type Guest,
  type Pos,
  type Yaw,
  type Mess,
  type Prop,
} from "../src/sim/game.js";
import { roomRects, ROOM } from "../src/render/floorplan.js";
import { configureRenderer, buildLighting } from "../src/render/lighting.js";
import { buildArchitecture } from "../src/render/architecture.js";
import { buildDecor } from "../src/render/decor.js";
import { syncCharacter, pruneCharacters } from "../src/render/characters.js";
import { syncUpkeepObjects } from "../src/render/upkeep.js";
import { syncTerminalScreens } from "../src/render/screens.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/hotel/dev/props.ts: missing #app canvas");
const hud = document.querySelector<HTMLDivElement>("#hud");

const EYE_HEIGHT_M = 1.6;
const SEED = "hotel-h0-look-1";

const sim = new Sim(SEED);
setup(sim);

const params = new URLSearchParams(window.location.search);

// -- optional dev-only fake mess/prop stamp, so a mess/broken-prop set can
//    be screenshotted deterministically without waiting on real checkouts.
//    This is dev-page-only code; main.ts and the sim itself never do this.
if (params.get("forceMess") === "1") {
  const floorForStamp = loadGroundFloor(SEED);
  const bedroom = floorForStamp.bedrooms[0];
  if (bedroom) {
    const cx = bedroom.goalCx + 1;
    const cz = bedroom.goalCz;
    const pos: Pos = { xMm: cx * 250 + 125, zMm: cz * 250 + 125 };
    const messEntity = sim.spawn();
    sim.setComponent<Pos>(messEntity, "pos", pos);
    sim.setComponent<Mess>(messEntity, "mess", { roomEntity: 0, kind: "towel-mountain" });
    const propEntity = sim.spawn();
    sim.setComponent<Pos>(propEntity, "pos", { xMm: pos.xMm + 500, zMm: pos.zMm });
    sim.setComponent<Prop>(propEntity, "prop", { kind: "lamp", roomEntity: 0, broken: true, repairProgress: 0 });
  }
}

// Step the sim at 20 Hz (matching the real tick rate) so guests actually
// walk into the lobby/queue before the first screenshot.
for (let i = 0; i < 1500; i++) sim.step();

const floor = loadGroundFloor(SEED);
if (params.get("debugRooms") === "1") {
  const rects = [...roomRects(floor).values()].map((r) => ({ id: r.roomId, kind: r.kind, cx: r.centerXM, cz: r.centerZM, w: r.widthM, d: r.depthM }));
  console.log("ROOMRECTS", JSON.stringify(rects));
  console.log("SPAWN", JSON.stringify(floor.spawn));
  console.log("BEDROOMS", JSON.stringify(floor.bedrooms));
  console.log("DESK", JSON.stringify(floor.desk));
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
configureRenderer(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.add(buildArchitecture(floor));
scene.add(buildDecor(floor));

const lightingRig = buildLighting(floor, scene, renderer);

// -- minimal hand-built SceneContext, same shape as three-host.ts's --------
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.rotation.order = "YXZ";

const objects = new Map<EntityId, THREE.Object3D>();
const scenery = new Map<string, THREE.Object3D>();

function objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D {
  let obj = objects.get(entity);
  if (!obj) {
    obj = create();
    objects.set(entity, obj);
    scene.add(obj);
  }
  return obj;
}
function sceneryFor(key: string, create: () => THREE.Object3D): THREE.Object3D {
  let obj = scenery.get(key);
  if (!obj) {
    obj = create();
    scenery.set(key, obj);
    scene.add(obj);
  }
  return obj;
}
function disposeObject(obj: THREE.Object3D): void {
  scene.remove(obj);
  obj.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) material.dispose();
  });
}
function pruneStale(): void {
  const live = new Set(sim.entities());
  for (const [entity, obj] of objects) {
    if (!live.has(entity)) {
      disposeObject(obj);
      objects.delete(entity);
    }
  }
}

const ctx = { scene, camera, renderer, objectFor, scenery: sceneryFor };

const registeredUpkeepInteractables = new Set<EntityId>();
function registerInteractable(_entity: EntityId, _object: THREE.Object3D): void {
  // Dev page has no player-fps raycaster; registration is a no-op here.
}

// -- camera pose from the query string --
const lobby = roomRects(floor).get(ROOM.LOBBY);
void lobby;
const defaultX = floor.spawn.xMm / 1000;
const defaultZ = floor.spawn.zMm / 1000;
const defaultYawDeg = floor.spawn.yawMdeg / 1000;

let camX = params.has("x") ? Number(params.get("x")) : defaultX;
let camZ = params.has("z") ? Number(params.get("z")) : defaultZ;
let yawDeg = params.has("yaw") ? Number(params.get("yaw")) : defaultYawDeg;
let pitchDeg = params.has("pitch") ? Number(params.get("pitch")) : 0;
const flyMode = params.get("fly") === "1";

function applyPose(): void {
  camera.position.set(camX, EYE_HEIGHT_M, camZ);
  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  camera.rotation.y = yawRad + Math.PI;
  camera.rotation.x = -pitchRad;
  camera.rotation.z = 0;
}
applyPose();

if (flyMode) {
  const held = new Set<string>();
  window.addEventListener("keydown", (e) => held.add(e.code));
  window.addEventListener("keyup", (e) => held.delete(e.code));
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yawDeg -= dx * 0.2;
    pitchDeg = Math.max(-89, Math.min(89, pitchDeg - dy * 0.2));
  });
  function flyStep(): void {
    const speed = 0.08;
    const yawRad = (yawDeg * Math.PI) / 180;
    const fwdX = Math.sin(yawRad);
    const fwdZ = Math.cos(yawRad);
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    let dx = 0;
    let dz = 0;
    if (held.has("KeyW")) {
      dx += fwdX;
      dz += fwdZ;
    }
    if (held.has("KeyS")) {
      dx -= fwdX;
      dz -= fwdZ;
    }
    if (held.has("KeyD")) {
      dx += rightX;
      dz += rightZ;
    }
    if (held.has("KeyA")) {
      dx -= rightX;
      dz -= rightZ;
    }
    camX += dx * speed;
    camZ += dz * speed;
  }
  (window as unknown as { __flyStep?: () => void }).__flyStep = flyStep;
}

function resize(): void {
  const w = canvas!.clientWidth || window.innerWidth;
  const h = canvas!.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener("resize", resize);

const TICK_MS = 50; // 20 Hz
let accumulatorMs = 0;
let lastFrameMs = performance.now();

function syncFrame(alpha: number): void {
  pruneStale();
  const world: IWorld = sim;

  syncTerminalScreens(ctx, world, registerInteractable);

  const liveGuests = new Set<EntityId>();
  for (const entity of sim.entities()) {
    if (entity === PLAYER_ENTITY) continue;
    const guest = sim.getComponent<Guest>(entity, "guest");
    if (!guest) continue;
    const pos = sim.getComponent<Pos>(entity, "pos");
    const prevPos = sim.getComponent<Pos>(entity, "prevPos");
    const yaw = sim.getComponent<Yaw>(entity, "yaw");
    const prevYaw = sim.getComponent<Yaw>(entity, "prevYaw");
    if (!pos || !prevPos || !yaw || !prevYaw) continue;
    liveGuests.add(entity);
    syncCharacter(ctx, entity, guest, pos, prevPos, yaw, prevYaw, alpha);
  }
  const upkeep = syncUpkeepObjects(ctx, world, alpha, registerInteractable, registeredUpkeepInteractables);
  for (const entity of upkeep.live) liveGuests.add(entity);
  pruneCharacters(liveGuests);
}

function frame(): void {
  const now = performance.now();
  const frameMs = now - lastFrameMs;
  lastFrameMs = now;
  accumulatorMs += frameMs;
  while (accumulatorMs >= TICK_MS) {
    sim.step();
    accumulatorMs -= TICK_MS;
  }
  const alpha = Math.min(1, accumulatorMs / TICK_MS);

  if (flyMode) {
    (window as unknown as { __flyStep?: () => void }).__flyStep?.();
    applyPose();
  }

  lightingRig.update(sim, now);
  syncFrame(alpha);
  renderer.render(scene, camera);

  if (hud) {
    hud.textContent = `tick: ${sim.tick}  calls: ${renderer.info.render.calls}  triangles: ${renderer.info.render.triangles}  frame: ${frameMs.toFixed(1)}ms`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
