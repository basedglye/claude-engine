/**
 * Lane 3 dev page: lighting + fixtures on the existing flat floor mesh
 * (the stand-in building, matching main.ts's toBufferGeometry(floor.mesh)
 * exactly, since architecture.ts is a different lane's concurrent work and
 * this page cannot depend on it). Standalone THREE scene — not wired
 * through createThreeHost's sim loop, since there is nothing sim-side to
 * step here.
 *
 * Query string: ?x=<m>&z=<m>&yaw=<deg>&pitch=<deg> poses the camera
 * (default: the lobby's center, spawn-like); ?fly=1 gives a WASD+mouse
 * fly camera for free inspection.
 */
import * as THREE from "three";
import { toBufferGeometry } from "@claude-engine/assets/web";
import { generateGroundFloor, type GroundFloor } from "@claude-engine/interiors";
import { roomRects, ROOM } from "../src/render/floorplan.js";
import { configureRenderer, buildLighting } from "../src/render/lighting.js";
import { buildFixtures } from "../src/render/fixtures.js";
import type { IWorld } from "@claude-engine/core";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/hotel/dev/light.ts: missing #app canvas");
const hud = document.querySelector<HTMLDivElement>("#hud");

const EYE_HEIGHT_M = 1.6;

const floor: GroundFloor = generateGroundFloor("hotel-h0-look-1");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
configureRenderer(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);

// Stand-in building geometry — the exact same construction main.ts uses.
{
  const geometry = toBufferGeometry(floor.mesh);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

const lightingRig = buildLighting(floor, scene, renderer);
scene.add(buildFixtures(floor));

// -- camera pose from the query string --
const params = new URLSearchParams(window.location.search);
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

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.rotation.order = "YXZ";

function applyPose(): void {
  camera.position.set(camX, EYE_HEIGHT_M, camZ);
  const yawRad = (yawDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  // Sim yaw-0-looks-toward-+Z convention (packages/player-fps/src/index.ts
  // onFrame): rotation.y = yaw + PI.
  camera.rotation.y = yawRad + Math.PI;
  camera.rotation.x = -pitchRad;
  camera.rotation.z = 0;
}
applyPose();

// -- ?fly=1: WASD + mouse-drag fly camera --
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
  const origApply = applyPose;
  (window as unknown as { __flyStep?: () => void }).__flyStep = flyStep;
  void origApply;
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

// Empty stand-in world: this dev page has no sim, so update() sees no
// broken-lamp props and every room light stays steady.
const emptyWorld: IWorld = {
  tick: 0,
  seed: "hotel-h0-look-1",
  stateHash: () => 0,
  entities: () => [],
  getComponent: () => undefined,
  eventsSince: () => [],
};

let lastFrameMs = performance.now();
let frameMs = 0;

function frame(): void {
  const now = performance.now();
  frameMs = now - lastFrameMs;
  lastFrameMs = now;

  if (flyMode) {
    (window as unknown as { __flyStep?: () => void }).__flyStep?.();
    applyPose();
  }

  lightingRig.update(emptyWorld, now);
  renderer.render(scene, camera);

  if (hud) {
    hud.textContent = `calls: ${renderer.info.render.calls}  triangles: ${renderer.info.render.triangles}  frame: ${frameMs.toFixed(1)}ms`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
