// Unit/property tests for @claude-engine/interiors, run against the built
// dist/ (npm run test -w @claude-engine/interiors builds first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs style.
import {
  generateGroundFloor,
  generateDoorMesh,
  DOOR_HEAD_HEIGHT_MM,
  WALL_HEIGHT_MM,
} from "../dist/index.js";
import { CELL, CELL_SIZE_MM, cellAt, findPathCells, findRoute, moveCircle, roomAt } from "@claude-engine/space";

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
    mesh: {
      positions: Array.from(gf.mesh.positions),
      normals: Array.from(gf.mesh.normals),
      indices: Array.from(gf.mesh.indices),
      colors: Array.from(gf.mesh.colors),
      triCount: gf.mesh.triCount,
    },
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
const GOLDEN_HASH = 0xe96201ca;

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
  check("doors: 4 rooms + lobby produce exactly 5 doors", gf.doors.length === 5);
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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
