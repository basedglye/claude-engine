/**
 * Articulated guest (and player-in-third-person, if ever wired) character
 * rigs — host-only presentation code (docs/PHASE-H1.md, "Host (main.ts)
 * additions" + apps/hotel/docs/ARCHITECTURE.md B6's standing ruling).
 *
 * B6 is a standing decision, not a this-phase choice: characters are
 * articulated `Object3D` limb hierarchies (torso/head/2 arms/2 legs),
 * procedurally posed. No skinning, no GLTF, no animation system — this
 * module builds the hierarchy once per entity (via `SceneContext.objectFor`,
 * so create/dispose rides the host's existing per-entity lifecycle) and
 * rotates the limb pivots every frame.
 *
 * Determinism note: this is host-only, unhashed, presentation code, so
 * `Math.sin`/`cos`/`abs` etc. are fine here (invariant 2 only bans them in
 * sim-side code). What is NOT fine is host-side *randomness* — every visual
 * variation (colour, height) is derived by hashing component data that is
 * already part of replayed sim state (`guest.archetypeId`, the guest's
 * name-derived flavour is not read here, so archetypeId/segment carry the
 * variety), so a replay's rendering is byte-identical to the live run's.
 */
import * as THREE from "three";
import type { EntityId } from "@claude-engine/core";
import { angleDeltaMdeg, FULL_TURN_MDEG } from "@claude-engine/space";
import type { SceneContext } from "@claude-engine/renderer-three";
import type { Guest, GuestState, Pos, Yaw } from "../sim/components.js";

// -- deterministic visual variety (no host-side randomness: see file doc) --

/** Small string hash (FNV-1a-ish), host-only, deterministic. Used only to
 *  derive presentation variance from component data — never fed back into
 *  sim state or used for gameplay decisions. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic HSL colour from the guest's archetype+segment (component
 *  data, identical across live/replay runs of the same seed). */
function colorForGuest(guest: Guest): THREE.Color {
  const h = hashString(`${guest.archetypeId}:${guest.segment}`);
  const hue = (h % 360) / 360;
  const sat = 0.35 + ((h >>> 8) % 40) / 100; // 0.35..0.75
  const light = 0.45 + ((h >>> 16) % 25) / 100; // 0.45..0.70
  return new THREE.Color().setHSL(hue, sat, light);
}

/** Deterministic height scale, +-15%, from the same hashed data. */
function heightScaleForGuest(guest: Guest): number {
  const h = hashString(`${guest.segment}:${guest.archetypeId}:height`);
  return 0.9 + ((h >>> 4) % 21) / 100; // 0.90..1.10
}

// -- rig dimensions (metres; renderer space, matches floor mesh mm/1000) --

const TORSO_W = 0.34;
const TORSO_H = 0.5;
const TORSO_D = 0.2;
const HEAD_SIZE = 0.24;
const ARM_LEN = 0.42;
const ARM_THICK = 0.09;
const LEG_LEN = 0.5;
const LEG_THICK = 0.11;
const HIP_Y = LEG_LEN; // ground -> hip
const SHOULDER_Y = HIP_Y + TORSO_H;

export interface CharacterRig {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  /** Pivots at the shoulder/hip; the mesh hangs below/from the pivot so
   *  rotating the pivot swings the limb like a hinge, not a floating box. */
  armLPivot: THREE.Group;
  armRPivot: THREE.Group;
  legLPivot: THREE.Group;
  legRPivot: THREE.Group;
}

function makeLimb(length: number, thick: number, color: THREE.Color, hangDown: boolean): { pivot: THREE.Group; mesh: THREE.Mesh } {
  const pivot = new THREE.Group();
  const geometry = new THREE.BoxGeometry(thick, length, thick);
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  // Offset the mesh so the pivot sits at one end (shoulder/hip), matching a
  // hinge rather than rotating the limb's own centre.
  mesh.position.y = hangDown ? -length / 2 : length / 2;
  pivot.add(mesh);
  return { pivot, mesh };
}

/** Builds one low-poly articulated figure. Called once per guest entity
 *  (via `SceneContext.objectFor`'s create callback) — never per frame. */
export function createCharacterRig(guest: Guest): CharacterRig {
  const color = colorForGuest(guest);
  const scale = heightScaleForGuest(guest);

  const root = new THREE.Group();
  root.scale.setScalar(scale);

  const torsoGeom = new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D);
  const torsoMat = new THREE.MeshStandardMaterial({ color });
  const torso = new THREE.Mesh(torsoGeom, torsoMat);
  torso.position.y = HIP_Y + TORSO_H / 2;
  root.add(torso);

  const headGeom = new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE);
  const headMat = new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, 0, 0.12) });
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = SHOULDER_Y + HEAD_SIZE / 2 + 0.02;
  root.add(head);

  const armL = makeLimb(ARM_LEN, ARM_THICK, color, true);
  armL.pivot.position.set(TORSO_W / 2 + ARM_THICK / 2, SHOULDER_Y, 0);
  root.add(armL.pivot);

  const armR = makeLimb(ARM_LEN, ARM_THICK, color, true);
  armR.pivot.position.set(-(TORSO_W / 2 + ARM_THICK / 2), SHOULDER_Y, 0);
  root.add(armR.pivot);

  const legL = makeLimb(LEG_LEN, LEG_THICK, color.clone().offsetHSL(0, 0, -0.1), true);
  legL.pivot.position.set(TORSO_W / 4, HIP_Y, 0);
  root.add(legL.pivot);

  const legR = makeLimb(LEG_LEN, LEG_THICK, color.clone().offsetHSL(0, 0, -0.1), true);
  legR.pivot.position.set(-TORSO_W / 4, HIP_Y, 0);
  root.add(legR.pivot);

  return { root, torso, head, armLPivot: armL.pivot, armRPivot: armR.pivot, legLPivot: legL.pivot, legRPivot: legR.pivot };
}

// -- per-entity render-only walk state (host presentation, never sim state) --

interface WalkState {
  lastXMm: number;
  lastZMm: number;
  /** Accumulated travelled distance (mm), wrapped into the walk phase.
   *  Driven purely by displacement, so a guest that is not actually moving
   *  never advances its stride — no moonwalking in place. */
  distMm: number;
}

const walkStates = new Map<EntityId, WalkState>();

const STRIDE_MM = 900; // distance for one full swing cycle
const SWING_AMP = 0.6; // radians
const ARM_AMP = 0.45;
const BOB_AMP = 0.035; // metres

function poseIdle(rig: CharacterRig): void {
  rig.armLPivot.rotation.set(0.05, 0, 0);
  rig.armRPivot.rotation.set(0.05, 0, 0);
  rig.legLPivot.rotation.set(0, 0, 0);
  rig.legRPivot.rotation.set(0, 0, 0);
  rig.root.position.y = 0;
}

function posePresent(rig: CharacterRig): void {
  // One arm extended forward and slightly up, as if handing over documents;
  // the other arm rests. Legs stay planted (a presenting guest is standing
  // still at the queue head).
  rig.armRPivot.rotation.set(-1.35, 0, -0.15);
  rig.armLPivot.rotation.set(0.05, 0, 0);
  rig.legLPivot.rotation.set(0, 0, 0);
  rig.legRPivot.rotation.set(0, 0, 0);
  rig.root.position.y = 0;
}

function poseWalk(rig: CharacterRig, phase: number): void {
  const swing = Math.sin(phase);
  rig.legLPivot.rotation.x = swing * SWING_AMP;
  rig.legRPivot.rotation.x = -swing * SWING_AMP;
  // Arms swing opposite the same-side leg (natural counter-swing gait).
  rig.armLPivot.rotation.x = -swing * ARM_AMP;
  rig.armRPivot.rotation.x = swing * ARM_AMP;
  rig.root.position.y = Math.abs(Math.sin(phase)) * BOB_AMP;
}

/** Advance the render-only walk phase for one entity from its interpolated
 *  displacement this frame, and pick+apply the right pose. `presenting`
 *  overrides walk/idle regardless of displacement (a presenting guest is
 *  stationary at the queue head by construction, but this keeps the pose
 *  correct even mid-transition). */
export function poseCharacter(entity: EntityId, rig: CharacterRig, guestState: GuestState, xMm: number, zMm: number): void {
  if (guestState === "presenting") {
    walkStates.delete(entity); // reset stride so the next walk starts clean
    posePresent(rig);
    return;
  }

  let ws = walkStates.get(entity);
  if (!ws) {
    ws = { lastXMm: xMm, lastZMm: zMm, distMm: 0 };
    walkStates.set(entity, ws);
  }
  const dx = xMm - ws.lastXMm;
  const dz = zMm - ws.lastZMm;
  const stepMm = Math.sqrt(dx * dx + dz * dz);
  ws.lastXMm = xMm;
  ws.lastZMm = zMm;

  if (stepMm < 0.5) {
    // Not actually moving this frame: decay is unnecessary, just idle.
    poseIdle(rig);
    return;
  }
  ws.distMm += stepMm;
  const phase = (ws.distMm / STRIDE_MM) * Math.PI * 2;
  poseWalk(rig, phase);
}

/** Drop render-only state for a despawned entity (called from syncScene
 *  alongside `SceneContext.objectFor`'s own prune, so this Map never grows
 *  unbounded across a long session). */
export function forgetCharacter(entity: EntityId): void {
  walkStates.delete(entity);
}

// -- interpolation (mirrors the player's own prevPos/pos + alpha blend) --

export function lerpMm(prev: number, cur: number, alpha: number): number {
  return prev + (cur - prev) * alpha;
}

/** Shortest-path yaw interpolation across the 0/360000 mdeg wrap, using the
 *  same integer angle-delta helper the sim itself uses for arcs. */
export function lerpYawMdeg(prevMdeg: number, curMdeg: number, alpha: number): number {
  const delta = angleDeltaMdeg(curMdeg, prevMdeg);
  const result = prevMdeg + delta * alpha;
  return ((result % FULL_TURN_MDEG) + FULL_TURN_MDEG) % FULL_TURN_MDEG;
}

/** Render one guest entity into `ctx`: interpolates pos/yaw from
 *  prevPos/pos + prevYaw/yaw by `alpha` (exactly like the existing player
 *  rendering — the sim is 20 Hz and this must not look stepped), and poses
 *  the rig from the guest's `state` plus this frame's actual displacement. */
export function syncCharacter(
  ctx: SceneContext,
  entity: EntityId,
  guest: Guest,
  pos: Pos,
  prevPos: Pos,
  yaw: Yaw,
  prevYaw: Yaw,
  alpha: number
): THREE.Object3D | undefined {
  ctx.objectFor(entity, () => {
    const created = createCharacterRig(guest);
    rigsByEntity.set(entity, created);
    return created.root;
  });
  const rig = rigsByEntity.get(entity);
  if (!rig) return undefined; // defensive; objectFor's create callback always populates this

  const xMm = lerpMm(prevPos.xMm, pos.xMm, alpha);
  const zMm = lerpMm(prevPos.zMm, pos.zMm, alpha);
  const yawMdeg = lerpYawMdeg(prevYaw.mdeg, yaw.mdeg, alpha);

  rig.root.position.x = xMm / 1000;
  rig.root.position.z = zMm / 1000;
  rig.root.rotation.y = -(yawMdeg / 1000) * (Math.PI / 180);

  poseCharacter(entity, rig, guest.state, pos.xMm, pos.zMm);
  return rig.root;
}

const rigsByEntity = new Map<EntityId, CharacterRig>();

/** Drop render-only bookkeeping (rig lookup + walk phase) for entities that
 *  no longer exist. `SceneContext.objectFor` already disposes/removes the
 *  Three.js objects on despawn; this just keeps this module's own side
 *  maps (`rigsByEntity`, `walkStates`) from growing unbounded across a long
 *  session, since neither is known to the host's own object map. */
export function pruneCharacters(liveEntities: ReadonlySet<EntityId>): void {
  for (const entity of rigsByEntity.keys()) {
    if (!liveEntities.has(entity)) {
      rigsByEntity.delete(entity);
      forgetCharacter(entity);
    }
  }
}
