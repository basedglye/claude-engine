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
} from "./sim/game.js";
import type { Guest } from "./sim/components.js";
import { syncCharacter, pruneCharacters } from "./render/characters.js";
import { syncHeldDocuments, pruneHeldDocuments } from "./render/documents.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/hotel: missing #app canvas in index.html");

// Seed must match scenarios/fps-look-interact.scenario.mjs's declared seed
// (docs/PHASE-H0.md exit criterion 1: "seed hotel-h0-look-1"). A browser
// scenario's --verify-replay reconstructs a fresh `Sim` from the scenario's
// `seed` field (packages/harness/src/index.ts's `verifyReplay`), and
// GroundFloor geometry/spawn/doors are a pure function of the seed
// (determinism rule 5) -- if this literal ever drifts from the live app's
// seed, headless replay diverges from the browser session on the very
// first tick (different spawn point, different door layout), independent
// of any command-log or trig determinism issue.
const sim = new Sim("hotel-h0-look-1", { eventRetentionTicks: 600 });
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

// Opt-in start barrier (phase-H0 round-2 review, blocking item 1): only
// present when the harness navigates here with ?worldforgeStartPaused=1,
// which it only does for scenarios with tick-gated input steps
// (packages/harness/src/browser.ts). Every other caller of this page
// (production, demo-visual, demo-walk, a plain browser visit) gets
// startPaused: false, hook.startBarrier stays undefined, and tickSim below
// behaves exactly as it always has.
const startPaused = new URLSearchParams(window.location.search).has("worldforgeStartPaused");

const hook = installTestHook({
  world: sim,
  submit: (command) => sim.submit(command),
  app: "@claude-engine/hotel",
  pointer: controller.syntheticPointer,
  tickTimings: () => tickTimings,
  startPaused,
});

// -- Per-tick timing, recorded for the sim-tick-ms probe / tickTimings(). --
const tickTimings: number[] = [];
const MAX_TICK_TIMINGS = 600;

/** Wraps sim.step(): calls controller.onTick(world, submit) immediately
 *  before stepping (per docs/PHASE-H0.md host module wiring), then records
 *  the tick's wall-clock duration for tickTimings()/the sim-tick-ms probe. */
function tickSim(): void {
  // Honour the start barrier: while it exists and hasn't been released,
  // the sim takes zero steps — world.tick stays genuinely 0, so a
  // harness `downAtTick: 0` step fires at the real tick 0 on every engine
  // instead of racing page-load latency (phase-H0 round-2 review item 1).
  // The host loop's fixed-tick accumulator (packages/renderer-three/src/
  // host-loop.ts) keeps draining normally either way -- returning here
  // early just means each drained tick did no work, so there is no
  // spiral-of-death and no special-casing needed in the host loop itself.
  if (hook.startBarrier && !hook.startBarrier.released) return;
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

// A presenting-eligible guest (queue head) has no `interactable` component
// (interactSystem handles it via the `guest` component directly, see
// docs/PHASE-H1.md's interactSystem widening) but the player-fps click
// pipeline still raycasts against explicitly *registered* interactable
// objects (packages/player-fps) -- so guest rigs must be registered the
// same way door meshes are, or a queue-head guest could never be clicked
// to trigger "presenting". Registered once per entity (guarded by this
// Set), the same create-once discipline as objectFor itself.
const registeredGuestInteractables = new Set<EntityId>();


const host = createThreeHost(sim, {
  canvas,
  stepSim: tickSim,
  submit: (command) => hook.submit(command),
  pointerHandlers: controller.pointerHandlers,
  onFrame: controller.onFrame,
  syncScene(ctx: SceneContext, world: IWorld, alpha: number) {
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

    // -- guest characters: articulated Object3D limb rigs, interpolated
    //    exactly like the player (prevPos/pos, prevYaw/yaw + alpha), posed
    //    from guest.state + this frame's actual displacement. See
    //    render/characters.ts (apps/hotel/docs/ARCHITECTURE.md B6). --
    const liveGuests = new Set<EntityId>();
    for (const entity of world.entities()) {
      const guest = world.getComponent<Guest>(entity, "guest");
      if (!guest) continue;
      const pos = world.getComponent<Pos>(entity, "pos");
      const prevPos = world.getComponent<Pos>(entity, "prevPos");
      const yaw = world.getComponent<Yaw>(entity, "yaw");
      const prevYaw = world.getComponent<Yaw>(entity, "prevYaw");
      if (!pos || !prevPos || !yaw || !prevYaw) continue;
      liveGuests.add(entity);
      const rigRoot = syncCharacter(ctx, entity, guest, pos, prevPos, yaw, prevYaw, alpha);
      if (rigRoot && !registeredGuestInteractables.has(entity)) {
        controller.registerInteractable(entity, rigRoot);
        registeredGuestInteractables.add(entity);
      }
    }
    pruneCharacters(liveGuests);

    // -- held-document view: docs/PHASE-H1.md "Held-item inspect". --
    syncHeldDocuments(ctx, world, ctx.camera, PLAYER_ENTITY);
    pruneHeldDocuments(world, PLAYER_ENTITY);
  },
});

window.addEventListener("beforeunload", () => host.stop());
