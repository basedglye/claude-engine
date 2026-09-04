/**
 * The world beyond the street cells: sky, ground, distant city, an awning
 * and sign over the entrance, stanchions and planters. Presentation-only;
 * nothing here is collidable and nothing sits on a walkable street cell
 * within 1m of the door span (guests/player only ever walk the sim's own
 * street cells, never this dressing).
 */
import * as THREE from "three";
import type { GroundFloor } from "@claude-engine/interiors";
import { ROOM, roomRects, doorRects } from "./floorplan.js";
import { chainLinkTexture, asphaltTexture, neonSignTexture, type HotelTier } from "./procedural.js";

export type { HotelTier };

function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function buildSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(300, 24, 16);
  const uniforms = {
    topColor: { value: new THREE.Color(0x2b4d78) },
    bottomColor: { value: new THREE.Color(0xffb977) },
    offset: { value: 20 },
    exponent: { value: 0.7 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sky-dome";
  return mesh;
}

export function buildExterior(floor: GroundFloor, hotelTier: HotelTier): THREE.Group {
  const group = new THREE.Group();
  group.name = "exterior";

  group.add(buildSky());

  const street = roomRects(floor).get(ROOM.STREET);
  const entrance = doorRects(floor).find((d) => d.isEntrance);
  const streetCenterX = street ? street.centerXM : 0;
  const streetFarZ = street ? street.zM0 : -10;
  const doorX = entrance ? entrance.centerXM : streetCenterX;
  const doorZ = entrance ? entrance.zM0 : streetFarZ + 2;

  // Ground: large pavement plane well beyond the street cells, plus an
  // asphalt road strip further out with a painted kerb.
  const groundSize = 220;
  const pavementMat =
    hotelTier === 0
      ? new THREE.MeshStandardMaterial({ map: asphaltTexture(1), roughness: 0.95 })
      : new THREE.MeshStandardMaterial({ color: 0x8c8c86, roughness: 0.95 });
  if (hotelTier === 0 && pavementMat.map) {
    pavementMat.map.repeat.set(groundSize / 6, groundSize / 6);
    pavementMat.map.needsUpdate = true;
  }
  const pavement = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), pavementMat);
  pavement.rotation.x = -Math.PI / 2;
  pavement.position.set(streetCenterX, -0.01, streetFarZ - groundSize / 2 + 6);
  pavement.receiveShadow = true;
  group.add(pavement);

  const roadZ = streetFarZ - 8;
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x24211f, roughness: 0.9 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, 8), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(streetCenterX, 0.0, roadZ);
  road.receiveShadow = true;
  group.add(road);

  const kerbMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 });
  const kerbNear = new THREE.Mesh(new THREE.BoxGeometry(groundSize, 0.15, 0.2), kerbMat);
  kerbNear.position.set(streetCenterX, 0.06, roadZ + 4);
  kerbNear.castShadow = true;
  kerbNear.receiveShadow = true;
  group.add(kerbNear);

  // Distant city blocks: dark boxes with emissive window grids, far side of the road.
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.8 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, emissive: new THREE.Color(0xffdca0), emissiveIntensity: 0.6 });
  const cityZ = roadZ - 12;
  for (let i = 0; i < 9; i++) {
    const bx = streetCenterX - 60 + i * 15 + (hash2(i, 1) - 0.5) * 4;
    const bw = 8 + hash2(i, 2) * 5;
    const bh = 14 + hash2(i, 3) * 26;
    const bd = 8 + hash2(i, 4) * 5;
    const bz = cityZ - hash2(i, 5) * 20;
    const block = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), blockMat);
    block.position.set(bx, bh / 2, bz);
    block.castShadow = false;
    block.receiveShadow = false;
    group.add(block);

    // A simple window grid as small emissive planes on the near face.
    const cols = Math.max(2, Math.floor(bw / 2));
    const rows = Math.max(2, Math.floor(bh / 3));
    const winGeo = new THREE.PlaneGeometry(0.8, 1.2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hash2(i * 100 + r * 10 + c, 7) < 0.4) continue;
        const wx = bx - bw / 2 + ((c + 0.5) * bw) / cols;
        const wy = 2 + ((r + 0.5) * (bh - 3)) / rows;
        const w = new THREE.Mesh(winGeo, winMat);
        w.position.set(wx, wy, bz + bd / 2 + 0.05);
        group.add(w);
      }
    }
  }

  const awningW = 3.2;
  const awningD = 1.4;
  const awningY0 = 2.3;
  const awningY1 = 2.9;
  const awningZFront = doorZ - awningD;

  if (hotelTier === 2) {
    // Awning over the entrance door.
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x1f4d33, roughness: 0.7, side: THREE.DoubleSide });
    const awningTrimMat = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 1, roughness: 0.3 });
    const awningShape = new THREE.BufferGeometry();
    {
      const positions = new Float32Array([
        doorX - awningW / 2, awningY1, doorZ,
        doorX + awningW / 2, awningY1, doorZ,
        doorX + awningW / 2, awningY0, awningZFront,
        doorX - awningW / 2, awningY0, awningZFront,
      ]);
      const idx = [0, 1, 2, 0, 2, 3];
      awningShape.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      awningShape.setIndex(idx);
      awningShape.computeVertexNormals();
    }
    const awning = new THREE.Mesh(awningShape, awningMat);
    awning.castShadow = true;
    awning.receiveShadow = true;
    group.add(awning);
    // Awning valance (front edge trim).
    const valance = new THREE.Mesh(new THREE.BoxGeometry(awningW, 0.25, 0.03), awningMat);
    valance.position.set(doorX, awningY0 - 0.1, awningZFront);
    valance.castShadow = true;
    group.add(valance);
    // Brass support poles.
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, awningY0, 8);
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, awningTrimMat);
      pole.position.set(doorX + (sx * awningW) / 2, awningY0 / 2, awningZFront);
      pole.castShadow = true;
      group.add(pole);
    }

    // Sign above the awning: canvas text "GRAND FOYER", gold serif on dark green.
    {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#173826";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#b08d3f";
      ctx.lineWidth = 8;
      ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
      ctx.fillStyle = "#d9b466";
      ctx.font = "bold 120px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GRAND FOYER", canvas.width / 2, canvas.height / 2 + 8);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), signMat);
      sign.position.set(doorX, awningY1 + 0.5, doorZ - 0.05);
      sign.castShadow = false;
      group.add(sign);
    }

    // Stanchions with a red rope, either side of the entrance, clear of the door span by 1m+.
    const stanchionMat = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 1, roughness: 0.25 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x7a1c1c, roughness: 0.6 });
    function addStanchion(x: number, z: number): THREE.Object3D {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 12), stanchionMat);
      base.position.y = 0.02;
      base.castShadow = true;
      g.add(base);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 10), stanchionMat);
      pole.position.y = 0.47;
      pole.castShadow = true;
      g.add(pole);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), stanchionMat);
      cap.position.y = 0.93;
      cap.castShadow = true;
      g.add(cap);
      g.position.set(x, 0, z);
      return g;
    }
    const stanchZ = doorZ - awningD - 0.6;
    const stA = addStanchion(doorX - 1.4, stanchZ);
    const stB = addStanchion(doorX + 1.4, stanchZ);
    group.add(stA, stB);
    const ropeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(doorX - 1.35, 0.9, stanchZ),
      new THREE.Vector3(doorX, 0.78, stanchZ),
      new THREE.Vector3(doorX + 1.35, 0.9, stanchZ),
    ]);
    const ropeGeo = new THREE.TubeGeometry(ropeCurve, 16, 0.02, 6, false);
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    // Carried from C2-W2: the thin rope tube's shadow bled a hard line
    // across the entrance floor at low sun angles; it reads fine unshadowed.
    rope.castShadow = false;
    group.add(rope);

    // Planters flanking the entrance, clear of the door span.
    const planterMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.85 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2f, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const px = doorX + sx * 2.1;
      const pz = doorZ - 0.5;
      const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.5, 12), planterMat);
      planter.position.set(px, 0.25, pz);
      planter.castShadow = true;
      planter.receiveShadow = true;
      group.add(planter);
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), foliageMat);
      foliage.position.set(px, 0.65, pz);
      foliage.castShadow = true;
      group.add(foliage);
    }
  } else if (hotelTier === 1) {
    // Tier 1: plain awning (same shape, unbranded green canvas) plus a
    // plain lit sign -- no stanchions/rope, no planters (interpolating,
    // not authoring a third full set).
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x2f5a3f, roughness: 0.75, side: THREE.DoubleSide });
    const awningShape = new THREE.BufferGeometry();
    {
      const positions = new Float32Array([
        doorX - awningW / 2, awningY1, doorZ,
        doorX + awningW / 2, awningY1, doorZ,
        doorX + awningW / 2, awningY0, awningZFront,
        doorX - awningW / 2, awningY0, awningZFront,
      ]);
      awningShape.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      awningShape.setIndex([0, 1, 2, 0, 2, 3]);
      awningShape.computeVertexNormals();
    }
    const awning = new THREE.Mesh(awningShape, awningMat);
    awning.castShadow = true;
    group.add(awning);
    const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, awningY0, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8a86, metalness: 0.5, roughness: 0.5 });
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(doorX + (sx * awningW) / 2, awningY0 / 2, awningZFront);
      group.add(pole);
    }
    const signMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, emissive: 0x333333, emissiveIntensity: 0.2, roughness: 0.6 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), signMat);
    sign.position.set(doorX, awningY1 + 0.4, doorZ - 0.05);
    group.add(sign);
  } else {
    // Tier 0: chain-link fence flanking the entrance, a dumpster off to
    // one side, and a buzzing neon VACANCY sign in place of the awning.
    const fenceH = 1.6;
    const fenceMat = new THREE.MeshStandardMaterial({
      map: chainLinkTexture(),
      color: 0xaaaaaa,
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.6,
    });
    fenceMat.map!.repeat.set(4, 1.5);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6a6a66, metalness: 0.5, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const fenceX = doorX + sx * 3.5;
      const fence = new THREE.Mesh(new THREE.PlaneGeometry(3, fenceH), fenceMat);
      fence.position.set(fenceX, fenceH / 2, doorZ - 1.2);
      fence.rotation.y = Math.PI / 2;
      // Carried from C2-W2: a thin chain-link plane casting a shadow reads
      // as a solid grey slab across the entrance floor once the sun angle
      // catches it -- the fence should be see-through, not shadow-casting.
      fence.castShadow = false;
      group.add(fence);
      for (const dz of [-1.2 - 1.5, -1.2 + 1.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, fenceH, 8), postMat);
        post.position.set(fenceX, fenceH / 2, doorZ + dz);
        group.add(post);
      }
    }

    // Dumpster off to one side, clear of the door span.
    const dumpsterMat = new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.85, metalness: 0.2 });
    const dumpster = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.2), dumpsterMat);
    dumpster.position.set(doorX + 4.5, 0.55, doorZ - 1.8);
    dumpster.castShadow = true;
    dumpster.receiveShadow = true;
    group.add(dumpster);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.8 });
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.3), lidMat);
    lid.position.set(doorX + 4.5, 1.14, doorZ - 1.8);
    lid.rotation.z = 0.15;
    group.add(lid);

    // Neon VACANCY sign, in place of the awning/GRAND FOYER sign.
    const neonTex = neonSignTexture("VACANCY");
    const neonMat = new THREE.MeshStandardMaterial({ map: neonTex, emissiveMap: neonTex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.5 });
    const neonBoxMat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.7 });
    // Housing spans doorZ-0.475 .. doorZ-0.325 (depth 0.15, centred at
    // doorZ-0.4). The street camera is at SMALLER z looking toward +z, so
    // the face must sit on the housing's near (street) side, in front of
    // the box, and be rotated to face -Z (toward the street) -- a bare
    // PlaneGeometry faces +Z by default, which pointed it at the lobby and
    // let the housing itself occlude it (COO review item 1).
    const signBox = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.15), neonBoxMat);
    signBox.position.set(doorX, awningY1, doorZ - 0.4);
    group.add(signBox);
    const neonFace = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.9), neonMat);
    neonFace.rotation.y = Math.PI;
    neonFace.position.set(doorX, awningY1, doorZ - 0.476);
    group.add(neonFace);
    // A rusty pole to hold the sign up, motel-marquee style.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9, metalness: 0.3 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, awningY1, 8), poleMat);
    pole.position.set(doorX, awningY1 / 2, doorZ - 0.4);
    group.add(pole);
  }

  // Warm late-afternoon directional light for the exterior scene.
  const sun = new THREE.DirectionalLight(0xffddaa, 1.6);
  sun.position.set(streetCenterX + 30, 40, roadZ + 10);
  sun.target.position.set(streetCenterX, 0, streetFarZ);
  sun.castShadow = false;
  group.add(sun);
  group.add(sun.target);

  return group;
}
