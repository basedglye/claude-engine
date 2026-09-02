// Unit/property tests for @claude-engine/interiors, run against the built
// dist/ (npm run test -w @claude-engine/interiors builds first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs style.
import {
  generateGroundFloor,
  generateDoorMesh,
  DOOR_HEAD_HEIGHT_MM,
  WALL_HEIGHT_MM,
  synthesizeAtlas,
  ATLAS_SIZE_PX,
  ATLAS_TILE_PX,
  TEXELS_PER_METRE,
} from "../dist/index.js";
import { CELL, CELL_SIZE_MM, cellAt, cellOfMm, findPathCells, findRoute, moveCircle, roomAt } from "@claude-engine/space";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

// FNV-1a over a string.
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic JSON-ish serialization: TypedArrays -> plain arrays.
function serializeGroundFloor(gf) {
  return JSON.stringify({
    grid: gf.grid,
    rooms: gf.rooms,
    portals: gf.portals,
    doors: gf.doors,
    spawn: gf.spawn,
    desk: gf.desk,
    entranceDoorIndex: gf.entranceDoorIndex,
    bedrooms: gf.bedrooms,
    mesh: {
      positions: Array.from(gf.mesh.positions),
      normals: Array.from(gf.mesh.normals),
      indices: Array.from(gf.mesh.indices),
      colors: Array.from(gf.mesh.colors),
      uvs: Array.from(gf.mesh.uvs ?? []),
      triCount: gf.mesh.triCount,
    },
  });
}

// Serialization of everything EXCEPT `mesh` -- the sim-visible surface of a
// GroundFloor. H2b's UV emission + lighting bake touch `mesh` bytes only
// (per docs/PHASE-H2.md section 5D); this hash is what proves it: if H2b
// ever moves THIS hash, sim-visible data leaked out of the mesh-only change,
// which is the actual invariant-2 violation to catch (mesh output is
// presentation, never hashed into sim state -- but that only holds if
// nothing else moved alongside it).
function serializeNonMeshFields(gf) {
  return JSON.stringify({
    grid: gf.grid,
    rooms: gf.rooms,
    portals: gf.portals,
    doors: gf.doors,
    spawn: gf.spawn,
    desk: gf.desk,
    entranceDoorIndex: gf.entranceDoorIndex,
    bedrooms: gf.bedrooms,
  });
}

const GOLDEN_SEED = "hotel-h0-look-1";
// Pinned golden hash for GOLDEN_SEED's full serialized GroundFloor. If this
// generator's output ever changes for this seed, this must be updated
// deliberately (and the reason recorded), not silently.
// Re-pinned after the DOOR_WIDTH_CELLS=4 doorway-width fix (see
// packages/interiors/src/layout.ts) changed the generated grid/mesh for
// every seed, including this one.
// Re-pinned again after the wall-winding fix (correct front-face winding
// into the walkable cell, matching normals) and the door-header fix
// (header quads over each DOOR cell from DOOR_HEAD_HEIGHT_MM to
// WALL_HEIGHT_MM) in mesh-gen.ts -- both change the mesh's vertex order
// and quad count for every seed, including this one.
// Re-pinned again for Phase H1a (see docs/PHASE-H1.md section E /
// docs/PHASE-H0.md deferral item 3): the generator now adds a front desk
// (FURNITURE cells), an explicit queue chain, a street door + exterior
// street strip, and bedroom annotations -- every seed's grid/mesh changed.
// Re-pinned again for the H1a lane-7 queue-clearance fix (see
// src/layout.ts's "COLLIDER CLEARANCE" note): `desk.queueCells` moved one
// row north and one column east so a 300mm-radius guest can actually
// stand on a slot. No grid cell, portal, door or mesh vertex changed --
// only the serialized `desk` block, which this hash covers.
// Re-pinned for H2b (previous value: 0x752bc750): buildFloorMesh now emits
// per-vertex UVs (planar projection into the retro atlas, TEXELS_PER_METRE
// density) and bakes a corridor/window/lamp vertex-colour lighting
// multiplier -- both change `mesh.positions`/`colors`/`uvs` bytes for every
// seed, this one included. This is legal under invariant 2 (asset-synthesis
// output is presentation, never hashed into sim state) because it is
// EXCLUSIVELY a mesh-bytes change: `NON_MESH_GOLDEN_HASH` below, which
// covers every other field, is unchanged from before this diff -- see that
// hash's own comment for how it proves the separation.
// Re-pinned a SECOND time inside H2b (0xbf2459e0 -> 0xef96f6ec) when the
// albedo moved out of the vertex colours and into the atlas. The first
// H2b pass emitted `atlasColour x roomTint x light`, which describes each
// material's colour twice and lands at roughly its square -- driving the
// built game showed the entire hotel rendered as uniform dark mud. Vertex
// colours now carry the LIGHT alone (see mesh-gen.ts's block comment above
// FLOOR_PALETTE). Same argument as above applies unchanged: mesh bytes
// only, and NON_MESH_GOLDEN_HASH did not move across either re-pin.
// Re-pinned a THIRD time inside H2b (0xef96f6ec -> 0x95618e02): the bake
// gained a per-face directional term and the UV mapping gained a half-texel
// gutter. Both were found by looking at the built game rather than by any
// gate. Without the normal term the positional falloffs vary only across
// the floor plan, so two opposite walls render identically and a room reads
// as one flat field; without the gutter a vertex landing exactly on a tile
// period sampled the NEIGHBOURING material (measured: lobby floor quads
// taking the corridor's grey-blue, ceiling quads taking the lobby's tan).
// Mesh bytes only, again, and NON_MESH_GOLDEN_HASH has not moved across any
// of the three re-pins.
const GOLDEN_HASH = 0x95618e02;

// --- Golden determinism: byte-identical across two calls, hash pinned. -----
{
  const a = generateGroundFloor(GOLDEN_SEED);
  const b = generateGroundFloor(GOLDEN_SEED);
  const sa = serializeGroundFloor(a);
  const sb = serializeGroundFloor(b);
  check("golden: two calls with the same seed serialize byte-identically", sa === sb);
  const h = hashStr(sa);
  console.log(`  golden hash for seed "${GOLDEN_SEED}": 0x${h.toString(16)}`);
  check(`golden: hash matches pinned value 0x${GOLDEN_HASH.toString(16)}`, h === GOLDEN_HASH);
}

// --- H2b: non-mesh-field hash, pinned separately -- proves the UV/lighting
// diff changed `mesh` bytes ONLY. Computed once (see the commit this test
// change ships in) and pinned like any other golden; if a future PR moves
// THIS hash without an explicit, reviewed reason, sim-visible data leaked
// out of what should be a presentation-only change. -----------------------
const NON_MESH_GOLDEN_HASH = 0x03ea4ca5;
{
  const gf = generateGroundFloor(GOLDEN_SEED);
  const s = serializeNonMeshFields(gf);
  const h = hashStr(s);
  console.log(`  non-mesh-fields hash for seed "${GOLDEN_SEED}": 0x${h.toString(16)}`);
  check(
    `H2b: non-mesh fields (grid/rooms/portals/doors/spawn/desk/entranceDoorIndex/bedrooms) hash matches pinned value 0x${NON_MESH_GOLDEN_HASH.toString(16)} (proves H2b's mesh diff carried zero sim-visible data)`,
    h === NON_MESH_GOLDEN_HASH
  );
}

// --- One-source-of-truth property: every wall quad <-> every grid boundary,
// PLUS every DOOR-adjacent boundary <-> exactly one header-pair. -----------
// NEW invariant (post door-header fix): a boundary where walkability
// differs (wa!==wc) still yields exactly one full-height quad (y: 0..H),
// same as before. A boundary where BOTH sides are walkable but exactly one
// side is a DOOR cell (the doorway opening itself -- no full wall, by
// design) now ADDITIONALLY yields exactly two header quads (one per side,
// y: DOOR_HEAD_HEIGHT_MM..H) closing the gap above the door leaf. Any other
// boundary (both walkable/non-door, or both solid) yields nothing. This is
// still a strict 1:1 correspondence -- just two boundary kinds instead of
// one -- so it still catches desync between grid and mesh.
{
  const gf = generateGroundFloor(GOLDEN_SEED);
  const { grid } = gf;
  const { width, height, originXMm, originZMm } = grid;
  const S = 250;
  const H_M = WALL_HEIGHT_MM / 1000;
  const DOOR_HEAD_M = DOOR_HEAD_HEIGHT_MM / 1000;

  function isWalkable(cellValue) {
    return (cellValue & CELL.WALKABLE) !== 0;
  }
  function isDoor(cellValue) {
    return (cellValue & CELL.DOOR) !== 0;
  }
  function idx(cx, cz) {
    return cz * width + cx;
  }

  // Ground truth, split into the two boundary kinds.
  const expectedFull = new Set(); // full-height wall: exactly one quad
  const expectedHeader = new Set(); // door boundary: exactly two header quads

  function classify(a, c, axisKey) {
    const wa = isWalkable(a);
    const wc = isWalkable(c);
    if (wa !== wc) {
      expectedFull.add(axisKey);
    } else if (wa && wc && isDoor(a) !== isDoor(c)) {
      expectedHeader.add(axisKey);
    }
  }

  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const a = grid.cells[idx(cx, cz)] ?? CELL.SOLID;
      const c = grid.cells[idx(cx + 1, cz)] ?? CELL.SOLID;
      const bx = originXMm + (cx + 1) * S;
      const z0 = originZMm + cz * S;
      classify(a, c, `x:${bx}:${z0}`);
    }
  }
  for (let cz = 0; cz < height - 1; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const a = grid.cells[idx(cx, cz)] ?? CELL.SOLID;
      const c = grid.cells[idx(cx, cz + 1)] ?? CELL.SOLID;
      const bz = originZMm + (cz + 1) * S;
      const x0 = originXMm + cx * S;
      classify(a, c, `z:${bz}:${x0}`);
    }
  }

  // Reconstruct wall/header quads from the mesh: 2 triangles (6 indices)
  // per quad, emitted contiguously (mesh-gen.ts's documented convention). A
  // wall/header quad's 4 corners do NOT all share the same Y (floor/ceiling
  // quads do -- those are skipped here).
  const pos = gf.mesh.positions;
  const ind = gf.mesh.indices;
  const actualFull = new Map(); // key -> count
  const actualHeader = new Map();
  let wallQuadCount = 0;
  let headerQuadCount = 0;
  for (let q = 0; q * 6 < ind.length; q++) {
    const base = q * 6;
    const corners = [ind[base], ind[base + 1], ind[base + 2], ind[base + 3]];
    const ys = corners.map((vi) => pos[vi * 3 + 1]);
    const allSameY = ys.every((y) => Math.abs(y - ys[0]) < 1e-9);
    if (allSameY) continue; // floor or ceiling quad, not a wall/header

    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const isFull = Math.abs(yMin - 0) < 1e-6 && Math.abs(yMax - H_M) < 1e-6;
    const isHeader = Math.abs(yMin - DOOR_HEAD_M) < 1e-6 && Math.abs(yMax - H_M) < 1e-6;
    if (!isFull && !isHeader) {
      check(`one-source-of-truth: wall/header quad spans a recognised y-range (got ${yMin}..${yMax})`, false);
      continue;
    }

    const xs = corners.map((vi) => Math.round(pos[vi * 3] * 1000));
    const zs = corners.map((vi) => Math.round(pos[vi * 3 + 2] * 1000));
    const xConst = xs.every((x) => x === xs[0]);
    const zConst = zs.every((z) => z === zs[0]);
    let key;
    if (xConst && !zConst) {
      key = `x:${xs[0]}:${Math.min(...zs)}`;
    } else if (zConst && !xConst) {
      key = `z:${zs[0]}:${Math.min(...xs)}`;
    } else {
      check("one-source-of-truth: wall/header quad is axis-aligned (const x or const z)", false);
      continue;
    }

    if (isFull) {
      wallQuadCount++;
      actualFull.set(key, (actualFull.get(key) ?? 0) + 1);
    } else {
      headerQuadCount++;
      actualHeader.set(key, (actualHeader.get(key) ?? 0) + 1);
    }
  }

  check("one-source-of-truth: every emitted full-height quad matches a grid boundary", [...actualFull.keys()].every((k) => expectedFull.has(k)));
  check("one-source-of-truth: every full-wall boundary has an emitted quad", [...expectedFull].every((k) => actualFull.has(k)));
  check("one-source-of-truth: every full-wall boundary has EXACTLY one quad", [...actualFull.values()].every((n) => n === 1));
  check("one-source-of-truth: full-wall quad count equals boundary count", wallQuadCount === expectedFull.size);

  check("one-source-of-truth: every emitted header quad matches a door boundary", [...actualHeader.keys()].every((k) => expectedHeader.has(k)));
  check("one-source-of-truth: every door boundary has emitted header quads", [...expectedHeader].every((k) => actualHeader.has(k)));
  check("one-source-of-truth: every door boundary has EXACTLY two header quads (one per side)", [...actualHeader.values()].every((n) => n === 2));
  check("one-source-of-truth: header quad count equals 2x door-boundary count", headerQuadCount === expectedHeader.size * 2);

  console.log(`  full-wall boundary/quad count for seed "${GOLDEN_SEED}": ${expectedFull.size}`);
  console.log(`  door-header boundary count for seed "${GOLDEN_SEED}": ${expectedHeader.size} (${headerQuadCount} header quads)`);
}

// --- Doors: count, stable dense doorIndex, roomA/roomB match cell neighbours.
{
  const gf = generateGroundFloor(GOLDEN_SEED);
  check("doors: 4 rooms + lobby + entrance produce exactly 6 doors", gf.doors.length === 6);
  const indices = gf.doors.map((d) => d.doorIndex).sort((a, b) => a - b);
  check(
    "doors: doorIndex values are stable and dense (0..N-1)",
    indices.every((v, i) => v === i)
  );
  const { grid, rooms } = gf;
  let allMatch = true;
  for (const d of gf.doors) {
    const cellValue = cellAt(grid, d.cx, d.cz);
    if ((cellValue & CELL.DOOR) === 0) allMatch = false;
    const idx = d.cz * grid.width + d.cx;
    const cellRoom = rooms[idx];
    if (cellRoom !== d.roomA && cellRoom !== d.roomB) allMatch = false;
    if (d.roomA === d.roomB) allMatch = false;
  }
  check("doors: every DoorSpec cell has the DOOR bit and matches roomA/roomB", allMatch);
}

// --- generateDoorMesh: sized to the doorway, deterministic. -----------------
{
  const gf = generateGroundFloor(GOLDEN_SEED);
  const spec = gf.doors[0];
  const m1 = generateDoorMesh(spec);
  const m2 = generateDoorMesh(spec);
  check("generateDoorMesh: deterministic for the same spec", JSON.stringify(Array.from(m1.positions)) === JSON.stringify(Array.from(m2.positions)));
  check("generateDoorMesh: produces a non-empty mesh", m1.triCount > 0 && m1.positions.length > 0);
  // Bounding box width should be ~= CELL_SIZE_MM (250mm = 0.25m) in one horizontal axis.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < m1.positions.length; i += 3) {
    const x = m1.positions[i];
    const y = m1.positions[i + 1];
    const z = m1.positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const spanY = maxY - minY;
  const doorSpan = Math.max(spanX, spanZ);
  // DOOR_WIDTH_CELLS=4 * CELL_SIZE_MM=250mm = 1000mm = 1.0m.
  check("generateDoorMesh: horizontal span ~= 1.0m doorway width (DOOR_WIDTH_CELLS)", Math.abs(doorSpan - 1.0) < 0.01);
  check("generateDoorMesh: height ~= 2.1m", Math.abs(spanY - 2.1) < 0.01);
}

// --- Doorway traversal: a 300mm-radius circle can actually walk through
// every doorway via the real space.moveCircle, stepping 200mm/tick (the
// same speed apps/hotel's moveSystem uses). This is the check whose
// absence let the "doors are impassable" defect through: prior tests only
// asserted door.open flips in the sim, never that a player-sized circle
// could physically cross the opening. Fails when closed, succeeds when
// open, for every doorway across a 100-seed sweep. -------------------------
{
  const PLAYER_RADIUS_MM = 300;
  const STEP_MM = 200;

  /** Steps a circle from (xMm,zMm) straight along (dxStep,dzStep) per tick,
   *  `ticks` times, through `grid` with the given isOpen overlay. Returns
   *  the final position. */
  function walk(grid, xMm, zMm, dxStep, dzStep, ticks, isOpen) {
    let pos = { xMm, zMm };
    for (let i = 0; i < ticks; i++) {
      pos = moveCircle(grid, pos.xMm, pos.zMm, dxStep, dzStep, PLAYER_RADIUS_MM, isOpen);
    }
    return pos;
  }

  let doorsTraversedOpen = 0;
  let doorsBlockedClosed = 0;
  let doorsTotal = 0;
  let sweepAllOk = true;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const seed = `hotel-h0-sweep-${i}`;
    const gf = generateGroundFloor(seed);
    const { grid, rooms, portals, doors } = gf;

    for (const d of doors) {
      doorsTotal++;
      const portal = portals.portals[d.doorIndex];
      const cells = portal.cells;
      // Row-spanning doorway (all cells share cz) -> travel along Z;
      // column-spanning doorway (all cells share cx) -> travel along X.
      const isRow = cells.every((c) => c.cz === cells[0].cz);
      const startBackMm = 2 * CELL_SIZE_MM + PLAYER_RADIUS_MM; // clear of the wall on roomA's side
      const crossMm = 2 * CELL_SIZE_MM + 2 * PLAYER_RADIUS_MM; // enough to land solidly in roomB
      const ticksNeeded = Math.ceil((startBackMm + crossMm) / STEP_MM);

      // Probe both directions off the door center to find which side is
      // roomA (start) vs roomB (target) -- doorA/doorB order relative to
      // grid axes is generation-dependent, not assumed.
      let startX, startZ, stepX, stepZ;
      // `sign` is the offset direction (from the door center) that lands in
      // roomA -- the start side. Travel toward roomB is the OPPOSITE
      // direction, so the step sign is the negation of the start-offset sign.
      if (isRow) {
        const negRoom = roomAt(rooms, grid, d.xMm, d.zMm - startBackMm);
        const sign = negRoom === d.roomA ? -1 : 1;
        startX = d.xMm;
        startZ = d.zMm + sign * startBackMm;
        stepX = 0;
        stepZ = -sign * STEP_MM;
      } else {
        const negRoom = roomAt(rooms, grid, d.xMm - startBackMm, d.zMm);
        const sign = negRoom === d.roomA ? -1 : 1;
        startX = d.xMm + sign * startBackMm;
        startZ = d.zMm;
        stepX = -sign * STEP_MM;
        stepZ = 0;
      }

      const startRoom = roomAt(rooms, grid, startX, startZ);
      const isOpenAt = (cx, cz) => cells.some((c) => c.cx === cx && c.cz === cz);

      // Closed: door cells never report open -> traversal must NOT reach roomB.
      const closedFinal = walk(grid, startX, startZ, stepX, stepZ, ticksNeeded, () => false);
      const closedRoom = roomAt(rooms, grid, closedFinal.xMm, closedFinal.zMm);
      const closedBlocked = closedRoom !== d.roomB;
      if (closedBlocked) doorsBlockedClosed++;

      // Open: door cells report open -> traversal must reach roomB.
      const openFinal = walk(grid, startX, startZ, stepX, stepZ, ticksNeeded, isOpenAt);
      const openRoom = roomAt(rooms, grid, openFinal.xMm, openFinal.zMm);
      const openTraversed = openRoom === d.roomB;
      if (openTraversed) doorsTraversedOpen++;

      if (startRoom !== d.roomA || !closedBlocked || !openTraversed) {
        sweepAllOk = false;
        console.log(
          `  traversal FAIL seed="${seed}" doorIndex=${d.doorIndex}: startRoom=${startRoom} (want ${d.roomA}) closedRoom=${closedRoom} (want !=${d.roomB}) openRoom=${openRoom} (want ${d.roomB})`
        );
      }
    }
  }
  console.log(
    `  doorway traversal: ${doorsTraversedOpen}/${doorsTotal} doors passable when open, ${doorsBlockedClosed}/${doorsTotal} correctly blocked when closed (${N} seeds)`
  );
  check(
    `doorway traversal: a 300mm-radius circle crosses every doorway via space.moveCircle when open, and is blocked when closed, across all ${N} seeds`,
    sweepAllOk
  );
}

// --- Connectivity sweep over 100 seeds. -------------------------------------
{
  let allPassed = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const seed = `hotel-h0-sweep-${i}`;
    const gf = generateGroundFloor(seed);
    const { grid, rooms, portals, doors, spawn } = gf;
    const isOpen = () => true; // all doors treated as open for the sweep

    // Spawn is on a walkable cell with player clearance (300mm radius): the
    // spawn cell and its 4-neighbours must all be walkable/non-solid.
    const spawnCx = Math.floor((spawn.xMm - grid.originXMm) / 250);
    const spawnCz = Math.floor((spawn.zMm - grid.originZMm) / 250);
    const spawnCell = cellAt(grid, spawnCx, spawnCz);
    let spawnOk = (spawnCell & CELL.WALKABLE) !== 0 && (spawnCell & CELL.SOLID) === 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = cellAt(grid, spawnCx + dx, spawnCz + dz);
      if ((nb & CELL.WALKABLE) === 0 || (nb & CELL.SOLID) !== 0) spawnOk = false;
    }

    // Every DoorSpec cell has the DOOR bit.
    let doorsOk = true;
    for (const d of doors) {
      if ((cellAt(grid, d.cx, d.cz) & CELL.DOOR) === 0) doorsOk = false;
    }

    // Every room id appearing in `rooms` (except 0/outside) is present in
    // the portal graph's `rooms` array (has at least one portal, or is
    // otherwise a valid room index).
    const roomIdsPresent = new Set(rooms.filter((r) => r !== 0));
    let graphOk = true;
    for (const rid of roomIdsPresent) {
      if (rid < 0 || rid >= portals.rooms.length) graphOk = false;
    }

    // Every room reachable from spawn via findRoute + findPathCells.
    let reachOk = true;
    const spawnPath = findPathCells(grid, { cx: spawnCx, cz: spawnCz }, { cx: spawnCx, cz: spawnCz }, isOpen);
    if (!spawnPath) reachOk = false;
    // Determine spawn's room id.
    const spawnRoom = rooms[spawnCz * grid.width + spawnCx];
    for (const rid of roomIdsPresent) {
      if (rid === spawnRoom) continue;
      const route = findRoute(portals, spawnRoom, rid);
      if (route === null) {
        reachOk = false;
        continue;
      }
      // Also confirm a real cell path exists to some cell of that room.
      const targetCellIdx = rooms.findIndex((r) => r === rid);
      if (targetCellIdx < 0) {
        reachOk = false;
        continue;
      }
      const tcx = targetCellIdx % grid.width;
      const tcz = Math.floor(targetCellIdx / grid.width);
      const cellPath = findPathCells(grid, { cx: spawnCx, cz: spawnCz }, { cx: tcx, cz: tcz }, isOpen);
      if (!cellPath) reachOk = false;
    }

    if (spawnOk && doorsOk && graphOk && reachOk) {
      allPassed++;
    } else {
      console.log(
        `  sweep FAIL seed="${seed}": spawnOk=${spawnOk} doorsOk=${doorsOk} graphOk=${graphOk} reachOk=${reachOk}`
      );
    }
  }
  console.log(`  connectivity sweep: ${allPassed}/${N} seeds passed`);
  check(`connectivity sweep: all ${N} seeds pass (every room reachable from spawn)`, allPassed === N);
}

// --- H1a: desk / queue / entrance / bedrooms property sweep, 100 seeds. ----
// See docs/PHASE-H1.md section E and the H0 deferral ledger row 3.
{

  function isWalkableCell(cellValue) {
    return (cellValue & CELL.WALKABLE) !== 0 && (cellValue & CELL.SOLID) === 0 && (cellValue & CELL.FURNITURE) === 0;
  }
  function isDoorCell(cellValue) {
    return (cellValue & CELL.DOOR) !== 0;
  }
  function hasClearance(grid, cx, cz) {
    const here = cellAt(grid, cx, cz);
    if (!isWalkableCell(here)) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = cellAt(grid, cx + dx, cz + dz);
      if ((nb & CELL.SOLID) !== 0 || (nb & CELL.FURNITURE) !== 0) return false;
    }
    return true;
  }
  function isAdjacent(a, b) {
    const dx = Math.abs(a.cx - b.cx);
    const dz = Math.abs(a.cz - b.cz);
    return dx + dz === 1;
  }

  const N = 100;
  let queueOk = 0;
  let terminalOk = 0;
  let bedroomsOk = 0;
  let entranceOk = 0;
  let risk1Ok = 0;

  for (let i = 0; i < N; i++) {
    const seed = `hotel-h0-sweep-${i}`;
    const gf = generateGroundFloor(seed);
    const { grid, rooms, portals, doors, desk, entranceDoorIndex, bedrooms } = gf;
    const isOpen = () => true;

    // 1. Queue chain: every entry WALKABLE and not DOOR, consecutive
    // entries orthogonally adjacent, no duplicates, length >= 8.
    let qOk = desk.queueCells.length >= 8;
    const seen = new Set();
    for (let k = 0; k < desk.queueCells.length; k++) {
      const c = desk.queueCells[k];
      const key = `${c.cx}:${c.cz}`;
      if (seen.has(key)) qOk = false;
      seen.add(key);
      const cell = cellAt(grid, c.cx, c.cz);
      if (!isWalkableCell(cell)) qOk = false;
      if (isDoorCell(cell)) qOk = false;
      if (k > 0 && !isAdjacent(desk.queueCells[k - 1], c)) qOk = false;
      // H1a lane-7 addition: a queue slot must be OCCUPIABLE by a
      // 300mm-radius guest, not merely walkable. On 250mm cells a cell
      // centre is 125mm from its own boundary, so any cell orthogonally
      // adjacent to SOLID or FURNITURE has a centre `space.moveCircle`
      // will never let an agent stand on. Without this property the queue
      // row sat flush against the desk's FURNITURE row and no guest could
      // ever reach a slot (the check-in chain was dead for every seed).
      if (!hasClearance(grid, c.cx, c.cz)) qOk = false;
    }
    if (qOk) queueOk++;

    // 2. Terminal anchor: walkable, AT the desk but not inside it, and
    // fully clear on all four sides.
    //
    // The anchor used to be required to sit cardinally adjacent to a desk
    // FURNITURE cell. That is what put the monitor's body inside the desk:
    // roughly a quarter of the rendered screen was occluded, and the fix
    // attempted in the renderer (nudging the mesh so it looked right) left
    // the sim's interactable and the mesh the player's reticle actually
    // hits about half a metre apart -- two sources of truth for one object.
    // So the anchor now stands two cells clear, and the property asserts
    // what actually matters: it is at the desk (within DESK_NEAR_CELLS),
    // it is not itself furniture, and a 300mm agent can occupy it with no
    // blocked neighbour at all.
    const DESK_NEAR_CELLS = 3;
    const termC = cellOfMm(grid, desk.xMm, desk.zMm);
    const termCell = cellAt(grid, termC.cx, termC.cz);
    let tOk = isWalkableCell(termCell);
    const neighbourDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let nearDesk = false;
    for (let dx = -DESK_NEAR_CELLS; dx <= DESK_NEAR_CELLS && !nearDesk; dx++) {
      for (let dz = -DESK_NEAR_CELLS; dz <= DESK_NEAR_CELLS && !nearDesk; dz++) {
        if ((cellAt(grid, termC.cx + dx, termC.cz + dz) & CELL.FURNITURE) !== 0) nearDesk = true;
      }
    }
    if (!nearDesk) tOk = false;
    for (const [dx, dz] of neighbourDirs) {
      const nb = cellAt(grid, termC.cx + dx, termC.cz + dz);
      if ((nb & CELL.SOLID) !== 0 || (nb & CELL.FURNITURE) !== 0) tOk = false;
    }
    if (tOk) terminalOk++;

    // 3. Bedrooms: each goal walkable, clear, inside its stated roomId,
    // and reachable from the desk head slot (all doors open).
    const headCell = desk.queueCells[0];
    let bOk = bedrooms.length === 4;
    for (const b of bedrooms) {
      if (!hasClearance(grid, b.goalCx, b.goalCz)) bOk = false;
      const idx = b.goalCz * grid.width + b.goalCx;
      if (rooms[idx] !== b.roomId) bOk = false;
      const route = findRoute(portals, rooms[headCell.cz * grid.width + headCell.cx], b.roomId);
      if (route === null) bOk = false;
      const path = findPathCells(grid, { cx: headCell.cx, cz: headCell.cz }, { cx: b.goalCx, cz: b.goalCz }, isOpen);
      if (!path) bOk = false;
    }
    if (bOk) bedroomsOk++;

    // 4. Entrance: exterior side has walkable spawn cells, and a guest can
    // path street -> queue head -> any bedroom goal, all doors open.
    const entranceDoor = doors[entranceDoorIndex];
    const streetRoomId = entranceDoor.roomA; // convention: roomA = street, see layout.ts
    let eOk = true;
    let streetCellIdx = -1;
    for (let idx = 0; idx < rooms.length; idx++) {
      if (rooms[idx] === streetRoomId) {
        const cx = idx % grid.width;
        const cz = Math.floor(idx / grid.width);
        if (hasClearance(grid, cx, cz)) {
          streetCellIdx = idx;
          break;
        }
      }
    }
    if (streetCellIdx < 0) eOk = false;
    else {
      const scx = streetCellIdx % grid.width;
      const scz = Math.floor(streetCellIdx / grid.width);
      const toHead = findPathCells(grid, { cx: scx, cz: scz }, { cx: headCell.cx, cz: headCell.cz }, isOpen);
      if (!toHead) eOk = false;
      for (const b of bedrooms) {
        const toBed = findPathCells(grid, { cx: scx, cz: scz }, { cx: b.goalCx, cz: b.goalCz }, isOpen);
        if (!toBed) eOk = false;
      }
    }
    if (eOk) entranceOk++;

    // 5. Risk 1: a departing guest's shortest path (bedroom goal -> street)
    // must not run through the queue chain -- a guest leaving must not have
    // to cross the line waiting to check in.
    let rOk = true;
    if (streetCellIdx >= 0) {
      const scx = streetCellIdx % grid.width;
      const scz = Math.floor(streetCellIdx / grid.width);
      const queueSet = new Set(desk.queueCells.map((c) => `${c.cx}:${c.cz}`));
      for (const b of bedrooms) {
        const leavePath = findPathCells(grid, { cx: b.goalCx, cz: b.goalCz }, { cx: scx, cz: scz }, isOpen);
        if (!leavePath) {
          rOk = false;
          continue;
        }
        for (const cell of leavePath) {
          if (queueSet.has(`${cell.cx}:${cell.cz}`)) {
            rOk = false;
          }
        }
      }
    } else {
      rOk = false;
    }
    if (rOk) risk1Ok++;

    if (!(qOk && tOk && bOk && eOk && rOk)) {
      console.log(
        `  H1a FAIL seed="${seed}": queue=${qOk} terminal=${tOk} bedrooms=${bOk} entrance=${eOk} risk1=${rOk}`
      );
    }
  }

  console.log(`  H1a queue chain: ${queueOk}/${N} seeds passed`);
  check(`H1a: queue chain is walkable/non-door, adjacent, unique, clear for a 300mm collider, length>=8 across all ${N} seeds`, queueOk === N);

  console.log(`  H1a terminal anchor: ${terminalOk}/${N} seeds passed`);
  check(`H1a: terminal anchor is walkable, at the desk, and clear on all four sides across all ${N} seeds`, terminalOk === N);

  console.log(`  H1a bedrooms: ${bedroomsOk}/${N} seeds passed`);
  check(`H1a: every bedroom goal is walkable, clear, in-room, and reachable from the desk head across all ${N} seeds`, bedroomsOk === N);

  console.log(`  H1a entrance/street: ${entranceOk}/${N} seeds passed`);
  check(`H1a: street has walkable spawn cells and paths to the queue head and every bedroom across all ${N} seeds`, entranceOk === N);

  console.log(`  H1a risk-1 (queue bypass): ${risk1Ok}/${N} seeds passed`);
  check(`H1a: a departing guest's path from any bedroom goal to the street never crosses the queue chain, across all ${N} seeds`, risk1Ok === N);
}

// --- H2b: atlas invariants (docs/PHASE-H2.md section 11, mechanical gate 1). -
{
  const ATLAS_SEED = GOLDEN_SEED;
  const atlas = synthesizeAtlas(ATLAS_SEED);

  check("atlas: palette.length <= 32", atlas.palette.length <= 32);
  console.log(`  atlas palette size: ${atlas.palette.length}`);

  // Deterministic: same seed twice -> byte-identical pixels/regions/palette;
  // different seed -> different pixels.
  {
    const a = synthesizeAtlas(ATLAS_SEED);
    const b = synthesizeAtlas(ATLAS_SEED);
    const c = synthesizeAtlas("hotel-h2-look-2");
    check("atlas: same seed twice -> byte-identical pixels", Buffer.from(a.pixels).equals(Buffer.from(b.pixels)));
    check("atlas: same seed twice -> identical regions", JSON.stringify(a.regions) === JSON.stringify(b.regions));
    check("atlas: same seed twice -> identical palette", JSON.stringify(a.palette) === JSON.stringify(b.palette));
    check("atlas: different seed -> different pixels", !Buffer.from(a.pixels).equals(Buffer.from(c.pixels)));
  }

  // Every material id buildFloorMesh can stamp has a region; every region is
  // inside [0,1] and non-degenerate. buildFloorMesh's own vocabulary (see
  // FLOOR_MATERIAL/DEFAULT_FLOOR_MATERIAL/"wall"/"ceiling" in mesh-gen.ts)
  // is a subset of this list -- "door" is reserved for a later lane (door
  // geometry lives outside this package's H2b scope) but still gets a region
  // since the atlas vocabulary is committed up front.
  const STAMPABLE_MATERIAL_IDS = [
    "floor:lobby",
    "floor:corridor",
    "floor:room1",
    "floor:room2",
    "floor:room3",
    "floor:room4",
    "floor:default",
    "wall",
    "ceiling",
    "door",
  ];
  {
    let allOk = true;
    for (const id of STAMPABLE_MATERIAL_IDS) {
      const r = atlas.regions[id];
      if (!r) {
        allOk = false;
        console.log(`  atlas FAIL: no region for material id "${id}"`);
        continue;
      }
      const inRange = [r.u0, r.v0, r.u1, r.v1].every((v) => v >= 0 && v <= 1);
      const nonDegenerate = r.u1 > r.u0 && r.v1 > r.v0;
      if (!inRange || !nonDegenerate) {
        allOk = false;
        console.log(`  atlas FAIL: region for "${id}" out of [0,1] or degenerate: ${JSON.stringify(r)}`);
      }
    }
    check("atlas: every material id buildFloorMesh can stamp has a region, inside [0,1] and non-degenerate", allOk);
  }

  // Dither present: on a known near-flat tile region (value noise's lattice
  // spacing is 32px, so an 8px-wide sample window is locally near-constant),
  // the Bayer4x4 pattern should show up as high-frequency, period-4
  // alternation -- horizontally adjacent pixels differ (mean abs diff > 0),
  // and the row's period-4 autocorrelation beats its period-3 autocorrelation
  // (4 is the Bayer matrix's period; 3 is an arbitrary non-matching period
  // used as the "this isn't just noise" control). Made non-vacuous by also
  // running the same assertions against a synthetic FLAT (undithered) tile
  // constructed right here, which must FAIL both checks.
  function meanAbsHDiff(getPixel, x0, y0, w, h) {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w - 1; x++) {
        sum += Math.abs(getPixel(x, y) - getPixel(x + 1, y));
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }
  function periodAutocorrelation(getPixel, x0, y0, w, h, period) {
    // Mean product of (value - rowMean) at x and x+period, one row's worth,
    // normalized by variance -- a standard windowed autocorrelation.
    let corrSum = 0;
    let varSum = 0;
    for (let y = y0; y < y0 + h; y++) {
      const rowVals = [];
      for (let x = x0; x < x0 + w; x++) rowVals.push(getPixel(x, y));
      const mean = rowVals.reduce((a, v) => a + v, 0) / rowVals.length;
      for (let i = 0; i < rowVals.length; i++) varSum += (rowVals[i] - mean) ** 2;
      for (let i = 0; i + period < rowVals.length; i++) {
        corrSum += (rowVals[i] - mean) * (rowVals[i + period] - mean);
      }
    }
    return varSum > 0 ? corrSum / varSum : 0;
  }

  // Real atlas: sample the top-left 16x16 px of the "wall" tile (deep
  // enough inside the 128px tile, and small enough relative to the 32px
  // noise lattice spacing, to be near-flat pre-dither).
  {
    const region = atlas.regions["wall"];
    const tileX0 = Math.round(region.u0 * ATLAS_SIZE_PX);
    const tileY0 = Math.round(region.v0 * ATLAS_SIZE_PX);
    const getR = (x, y) => atlas.pixels[(y * ATLAS_SIZE_PX + x) * 4];
    const meanDiff = meanAbsHDiff(getR, tileX0, tileY0, 16, 16);
    const ac4 = periodAutocorrelation(getR, tileX0, tileY0, 16, 16, 4);
    const ac3 = periodAutocorrelation(getR, tileX0, tileY0, 16, 16, 3);
    console.log(`  dither probe (real atlas, "wall" tile): meanAbsHDiff=${meanDiff.toFixed(3)} ac4=${ac4.toFixed(3)} ac3=${ac3.toFixed(3)}`);
    check("atlas: dithered region has nonzero horizontal pixel alternation (meanAbsHDiff > 0)", meanDiff > 0);
    check("atlas: dithered region's period-4 autocorrelation exceeds its period-3 autocorrelation (Bayer4x4 signature)", ac4 > ac3);
  }

  // Control: a synthetic FLAT (undithered, constant-value) tile, same
  // sampling code. Must fail the meanAbsHDiff>0 check outright (which also
  // makes the ac4>ac3 comparison moot at 0-vs-0) -- printed either way so
  // the control's result is visible, per the task's "print that control's
  // result" instruction.
  {
    const FLAT_VALUE = 120;
    const getFlat = () => FLAT_VALUE;
    const meanDiffFlat = meanAbsHDiff(getFlat, 0, 0, 16, 16);
    const ac4Flat = periodAutocorrelation(getFlat, 0, 0, 16, 16, 4);
    const ac3Flat = periodAutocorrelation(getFlat, 0, 0, 16, 16, 3);
    console.log(
      `  dither probe (synthetic FLAT control): meanAbsHDiff=${meanDiffFlat.toFixed(3)} ac4=${ac4Flat.toFixed(3)} ac3=${ac3Flat.toFixed(3)} (expected to FAIL the dither-present assertions)`
    );
    const controlCorrectlyFlat = meanDiffFlat === 0;
    check(
      "atlas: dither-present assertion is non-vacuous -- a synthetic flat/undithered tile fails meanAbsHDiff > 0 (the real atlas's pass is meaningful)",
      controlCorrectlyFlat
    );
  }
}

// --- H2b: texel density -- UV extent * region size / quad world size ∈
// 64 ± 16 px/m on both axes, for every wall/floor/ceiling quad (docs/
// PHASE-H2.md section 11, mechanical gate 2). --------------------------------
{
  const atlas = synthesizeAtlas(GOLDEN_SEED);
  const gf = generateGroundFloor(GOLDEN_SEED);
  const pos = gf.mesh.positions;
  const uv = gf.mesh.uvs;
  const ind = gf.mesh.indices;

  check("texel density: mesh carries a uvs array sized 2 floats/vertex", uv.length === (pos.length / 3) * 2);

  function findRegion(u, v) {
    for (const id of Object.keys(atlas.regions)) {
      const r = atlas.regions[id];
      if (u >= r.u0 - 1e-9 && u < r.u1 + 1e-9 && v >= r.v0 - 1e-9 && v < r.v1 + 1e-9) return r;
    }
    return null;
  }

  let checkedQuads = 0;
  let densityOk = true;
  const TOLERANCE = 16;
  const TARGET = 64; // TEXELS_PER_METRE, checked directly below too.
  check("texel density: TEXELS_PER_METRE constant is 64", TEXELS_PER_METRE === 64);
  check("texel density: ATLAS_TILE_PX constant is 128", ATLAS_TILE_PX === 128);

  for (let q = 0; q * 6 < ind.length; q++) {
    const base = q * 6;
    const corners = [ind[base], ind[base + 1], ind[base + 2], ind[base + 3]];
    const xs = corners.map((vi) => pos[vi * 3]);
    const ys = corners.map((vi) => pos[vi * 3 + 1]);
    const zs = corners.map((vi) => pos[vi * 3 + 2]);
    const us = corners.map((vi) => uv[vi * 2]);
    const vs = corners.map((vi) => uv[vi * 2 + 1]);

    const allSameY = ys.every((y) => Math.abs(y - ys[0]) < 1e-9);
    const region = findRegion(us[0], vs[0]);
    if (!region) {
      densityOk = false;
      console.log(`  texel density FAIL: quad ${q} UV (${us[0]},${vs[0]}) matches no atlas region`);
      continue;
    }
    const regionSizeUPx = (region.u1 - region.u0) * ATLAS_SIZE_PX; // == ATLAS_TILE_PX
    const regionSizeVPx = (region.v1 - region.v0) * ATLAS_SIZE_PX;

    // World size (metres) per axis, straight from positions (never from
    // UVs -- UVs may have wrapped, positions never do).
    let worldSizeU;
    let worldSizeV;
    let axisLabel;
    if (allSameY) {
      // Floor/ceiling: u<->X, v<->Z.
      worldSizeU = Math.max(...xs) - Math.min(...xs);
      worldSizeV = Math.max(...zs) - Math.min(...zs);
      axisLabel = "xz";
    } else {
      const xConst = xs.every((x) => Math.abs(x - xs[0]) < 1e-9);
      if (xConst) {
        // X-facing wall: u<->Z, v<->Y.
        worldSizeU = Math.max(...zs) - Math.min(...zs);
        worldSizeV = Math.max(...ys) - Math.min(...ys);
        axisLabel = "zy";
      } else {
        // Z-facing wall: u<->X, v<->Y.
        worldSizeU = Math.max(...xs) - Math.min(...xs);
        worldSizeV = Math.max(...ys) - Math.min(...ys);
        axisLabel = "xy";
      }
    }
    if (worldSizeU <= 1e-9 || worldSizeV <= 1e-9) continue; // degenerate, skip

    // Reconstruct each axis' true (unwrapped) texel extent. A quad's
    // corners only ever take 2 distinct values per axis (min/max), so the
    // true extent is exactly worldSize*TEXELS_PER_METRE by construction of
    // wrapPx() in mesh-gen.ts (a pure per-vertex modulo of that value) --
    // the meaningful thing to verify is that the STORED (wrapped) UV data
    // is actually consistent with that, not just assume it. `nWraps` is
    // the number of full tile periods the raw texel run crosses (>0 only
    // for full-height walls, since WALL_HEIGHT_MM=2.7m exceeds the tile's
    // 2m period -- see mesh-gen.ts's addQuad doc comment); `localDeltaPx`
    // is the observed wrapped delta between the max- and min-world corner,
    // read back from the stored UVs through this quad's own region rect.
    // u axis.
    {
      // Find the corner with min/max world coordinate along u's source axis
      // rather than min/max UV (UVs wrap; positions don't).
      const uSourceVals = axisLabel === "xz" ? xs : axisLabel === "zy" ? zs : xs;
      let minI = 0;
      let maxI = 0;
      for (let i = 1; i < 4; i++) {
        if (uSourceVals[i] < uSourceVals[minI]) minI = i;
        if (uSourceVals[i] > uSourceVals[maxI]) maxI = i;
      }
      const uLocalMinPx = ((us[minI] - region.u0) / (region.u1 - region.u0)) * regionSizeUPx;
      const uLocalMaxPx = ((us[maxI] - region.u0) / (region.u1 - region.u0)) * regionSizeUPx;
      const rawTexels = worldSizeU * TEXELS_PER_METRE;
      const nWraps = Math.floor(rawTexels / ATLAS_TILE_PX + 1e-9);
      const localDeltaPx = (((uLocalMaxPx - uLocalMinPx) % ATLAS_TILE_PX) + ATLAS_TILE_PX) % ATLAS_TILE_PX;
      const extentPx = nWraps * ATLAS_TILE_PX + localDeltaPx;
      const density = extentPx / worldSizeU;
      if (Math.abs(density - TARGET) > TOLERANCE) {
        densityOk = false;
        console.log(
          `  texel density FAIL (u): quad ${q} axis=${axisLabel} worldSizeU=${worldSizeU.toFixed(3)}m extentPx=${extentPx.toFixed(1)} density=${density.toFixed(1)}px/m`
        );
      }
    }
    // v axis.
    {
      const vSourceVals = ys && !allSameY ? ys : zs;
      let minI = 0;
      let maxI = 0;
      for (let i = 1; i < 4; i++) {
        if (vSourceVals[i] < vSourceVals[minI]) minI = i;
        if (vSourceVals[i] > vSourceVals[maxI]) maxI = i;
      }
      const vLocalMinPx = ((vs[minI] - region.v0) / (region.v1 - region.v0)) * regionSizeVPx;
      const vLocalMaxPx = ((vs[maxI] - region.v0) / (region.v1 - region.v0)) * regionSizeVPx;
      const rawTexels = worldSizeV * TEXELS_PER_METRE;
      const nWraps = Math.floor(rawTexels / ATLAS_TILE_PX + 1e-9);
      const localDeltaPx = (((vLocalMaxPx - vLocalMinPx) % ATLAS_TILE_PX) + ATLAS_TILE_PX) % ATLAS_TILE_PX;
      const extentPx = nWraps * ATLAS_TILE_PX + localDeltaPx;
      const density = extentPx / worldSizeV;
      if (Math.abs(density - TARGET) > TOLERANCE) {
        densityOk = false;
        console.log(
          `  texel density FAIL (v): quad ${q} axis=${axisLabel} worldSizeV=${worldSizeV.toFixed(3)}m extentPx=${extentPx.toFixed(1)} density=${density.toFixed(1)}px/m`
        );
      }
    }
    checkedQuads++;
  }
  console.log(`  texel density: checked ${checkedQuads} wall/floor/ceiling quads`);
  check(`texel density: every wall/floor/ceiling quad's UV extent implies ${TARGET}±${TOLERANCE} px/m on both axes`, densityOk);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
