// Unit/property tests for @claude-engine/interiors, run against the built
// dist/ (npm run test -w @claude-engine/interiors builds first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs style.
import {
  generateGroundFloor,
  generateDoorMesh,
} from "../dist/index.js";
import { CELL, cellAt, findPathCells, findRoute } from "@claude-engine/space";

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
const GOLDEN_HASH = 0x1da01366;

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

// --- One-source-of-truth property: every wall quad <-> every grid boundary. -
{
  const gf = generateGroundFloor(GOLDEN_SEED);
  const { grid } = gf;
  const { width, height, originXMm, originZMm } = grid;
  const S = 250;

  function isWalkable(cellValue) {
    return (cellValue & CELL.WALKABLE) !== 0;
  }
  function idx(cx, cz) {
    return cz * width + cx;
  }

  // Ground truth: every internal cell-edge boundary where walkability
  // differs, keyed by (axis, boundary plane mm, cell-span start mm).
  const expected = new Set();
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width - 1; cx++) {
      const wa = isWalkable(grid.cells[idx(cx, cz)] ?? CELL.SOLID);
      const wc = isWalkable(grid.cells[idx(cx + 1, cz)] ?? CELL.SOLID);
      if (wa !== wc) {
        const bx = originXMm + (cx + 1) * S;
        const z0 = originZMm + cz * S;
        expected.add(`x:${bx}:${z0}`);
      }
    }
  }
  for (let cz = 0; cz < height - 1; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const wa = isWalkable(grid.cells[idx(cx, cz)] ?? CELL.SOLID);
      const wc = isWalkable(grid.cells[idx(cx, cz + 1)] ?? CELL.SOLID);
      if (wa !== wc) {
        const bz = originZMm + (cz + 1) * S;
        const x0 = originXMm + cx * S;
        expected.add(`z:${bz}:${x0}`);
      }
    }
  }

  // Reconstruct wall quads from the mesh: 2 triangles (6 indices) per quad,
  // emitted contiguously (mesh-gen.ts's documented convention). A wall
  // quad's 4 corners do NOT all share the same Y (floor/ceiling quads do).
  const pos = gf.mesh.positions;
  const ind = gf.mesh.indices;
  const actual = new Set();
  let wallQuadCount = 0;
  for (let q = 0; q * 6 < ind.length; q++) {
    const base = q * 6;
    // Unique corner vertex indices for this quad (p0,p1,p2,p3 from addQuad).
    const corners = [ind[base], ind[base + 1], ind[base + 2], ind[base + 3]];
    const ys = corners.map((vi) => pos[vi * 3 + 1]);
    const allSameY = ys.every((y) => Math.abs(y - ys[0]) < 1e-9);
    if (allSameY) continue; // floor or ceiling quad, not a wall
    wallQuadCount++;
    // mm coords (positions are metres -> back to mm, rounded).
    const xs = corners.map((vi) => Math.round(pos[vi * 3] * 1000));
    const zs = corners.map((vi) => Math.round(pos[vi * 3 + 2] * 1000));
    const xConst = xs.every((x) => x === xs[0]);
    const zConst = zs.every((z) => z === zs[0]);
    if (xConst && !zConst) {
      const bx = xs[0];
      const z0 = Math.min(...zs);
      actual.add(`x:${bx}:${z0}`);
    } else if (zConst && !xConst) {
      const bz = zs[0];
      const x0 = Math.min(...xs);
      actual.add(`z:${bz}:${x0}`);
    } else {
      check("one-source-of-truth: wall quad is axis-aligned (const x or const z)", false);
    }
  }

  check("one-source-of-truth: every emitted wall quad matches a grid boundary", [...actual].every((k) => expected.has(k)));
  check("one-source-of-truth: every grid boundary has an emitted wall quad", [...expected].every((k) => actual.has(k)));
  check("one-source-of-truth: wall quad count equals boundary count", wallQuadCount === expected.size);
  console.log(`  boundary/wall-quad count for seed "${GOLDEN_SEED}": ${expected.size}`);
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
  check("generateDoorMesh: horizontal span ~= 0.25m doorway width", Math.abs(doorSpan - 0.25) < 0.01);
  check("generateDoorMesh: height ~= 2.1m", Math.abs(spanY - 2.1) < 0.01);
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
