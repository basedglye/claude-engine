/**
 * Host-side terminal screen wiring (docs/PHASE-H1.md, "The screen contract,
 * consolidated" + "Host (main.ts) additions"). Presentation-only: reads
 * `terminal`/`screenApp`/`pos`/`yaw` via `IWorld`, never writes sim state
 * except through the actor-bound `screen.*`/`screen.blur` commands main.ts
 * submits in response to real input.
 *
 * One `createScreenSurface()` per terminal entity (H1 ships exactly one
 * terminal, but this is written per-entity so a second terminal is not a
 * rewrite). The quad's `CanvasTexture` is repainted only on `paintSeq`
 * change (`surface.sync`'s own dirty check) using the SAME exported pure
 * `buildScreenWorldView` + `hotelShell.paintSpec` that `screenSystem` uses
 * sim-side — two view-builders that can disagree is the bug.
 */
import * as THREE from "three";
import type { EntityId, IWorld } from "@claude-engine/core";
import type { SceneContext } from "@claude-engine/renderer-three";
import { SCREEN_H, SCREEN_W } from "@claude-engine/surface-ui";
import { createScreenSurface } from "@claude-engine/surface-ui/host";
import { hotelShell, buildScreenWorldView, type Terminal, type ScreenApp, type Pos, type Yaw } from "../sim/game.js";

export const SCREEN_W_M = 0.55;
export const SCREEN_H_M = SCREEN_W_M * (SCREEN_H / SCREEN_W);
/** Mounted above the desk surface at roughly monitor height. */
const SCREEN_Y_M = 1.15;
/** How far the screen plane sits in front of the housing's back panel —
 *  keeps it from z-fighting with the box behind it. */
const SCREEN_Z_OFFSET_M = 0.051;

/** The monitor housing: a beige 90s CRT body around the screen plane so it
 *  reads as a physical terminal rather than a floating texture (H1b
 *  review: "no monitor body"). Sized a bit larger than the screen plane on
 *  every side (a bezel), with a deeper tapering back and a small stand.
 *  Presentation only -- no sim meaning, just geometry. The bezel frame is
 *  built as four slabs AROUND the screen opening (never a solid plate in
 *  front of it) and its front face sits behind SCREEN_Z_OFFSET_M so it can
 *  never occlude the screen plane the readability gate measures. */
const HOUSING_BEZEL_M = 0.05;
const HOUSING_W_M = SCREEN_W_M + HOUSING_BEZEL_M * 2;
const HOUSING_H_M = SCREEN_H_M + HOUSING_BEZEL_M * 2;
const HOUSING_DEPTH_M = 0.1;
const CRT_BEIGE = 0xd9d2bd;

export interface TerminalScreen {
  entity: EntityId;
  /** The whole prop (housing + screen plane) -- what focus/click raycasts
   *  register against and what the housing-relative screen plane is a
   *  child of, so repositioning the group moves both together. */
  group: THREE.Group;
  /** The textured screen plane specifically -- what main.ts raycasts for
   *  `uvToPixel` and what the camera-ease points the camera at. */
  screenMesh: THREE.Mesh;
  surface: ReturnType<typeof createScreenSurface>;
}

const screensByEntity = new Map<EntityId, TerminalScreen>();

/** Beige plastic bezel frame AROUND the screen opening: four slabs (top,
 *  bottom, left, right) rather than one plate, so nothing ever sits in
 *  front of the screen plane's face -- only around it. Sits flush with the
 *  housing's front (z = -HOUSING_DEPTH_M/2 + small), well behind
 *  SCREEN_Z_OFFSET_M. */
function buildBezel(): THREE.Group {
  const g = new THREE.Group();
  const bezelMat = new THREE.MeshStandardMaterial({ color: CRT_BEIGE, roughness: 0.55 });
  // In FRONT of the housing's face (+z is the side the player and the
  // screen plane are on), as a frame around the screen opening. The first
  // cut put this at -z (inside the casing) and the tapering back at +z, so
  // the casing sat in front of the screen and the readability gate went
  // red (calibContrast 0.02).
  const frontZ = HOUSING_DEPTH_M / 2 + 0.015;
  const thick = 0.03;
  const top = new THREE.Mesh(new THREE.BoxGeometry(HOUSING_W_M, HOUSING_BEZEL_M, thick), bezelMat);
  top.position.set(0, HOUSING_H_M / 2 - HOUSING_BEZEL_M / 2, frontZ);
  const bottom = top.clone();
  bottom.position.y = -(HOUSING_H_M / 2 - HOUSING_BEZEL_M / 2);
  const left = new THREE.Mesh(new THREE.BoxGeometry(HOUSING_BEZEL_M, SCREEN_H_M, thick), bezelMat);
  left.position.set(-(HOUSING_W_M / 2 - HOUSING_BEZEL_M / 2), 0, frontZ);
  const right = left.clone();
  right.position.x = HOUSING_W_M / 2 - HOUSING_BEZEL_M / 2;
  g.add(top, bottom, left, right);

  // Power LED, bottom-right of the bezel.
  const led = new THREE.Mesh(
    new THREE.CircleGeometry(0.006, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e7d32, emissive: 0x39d353, emissiveIntensity: 1.2 })
  );
  led.position.set(HOUSING_W_M / 2 - HOUSING_BEZEL_M * 1.5, -(HOUSING_H_M / 2 - HOUSING_BEZEL_M / 2), frontZ + thick / 2 + 0.001);
  g.add(led);
  return g;
}

/** A cheap beige keyboard slab + a small mouse, sitting on the desk
 *  surface (y = 1.0m, per the lane brief) in front of the monitor. Local
 *  to the terminal group so it eases/moves with the monitor as a unit. */
function buildKeyboardAndMouse(deskTopY: number, groupY: number): THREE.Group {
  const g = new THREE.Group();
  const plasticMat = new THREE.MeshStandardMaterial({ color: CRT_BEIGE, roughness: 0.6 });
  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.12), plasticMat);
  keyboard.position.set(0, deskTopY - groupY, HOUSING_DEPTH_M / 2 + 0.14);
  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.08), plasticMat);
  mouse.position.set(0.22, deskTopY - groupY, HOUSING_DEPTH_M / 2 + 0.14);
  g.add(keyboard, mouse);
  return g;
}

function createTerminalGroup(surface: ReturnType<typeof createScreenSurface>): { group: THREE.Group; screenMesh: THREE.Mesh } {
  const group = new THREE.Group();

  // Deeper, gently tapering back casing (two stacked boxes reading as a
  // CRT's characteristic bulge) instead of a plain slab.
  const bodyMat = new THREE.MeshStandardMaterial({ color: CRT_BEIGE, roughness: 0.6 });
  const frontHousing = new THREE.Mesh(new THREE.BoxGeometry(HOUSING_W_M, HOUSING_H_M, HOUSING_DEPTH_M), bodyMat);
  group.add(frontHousing);
  const back = new THREE.Mesh(new THREE.BoxGeometry(HOUSING_W_M * 0.7, HOUSING_H_M * 0.7, HOUSING_DEPTH_M * 1.6), bodyMat);
  back.position.z = -(HOUSING_DEPTH_M / 2 + (HOUSING_DEPTH_M * 1.6) / 2 - 0.01);
  group.add(back);

  const bezel = buildBezel();
  group.add(bezel);

  // Small stand/base under the monitor.
  const stand = new THREE.Mesh(new THREE.BoxGeometry(HOUSING_W_M * 0.5, 0.03, HOUSING_DEPTH_M * 1.2), bodyMat);
  stand.position.y = -HOUSING_H_M / 2 - 0.015;
  group.add(stand);

  // Keyboard + mouse on the desk surface in front of the monitor. Desk top
  // sits at 1.0m (another lane's table); SCREEN_Y_M is the monitor mount
  // height, so offset relative to that.
  group.add(buildKeyboardAndMouse(1.0, SCREEN_Y_M));

  // Double-sided: the terminal's `interactable` has no fixed frontal arc
  // (interactSystem checks the ACTOR's facing, not a preferred side on the
  // interactable itself -- see components.ts's Interactable), so a player
  // may legitimately walk up from either side of the desk. A single-sided
  // plane read as blank/invisible from the "wrong" side even when the
  // orientation math was correct for the OTHER side (H1b review finding).
  const screenGeometry = new THREE.PlaneGeometry(SCREEN_W_M, SCREEN_H_M);
  const screenMaterial = new THREE.MeshBasicMaterial({ map: surface.texture, side: THREE.DoubleSide });
  const screenMesh = new THREE.Mesh(screenGeometry, screenMaterial);
  screenMesh.position.set(0, 0, SCREEN_Z_OFFSET_M);
  group.add(screenMesh);

  return { group, screenMesh };
}

/**
 * Finds the (currently singular) terminal entity, creates/positions its
 * screen quad on first sight (registering it as an FPS-click interactable
 * exactly like door/guest props so `interact` can focus it), repaints it
 * when `screenApp.paintSeq` changed, and returns the live registry so
 * main.ts's focus/input routing can find the quad and its `uvToPixel`.
 */
export function syncTerminalScreens(
  ctx: SceneContext,
  world: IWorld,
  registerInteractable: (entity: EntityId, object: THREE.Object3D) => void
): Map<EntityId, TerminalScreen> {
  for (const entity of world.entities()) {
    const terminalComp = world.getComponent<Terminal>(entity, "terminal");
    if (!terminalComp) continue;
    const screenApp = world.getComponent<ScreenApp>(entity, "screenApp");
    const pos = world.getComponent<Pos>(entity, "pos");
    const yaw = world.getComponent<Yaw>(entity, "yaw");
    if (!screenApp || !pos || !yaw) continue;

    let screen = screensByEntity.get(entity);
    if (!screen) {
      const surface = createScreenSurface();
      const { group, screenMesh } = createTerminalGroup(surface);
      group.position.set(pos.xMm / 1000, SCREEN_Y_M, pos.zMm / 1000);
      // `terminal.yaw` (== floor.desk.yawMdeg) is the DESK COUNTER's own
      // orientation, not the direction its monitor screen faces -- driving
      // the game and measuring an actual approach position showed the
      // naive `rotation.y = deskYaw` leaves the screen's wide face nearly
      // PARALLEL to the line a player walks up along (the housing reads as
      // a thin edge-on sliver from the practical standing spot), off by
      // ~90 degrees from where it needs to be to read face-on. Verified
      // empirically (H1b review round 2): player at world (3.783, 2.971),
      // terminal at (1.375, 3.125) -- the direction from terminal to
      // player is ~94 degrees in the sim's atan2(dx,dz) convention, while
      // `deskYaw` (180 degrees) mapped straight to `rotation.y` put the
      // screen's normal at 180 degrees, an ~86-degree miss. Rotating the
      // housing a further -PI/2 off the desk yaw lines the screen face up
      // with the desk's usable (counter-front) side instead of its
      // lengthwise axis.
      group.rotation.y = (yaw.mdeg / 1000) * (Math.PI / 180) - Math.PI / 2;
      ctx.scene.add(group);
      screen = { entity, group, screenMesh, surface };
      screensByEntity.set(entity, screen);
      registerInteractable(entity, group);
    }

    const view = buildScreenWorldView(world);
    screen.surface.sync(screenApp.paintSeq, hotelShell.paintSpec(screenApp.state, view));
  }
  return screensByEntity;
}
