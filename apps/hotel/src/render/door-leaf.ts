/**
 * Real door leaf geometry, built in WORLD space exactly like
 * packages/interiors/src/door-mesh.ts's generateDoorMesh, so main.ts's
 * existing pivot trick (group at the door centre, leaf offset by the
 * inverse) keeps working unchanged. Host-side presentation only; Math.*
 * trig is fine here (mirrors door-mesh.ts's rotation, just with regular
 * floating trig instead of space's Q16.16 LUT since this is not sim code).
 */
import * as THREE from "three";
import type { DoorSpec } from "@claude-engine/interiors";
import { makePbrMaterial } from "./assets.js";

const DOOR_HEIGHT_M = 2.1;
const DOOR_THICKNESS_M = 0.045;

function rotateToWorld(lx: number, lz: number, yawMdeg: number, cxM: number, czM: number): [number, number] {
  const rad = (yawMdeg / 1000) * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const wx = lx * cos - lz * sin;
  const wz = lx * sin + lz * cos;
  return [cxM + wx, czM + wz];
}

export interface DoorLeafOptions {
  entrance: boolean;
}

/** Builds one interior panelled wood door leaf with brass lever handles on
 *  both faces, centred on spec.xMm/zMm and oriented by spec.yawMdeg. */
function buildInteriorLeaf(spec: DoorSpec): THREE.Object3D {
  const group = new THREE.Group();
  const cxM = spec.xMm / 1000;
  const czM = spec.zMm / 1000;
  const widthM = (spec.widthCells * 250) / 1000;
  // Leave a small gap either side of the jamb (visual only — clearance is
  // grid-driven for the sim, this is purely a "leaf smaller than the
  // opening" look).
  const leafW = widthM - 0.06;

  const woodMat = makePbrMaterial("wood-door", { fallbackColor: 0x4a3220, roughness: 0.55 });
  const brassMat = makePbrMaterial("metal-brass", { fallbackColor: 0xb08d3f, metalness: 1, roughness: 0.3 });

  // A local-space object oriented so local +X spans the doorway width and
  // local +Z is the thin axis, then rotated to world by yawMdeg exactly
  // like door-mesh.ts's rotateToWorldM (mirrored here with regular trig).
  const local = new THREE.Group();

  // Main slab.
  const slabGeo = new THREE.BoxGeometry(leafW, DOOR_HEIGHT_M, DOOR_THICKNESS_M);
  const slab = new THREE.Mesh(slabGeo, woodMat);
  slab.position.set(0, DOOR_HEIGHT_M / 2, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  local.add(slab);

  // Raised panels: two stiles of shallow boxes proud of the slab face, a
  // classic 4-panel look (upper small, lower tall) on both faces.
  const panelInset = 0.08;
  const panelDepth = 0.012;
  const panelW = leafW - panelInset * 2;
  function addPanel(cy: number, ph: number, faceZ: number): void {
    const g = new THREE.BoxGeometry(panelW, ph, panelDepth);
    const m = new THREE.Mesh(g, woodMat);
    m.position.set(0, cy, faceZ);
    m.castShadow = true;
    m.receiveShadow = true;
    local.add(m);
  }
  const halfT = DOOR_THICKNESS_M / 2;
  addPanel(DOOR_HEIGHT_M * 0.72, DOOR_HEIGHT_M * 0.32, halfT + panelDepth / 2);
  addPanel(DOOR_HEIGHT_M * 0.32, DOOR_HEIGHT_M * 0.48, halfT + panelDepth / 2);
  addPanel(DOOR_HEIGHT_M * 0.72, DOOR_HEIGHT_M * 0.32, -halfT - panelDepth / 2);
  addPanel(DOOR_HEIGHT_M * 0.32, DOOR_HEIGHT_M * 0.48, -halfT - panelDepth / 2);

  // Brass lever handles at 1.0m, both faces, near the leaf's latch edge.
  function addHandle(faceZ: number, sign: 1 | -1): void {
    const handleGroup = new THREE.Group();
    const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.01), brassMat);
    backplate.position.set(leafW / 2 - 0.08, 1.0, faceZ);
    backplate.castShadow = true;
    handleGroup.add(backplate);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 8), brassMat);
    lever.rotation.z = Math.PI / 2;
    lever.position.set(leafW / 2 - 0.08 + sign * 0.06, 1.0, faceZ);
    lever.castShadow = true;
    handleGroup.add(lever);
    local.add(handleGroup);
  }
  addHandle(halfT + 0.01, 1);
  addHandle(-halfT - 0.01, -1);

  // Orient/position `local` into world space via the same rotation
  // door-mesh.ts uses: rotate the local axes by yawMdeg around the door
  // centre. Rather than rotate every vertex by hand (as door-mesh.ts does
  // for its raw geometry), just set the group's own rotation + position —
  // equivalent for a rigid THREE.Object3D.
  local.rotation.y = -(spec.yawMdeg / 1000) * (Math.PI / 180);
  local.position.set(cxM, 0, czM);
  group.add(local);
  return group;
}

/** Entrance: a pair of glass doors in a brass frame with push bars. */
function buildEntranceLeaf(spec: DoorSpec): THREE.Object3D {
  const group = new THREE.Group();
  const cxM = spec.xMm / 1000;
  const czM = spec.zMm / 1000;
  const widthM = (spec.widthCells * 250) / 1000;
  const leafW = widthM / 2 - 0.05;

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe0e8,
    transparent: true,
    opacity: 0.35,
    roughness: 0.05,
    metalness: 0,
    // No `transmission`: it forces a full extra scene render each frame.
    side: THREE.DoubleSide,
  });
  const brassMat = makePbrMaterial("metal-brass", { fallbackColor: 0xb08d3f, metalness: 1, roughness: 0.25 });

  const local = new THREE.Group();

  function addLeaf(sign: 1 | -1): void {
    const leafGroup = new THREE.Group();
    const centerX = (sign * leafW) / 2;
    const frameT = 0.04;

    const pane = new THREE.Mesh(new THREE.PlaneGeometry(leafW - frameT * 2, DOOR_HEIGHT_M - frameT * 2), glassMat);
    pane.position.set(centerX, DOOR_HEIGHT_M / 2, 0);
    pane.receiveShadow = true;
    leafGroup.add(pane);

    // Brass frame (4 bars).
    const vBarGeo = new THREE.BoxGeometry(frameT, DOOR_HEIGHT_M, frameT);
    const left = new THREE.Mesh(vBarGeo, brassMat);
    left.position.set(centerX - leafW / 2 + frameT / 2, DOOR_HEIGHT_M / 2, 0);
    left.castShadow = true;
    leafGroup.add(left);
    const right = new THREE.Mesh(vBarGeo, brassMat);
    right.position.set(centerX + leafW / 2 - frameT / 2, DOOR_HEIGHT_M / 2, 0);
    right.castShadow = true;
    leafGroup.add(right);
    const hBarGeo = new THREE.BoxGeometry(leafW, frameT, frameT);
    const top = new THREE.Mesh(hBarGeo, brassMat);
    top.position.set(centerX, DOOR_HEIGHT_M - frameT / 2, 0);
    top.castShadow = true;
    leafGroup.add(top);
    const bottom = new THREE.Mesh(hBarGeo, brassMat);
    bottom.position.set(centerX, frameT / 2, 0);
    bottom.castShadow = true;
    leafGroup.add(bottom);

    // Push bar.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.6, 0.05, 0.03), brassMat);
    bar.position.set(centerX, 1.0, 0.03);
    bar.castShadow = true;
    leafGroup.add(bar);

    local.add(leafGroup);
  }
  addLeaf(1);
  addLeaf(-1);

  local.rotation.y = -(spec.yawMdeg / 1000) * (Math.PI / 180);
  local.position.set(cxM, 0, czM);
  group.add(local);
  return group;
}

export function createDoorLeaf(spec: DoorSpec, opts: DoorLeafOptions): THREE.Object3D {
  return opts.entrance ? buildEntranceLeaf(spec) : buildInteriorLeaf(spec);
}

// Re-export for callers that want the raw world-space rotate helper
// (mirrors door-mesh.ts's rotateToWorldM but in metres, using Math.* since
// this is host code).
export { rotateToWorld };
