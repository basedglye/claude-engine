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

/** The monitor housing: a plain dark box behind/around the screen plane so
 *  it reads as a physical terminal rather than a floating texture (H1b
 *  review: "no monitor body"). Sized a bit larger than the screen plane on
 *  every side (a bezel), with some depth for the "casing". Presentation
 *  only -- no sim meaning, just geometry. */
const HOUSING_BEZEL_M = 0.05;
/** How far the monitor stands off the desk anchor, along its own facing. */
const TERMINAL_STANDOFF_M = 0.45;
/**
 * How far the monitor sits along the desk from the anchor cell.
 *
 * Placed exactly on the anchor, the desk's own furniture geometry occludes
 * the far ~27% of the monitor: the screen rendered 643x662 against a 640x480
 * texture (aspect 0.97 where it should be 1.33), which reads as the right
 * side of the UI being cropped and cost a previous session a long hunt for a
 * texture-sampling bug that did not exist. Offsetting along the desk clears
 * it — measured, the screen then renders 884x662, aspect 1.335 against the
 * texture's 1.333, with texelScale 1.38 matching screenRect exactly.
 */
const TERMINAL_ALONG_DESK_M = 0.35;
const HOUSING_W_M = SCREEN_W_M + HOUSING_BEZEL_M * 2;
const HOUSING_H_M = SCREEN_H_M + HOUSING_BEZEL_M * 2;
const HOUSING_DEPTH_M = 0.1;

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

function createTerminalGroup(surface: ReturnType<typeof createScreenSurface>): { group: THREE.Group; screenMesh: THREE.Mesh } {
  const group = new THREE.Group();

  const housingGeometry = new THREE.BoxGeometry(HOUSING_W_M, HOUSING_H_M, HOUSING_DEPTH_M);
  const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b2e });
  const housing = new THREE.Mesh(housingGeometry, housingMaterial);
  group.add(housing);

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
      // Stand the monitor off the desk anchor along its own facing. The
      // anchor sits against the lobby's west wall, and a monitor placed
      // exactly on it has its far half buried in that wall — which reads as
      // the screen being cropped by a hard vertical edge, because the wall
      // is drawn in front of the half that is inside it. Offsetting along
      // the group's local forward puts the whole panel in the room.
      group.translateZ(-TERMINAL_STANDOFF_M);
      group.translateX(TERMINAL_ALONG_DESK_M);
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
