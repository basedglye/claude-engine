/**
 * Lane 3 — visible light fixtures. Purely emissive geometry: fixtures never
 * light the scene themselves (see lighting.ts for the actual THREE.Light
 * rig). Host/presentation only, deterministic (grid-derived placement, no
 * Math.random).
 */
import * as THREE from "three";
import type { GroundFloor } from "@claude-engine/interiors";
import { roomRects, doorRects, ROOM, WALL_HEIGHT_M } from "./floorplan.js";
import { loadModel, fitToFootprint } from "./assets.js";

const BULB_COLOR = 0xffcf99;
const BRASS_COLOR = 0x8a6a3a;

function bulbMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: BULB_COLOR,
    emissive: BULB_COLOR,
    emissiveIntensity: 2,
    roughness: 0.4,
    metalness: 0,
  });
}

function brassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: BRASS_COLOR, roughness: 0.35, metalness: 0.8 });
}

/** Fallback chandelier: a brass ring + chain with 8 small emissive bulbs. */
function fallbackChandelier(): THREE.Group {
  const group = new THREE.Group();
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), brassMaterial());
  chain.position.y = 0.25;
  group.add(chain);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 24), brassMaterial());
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const bulbGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const mat = bulbMaterial();
  const bulbCount = 8;
  for (let i = 0; i < bulbCount; i++) {
    const t = i / bulbCount;
    const angle = t * Math.PI * 2;
    const bulb = new THREE.Mesh(bulbGeo, mat);
    bulb.position.set(Math.cos(angle) * 0.5, -0.05, Math.sin(angle) * 0.5);
    group.add(bulb);
  }
  return group;
}

/** Fallback wall sconce: a small brass bracket + emissive glass half-cylinder. */
function fallbackSconce(): THREE.Group {
  const group = new THREE.Group();
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), brassMaterial());
  group.add(bracket);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8, 1, false, 0, Math.PI), bulbMaterial());
  glass.rotation.z = Math.PI / 2;
  glass.position.x = 0.08;
  group.add(glass);
  return group;
}

/** Fallback bedroom ceiling lamp: a simple brass disc + emissive globe. */
function fallbackBedroomLamp(): THREE.Group {
  const group = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), brassMaterial());
  group.add(canopy);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), bulbMaterial());
  globe.position.y = -0.08;
  group.add(globe);
  return group;
}

function recessedDownlight(): THREE.Mesh {
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12), bulbMaterial());
  return disc;
}

/** True when a wall-mounted point at (x,z) along the given axis falls
 *  inside any door's span — used to keep sconces out of doorways. */
function insideAnyDoor(x: number, z: number, doors: ReturnType<typeof doorRects>, marginM = 0.3): boolean {
  return doors.some(
    (d) => x >= d.xM0 - marginM && x <= d.xM1 + marginM && z >= d.zM0 - marginM && z <= d.zM1 + marginM
  );
}

export function buildFixtures(floor: GroundFloor): THREE.Group {
  const group = new THREE.Group();
  group.name = "fixtures";

  const rects = roomRects(floor);
  const doors = doorRects(floor);

  // -- lobby chandelier --
  const lobby = rects.get(ROOM.LOBBY);
  if (lobby) {
    const chandelierGroup = new THREE.Group();
    chandelierGroup.position.set(lobby.centerXM, WALL_HEIGHT_M - 0.5, lobby.centerZM);
    chandelierGroup.add(fallbackChandelier());
    group.add(chandelierGroup);

    void loadModel("chandelier").then((model) => {
      if (!model) return;
      fitToFootprint(model.scene, { w: 1, d: 1, h: 0.8 });
      chandelierGroup.clear();
      chandelierGroup.add(model.scene);
    });

    // recessed downlights in a deterministic ~3m grid over the lobby
    addDownlightGrid(group, lobby.xM0, lobby.zM0, lobby.xM1, lobby.zM1);
  }

  // -- corridor: recessed downlights + wall sconces --
  const corridor = rects.get(ROOM.CORRIDOR);
  if (corridor) {
    addDownlightGrid(group, corridor.xM0, corridor.zM0, corridor.xM1, corridor.zM1);

    const alongX = corridor.widthM >= corridor.depthM;
    const spacingM = 3;
    const sconceY = 1.9;
    if (alongX) {
      const count = Math.max(1, Math.floor(corridor.widthM / spacingM));
      for (let i = 1; i <= count; i++) {
        const x = corridor.xM0 + (corridor.widthM * i) / (count + 1);
        addSconcePair(group, x, corridor.zM0, corridor.zM1, sconceY, doors, "x");
      }
    } else {
      const count = Math.max(1, Math.floor(corridor.depthM / spacingM));
      for (let i = 1; i <= count; i++) {
        const z = corridor.zM0 + (corridor.depthM * i) / (count + 1);
        addSconcePair(group, z, corridor.xM0, corridor.xM1, sconceY, doors, "z");
      }
    }
  }

  // -- bedroom ceiling lamps --
  for (const rect of rects.values()) {
    if (rect.kind !== "bedroom") continue;
    const lampGroup = new THREE.Group();
    lampGroup.position.set(rect.centerXM, WALL_HEIGHT_M - 0.15, rect.centerZM);
    lampGroup.add(fallbackBedroomLamp());
    group.add(lampGroup);
  }

  return group;
}

function addDownlightGrid(group: THREE.Group, xM0: number, zM0: number, xM1: number, zM1: number): void {
  const spacingM = 3;
  const widthM = xM1 - xM0;
  const depthM = zM1 - zM0;
  const nx = Math.max(1, Math.round(widthM / spacingM));
  const nz = Math.max(1, Math.round(depthM / spacingM));
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = xM0 + (widthM * (ix + 0.5)) / nx;
      const z = zM0 + (depthM * (iz + 0.5)) / nz;
      const disc = recessedDownlight();
      disc.position.set(x, WALL_HEIGHT_M - 0.02, z);
      group.add(disc);
    }
  }
}

/** Places a sconce on each of the two walls perpendicular to `crossAxis` at
 *  fixed coordinate `along`, spanning between `crossM0`/`crossM1`, skipping
 *  any position that falls inside a door span. */
function addSconcePair(
  group: THREE.Group,
  along: number,
  crossM0: number,
  crossM1: number,
  yM: number,
  doors: ReturnType<typeof doorRects>,
  axis: "x" | "z"
): void {
  const positions: Array<[number, number]> =
    axis === "x"
      ? [
          [along, crossM0 + 0.05],
          [along, crossM1 - 0.05],
        ]
      : [
          [crossM0 + 0.05, along],
          [crossM1 - 0.05, along],
        ];
  for (const [x, z] of positions) {
    if (insideAnyDoor(x, z, doors)) continue;
    const sconceGroup = new THREE.Group();
    sconceGroup.position.set(x, yM, z);
    sconceGroup.add(fallbackSconce());
    group.add(sconceGroup);

    void loadModel("wall-sconce").then((model) => {
      if (!model) return;
      fitToFootprint(model.scene, { w: 0.15, d: 0.1, h: 0.2 });
      sconceGroup.clear();
      sconceGroup.add(model.scene);
    });
  }
}
