/**
 * Host-side views for the things H2a added to the world that a player has
 * to be able to SEE and CLICK: messes, props, resumes sitting on the desk,
 * and job candidates.
 *
 * WHY THIS FILE EXISTS. The H2a gates drive housekeeping, maintenance and
 * hiring through commands, so they were all green while none of it was
 * reachable by a human at all: a `mess` entity has a `pos` and an
 * `interactable`, but nothing built an Object3D for it, and
 * `player-fps` raycasts only against explicitly REGISTERED objects. Invisible
 * and unclickable. That is the exact shape of H1b's defect 2 ("screen
 * clicking had never worked for a human while every gate stayed green"),
 * caught the same way — by driving the built game and looking at it.
 *
 * Presentation only: no component is written, nothing here is hashed, and
 * all of it is derived from sim state that replay reproduces byte for byte.
 * `Math.*` is fine in this file for the same reason it is fine in
 * render/characters.ts — it is outside the purity roots and its output
 * never re-enters the sim. Host-side RANDOMNESS is still banned; every
 * variation below is hashed from component data.
 *
 * Deliberately plain shapes. The retro texture/material pass is H2b's
 * (docs/PHASE-H2.md's split), and putting a look on these now would be
 * authoring against a target that phase is about to move. What must be true
 * TODAY is that the objects exist, sit where the sim says they sit, read as
 * distinct from one another, and can be clicked.
 */
import * as THREE from "three";
import type { EntityId, IWorld } from "@claude-engine/core";
import type { SceneContext } from "@claude-engine/renderer-three";
import type { Candidate, DocumentComp, Mess, Pos, Prop, Yaw } from "../sim/components.js";
import { syncCharacter } from "./characters.js";
import { loadModel, fitToFootprint } from "./assets.js";

/** Same host-only hash render/characters.ts uses, for the same reason:
 *  deterministic visual variety derived from component data. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashedColor(key: string, satBase: number, lightBase: number): THREE.Color {
  const h = hashString(key);
  return new THREE.Color().setHSL((h % 360) / 360, satBase + ((h >>> 8) % 30) / 100, lightBase + ((h >>> 16) % 20) / 100);
}

const MESS_SIZE_M = 0.28;
const PROP_W_M = 0.5;
const PROP_H_M = 0.6;
const TRAY_DOC_W_M = 0.22;
const TRAY_DOC_H_M = 0.3;

// -- prop fallback rigs: kind -> {tiltGroup, indicator material/mesh} ------
// `tiltGroup` is what leans when broken (matches the old rotation.z
// behaviour so "broken" stays legible without a HUD); `indicator` is the
// per-kind readable tell (dark shade, static screen, puddle, ajar door).

interface PropRig {
  tiltGroup: THREE.Object3D;
  setBroken(broken: boolean, mendedFrac: number): void;
}

function buildTvRig(): { object: THREE.Group; rig: PropRig } {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.06), slabMat);
  slab.position.y = 0.3 + 0.17;
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, emissive: 0x0d1a26, emissiveIntensity: 0.5 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), screenMat);
  screen.position.set(0, 0.3 + 0.17, 0.031);
  const standMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.15), standMat);
  stand.position.y = 0.15;
  tilt.add(slab, screen, stand);
  group.add(tilt);
  const rig: PropRig = {
    tiltGroup: tilt,
    setBroken(broken) {
      screenMat.color.set(broken ? 0x8a8a8a : 0x1a2a3a);
      screenMat.emissive.set(broken ? 0x444444 : 0x0d1a26);
      screenMat.emissiveIntensity = broken ? 0.15 : 0.5;
    },
  };
  loadModel("tv").then((loaded) => {
    if (!loaded) return;
    fitToFootprint(loaded.scene, { w: 0.5, d: 0.15, h: 0.34 });
    loaded.scene.position.y = 0.3;
    slab.visible = false;
    stand.visible = false;
    tilt.add(loaded.scene);
  });
  return { object: group, rig };
}

function buildRadiatorRig(): { object: THREE.Group; rig: PropRig } {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 }));
  panel.position.y = 0.35;
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x3a5a6a, transparent: true, opacity: 0, roughness: 0.2, metalness: 0.1 });
  const puddleGeom = new THREE.CircleGeometry(0.22, 16);
  puddleGeom.rotateX(-Math.PI / 2);
  const puddle = new THREE.Mesh(puddleGeom, puddleMat);
  puddle.position.y = 0.005;
  tilt.add(panel);
  group.add(tilt, puddle);
  const rig: PropRig = {
    tiltGroup: tilt,
    setBroken(broken) {
      puddleMat.opacity = broken ? 0.85 : 0;
    },
  };
  loadModel("radiator").then((loaded) => {
    if (!loaded) return;
    fitToFootprint(loaded.scene, { w: 0.5, d: 0.1, h: 0.5 });
    loaded.scene.position.y = 0.35;
    panel.visible = false;
    tilt.add(loaded.scene);
  });
  return { object: group, rig };
}

function buildLampFallbackRig(): { object: THREE.Group; rig: PropRig } {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d4a, roughness: 0.3, metalness: 0.8 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 8), brassMat);
  stem.position.y = 0.6;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12), brassMat);
  base.position.y = 0.02;
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf2d9a0, emissive: 0xf2c060, emissiveIntensity: 1.5, roughness: 0.6 });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.26, 12, 1, true), shadeMat);
  shade.position.y = 1.2 + 0.1;
  tilt.add(stem, base, shade);
  group.add(tilt);
  const rig: PropRig = {
    tiltGroup: tilt,
    setBroken(broken) {
      shadeMat.emissiveIntensity = broken ? 0 : 1.5;
      shadeMat.color.set(broken ? 0x3a3428 : 0xf2d9a0);
    },
  };
  loadModel("lamp-floor").then((loaded) => {
    if (!loaded) return;
    fitToFootprint(loaded.scene, { w: 0.3, d: 0.3, h: 1.4 });
    stem.visible = false;
    base.visible = false;
    shade.visible = false;
    tilt.add(loaded.scene);
  });
  return { object: group, rig };
}

function buildIceboxRig(): { object: THREE.Group; rig: PropRig } {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.45), bodyMat);
  body.position.y = 0.275;
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-0.225, 0.275, 0.225);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.42), new THREE.MeshStandardMaterial({ color: 0xe4e4e0, roughness: 0.4 }));
  door.position.set(0.01, 0, 0.21);
  doorPivot.add(door);
  tilt.add(body, doorPivot);
  group.add(tilt);
  const rig: PropRig = {
    tiltGroup: tilt,
    setBroken(broken) {
      doorPivot.rotation.y = broken ? -0.6 : 0;
    },
  };
  loadModel("minifridge").then((loaded) => {
    if (!loaded) return;
    fitToFootprint(loaded.scene, { w: 0.45, d: 0.45, h: 0.55 });
    body.visible = false;
    doorPivot.visible = false;
    tilt.add(loaded.scene);
  });
  return { object: group, rig };
}

function buildGenericPropRig(kind: string): { object: THREE.Group; rig: PropRig } {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: hashedColor(`prop:${kind}`, 0.3, 0.4) });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(PROP_W_M, PROP_H_M, PROP_W_M * 0.6), material);
  mesh.position.y = PROP_H_M / 2;
  tilt.add(mesh);
  group.add(tilt);
  const rig: PropRig = {
    tiltGroup: tilt,
    setBroken(broken) {
      material.emissive.setRGB(broken ? 0.25 : 0, 0, 0);
    },
  };
  return { object: group, rig };
}

const propRigs = new Map<EntityId, PropRig>();

function buildPropRigFor(kind: string): { object: THREE.Group; rig: PropRig } {
  switch (kind) {
    case "tv":
      return buildTvRig();
    case "radiator":
      return buildRadiatorRig();
    case "lamp":
      return buildLampFallbackRig();
    case "icebox":
      return buildIceboxRig();
    default:
      return buildGenericPropRig(kind);
  }
}

// -- mess fallback builders: kind -> a shape that reads as that mess -------

function buildMess(kind: string): THREE.Object3D {
  switch (kind) {
    case "pizza-box": {
      const g = new THREE.Group();
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xc9a05a, roughness: 0.9 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.3), boxMat);
      base.position.y = 0.01;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.3), boxMat);
      lid.position.set(0.32, 0.01, 0);
      lid.rotation.z = -0.15;
      const grease = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), new THREE.MeshStandardMaterial({ color: 0x7a4a1a, roughness: 0.6 }));
      grease.rotation.x = -Math.PI / 2;
      grease.position.y = 0.021;
      g.add(base, lid, grease);
      return g;
    }
    case "mystery-stain": {
      const geom = new THREE.CircleGeometry(0.24, 14);
      geom.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x2a1f1a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 });
      const mesh = new THREE.Mesh(geom, material);
      mesh.position.y = 0.003;
      return mesh;
    }
    case "towel-mountain": {
      const g = new THREE.Group();
      const towelMat = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.9 });
      const offsets: [number, number, number, number][] = [
        [0, 0.06, 0, 0.16],
        [0.09, 0.1, 0.05, 0.13],
        [-0.08, 0.09, -0.06, 0.12],
        [0.02, 0.15, -0.03, 0.1],
      ];
      for (const [x, y, z, r] of offsets) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), towelMat);
        sphere.position.set(x, y, z);
        sphere.scale.y = 0.6;
        g.add(sphere);
      }
      return g;
    }
    case "minibar-carnage": {
      const g = new THREE.Group();
      const bottleMat = new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.3, transparent: true, opacity: 0.85 });
      const canMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.4, metalness: 0.6 });
      const spots: [number, number, boolean][] = [
        [-0.08, -0.05, true],
        [0.06, 0.02, false],
        [0.1, -0.08, true],
        [-0.02, 0.08, false],
      ];
      for (const [x, z, isBottle] of spots) {
        const item = isBottle
          ? new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 8), bottleMat)
          : new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 8), canMat);
        item.position.set(x, isBottle ? 0.08 : 0.05, z);
        item.rotation.z = Math.PI / 2.2;
        g.add(item);
      }
      return g;
    }
    case "suspicious-glitter": {
      const geom = new THREE.CircleGeometry(0.22, 14);
      geom.rotateX(-Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        emissive: 0xc9a24a,
        emissiveIntensity: 0.6,
        roughness: 0.4,
        metalness: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.position.y = 0.003;
      return mesh;
    }
    default: {
      const geometry = new THREE.BoxGeometry(MESS_SIZE_M, MESS_SIZE_M * 0.5, MESS_SIZE_M);
      const material = new THREE.MeshStandardMaterial({ color: hashedColor(`mess:${kind}`, 0.4, 0.3) });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.y = ((hashString(kind) % 4) * Math.PI) / 4;
      return mesh;
    }
  }
}
/** Props stand on the floor; messes lie on it; tray documents sit at desk
 *  height so they read as paper on a counter rather than litter. */
const TRAY_Y_M = 1.05;

export interface UpkeepSyncResult {
  /** Every entity this pass rendered, for the caller's prune bookkeeping. */
  live: Set<EntityId>;
}

/**
 * Build/refresh the Object3Ds for every mess, prop, tray document and
 * candidate in the world, and register each as an interactable exactly once
 * (the same create-once discipline door and guest rigs use).
 *
 * `registered` is owned by the caller so it can be cleared by
 * `resetEntityKeyedHostState()` on a quick-load — `Sim.restore()` rewinds
 * `nextEntity`, so an id can come back attached to a different object, and
 * a guard Set with no reset is precisely the H1b item-6 hazard.
 */
export function syncUpkeepObjects(
  ctx: SceneContext,
  world: IWorld,
  alpha: number,
  registerInteractable: (entity: EntityId, object: THREE.Object3D) => void,
  registered: Set<EntityId>
): UpkeepSyncResult {
  const live = new Set<EntityId>();

  for (const entity of world.entities()) {
    const pos = world.getComponent<Pos>(entity, "pos");

    // -- messes: small lumps on the floor, one per wipe ------------------
    const mess = world.getComponent<Mess>(entity, "mess");
    if (mess && pos) {
      live.add(entity);
      const object = ctx.objectFor(entity, () => buildMess(mess.kind));
      object.position.set(pos.xMm / 1000, 0, pos.zMm / 1000);
      registerOnce(entity, object, registerInteractable, registered);
      continue;
    }

    // -- props: standing furniture, visibly broken and visibly mending ---
    const prop = world.getComponent<Prop>(entity, "prop");
    if (prop && pos) {
      live.add(entity);
      const object = ctx.objectFor(entity, () => {
        const { object: obj, rig } = buildPropRigFor(prop.kind);
        propRigs.set(entity, rig);
        return obj;
      });
      object.position.set(pos.xMm / 1000, 0, pos.zMm / 1000);
      // "Visible dirt-reveal progress" applied to repair, in its cheapest
      // honest form: a broken prop leans, and each repair press stands it
      // back up. The player can read progress off the object rather than
      // off a meter, which is the H2 spec's §9 requirement. Per-kind
      // readable tells (dark shade, static screen, puddle, ajar door) ride
      // alongside the lean via each rig's `setBroken`.
      const rig = propRigs.get(entity);
      if (rig) {
        const brokenLean = prop.broken ? 0.45 : 0;
        const mended = prop.broken && prop.repairProgress > 0 ? prop.repairProgress / 3 : 0;
        rig.tiltGroup.rotation.z = brokenLean * (1 - Math.min(1, mended));
        rig.setBroken(prop.broken, mended);
      }
      registerOnce(entity, object, registerInteractable, registered);
      continue;
    }

    // -- documents lying in the world (printed resumes on the tray) ------
    //    Held documents are drawn by render/documents.ts in front of the
    //    camera; this is the other half, the ones still on the counter.
    const doc = world.getComponent<DocumentComp>(entity, "document");
    if (doc && pos && doc.heldBy === 0) {
      live.add(entity);
      const object = ctx.objectFor(entity, () => {
        const geometry = new THREE.BoxGeometry(TRAY_DOC_W_M, 0.01, TRAY_DOC_H_M);
        const material = new THREE.MeshStandardMaterial({ color: 0xf2ead6 });
        return new THREE.Mesh(geometry, material);
      });
      object.position.set(pos.xMm / 1000, TRAY_Y_M, pos.zMm / 1000);
      object.visible = true;
      registerOnce(entity, object, registerInteractable, registered);
      continue;
    }
    if (doc && doc.heldBy !== 0) {
      // Held: render/documents.ts owns it now. Keep it out of `live` so the
      // caller's prune disposes the counter copy.
      continue;
    }

    // -- candidates: guest-shaped people who wait instead of queueing ----
    const candidate = world.getComponent<Candidate>(entity, "candidate");
    if (candidate && pos && candidate.state !== "hired") {
      const prevPos = world.getComponent<Pos>(entity, "prevPos");
      const yaw = world.getComponent<Yaw>(entity, "yaw");
      const prevYaw = world.getComponent<Yaw>(entity, "prevYaw");
      if (!prevPos || !yaw || !prevYaw) continue;
      live.add(entity);
      // Reuse the guest rig wholesale — a candidate IS a person who walked
      // in the same door, and giving them a different body would be a lie
      // about what they are. `syncCharacter` reads only archetypeId and
      // segment (for deterministic colour/height) and the state (for the
      // pose), so a small adapter is all that is needed.
      const asGuest = {
        archetypeId: `candidate:${candidate.quirk}`,
        segment: "staff",
        state: candidate.state === "arriving" ? ("arriving" as const) : ("queued" as const),
        roomEntity: 0,
        stayUntilTick: 0,
        queueIndex: -1,
        patienceTicks: 0,
        waitedTicks: 0,
        brokenPropNights: 0,
        paidMinor: 0,
      };
      const rigRoot = syncCharacter(ctx, entity, asGuest, pos, prevPos, yaw, prevYaw, alpha);
      if (rigRoot) registerOnce(entity, rigRoot, registerInteractable, registered);
      continue;
    }
  }

  for (const entity of propRigs.keys()) {
    if (!live.has(entity)) propRigs.delete(entity);
  }

  return { live };
}

function registerOnce(
  entity: EntityId,
  object: THREE.Object3D,
  registerInteractable: (entity: EntityId, object: THREE.Object3D) => void,
  registered: Set<EntityId>
): void {
  if (registered.has(entity)) return;
  registerInteractable(entity, object);
  registered.add(entity);
}
