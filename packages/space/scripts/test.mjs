// Unit tests for @claude-engine/space, run against the built dist/ (npm run
// test -w @claude-engine/space builds first). Hand-rolled assert-and-exit
// script, matching packages/core/scripts/test.mjs style rather than pulling
// in Node's test runner.
import {
  ONE,
  FULL_TURN_MDEG,
  sinMdeg,
  cosMdeg,
  atan2Mdeg,
  isqrt,
  angleDeltaMdeg,
  CELL,
  cellAt,
  cellOfMm,
  moveCircle,
  losClear,
  roomAt,
  findPathCells,
  findRoute,
} from "../dist/index.js";
import { generateLutSource } from "./gen-sin-lut.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

// --- LUT regeneration is byte-identical to the committed file --------------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const committedPath = join(here, "..", "src", "sin-lut.ts");
  const committed = readFileSync(committedPath, "utf8");
  const regenerated = generateLutSource();
  check("sin-lut.ts: regeneration is byte-identical to committed file", committed === regenerated);
}

// --- sinMdeg / cosMdeg golden values at boundary angles ---------------------
{
  const tol = 3; // units of Q16.16
  function near(actual, expected, t = tol) {
    return Math.abs(actual - expected) <= t;
  }
  check("sinMdeg(0) == 0", sinMdeg(0) === 0);
  check("sinMdeg(90_000) == ONE", sinMdeg(90_000) === ONE);
  check("sinMdeg(180_000) ~= 0", near(sinMdeg(180_000), 0));
  check("sinMdeg(270_000) == -ONE", sinMdeg(270_000) === -ONE);
  check("sinMdeg(359_999) ~= 0 (just under 360)", near(sinMdeg(359_999), 0, 20));
  check("sinMdeg(-90_000) == -ONE (negative wraps)", sinMdeg(-90_000) === -ONE);
  check("sinMdeg(450_000) == ONE (>360 wraps, 450=90+360)", sinMdeg(450_000) === ONE);
  check("cosMdeg(0) == ONE", cosMdeg(0) === ONE);
  check("cosMdeg(90_000) ~= 0", near(cosMdeg(90_000), 0));
  check("cosMdeg(180_000) == -ONE", cosMdeg(180_000) === -ONE);
}

// --- sinMdeg max error vs Math.sin across a full sweep ----------------------
{
  let maxErr = 0;
  for (let mdeg = 0; mdeg < FULL_TURN_MDEG; mdeg += 37) {
    const expected = Math.round(Math.sin((mdeg * Math.PI) / 180000) * ONE);
    const actual = sinMdeg(mdeg);
    const err = Math.abs(actual - expected);
    if (err > maxErr) maxErr = err;
  }
  console.log(`  sinMdeg max error vs Math.sin*ONE across sweep (step 37 mdeg): ${maxErr} (Q16.16 units)`);
  check("sinMdeg: max error <= 3 units of Q16.16 across sweep", maxErr <= 3);
}

// --- atan2Mdeg accuracy within 100 mdeg, all quadrants + axes --------------
{
  function refAtan2Mdeg(y, x) {
    if (x === 0 && y === 0) return 0;
    let deg = (Math.atan2(y, x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg * 1000);
  }
  function angDist(a, b) {
    let d = Math.abs(a - b) % FULL_TURN_MDEG;
    if (d > FULL_TURN_MDEG / 2) d = FULL_TURN_MDEG - d;
    return d;
  }
  let maxErr = 0;
  const coords = [];
  for (let x = -20; x <= 20; x += 3) {
    for (let y = -20; y <= 20; y += 3) {
      coords.push([y, x]);
    }
  }
  // axes explicitly
  coords.push([0, 5], [0, -5], [5, 0], [-5, 0]);
  for (const [y, x] of coords) {
    if (x === 0 && y === 0) continue;
    const actual = atan2Mdeg(y, x);
    const expected = refAtan2Mdeg(y, x);
    const err = angDist(actual, expected);
    if (err > maxErr) maxErr = err;
  }
  console.log(`  atan2Mdeg max error vs Math.atan2 across sweep: ${maxErr} mdeg`);
  check("atan2Mdeg: within 100 mdeg across sweep", maxErr <= 100);
  check("atan2Mdeg(0,0) documented result is 0", atan2Mdeg(0, 0) === 0);
  check("atan2Mdeg quadrant 1 (5,5) ~= 45000", angDist(atan2Mdeg(5, 5), 45000) <= 100);
  check("atan2Mdeg quadrant 2 (5,-5) ~= 135000", angDist(atan2Mdeg(5, -5), 135000) <= 100);
  check("atan2Mdeg quadrant 3 (-5,-5) ~= 225000", angDist(atan2Mdeg(-5, -5), 225000) <= 100);
  check("atan2Mdeg quadrant 4 (-5,5) ~= 315000", angDist(atan2Mdeg(-5, 5), 315000) <= 100);
}

// --- isqrt --------------------------------------------------------------
{
  check("isqrt(0) == 0", isqrt(0) === 0);
  check("isqrt(1) == 1", isqrt(1) === 1);
  check("isqrt(4) == 2 (perfect square)", isqrt(4) === 2);
  check("isqrt(9) == 3 (perfect square)", isqrt(9) === 3);
  check("isqrt(10000) == 100 (perfect square)", isqrt(10000) === 100);
  check("isqrt(3) == 1 (below next square)", isqrt(3) === 1);
  check("isqrt(5) == 2 (above square, off-by-one)", isqrt(5) === 2);
  check("isqrt(8) == 2 (off-by-one below 9)", isqrt(8) === 2);
  check("isqrt(15) == 3 (off-by-one below 16)", isqrt(15) === 3);
  check("isqrt(17) == 4 (off-by-one above 16)", isqrt(17) === 4);
  let threw = false;
  try {
    isqrt(-1);
  } catch {
    threw = true;
  }
  check("isqrt(-1) throws", threw);
}

// --- angleDeltaMdeg wrap-around --------------------------------------------
{
  check("angleDeltaMdeg(1000, 359000) == 2000 (wraps forward)", angleDeltaMdeg(1000, 359000) === 2000);
  check("angleDeltaMdeg(359000, 1000) == -2000", angleDeltaMdeg(359000, 1000) === -2000);
  check("angleDeltaMdeg(0, 0) == 0", angleDeltaMdeg(0, 0) === 0);
  check("angleDeltaMdeg(180000, 0) == 180000 (boundary)", angleDeltaMdeg(180000, 0) === 180000);
  check("angleDeltaMdeg(90000, 270000) == -180000+... in range", (() => {
    const d = angleDeltaMdeg(90000, 270000);
    return d > -180000 && d <= 180000 && Math.abs(Math.abs(d) - 180000) <= 0;
  })());
  check("angleDeltaMdeg(10000, 350000) == 20000", angleDeltaMdeg(10000, 350000) === 20000);
}

// ============================================================================
// grid.ts tests
// ============================================================================

// Build a small 10x10 test grid (2500mm x 2500mm at 250mm cells):
// Row layout (z=0 top): a horizontal wall at cz=5 spanning cx=0..9 except a
// door at cx=5 (DOOR flag). All other cells WALKABLE. Origin at (0,0).
function buildTestGrid() {
  const width = 10;
  const height = 10;
  const cells = new Array(width * height).fill(CELL.WALKABLE);
  for (let cx = 0; cx < width; cx++) {
    const idx = 5 * width + cx;
    if (cx === 5) {
      cells[idx] = CELL.WALKABLE | CELL.DOOR;
    } else {
      cells[idx] = CELL.SOLID;
    }
  }
  return { width, height, originXMm: 0, originZMm: 0, cells };
}

{
  const grid = buildTestGrid();
  check("cellAt: wall cell has SOLID bit", (cellAt(grid, 2, 5) & CELL.SOLID) !== 0);
  check("cellAt: door cell has DOOR bit", (cellAt(grid, 5, 5) & CELL.DOOR) !== 0);
  check("cellAt: open floor is WALKABLE only", cellAt(grid, 2, 2) === CELL.WALKABLE);
  check("cellAt: out of bounds is SOLID", (cellAt(grid, -1, 0) & CELL.SOLID) !== 0);

  const c = cellOfMm(grid, 625, 625); // 625/250 = 2.5 -> cx=2
  check("cellOfMm: (625,625) -> (2,2)", c.cx === 2 && c.cz === 2);
}

// --- moveCircle: free movement -----------------------------------------
{
  const grid = buildTestGrid();
  const start = { xMm: 500, zMm: 500 }; // well inside open area, cz=2 row
  const res = moveCircle(grid, start.xMm, start.zMm, 100, 50, 80);
  check("moveCircle: free movement moves both axes", res.xMm === 600 && res.zMm === 550);
}

// --- moveCircle: head-on wall stop --------------------------------------
{
  const grid = buildTestGrid();
  // Approach the wall row (cz=5, worldZ 1250..1500) from above (z=1100),
  // moving straight down (+z), radius small enough that only Z is blocked.
  const res = moveCircle(grid, 625, 1100, 0, 200, 60);
  check("moveCircle: head-on wall stop blocks Z (0mm movement)", res.zMm === 1100);
  check("moveCircle: head-on wall stop leaves X unaffected", res.xMm === 625);
}

// --- moveCircle: wall slide ----------------------------------------------
{
  const grid = buildTestGrid();
  // Moving diagonally into the wall: dx free, dz blocked by wall -> slides
  // along X while Z is stopped.
  const res = moveCircle(grid, 625, 1100, 50, 200, 60);
  check("moveCircle: wall slide keeps free-axis (X) movement", res.xMm === 675);
  check("moveCircle: wall slide stops blocked-axis (Z) movement", res.zMm === 1100);
}

// --- moveCircle: both axes blocked (corner) ------------------------------
{
  // Grid with a solid block at (5,5) and (6,5) forming a corner obstruction
  // near (5,4)/(6,4) too, so moving toward (5,5) diagonally from (4,4) hits
  // solid on both resolved axes.
  const width = 10;
  const height = 10;
  const cells = new Array(width * height).fill(CELL.WALKABLE);
  cells[5 * width + 5] = CELL.SOLID;
  cells[5 * width + 6] = CELL.SOLID;
  cells[6 * width + 5] = CELL.SOLID;
  const grid = { width, height, originXMm: 0, originZMm: 0, cells };
  // Player circle centered just NW of the solid corner cluster (cell 5,5
  // occupies world 1250..1500 in both axes). Start close enough that any
  // movement toward the corner is blocked on both resolved axes.
  const start = { xMm: 1230, zMm: 1230 };
  const res = moveCircle(grid, start.xMm, start.zMm, 40, 40, 60);
  check("moveCircle: corner case blocks both axes", res.xMm === start.xMm && res.zMm === start.zMm);
}

// --- moveCircle: DOOR cell blocks closed, passes open --------------------
{
  const grid = buildTestGrid();
  // Move straight through the door cell (cx=5, world x 1250..1500) at cz=5
  // (world z 1250..1500), approaching from above.
  const closedRes = moveCircle(grid, 1375, 1100, 0, 200, 60, () => false);
  check("moveCircle: closed door blocks", closedRes.zMm === 1100);

  const openRes = moveCircle(grid, 1375, 1100, 0, 200, 60, () => true);
  check("moveCircle: open door passes", openRes.zMm === 1300);
}

// --- moveCircle: radius keeps circle out of the wall ----------------------
{
  const grid = buildTestGrid();
  // Approach wall (starts at world z=1250) with a normal-sized step (a real
  // caller never exceeds MOVE_SPEED_MM_PER_TICK = 200mm/tick per H0 spec);
  // radius 60 means the circle's edge must stay >= 60mm from the wall face.
  const res = moveCircle(grid, 625, 1150, 0, 150, 60);
  check("moveCircle: never ends up overlapping the wall (never inside SOLID)", res.zMm <= 1250 - 60);
}

// --- moveCircle: never NaN -------------------------------------------------
{
  const grid = buildTestGrid();
  const res = moveCircle(grid, 0, 0, 0, 0, 60);
  check("moveCircle: zero movement never produces NaN", !Number.isNaN(res.xMm) && !Number.isNaN(res.zMm));
}

// --- losClear ---------------------------------------------------------------
{
  const grid = buildTestGrid();
  check("losClear: clear line within open room", losClear(grid, 250, 250, 250, 1100));
  check("losClear: line through a solid wall segment is blocked", !losClear(grid, 625, 250, 625, 2250));
  check("losClear: line through a closed door is blocked", !losClear(grid, 1375, 250, 1375, 2250, () => false));
  check("losClear: line through an open door passes", losClear(grid, 1375, 250, 1375, 2250, () => true));
}

// ============================================================================
// portals.ts / route.ts tests
// ============================================================================

// Build a two-room grid split by the wall-with-door grid above: room 1
// above the wall (cz 0..4), room 2 below (cz 6..9), row 5 is the wall/door.
function buildTwoRoomWorld() {
  const grid = buildTestGrid();
  const width = grid.width;
  const height = grid.height;
  const rooms = new Array(width * height).fill(-1);
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const idx = cz * width + cx;
      if (cell_is_solid(grid.cells[idx])) continue;
      rooms[idx] = cz <= 4 ? 1 : cz >= 5 ? 2 : -1;
    }
  }
  function cell_is_solid(c) {
    return (c & CELL.SOLID) !== 0;
  }
  const portal = { id: 0, roomA: 1, roomB: 2, cells: [{ cx: 5, cz: 5 }] };
  const graph = {
    rooms: [[], [0], [0]], // index 0 unused ("outside" reserved but not modeled here)
    portals: [portal],
  };
  return { grid, rooms, graph };
}

{
  const { grid, rooms } = buildTwoRoomWorld();
  check("roomAt: point in room 1", roomAt(rooms, grid, 250, 250) === 1);
  check("roomAt: point in room 2", roomAt(rooms, grid, 250, 2250) === 2);
  check("roomAt: point in a wall is -1", roomAt(rooms, grid, 625, 1300) === -1);
}

// --- findPathCells: around an obstacle -------------------------------------
{
  const grid = buildTestGrid();
  const from = { cx: 2, cz: 2 };
  const to = { cx: 2, cz: 7 };
  const path = findPathCells(grid, from, to, () => true); // door open
  check("findPathCells: finds a path through the open door", path !== null);
  if (path) {
    check("findPathCells: path starts at from", path[0].cx === from.cx && path[0].cz === from.cz);
    check("findPathCells: path ends at to", path[path.length - 1].cx === to.cx && path[path.length - 1].cz === to.cz);
    // Every step must be 4-connected.
    let stepsOk = true;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dist = Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
      if (dist !== 1) stepsOk = false;
    }
    check("findPathCells: every step is 4-connected", stepsOk);
    check("findPathCells: path passes through the door cell (5,5)", path.some((p) => p.cx === 5 && p.cz === 5));
  }
}

// --- findPathCells: unreachable target returns null ------------------------
{
  const grid = buildTestGrid();
  const from = { cx: 2, cz: 2 };
  const to = { cx: 2, cz: 7 };
  const path = findPathCells(grid, from, to, () => false); // door closed -> unreachable
  check("findPathCells: unreachable target returns null", path === null);
}

// --- findPathCells: determinism ---------------------------------------------
{
  const grid = buildTestGrid();
  const from = { cx: 0, cz: 0 };
  const to = { cx: 9, cz: 4 };
  const p1 = findPathCells(grid, from, to, () => true);
  const p2 = findPathCells(grid, from, to, () => true);
  check(
    "findPathCells: deterministic (same inputs -> identical array)",
    JSON.stringify(p1) === JSON.stringify(p2)
  );
}

// --- findRoute: multi-hop, same-room, unreachable ---------------------------
{
  const { graph } = buildTwoRoomWorld();
  const route = findRoute(graph, 1, 2);
  check("findRoute: multi-hop route via the one portal", Array.isArray(route) && route.length === 1 && route[0] === 0);

  const sameRoom = findRoute(graph, 1, 1);
  check("findRoute: same-room route is empty array", Array.isArray(sameRoom) && sameRoom.length === 0);

  const unreachable = findRoute(graph, 1, 3); // room 3 doesn't exist in this graph's rooms array bounds
  check("findRoute: unreachable/out-of-range room returns null", unreachable === null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
