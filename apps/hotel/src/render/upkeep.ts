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
import { createRetroMaterial, type SceneContext } from "@claude-engine/renderer-three";
import { LOOK } from "./look-lock.js";
import type { Candidate, DocumentComp, Mess, Pos, Prop, Yaw } from "../sim/components.js";
import { syncCharacter } from "./characters.js";

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
      const object = ctx.objectFor(entity, () => {
        const geometry = new THREE.BoxGeometry(MESS_SIZE_M, MESS_SIZE_M * 0.5, MESS_SIZE_M);
        // H2b: the PS1 material, same factory as the level (see
        // render/look-lock.ts). Untextured, so only the vertex jitter
        // compiles in.
        const material = createRetroMaterial({ vertexColors: false, look: LOOK }) as THREE.MeshLambertMaterial;
        material.color = hashedColor(`mess:${mess.kind}`, 0.4, 0.3);
        const meshObject = new THREE.Mesh(geometry, material);
        // A quarter-turn per kind, so a room full of them does not read as
        // a grid of identical boxes.
        meshObject.rotation.y = ((hashString(mess.kind) % 4) * Math.PI) / 4;
        return meshObject;
      });
      object.position.set(pos.xMm / 1000, MESS_SIZE_M * 0.25, pos.zMm / 1000);
      registerOnce(entity, object, registerInteractable, registered);
      continue;
    }

    // -- props: standing furniture, visibly broken and visibly mending ---
    const prop = world.getComponent<Prop>(entity, "prop");
    if (prop && pos) {
      live.add(entity);
      const object = ctx.objectFor(entity, () => {
        const geometry = new THREE.BoxGeometry(PROP_W_M, PROP_H_M, PROP_W_M * 0.6);
        const material = createRetroMaterial({ vertexColors: false, look: LOOK }) as THREE.MeshLambertMaterial;
        material.color = hashedColor(`prop:${prop.kind}`, 0.3, 0.4);
        return new THREE.Mesh(geometry, material);
      });
      object.position.set(pos.xMm / 1000, PROP_H_M / 2, pos.zMm / 1000);
      // "Visible dirt-reveal progress" applied to repair, in its cheapest
      // honest form: a broken prop leans, and each repair press stands it
      // back up. The player can read progress off the object rather than
      // off a meter, which is the H2 spec's §9 requirement; H2b makes it
      // pretty.
      const brokenLean = prop.broken ? 0.45 : 0;
      const mended = prop.broken && prop.repairProgress > 0 ? prop.repairProgress / 3 : 0;
      object.rotation.z = brokenLean * (1 - Math.min(1, mended));
      const mesh = object as THREE.Mesh;
      const material = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (material && "emissive" in material) {
        material.emissive.setRGB(prop.broken ? 0.25 : 0, 0, 0);
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
        const material = createRetroMaterial({ vertexColors: false, look: LOOK }) as THREE.MeshLambertMaterial;
        material.color = new THREE.Color(0xf2ead6);
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
