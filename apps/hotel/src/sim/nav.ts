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

/** Judgment-call fix, discovered while wiring the desk/street doorways
 *  (this file's own bug, not `interiors`'): a DOOR span is
 *  DOOR_WIDTH_CELLS (4) cells = 1000mm wide, but guest/player colliders are
 *  GUEST_RADIUS_MM/PLAYER_RADIUS_MM = 300mm — a circle centered on either
 *  EDGE cell of a 4-cell span sits only 125mm from the jamb, well inside
 *  its own radius, so `moveCircle` (space's axis-separated circle-vs-grid
 *  check) correctly refuses to move there even though the cell itself is
 *  WALKABLE|DOOR. `findPathCells`/`findJitteredPath` only ever tested
 *  single-cell occupiability, so A* happily routed guests onto those edge
 *  cells and they then got stuck forever unable to step through their own
 *  computed path. Fix: a DOOR cell is only occupiable for a circle-bodied
 *  agent if neither of its cardinal neighbours is SOLID — that excludes
 *  exactly the two jamb-adjacent edge cells of every span (the two
 *  interior cells of a 4-wide span clear the jamb by 375mm > 300mm) and
 *  leaves through-traffic cells untouched (their in-line neighbours are
 *  WALKABLE on both sides of the doorway, never SOLID). Applies to every
 *  door this pathfinder crosses, not just the entrance. */
function hasClearance(grid: NavGrid, cx: number, cz: number): boolean {
  const neighbours: [number, number][] = [
    [cx + 1, cz],
    [cx - 1, cz],
    [cx, cz + 1],
    [cx, cz - 1],
  ];
  for (const [nx, nz] of neighbours) {
    if (cellAt(grid, nx, nz) & CELL.SOLID) return false;
  }
  return true;
}

function isOccupiable(grid: NavGrid, cx: number, cz: number, isOpen: (cx: number, cz: number) => boolean): boolean {
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return false;
  const cell = cellAt(grid, cx, cz);
  if (cell & CELL.SOLID) return false;
  if (cell & CELL.FURNITURE) return false;
  if (cell & CELL.DOOR) {
    if (!isOpen(cx, cz)) return false;
    if (!hasClearance(grid, cx, cz)) return false;
  }
  return (cell & CELL.WALKABLE) !== 0;
}

/** Grid A* between two cells (4-connected), step cost `1 + jitter(...)` so
 *  agents with different `agentSeed`s prefer slightly different columns in
 *  wide spaces without ever touching an Rng at query time. Deterministic
 *  tie-break: lower (cz*width+cx) index wins, same convention as
 *  `@claude-engine/space`'s `findPathCells`. */
export function findJitteredPath(
  grid: NavGrid,
  from: PathCell,
  to: PathCell,
  isOpen: (cx: number, cz: number) => boolean,
  agentSeed: number
): PathCell[] | null {
  if (!isOccupiable(grid, from.cx, from.cz, isOpen)) return null;
  if (!isOccupiable(grid, to.cx, to.cz, isOpen)) return null;

  const idxOf = (cx: number, cz: number) => cz * grid.width + cx;
  const startIdx = idxOf(from.cx, from.cz);
  const goalIdx = idxOf(to.cx, to.cz);
  if (startIdx === goalIdx) return [{ cx: from.cx, cz: from.cz }];

  const size = grid.width * grid.height;
  const gScore = new Array<number>(size).fill(Infinity);
  const cameFrom = new Array<number>(size).fill(-1);
  const closed = new Array<boolean>(size).fill(false);
  gScore[startIdx] = 0;

  const heuristic = (idx: number): number => {
    const cx = idx % grid.width;
    const cz = Math.floor(idx / grid.width);
    return Math.abs(cx - to.cx) + Math.abs(cz - to.cz);
  };

  const open: number[] = [startIdx];
  const inOpen = new Array<boolean>(size).fill(false);
  inOpen[startIdx] = true;

  while (open.length > 0) {
    let bestPos = 0;
    let bestF = gScore[open[0]!]! + heuristic(open[0]!);
    for (let i = 1; i < open.length; i++) {
      const idx = open[i]!;
      const f = gScore[idx]! + heuristic(idx);
      if (f < bestF || (f === bestF && idx < open[bestPos]!)) {
        bestF = f;
        bestPos = i;
      }
    }
    const currentIdx = open[bestPos]!;
    open.splice(bestPos, 1);
    inOpen[currentIdx] = false;

    if (currentIdx === goalIdx) {
      const path: PathCell[] = [];
      let cur = currentIdx;
      while (cur !== -1) {
        path.push({ cx: cur % grid.width, cz: Math.floor(cur / grid.width) });
        cur = cameFrom[cur]!;
      }
      path.reverse();
      return path;
    }
    closed[currentIdx] = true;

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
      if (closed[nIdx]) continue;
      const stepCost = 1 + jitter(agentSeed, n.cx, n.cz, grid.width);
      const tentativeG = gScore[currentIdx]! + stepCost;
      if (tentativeG < gScore[nIdx]!) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        if (!inOpen[nIdx]) {
          open.push(nIdx);
          inOpen[nIdx] = true;
        }
      }
    }
  }

  return null;
}
