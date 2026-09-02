// Unit tests for @claude-engine/player-fps, run against the built dist/
// (npm run test -w @claude-engine/player-fps builds first). Hand-rolled
// assert-and-exit script, matching packages/interiors/scripts/test.mjs and
// packages/space/scripts/test.mjs style rather than pulling in a test
// runner or a DOM/jsdom dependency this package doesn't otherwise need.
import * as THREE from "three";

// This package's real DOM-facing listeners are installed only when
// `window` exists (see src/index.ts: `if (typeof window !== "undefined")`).
// Headless Node has no window, so install a minimal stand-in BEFORE
// importing dist/index.js, capturing the keydown/keyup handlers it
// registers -- that's the only way this test can drive the `V` third-
// person toggle, since createFpsController exposes no toggle API of its
// own (the toggle is deliberately owned by real/synthetic keyboard input
// only, matching every other input path in this controller).
const listeners = {};
globalThis.window = {
  addEventListener(type, fn) {
    listeners[type] = fn;
  },
  removeEventListener() {},
};

const { createFpsController } = await import("../dist/index.js");

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

function pressKey(code) {
  listeners["keydown"]({ code, repeat: false });
}

// Minimal mock IWorld: a fixed player pose, no prevPos/prevYaw component
// (so onFrame's interpolation is skipped and alpha doesn't matter), no
// entities/events needed by anything under test here.
function makeWorld(poseMm) {
  return {
    tick: 0,
    seed: "test",
    stateHash: () => 0,
    entities: () => [],
    getComponent: () => undefined,
    eventsSince: () => [],
    _pose: poseMm,
  };
}

const PLAYER_ENTITY = 1;

function makeController(boomClip) {
  return createFpsController({
    actor: "player",
    playerEntity: PLAYER_ENTITY,
    readPose: (world) => world._pose,
    makeFace: (tick, yawMdeg) => ({ tick, kind: "face", yawMdeg }),
    makeMove: (tick, f, s) => ({ tick, kind: "move", f, s }),
    makeInteract: (tick, target) => ({ tick, kind: "interact", target }),
    thirdPersonBoomM: 3.5,
    boomClip,
  });
}

// ---------------------------------------------------------------------
// Boom clip: unoccluded vs. clamped-by-occlusion must land at materially
// different camera positions, and the clamped case must respect the skin
// pull-in and the minimum-distance floor.
// ---------------------------------------------------------------------
{
  // Player at origin, facing sim yaw 0 (sim forward at yaw 0 is +Z, per
  // src/index.ts's rotation-matching comment).
  const world = makeWorld({ xMm: 0, zMm: 0, yawMdeg: 0 });

  // -- Unoccluded: boomClip reports the full naive distance is clear. --
  const unoccluded = makeController((fromX, fromZ, toX, toZ) => {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    return Math.sqrt(dx * dx + dz * dz); // no occluder: full distance clear
  });
  pressKey("KeyV"); // toggle into third-person on this controller instance
  const camA = new THREE.PerspectiveCamera();
  unoccluded.onFrame(camA, world, 0);

  // -- Occluded: boomClip reports a wall 1.2m out along the boom ray. --
  const OCCLUDED_HIT_M = 1.2;
  const clamped = makeController(() => OCCLUDED_HIT_M);
  pressKey("KeyV");
  const camB = new THREE.PerspectiveCamera();
  clamped.onFrame(camB, world, 0);

  console.log(
    `  unclamped boom camera position: (${camA.position.x.toFixed(3)}, ${camA.position.z.toFixed(3)})`
  );
  console.log(
    `  clamped boom camera position:   (${camB.position.x.toFixed(3)}, ${camB.position.z.toFixed(3)})`
  );

  const distA = Math.hypot(camA.position.x, camA.position.z);
  const distB = Math.hypot(camB.position.x, camB.position.z);

  check("boomClip absent-equivalent (fully clear): boom sits at the full 3.5m distance", Math.abs(distA - 3.5) < 1e-6);

  const BOOM_SKIN_M = 0.05;
  const expectedClamped = OCCLUDED_HIT_M - BOOM_SKIN_M;
  check(
    `boomClip occluded at ${OCCLUDED_HIT_M}m: boom pulls in to hit - skin (${expectedClamped}m)`,
    Math.abs(distB - expectedClamped) < 1e-6
  );

  // Non-vacuity: the two cases must land in materially different places.
  check(
    "non-vacuous: unclamped and clamped boom positions differ materially (>0.5m)",
    Math.abs(distA - distB) > 0.5
  );

  // Minimum-distance floor: an occluder essentially on top of the player
  // must not collapse the boom into/through the player's own head.
  const BOOM_MIN_DISTANCE_M = 0.3;
  const rightAtPlayer = makeController(() => 0.01);
  pressKey("KeyV");
  const camC = new THREE.PerspectiveCamera();
  rightAtPlayer.onFrame(camC, world, 0);
  const distC = Math.hypot(camC.position.x, camC.position.z);
  check(
    `boomClip occluder nearly on the player: boom floors at BOOM_MIN_DISTANCE_M (${BOOM_MIN_DISTANCE_M}m), got ${distC.toFixed(3)}m`,
    Math.abs(distC - BOOM_MIN_DISTANCE_M) < 1e-6
  );
}

// ---------------------------------------------------------------------
// registerInteractable reverse-map prune (H1b deferral row 2): re-
// registering an entity with a different object must drop the OLD
// object's reverse (objectToEntity) entry, not just overwrite the
// entity->object forward entry. resolveTarget() only ever raycasts
// against `interactables.values()` (the CURRENT forward entries), so a
// stale reverse entry is invisible to a raycast against a standalone
// object -- it can only resolve a hit if the stale object gets reached
// via recursive descendant traversal of a DIFFERENT, still-registered
// object (e.g. the stale mesh got reparented under a new container that
// is itself registered to a new entity -- exactly what object reuse /
// pooling does). That is the concrete, observable failure mode the H1b
// deferral names ("can resolve a raycast hit on a disposed object to a
// live entity"), so the test reproduces it via currentTarget() with a
// real THREE.Raycaster rather than reaching into private module state.
// ---------------------------------------------------------------------
{
  const world = makeWorld({ xMm: 0, zMm: 0, yawMdeg: 0 });
  const controller = createFpsController({
    actor: "player",
    playerEntity: PLAYER_ENTITY,
    readPose: (w) => w._pose,
    makeFace: (tick, yawMdeg) => ({ tick, kind: "face", yawMdeg }),
    makeMove: (tick, f, s) => ({ tick, kind: "move", f, s }),
    makeInteract: (tick, target) => ({ tick, kind: "interact", target }),
  });

  const STALE_ENTITY = 1; // originally owned objA
  const REASSIGNED_ENTITY_OBJECT = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); // entity 1's new object
  REASSIGNED_ENTITY_OBJECT.position.set(100, 0, 0); // well off to the side of the raycast below
  const NEW_ENTITY = 2; // will own a container that objA gets reparented into
  const objA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); // the "disposed" stale object

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, 10);
  // onFrame needs to run once (with thirdPerson off) so resolveTarget has a
  // raycastCamera at all; it places the camera at the player pose, so aim
  // it explicitly afterward for the raycasts below.
  controller.onFrame(camera, world, 0);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, 10);

  // 1. entity 1 -> objA.
  controller.registerInteractable(STALE_ENTITY, objA);

  // 2. Reassign entity 1 to a different object. Without the fix, objA
  // stays in objectToEntity pointing at entity 1 even though objA is no
  // longer entity 1's registered object.
  controller.registerInteractable(STALE_ENTITY, REASSIGNED_ENTITY_OBJECT);

  // 3. Reparent the now-stale objA as a CHILD of a brand-new container,
  // and register that container to a different entity -- the object-reuse
  // scenario that makes the stale reverse entry reachable again via
  // recursive raycasting.
  const container = new THREE.Group();
  container.add(objA);
  objA.position.set(0, 0, 0); // local to container
  container.position.set(0, 1.6, 5); // directly ahead, in view
  controller.registerInteractable(NEW_ENTITY, container);

  // No renderer is driving a render loop here, so matrixWorld is never
  // recomputed automatically -- do it explicitly before raycasting
  // (THREE.Raycaster reads matrixWorld directly), matching what a real
  // frame's render() call would have done for us.
  camera.updateMatrixWorld(true);
  REASSIGNED_ENTITY_OBJECT.updateMatrixWorld(true);
  container.updateMatrixWorld(true);

  const target = controller.currentTarget();
  check(
    "reverse-map prune: a hit on a reparented, previously-stale object resolves to its NEW owner, not the old entity it was unregistered from",
    target === NEW_ENTITY
  );
  check(
    "reverse-map prune: the stale entry does not still resolve to the old entity it was unregistered from",
    target !== STALE_ENTITY
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
