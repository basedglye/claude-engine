import { CELL, cellAt, type NavGrid } from "./grid.js";
import type { PortalGraph } from "./portals.js";

interface CellCoord {
  cx: number;
  cz: number;
}

function cellIndex(grid: NavGrid, cx: number, cz: number): number {
  return cz * grid.width + cx;
}

function isOccupiable(
  grid: NavGrid,
  cx: number,
  cz: number,
  isOpen?: (cx: number, cz: number) => boolean
): boolean {
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return false;
  const cell = cellAt(grid, cx, cz);
  if (cell & CELL.SOLID) return false;
  if (cell & CELL.FURNITURE) return false;
  if (cell & CELL.DOOR) {
    const open = isOpen ? isOpen(cx, cz) : false;
    if (!open) return false;
  }
  return (cell & CELL.WALKABLE) !== 0;
}

/** Grid A* between two cells (4-connected, unit cost, deterministic
 *  tie-break: lower (cz*width+cx) index wins). Ships tested in H0; no H0
 *  system calls it.
 *
 *  Tie-break rule: among frontier nodes with equal f-score, and among equal
 *  g-score neighbours discovered from the same node, the one with the lower
 *  `cz*width+cx` index is preferred — implemented by iterating neighbours in
 *  a fixed order and only replacing an existing best when strictly better,
 *  combined with a priority queue keyed (f, index) ascending. */
export function findPathCells(
  grid: NavGrid,
  from: CellCoord,
  to: CellCoord,
  isOpen?: (cx: number, cz: number) => boolean
): CellCoord[] | null {
  if (!isOccupiable(grid, from.cx, from.cz, isOpen)) return null;
  if (!isOccupiable(grid, to.cx, to.cz, isOpen)) return null;

  const startIdx = cellIndex(grid, from.cx, from.cz);
  const goalIdx = cellIndex(grid, to.cx, to.cz);
  if (startIdx === goalIdx) return [{ cx: from.cx, cz: from.cz }];

  const size = grid.width * grid.height;
  const gScore = new Array<number>(size).fill(Infinity);
  const cameFrom = new Array<number>(size).fill(-1);
  const closed = new Array<boolean>(size).fill(false);
  gScore[startIdx] = 0;

  function heuristic(idx: number): number {
    const cx = idx % grid.width;
    const cz = Math.floor(idx / grid.width);
    return Math.abs(cx - to.cx) + Math.abs(cz - to.cz);
  }

  // Simple binary-heap-free priority list (grid sizes here are small); sort
  // by (f, index) each pop for deterministic tie-break.
  const open: number[] = [startIdx];
  const inOpen = new Array<boolean>(size).fill(false);
  inOpen[startIdx] = true;

  while (open.length > 0) {
    // Pick lowest f, tie-break lowest index.
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
      // Reconstruct.
      const path: CellCoord[] = [];
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
    // Fixed neighbour order: +x, -x, +z, -z (deterministic).
    const neighbours: CellCoord[] = [
      { cx: cx + 1, cz },
      { cx: cx - 1, cz },
      { cx, cz: cz + 1 },
      { cx, cz: cz - 1 },
    ];
    for (const n of neighbours) {
      if (n.cx < 0 || n.cz < 0 || n.cx >= grid.width || n.cz >= grid.height) continue;
      if (!isOccupiable(grid, n.cx, n.cz, isOpen)) continue;
      const nIdx = cellIndex(grid, n.cx, n.cz);
      if (closed[nIdx]) continue;
      const tentativeG = gScore[currentIdx]! + 1;
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

/** Portal-level route (BFS over PortalGraph, lowest-portal-id tie-break).
 *  Ships tested in H0; no H0 system calls it. */
export function findRoute(graph: PortalGraph, fromRoom: number, toRoom: number): number[] | null {
  if (fromRoom === toRoom) return [];
  if (fromRoom < 0 || fromRoom >= graph.rooms.length) return null;
  if (toRoom < 0 || toRoom >= graph.rooms.length) return null;

  const visited = new Set<number>([fromRoom]);
  // cameVia[room] = portal id used to reach it
  const cameVia = new Map<number, number>();
  const cameFromRoom = new Map<number, number>();
  const queue: number[] = [fromRoom];
  let qi = 0;

  while (qi < queue.length) {
    const room = queue[qi]!;
    qi++;
    if (room === toRoom) {
      // Reconstruct portal id path.
      const portalIds: number[] = [];
      let cur = room;
      while (cur !== fromRoom) {
        const portalId = cameVia.get(cur)!;
        portalIds.push(portalId);
        cur = cameFromRoom.get(cur)!;
      }
      portalIds.reverse();
      return portalIds;
    }

    const portalIds = (graph.rooms[room] ?? []).slice().sort((a, b) => a - b);
    for (const pid of portalIds) {
      const portal = graph.portals.find((p) => p.id === pid);
      if (!portal) continue;
      const otherRoom = portal.roomA === room ? portal.roomB : portal.roomA;
      if (visited.has(otherRoom)) continue;
      visited.add(otherRoom);
      cameVia.set(otherRoom, pid);
      cameFromRoom.set(otherRoom, room);
      queue.push(otherRoom);
    }
  }

  return null;
}
