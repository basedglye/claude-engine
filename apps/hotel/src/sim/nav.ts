/**
 * Pathfinding helpers for Phase H1a's guest nav (docs/PHASE-H1.md, "The
 * `apps/hotel` additions" -> nav.ts, and "Determinism rules specific to
 * this phase" 5 and 6). Pure; imports only @claude-engine/core (types) and
 * @claude-engine/space (grid primitives) — no changes to either package
 * (spec section F).
 *
 * Implementer's note on jitter and `findPathCells`: the spec asks for
 * jitter to be "added to A* g-cost", but `@claude-engine/space`'s exported
 * `findPathCells` (packages/space/src/route.ts) takes no cost-function
 * hook — it is fixed unit-cost — and spec section F rules out changing
 * `space` in this phase. Rather than patch around that by perturbing paths
 * post-hoc (which could not actually change *which* path A* picks), this
 * file implements its own small grid A* (`findJitteredPath`, below),
 * mirroring `findPathCells`'s algorithm and cell-occupiability rules
 * exactly (same SOLID/FURNITURE/DOOR handling via the same `CELL`
 * constants and `cellAt`) but with a pluggable per-step cost. This is
 * flagged in the phase report as a spec/package-boundary tension rather
 * than silently reused or silently diverging.
 */
import type { EntityId, Sim } from "@claude-engine/core";
import { CELL, cellAt, type NavGrid } from "@claude-engine/space";
import type { Door, NavAgent, Pos, PathCell } from "./components.js";

// -- Stateless hashing (determinism rule 5) --------------------------------

/** Committed integer hash (xorshift-mix), used only for jitter — never a
 *  substitute for the seeded Rng, and never advances any Rng stream. */
export function hash32(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** jitter(agentSeed, cx, cz) = hash32(agentSeed ^ (cz*width+cx)) & 3, per
 *  determinism rule 5. Pure function of its arguments: calling it
 *  repeatedly with the same inputs returns the same value and draws
 *  nothing from any Rng. `agentSeed` is assigned once at spawn time from
 *  forkRng("guest-spawn"). */
export function jitter(agentSeed: number, cx: number, cz: number, gridWidth: number): number {
  return hash32((agentSeed ^ ((cz * gridWidth + cx) >>> 0)) >>> 0) & 3;
}

// -- Per-tick open-cell set + occupancy (deferral item 2, determinism rule 6) --

/** True iff (cx,cz) is one of the cells spanned by some currently-open
 *  door. Built ONCE per tick (by the caller: pathSystem, and independently
 *  by moveSystem since they are separate top-level systems that may not
 *  share cross-system closure state) by scanning `withComponent("door")`
 *  against seed-pure portal data — never stored across ticks. */
export function buildOpenCellSet(
  sim: Sim,
  gridWidth: number,
  portalCellsByDoorIndex: readonly { cx: number; cz: number }[][]
): Set<number> {
  const open = new Set<number>();
  for (const [, door] of sim.withComponent<Door>("door")) {
    if (!door.open) continue;
    const cells = portalCellsByDoorIndex[door.doorIndex];
    if (!cells) continue;
    for (const c of cells) open.add(c.cz * gridWidth + c.cx);
  }
  return open;
}

export function makeIsOpen(openCells: ReadonlySet<number>, gridWidth: number): (cx: number, cz: number) => boolean {
  return (cx: number, cz: number) => openCells.has(cz * gridWidth + cx);
}

/** Cell index (cz*width+cx) -> the navAgent entity currently standing
 *  there, for the yield rule. Built fresh every call — not cached. */
export function buildOccupancy(sim: Sim, gridWidth: number): Map<number, EntityId> {
  const occ = new Map<number, EntityId>();
  for (const [entity] of sim.withComponent<NavAgent>("navAgent")) {
    const pos = sim.getComponent<Pos>(entity, "pos");
    if (!pos) continue;
    const cx = Math.floor(pos.xMm / CELL_SIZE_MM_LOCAL);
    const cz = Math.floor(pos.zMm / CELL_SIZE_MM_LOCAL);
    occ.set(cz * gridWidth + cx, entity);
  }
  return occ;
}

// Mirrors @claude-engine/space's CELL_SIZE_MM (250) without importing a
// value across the purity-root boundary redundantly — kept in lock-step by
// the shared constant re-export below, used only for the occupancy scan's
// own cell math (cellOfMm does the load-bearing conversion everywhere
// else in game.ts).
import { CELL_SIZE_MM as CELL_SIZE_MM_LOCAL } from "@claude-engine/space";

// -- The jittered A* (see file header) -------------------------------------

/** Can a circle-bodied agent of up to AGENT_RADIUS_MM stand on this cell's
 *  CENTRE?
 *
 *  H1a lane-7 correction of the original (doors-only, 4-neighbour) rule.
 *  The original version — written while fixing guests getting stuck in
 *  their own doorways — checked only the four cardinal neighbours, and
 *  only for DOOR cells. Both restrictions were wrong, and the second one
 *  hid the first:
 *
 *  - Cells are CELL_SIZE_MM = 250mm, agents are 300mm-radius. A cell
 *    centre is 125mm from its own edge and ~177mm from its nearest
 *    DIAGONAL cell's corner, so `space.moveCircle`'s circle-vs-AABB test
 *    reports a blocking cell anywhere in the 3x3 neighbourhood as an
 *    overlap. An agent can therefore never stand on the centre of a cell
 *    with ANY blocking neighbour, diagonals included.
 *  - Nothing about that is door-specific: a WALKABLE cell one step from a
 *    wall or from the front desk's FURNITURE row is equally unoccupiable.
 *
 *  Concretely (seed "hotel-h1-rush-1"): A* happily routed arriving guests
 *  onto cell (22,7), whose four cardinal neighbours are all walkable but
 *  whose DIAGONAL neighbour (21,6) is the wall beside the entrance
 *  doorway. Guests walked in through the door, stopped dead at (23,7) and
 *  stayed there for the rest of the run, because every step of their own
 *  computed path was refused by `moveCircle`.
 *
 *  So: a cell is occupiable only if all eight neighbours are non-blocking.
 *  DOOR neighbours count as non-blocking here, matching `pathSystem`'s
 *  optimistic planning (guests open the doors they need — see game.ts's
 *  moveSystem door-opening block); the real `open` bit is still enforced
 *  by `moveCircle` at the moment of the move. The cost is one cell of
 *  margin against every wall, which the generated floor has everywhere
 *  (6-cell corridors, 4-cell doorways -> 2 usable lanes, and
 *  packages/interiors' 100-seed sweep asserts clearance for the queue
 *  slots, bedroom goals, terminal anchor and street cells). */
function hasClearance(grid: NavGrid, cx: number, cz: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const cell = cellAt(grid, cx + dx, cz + dz);
      if (cell & CELL.SOLID) return false;
      if (cell & CELL.FURNITURE) return false;
    }
  }
  return true;
}

/** Exported as `isOccupiableCell` for game.ts's clerk-work-cell derivation:
 *  a cell an NPC is asked to STAND on must satisfy exactly the rule A* uses
 *  to route onto it, or the goal is unreachable and the agent wanders. */
export function isOccupiable(grid: NavGrid, cx: number, cz: number, isOpen: (cx: number, cz: number) => boolean): boolean {
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return false;
  const cell = cellAt(grid, cx, cz);
  if (cell & CELL.SOLID) return false;
  if (cell & CELL.FURNITURE) return false;
  if (cell & CELL.DOOR) {
    if (!isOpen(cx, cz)) return false;
  }
  if (!hasClearance(grid, cx, cz)) return false;
  return (cell & CELL.WALKABLE) !== 0;
}

/** Grid A* between two cells (4-connected), step cost `1 + jitter(...)` so
 *  agents with different `agentSeed`s prefer slightly different columns in
 *  wide spaces without ever touching an Rng at query time. Deterministic
 *  tie-break: lower (cz*width+cx) index wins, same convention as
 *  `@claude-engine/space`'s `findPathCells`.
 *
 *  ALLOCATION (docs/PHASE-H2.md §12 item 2, H1b review deferral 4c): the
 *  four per-cell working arrays are module-level scratch, sized once to the
 *  grid and reused across calls via generation stamping instead of being
 *  allocated and filled per call. At 10 repaths/tick over a ~1000-cell
 *  grid that was ~40k element writes per tick of pure setup. This is
 *  deterministic for the same reason a fresh array is: nothing survives a
 *  call. A cell is only ever read after its stamp has been set to the
 *  current generation in the same call, so a stale value from a previous
 *  call can never be observed. The generation counter is a pure
 *  performance detail — it is never hashed, never in a component, and is
 *  reset (along with the stamps) on wraparound.
 */
let scratchSize = 0;
let scratchGeneration = 0;
let scratchGScore = new Int32Array(0);
let scratchCameFrom = new Int32Array(0);
let scratchStamp = new Uint32Array(0);
let scratchClosed = new Uint32Array(0);
let scratchInOpen = new Uint32Array(0);
const scratchOpenList: number[] = [];

function ensureScratch(size: number): void {
  if (scratchSize === size) {
    scratchGeneration++;
    // Uint32 wraparound would make every stale stamp look current. Reset
    // the stamp arrays and restart at 1 — correctness, not just hygiene.
    if (scratchGeneration >= 0xffffffff) {
      scratchStamp.fill(0);
      scratchClosed.fill(0);
      scratchInOpen.fill(0);
      scratchGeneration = 1;
    }
    return;
  }
  scratchSize = size;
  scratchGeneration = 1;
  scratchGScore = new Int32Array(size);
  scratchCameFrom = new Int32Array(size);
  scratchStamp = new Uint32Array(size);
  scratchClosed = new Uint32Array(size);
  scratchInOpen = new Uint32Array(size);
}

export function findJitteredPath(
  grid: NavGrid,
  from: PathCell,
  to: PathCell,
  isOpen: (cx: number, cz: number) => boolean,
  agentSeed: number,
  /** Cell index (cz*width+cx) to route AROUND, or -1 for none. The
   *  sidestep branch of moveSystem's yield rule passes the cell it was
   *  blocked on, so the repath is a genuine detour instead of a re-plan of
   *  the identical route (see game.ts). Never applied to the start or goal
   *  cell — an agent standing on it, or aiming at it, still gets a path. */
  avoidIdx: number = -1
): PathCell[] | null {
  if (!isOccupiable(grid, from.cx, from.cz, isOpen)) return null;
  if (!isOccupiable(grid, to.cx, to.cz, isOpen)) return null;

  const idxOf = (cx: number, cz: number) => cz * grid.width + cx;
  const startIdx = idxOf(from.cx, from.cz);
  const goalIdx = idxOf(to.cx, to.cz);
  if (startIdx === goalIdx) return [{ cx: from.cx, cz: from.cz }];

  const size = grid.width * grid.height;
  ensureScratch(size);
  const gen = scratchGeneration;
  const gScore = scratchGScore;
  const cameFrom = scratchCameFrom;
  const stamp = scratchStamp;
  const closed = scratchClosed;
  const inOpen = scratchInOpen;

  /** gScore for a cell not yet reached this call reads as "infinite". */
  const gAt = (idx: number): number => (stamp[idx] === gen ? gScore[idx]! : Infinity);

  gScore[startIdx] = 0;
  cameFrom[startIdx] = -1;
  stamp[startIdx] = gen;

  const heuristic = (idx: number): number => {
    const cx = idx % grid.width;
    const cz = Math.floor(idx / grid.width);
    return Math.abs(cx - to.cx) + Math.abs(cz - to.cz);
  };

  const open = scratchOpenList;
  open.length = 0;
  open.push(startIdx);
  inOpen[startIdx] = gen;

  while (open.length > 0) {
    let bestPos = 0;
    let bestF = gAt(open[0]!) + heuristic(open[0]!);
    for (let i = 1; i < open.length; i++) {
      const idx = open[i]!;
      const f = gAt(idx) + heuristic(idx);
      if (f < bestF || (f === bestF && idx < open[bestPos]!)) {
        bestF = f;
        bestPos = i;
      }
    }
    const currentIdx = open[bestPos]!;
    open.splice(bestPos, 1);
    inOpen[currentIdx] = 0;

    if (currentIdx === goalIdx) {
      // The output path is a FRESH array: it lives in a component, so it
      // must not alias scratch.
      const path: PathCell[] = [];
      let cur = currentIdx;
      while (cur !== -1) {
        path.push({ cx: cur % grid.width, cz: Math.floor(cur / grid.width) });
        cur = cameFrom[cur]!;
      }
      path.reverse();
      return path;
    }
    closed[currentIdx] = gen;

    const cx = currentIdx % grid.width;
    const cz = Math.floor(currentIdx / grid.width);
    const neighbours: PathCell[] = [
      { cx: cx + 1, cz },
      { cx: cx - 1, cz },
      { cx, cz: cz + 1 },
      { cx, cz: cz - 1 },
    ];
    for (const n of neighbours) {
      if (n.cx < 0 || n.cz < 0 || n.cx >= grid.width || n.cz >= grid.height) continue;
      if (!isOccupiable(grid, n.cx, n.cz, isOpen)) continue;
      const nIdx = idxOf(n.cx, n.cz);
      if (nIdx === avoidIdx && nIdx !== goalIdx) continue;
      if (closed[nIdx] === gen) continue;
      const stepCost = 1 + jitter(agentSeed, n.cx, n.cz, grid.width);
      const tentativeG = gAt(currentIdx) + stepCost;
      if (tentativeG < gAt(nIdx)) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        stamp[nIdx] = gen;
        if (inOpen[nIdx] !== gen) {
          open.push(nIdx);
          inOpen[nIdx] = gen;
        }
      }
    }
  }

  return null;
}
