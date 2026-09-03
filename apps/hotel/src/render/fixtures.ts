/**
 * Lane 3 — visible light fixtures. Purely emissive geometry: fixtures never
 * light the scene themselves (see lighting.ts for the actual THREE.Light
 * rig). Host/presentation only, deterministic (grid-derived placement, no
 * Math.random).
 */
import * as THREE from "three";
import type { GroundFloor } from "@claude-engine/interiors";
import { roomRects, ROOM, WALL_HEIGHT_M } from "./floorplan.js";
import { loadModel, fitToFootprint } from "./assets.js";
import { roomOccupancyFor, placeOnWallSurface, type WallSide } from "./placement.js";
import type { HotelTier } from "./procedural.js";

export type { HotelTier };

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

const TUBE_COLOR = 0xe8f0ff;
function tubeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: TUBE_COLOR, emissive: TUBE_COLOR, emissiveIntensity: 1.6, roughness: 0.5 });
}
function sheetMetalMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xb8b4a8, roughness: 0.6, metalness: 0.4 });
}

/** Tier-0 fluorescent tube fixture: two thin emissive boxes in a shallow
 *  sheet-metal trough. Named "fixture-fluoro" so `lighting.ts`'s flicker
 *  target (the lobby) can be identified by name if ever needed; the
 *  actual flicker is driven by `lighting.ts`'s light rig, not here --
 *  fixtures are purely emissive geometry (never a THREE.Light). */
function fallbackFluorescentTrough(widthM: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "fixture-fluoro";
  const trough = new THREE.Mesh(new THREE.BoxGeometry(widthM, 0.05, 0.3), sheetMetalMaterial());
  trough.position.y = -0.02;
  g.add(trough);
  const tube = tubeMaterial();
  for (const dz of [-0.08, 0.08]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, widthM - 0.1, 8), tube);
    t.rotation.z = Math.PI / 2;
    t.position.set(0, -0.03, dz);
    g.add(t);
  }
  return g;
}

/** Tier-0 bedroom fixture: a bare pull-chain bulb on a short cord. */
function fallbackBareBulb(): THREE.Group {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), sheetMetalMaterial());
  g.add(canopy);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  cord.position.y = -0.06;
  g.add(cord);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), bulbMaterial());
  bulb.position.y = -0.13;
  g.add(bulb);
  return g;
}

export function buildFixtures(floor: GroundFloor, hotelTier: HotelTier): THREE.Group {
  const group = new THREE.Group();
  group.name = "fixtures";

  const rects = roomRects(floor);

  // -- lobby: chandelier (tier 2), recessed cans (tier 1), fluorescent
  //    trough (tier 0) --
  const lobby = rects.get(ROOM.LOBBY);
  if (lobby) {
    if (hotelTier === 2) {
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
    } else if (hotelTier === 1) {
      addDownlightGrid(group, lobby.xM0, lobby.zM0, lobby.xM1, lobby.zM1);
    } else {
      // Tier 0: fluorescent troughs in a ~2.5m grid, in place of the
      // chandelier -- this is the fixture the lobby's lighting flicker
      // (lighting.ts) reads as "the broken one".
      const spacingM = 2.5;
      const nx = Math.max(1, Math.round(lobby.widthM / spacingM));
      const nz = Math.max(1, Math.round(lobby.depthM / spacingM));
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const x = lobby.xM0 + (lobby.widthM * (ix + 0.5)) / nx;
          const z = lobby.zM0 + (lobby.depthM * (iz + 0.5)) / nz;
          const trough = fallbackFluorescentTrough(1.2);
          trough.position.set(x, WALL_HEIGHT_M - 0.03, z);
          group.add(trough);
        }
      }
    }
  }

  // -- corridor: recessed downlights + wall sconces (tier 1/2), a single
  //    fluorescent trough down the middle (tier 0) --
  const corridor = rects.get(ROOM.CORRIDOR);
  if (corridor) {
    if (hotelTier === 0) {
      const alongX0 = corridor.widthM >= corridor.depthM;
      const trough = fallbackFluorescentTrough(Math.min(2.4, alongX0 ? corridor.widthM * 0.8 : corridor.depthM * 0.8));
      if (!alongX0) trough.rotation.y = Math.PI / 2;
      trough.position.set(corridor.centerXM, WALL_HEIGHT_M - 0.03, corridor.centerZM);
      group.add(trough);
    } else {
      addDownlightGrid(group, corridor.xM0, corridor.zM0, corridor.xM1, corridor.zM1);

      // Sconces routed through the SAME shared placement solver/occupancy
      // grid decor.ts uses for paintings (`roomOccupancyFor` -- see
      // placement.ts), rather than a fixed 3m stepping loop that never
      // consulted anything. `clearanceM=0.6` keeps a sconce at least 0.6m
      // from any painting span already blocked on this wall's channel
      // (COO review W3-1). sconceY stays 2.15 -- above the 1.5m painting
      // line -- as a belt-and-braces height separation on top of the
      // now-real spatial one.
      const sconceY = 2.15;
      const sconceSides: WallSide[] = corridor.widthM >= corridor.depthM ? ["north", "south"] : ["west", "east"];
      const corridorOcc = roomOccupancyFor(floor, corridor, hotelTier);
      // Same longest-run-first behaviour as the painting loops in
      // decor.ts: keep asking until the solver has nothing left to give.
      for (let i = 0; i < 8; i++) {
        const pose = placeOnWallSurface(corridorOcc, 0.2, 0.2, sconceSides, 0.15, 0.6);
        if (!pose) break;
        addSconceAt(group, pose.x, pose.z, pose.yawRad, sconceY, hotelTier);
      }
    }
  }

  // -- bedroom ceiling fixture: bare bulb (0), recessed can (1), pendant
  //    lamp (2, unchanged) --
  for (const rect of rects.values()) {
    if (rect.kind !== "bedroom") continue;
    const lampGroup = new THREE.Group();
    lampGroup.position.set(rect.centerXM, WALL_HEIGHT_M - 0.15, rect.centerZM);
    if (hotelTier === 0) {
      lampGroup.add(fallbackBareBulb());
    } else if (hotelTier === 1) {
      const disc = recessedDownlight();
      disc.position.y = 0.12;
      lampGroup.add(disc);
    } else {
      lampGroup.add(fallbackBedroomLamp());
    }
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

/** Places one sconce at a pose returned by `placeOnWallSurface` (world
 *  x/z already flush to the wall) -- replaces the old `addSconcePair`'s
 *  fixed-spacing loop plus its own door check, both now subsumed by the
 *  shared solver/occupancy grid (COO review W3-1: the solver's own door
 *  lane blocking is what used to be `insideAnyDoor`, now for real instead
 *  of a second bespoke check). Insets 0.05m off the wall face, same as the
 *  fixed-loop version did, so the bracket doesn't z-fight the wall mesh. */
function addSconceAt(group: THREE.Group, xOnWall: number, zOnWall: number, yawRad: number, yM: number, hotelTier: HotelTier): void {
  // `yawRad` faces INTO the room (same convention as placement.ts's
  // `wallPoint`), so stepping 0.05m along it insets the sconce off the
  // wall face without needing to know which side it came from.
  const insetM = 0.05;
  const x = xOnWall + Math.sin(yawRad) * insetM;
  const z = zOnWall + Math.cos(yawRad) * insetM;
  const sconceGroup = new THREE.Group();
  sconceGroup.position.set(x, yM, z);
  sconceGroup.add(fallbackSconce());
  group.add(sconceGroup);

  if (hotelTier === 2) {
    void loadModel("wall-sconce").then((model) => {
      if (!model) return;
      fitToFootprint(model.scene, { w: 0.15, d: 0.1, h: 0.2 });
      sconceGroup.clear();
      sconceGroup.add(model.scene);
    });
  }
}
