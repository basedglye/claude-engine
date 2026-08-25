import * as THREE from "three";
import { Sim, type EntityId, type IWorld } from "@claude-engine/core";
import { createThreeHost, installTestHook, type SceneContext } from "@claude-engine/renderer-three";
import { toBufferGeometry } from "@claude-engine/assets/web";
import { generateDoorMesh, type GroundFloor, type DoorSpec } from "@claude-engine/interiors";
import { createFpsController } from "@claude-engine/player-fps";
import {
  setup,
  loadGroundFloor,
  faceCommand,
  moveCommand,
  interactCommand,
  PLAYER_ENTITY,
  PLAYER_ACTOR,
  type Pos,
  type Yaw,
  type Door,
} from "./game.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/hotel: missing #app canvas in index.html");

const sim = new Sim("hotel-h0-1", { eventRetentionTicks: 600 });
setup(sim);

// Re-derive the same pure GroundFloor from the seed for meshes. Deliberately
// NOT reusing a game.ts closure across the module boundary — main.ts calls
// the same pure function independently, exactly as game.ts does inside
// setup() (docs/PHASE-H0.md determinism rule 5).
const floor: GroundFloor = loadGroundFloor(sim.seed);
const doorSpecByIndex = new Map<number, DoorSpec>(floor.doors.map((d) => [d.doorIndex, d]));

const controller = createFpsController({
  actor: PLAYER_ACTOR,
  playerEntity: PLAYER_ENTITY,
  readPose(world: IWorld) {
    const pos = world.getComponent<Pos>(PLAYER_ENTITY, "pos");
    const yaw = world.getComponent<Yaw>(PLAYER_ENTITY, "yaw");
    if (!pos || !yaw) return undefined;
    return { xMm: pos.xMm, zMm: pos.zMm, yawMdeg: yaw.mdeg };
  },
  makeFace: (tick, yawMdeg) => faceCommand(tick, yawMdeg),
  makeMove: (tick, forwardMilli, strafeMilli) => moveCommand(tick, forwardMilli, strafeMilli),
  makeInteract: (tick, target) => interactCommand(tick, target),
});

const hook = installTestHook({
  world: sim,
  submit: (command) => sim.submit(command),
  app: "@claude-engine/hotel",
  pointer: controller.syntheticPointer,
  tickTimings: () => tickTimings,
});

// -- Per-tick timing, recorded for the sim-tick-ms probe / tickTimings(). --
const tickTimings: number[] = [];
const MAX_TICK_TIMINGS = 600;

/** Wraps sim.step(): calls controller.onTick(world, submit) immediately
 *  before stepping (per docs/PHASE-H0.md host module wiring), then records
 *  the tick's wall-clock duration for tickTimings()/the sim-tick-ms probe. */
function tickSim(): void {
  controller.onTick(sim, (command) => hook.submit(command));
  const start = performance.now();
  sim.step();
  const elapsedMs = performance.now() - start;
  tickTimings.push(elapsedMs);
  if (tickTimings.length > MAX_TICK_TIMINGS) tickTimings.shift();
}

// Door meshes: a THREE.Group per door entity, pivoted at the door's hinge so
// flipping door.open visibly swings the panel (legible on a screenshot per
// docs/PHASE-H0.md exit criterion 1). Rebuilt lazily; found each frame by
// scanning entities()+getComponent (IWorld exposes no withComponent — only
// Sim does), never cached against a doorIndex assumed stable across restore.
const doorGroups = new Map<EntityId, THREE.Group>();
const DOOR_SWING_OPEN_RAD = Math.PI / 2;

const host = createThreeHost(sim, {
  canvas,
  stepSim: tickSim,
  submit: (command) => hook.submit(command),
  pointerHandlers: controller.pointerHandlers,
  onFrame: (camera, world, alpha) => controller.onFrame(camera, world, alpha),
  syncScene(ctx: SceneContext, world: IWorld) {
    ctx.scenery("floor-mesh", () => {
      const geometry = toBufferGeometry(floor.mesh);
      const material = new THREE.MeshStandardMaterial({ vertexColors: true });
      return new THREE.Mesh(geometry, material);
    });

    for (const entity of world.entities()) {
      const door = world.getComponent<Door>(entity, "door");
      if (!door) continue;
      const spec = doorSpecByIndex.get(door.doorIndex);
      if (!spec) continue;

      let group = doorGroups.get(entity);
      if (!group) {
        const doorMesh = generateDoorMesh(spec);
        const geometry = toBufferGeometry(doorMesh);
        const material = new THREE.MeshStandardMaterial({ vertexColors: true });
        const mesh = new THREE.Mesh(geometry, material);
        // generateDoorMesh already positions the panel in world space
        // (docs/PHASE-H0.md's door mesh is centered on the door cell), so
        // pivot the group at the door center and offset the mesh by the
        // inverse to rotate around that hinge point rather than the scene
        // origin.
        group = new THREE.Group();
        group.position.set(spec.xMm / 1000, 0, spec.zMm / 1000);
        mesh.position.set(-spec.xMm / 1000, 0, -spec.zMm / 1000);
        group.add(mesh);
        doorGroups.set(entity, group);
        ctx.scene.add(group);
        controller.registerInteractable(entity, group);
      }
      group.rotation.y = door.open ? DOOR_SWING_OPEN_RAD : 0;
    }
  },
});

window.addEventListener("beforeunload", () => host.stop());
