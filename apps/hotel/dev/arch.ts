/**
 * Dev-only inspection page for the "real hotel" architecture lane. Not part
 * of the production bundle (vite build's default input is index.html
 * only). Builds generateGroundFloor("hotel-h0-look-1"), adds
 * buildArchitecture + buildExterior + a couple of createDoorLeaf panels,
 * lights it, and reads a camera pose from the query string.
 */
import * as THREE from "three";
import { generateGroundFloor, type DoorSpec } from "@claude-engine/interiors";
import { buildArchitecture } from "../src/render/architecture.js";
import { buildExterior } from "../src/render/exterior.js";
import { createDoorLeaf } from "../src/render/door-leaf.js";
import { roomRects } from "../src/render/floorplan.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("dev/arch: missing #app canvas");

const floor = generateGroundFloor("hotel-h0-look-1");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x223449);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 500);
camera.rotation.order = "YXZ";

scene.add(buildArchitecture(floor));
scene.add(buildExterior(floor));

// A couple of door leaves for visual inspection: the entrance and the
// first interior door.
const doorGroups: THREE.Object3D[] = [];
function addDoorLeaf(spec: DoorSpec, entrance: boolean): void {
  const leaf = createDoorLeaf(spec, { entrance });
  const group = new THREE.Group();
  group.position.set(spec.xMm / 1000, 0, spec.zMm / 1000);
  leaf.position.set(-spec.xMm / 1000, 0, -spec.zMm / 1000);
  group.add(leaf);
  scene.add(group);
  doorGroups.push(group);
}
for (const d of floor.doors) {
  addDoorLeaf(d, d.doorIndex === floor.entranceDoorIndex);
}

// -- Lighting: hemisphere sky/ground + ambient + one warm point light per
//    room rect at 2.4m + one outdoor directional (buildExterior already
//    adds its own sun, this is a fill for interior legibility). --
const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x362b22, 0.6);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);

for (const rect of roomRects(floor).values()) {
  if (rect.kind === "street") continue;
  const light = new THREE.PointLight(0xffe3b0, 12, Math.max(rect.widthM, rect.depthM) * 1.8, 2);
  light.position.set(rect.centerXM, 2.4, rect.centerZM);
  light.castShadow = false;
  scene.add(light);
}

const sunFill = new THREE.DirectionalLight(0xfff0dd, 0.9);
sunFill.position.set(floor.spawn.xMm / 1000 + 10, 20, floor.spawn.zMm / 1000 - 15);
sunFill.castShadow = true;
sunFill.shadow.mapSize.set(2048, 2048);
sunFill.shadow.camera.left = -40;
sunFill.shadow.camera.right = 40;
sunFill.shadow.camera.top = 40;
sunFill.shadow.camera.bottom = -40;
sunFill.shadow.camera.near = 1;
sunFill.shadow.camera.far = 120;
scene.add(sunFill);

// -- Pose from query string. yaw convention mirrors
//    packages/player-fps/src/index.ts onFrame: sim yaw 0 looks toward +Z,
//    camera.rotation.y = yawRad + PI. --
const params = new URLSearchParams(window.location.search);
const EYE_HEIGHT_M = 1.6;
function num(name: string, fallback: number): number {
  const v = params.get(name);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
const defaultX = floor.spawn.xMm / 1000;
const defaultZ = floor.spawn.zMm / 1000;
const poseX = num("x", defaultX);
const poseZ = num("z", defaultZ);
const poseYawDeg = num("yaw", 0);
const posePitchDeg = num("pitch", 0);
camera.position.set(poseX, EYE_HEIGHT_M, poseZ);
const yawRad = (poseYawDeg * Math.PI) / 180;
const pitchRad = (posePitchDeg * Math.PI) / 180;
camera.rotation.y = yawRad + Math.PI;
camera.rotation.x = -pitchRad;
camera.rotation.z = 0;

// -- Optional fly camera (?fly=1): WASD + mouse look, for author inspection. --
const flyEnabled = params.get("fly") === "1";
if (flyEnabled) {
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  let yaw = camera.rotation.y;
  let pitch = camera.rotation.x;
  canvas.addEventListener("click", () => canvas.requestPointerLock());
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.0025;
    pitch -= e.movementY * 0.0025;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  });
  const flySpeed = 4; // m/s
  let lastT = performance.now();
  function flyStep(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3();
    if (keys.has("KeyW")) move.add(forward);
    if (keys.has("KeyS")) move.sub(forward);
    if (keys.has("KeyD")) move.add(right);
    if (keys.has("KeyA")) move.sub(right);
    if (keys.has("Space")) move.y += 1;
    if (keys.has("ShiftLeft")) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(flySpeed * dt);
      camera.position.add(move);
    }
    requestAnimationFrame(flyStep);
  }
  requestAnimationFrame(flyStep);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function renderLoop(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// Expose for debugging from devtools / screenshot scripts.
(window as unknown as { __ARCH_DEV__: unknown }).__ARCH_DEV__ = { scene, camera, floor };
