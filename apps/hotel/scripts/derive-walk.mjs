#!/usr/bin/env node
/**
 * derive-walk — turns "walk the player to (x,z) and look at a thing" into a
 * tick-gated browser input script, and then PROVES the script it emitted.
 *
 * WHY THIS EXISTS, AND WHY IT IS COMMITTED RATHER THAN SCRATCH
 * ------------------------------------------------------------
 * Every browser gate this project has shipped (H0's `fps-look-interact`,
 * H1b's `reserva-readability`, H2b's `art-lock` / `save-resume` /
 * `upkeep-click`) needed the same thing: a sequence of look deltas in mouse
 * PIXELS and key-down/key-up windows in SIM TICKS that lands the player at a
 * pose from which a specific object is inside the sim's interact range and
 * arc AND under the reticle raycast. Each of those gates derived its
 * literals by hand, and the derivation was the single most expensive part of
 * the phase every time. H2b paid it a fourth time and initially got a gate
 * that walked into a doorway and wedged.
 *
 * Hand derivation is also where the WRONG kind of green comes from. A script
 * that arrives but sits 5 degrees outside the interact arc produces
 * `interact-denied` — a run that walks convincingly and asserts nothing.
 * H0 round 1 shipped exactly that shape of gate and it took a review round
 * to catch. So this tool does not stop at emitting a script: it re-simulates
 * the emitted script in a FRESH sim, verbatim, and reports the achieved
 * pose, the distance and bearing to the target, and whether the sim would
 * actually ACCEPT an `interact` from there. What it prints is a measurement,
 * not a plan.
 *
 * WHAT IT DOES NOT DO. It does not verify the RETICLE RAYCAST, which is a
 * host-side, Three.js fact about where an object's geometry actually is on
 * screen. It computes the pitch (`dy`) that aims at a target of a given
 * height and says so, but the sign convention and the final few pixels have
 * to be confirmed in the real browser — `reserva-readability`'s header
 * comment records that its own dy was found by probing the live build, and
 * that remains the standard. This tool removes the walking problem, not the
 * looking-at-it problem.
 *
 * USAGE
 *   node apps/hotel/scripts/derive-walk.mjs \
 *     --seed hotel-h2-upkeep-1 [--config upkeep-demo] \
 *     --to 7125,6375 [--stop-mm 1100] [--target-height-m 0.07] \
 *     [--max-ticks 200] [--start-tick 0] [--json]
 *
 * `--to` accepts world millimetres, or `mess:0` / `candidate:0` / `prop:0` /
 * `document:0` to aim at the Nth entity of that kind in setup order (which
 * is what a scenario author actually has in hand).
 *
 * DETERMINISM NOTE. This is a derivation tool, not sim code: it lives
 * outside every purity root and may use `Math.atan2` freely. Nothing it
 * computes enters the sim — its output is committed literals in a scenario
 * file, and the scenario's own run is what the harness verifies.
 */
import { readFileSync } from "node:fs";
import { Sim } from "@claude-engine/core";
import { CELL, CELL_SIZE_MM, cellAt, cellOfMm } from "@claude-engine/space";
// The hotel's OWN clearance-aware A*, not `space`'s raw `findPathCells`.
// CLAUDE.md's standing rule from the H1a review is explicit: no new caller
// routes a collider-bearing agent through `findPathCells`, because it is
// not clearance-aware. The first draft of this tool broke that rule and was
// punished exactly as predicted — A* returned a route down a column a
// 300mm-radius player cannot occupy, the follower drove into it, and the
// stall looked like a follower bug for two rounds of debugging.
import { findJitteredPath, buildOpenCellSet, makeIsOpen, isOccupiable as isOccupiableCell } from "../dist-game/sim/nav.js";
import {
  setup,
  setupNamed,
  faceCommand,
  moveCommand,
  loadGroundFloor,
  PLAYER_RADIUS_MM,
  PLAYER_ENTITY,
  INTERACTABLE_RADIUS_MM,
  INTERACTABLE_ARC_MDEG,
} from "../dist-game/sim/game.js";

// player-fps: one look pixel is this many millidegrees of camera yaw.
const MDEG_PER_PX = 220;
// Eye height, matching @claude-engine/player-fps's DEFAULT_EYE_HEIGHT_M.
const EYE_HEIGHT_M = 1.6;

// -- argv ------------------------------------------------------------------
const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}
const flag = (name) => argv.includes(`--${name}`);

const SEED = opt("seed", "hotel-h0-look-1");
const CONFIG = opt("config", "");
const TO = opt("to", "");
const STOP_MM = Number(opt("stop-mm", 1100));
const MAX_TICKS = Number(opt("max-ticks", 200));
const START_TICK = Number(opt("start-tick", 0));
const TARGET_HEIGHT_M = Number(opt("target-height-m", 1.0));
const AS_JSON = flag("json");
/** A JSON file holding an already-derived script (the `script` array from a
 *  previous run). It is replayed first and the new derivation starts from
 *  the pose it leaves behind — so a multi-leg gate ("walk to the mess, wipe
 *  it, walk back and interview a candidate") is derived leg by leg instead
 *  of as one intractable route. The emitted script contains ONLY the new
 *  leg; concatenate them in the scenario file. */
const AFTER = opt("after", "");

if (!TO) {
  console.error("derive-walk: --to <xMm,zMm | mess:0 | candidate:0 | prop:0 | document:0> is required");
  process.exit(2);
}

// -- helpers ---------------------------------------------------------------
const wrap = (m) => ((m % 360000) + 360000) % 360000;
/** Signed shortest delta, in (-180000, 180000]. */
function shortest(d) {
  let x = wrap(d);
  if (x > 180000) x -= 360000;
  return x;
}
/** The sim's own heading convention: forward at yaw is (sin yaw, cos yaw),
 *  so the bearing from a to b is atan2(dx, dz) — NOT atan2(dz, dx). Getting
 *  this backwards points the derivation at the mirror image of the target,
 *  which is a mistake that looks like a near miss. */
function bearingMdeg(from, to) {
  return wrap((Math.atan2(to.xMm - from.xMm, to.zMm - from.zMm) * 180000) / Math.PI);
}
const dist = (a, b) => Math.hypot(a.xMm - b.xMm, a.zMm - b.zMm);
const cellCenter = (c) => ({
  xMm: c.cx * CELL_SIZE_MM + CELL_SIZE_MM / 2,
  zMm: c.cz * CELL_SIZE_MM + CELL_SIZE_MM / 2,
});

const prefix = AFTER ? JSON.parse(readFileSync(AFTER, "utf-8")) : [];

/** Build the world and advance it to this derivation's starting point:
 *  `--start-tick` bare ticks, then `--after`'s script replayed verbatim.
 *  Both the planning sim and the verification sim go through this, so the
 *  two can never disagree about where the leg begins. */
function makeSim() {
  const sim = new Sim(SEED, { eventRetentionTicks: 60000 });
  if (CONFIG) setupNamed(sim, CONFIG);
  else setup(sim);
  let yaw = 0;
  let held = false;
  const prefixLast = prefix.reduce((m, st) => Math.max(m, st.atTick ?? st.upAtTick ?? 0), -1);
  const until = Math.max(START_TICK - 1, prefixLast);
  for (let t = 0; t <= until; t++) {
    for (const step of prefix) {
      if (step.pointer === "look" && step.atTick === t) yaw = wrap(yaw + step.dx * MDEG_PER_PX);
      if (step.key && step.downAtTick === t) held = true;
      if (step.key && step.upAtTick === t) held = false;
    }
    sim.submit(faceCommand(t + 1, yaw));
    if (held) sim.submit(moveCommand(t + 1, 1000, 0));
    sim.step();
  }
  return { sim, yaw };
}
const playerPos = (sim) => sim.getComponent(PLAYER_ENTITY, "pos");

/** Resolve `mess:0` style selectors against a freshly-built world. */
function resolveTarget(sim) {
  const m = /^([a-z]+):(\d+)$/.exec(TO);
  if (!m) {
    const [x, z] = TO.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      console.error(`derive-walk: could not parse --to "${TO}"`);
      process.exit(2);
    }
    return { xMm: x, zMm: z, entity: undefined, kind: "point" };
  }
  const [, kind, nthRaw] = m;
  const nth = Number(nthRaw);
  const found = [];
  for (const e of sim.entities()) {
    if (sim.getComponent(e, kind) === undefined) continue;
    const pos = sim.getComponent(e, "pos");
    if (pos) found.push({ entity: e, xMm: pos.xMm, zMm: pos.zMm });
  }
  const hit = found[nth];
  if (!hit) {
    console.error(`derive-walk: no "${kind}" #${nth} in this world (found ${found.length}).`);
    process.exit(2);
  }
  return { ...hit, kind };
}

/**
 * Radius-aware line of sight, used for string-pulling the A* path.
 *
 * `space`'s own `losClear` walks single cells and knows nothing about the
 * player's 300mm radius, so it happily reports a diagonal gap between two
 * wall corners as clear — which is precisely how the first attempt at this
 * derivation wedged the player at a doorway. This samples the segment and
 * requires the four radius-offset corners at each sample to be walkable,
 * which is conservative in the right direction: it rejects some shortcuts
 * that would have worked, and accepts none that would not.
 */
function losClearForRadius(grid, from, to, radiusMm, isOpen) {
  const steps = Math.max(1, Math.ceil(dist(from, to) / 100));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.xMm + (to.xMm - from.xMm) * t;
    const z = from.zMm + (to.zMm - from.zMm) * t;
    for (const [ox, oz] of [
      [-radiusMm, -radiusMm],
      [radiusMm, -radiusMm],
      [-radiusMm, radiusMm],
      [radiusMm, radiusMm],
    ]) {
      const c = cellOfMm(grid, x + ox, z + oz);
      const value = cellAt(grid, c.cx, c.cz);
      const walkable = (value & CELL.WALKABLE) !== 0;
      const open = walkable && ((value & CELL.DOOR) === 0 || isOpen(c.cx, c.cz));
      if (!open) return false;
    }
  }
  return true;
}

// -- 1. plan ---------------------------------------------------------------
const { sim: planSim, yaw: entryYaw } = makeSim();
const floor = loadGroundFloor(SEED);
const grid = floor.grid;
const target = resolveTarget(planSim);

// Which door cells are passable RIGHT NOW, taken from the sim's own
// `buildOpenCellSet` rather than re-derived here — a second description of
// "is this door open" is exactly the kind of thing that drifts, and the
// whole point of this tool is that its answer matches the sim's.
const portalCellsByDoorIndex = floor.doors.map((d) => {
  const c = cellOfMm(grid, d.xMm, d.zMm);
  const cells = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) cells.push({ cx: c.cx + dx, cz: c.cz + dz });
  return cells;
});
const isOpen = makeIsOpen(buildOpenCellSet(planSim, grid.width, portalCellsByDoorIndex), grid.width);

/** Is this a doorway cell? Doorways are funnels — entered head-on, never
 *  cut across. */
const isDoorCell = (c) => (cellAt(grid, c.cx, c.cz) & CELL.DOOR) !== 0;

const startCell = cellOfMm(grid, playerPos(planSim).xMm, playerPos(planSim).zMm);
const goalCell = cellOfMm(grid, target.xMm, target.zMm);
/**
 * The cell to actually route TO.
 *
 * A target is usually a thing to stand NEXT to, not on: a mess lies against
 * a bedroom wall, and its own cell routinely fails `isOccupiable`'s
 * clearance test for a 300mm collider. Handing that cell to A* returns null
 * and the tool reports "no path" for a target the player can obviously walk
 * up to — which is what it did for both of `art-lock`'s messes before this.
 * So: if the goal cell is not occupiable, walk out in rings and take the
 * nearest cell that is, deterministically (lower cz*width+cx wins a tie).
 * `--stop-mm` then does the rest, and the range/arc check at the end is
 * what decides whether the resulting pose is actually good enough.
 */
function routableGoal(cell) {
  if (isOccupiableCell(grid, cell.cx, cell.cz, isOpen)) return cell;
  for (let r = 1; r <= 6; r++) {
    const ring = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const c = { cx: cell.cx + dx, cz: cell.cz + dz };
        if (isOccupiableCell(grid, c.cx, c.cz, isOpen)) ring.push(c);
      }
    }
    ring.sort((a, b) => a.cz * grid.width + a.cx - (b.cz * grid.width + b.cx));
    if (ring[0]) return ring[0];
  }
  return cell;
}
const routeGoal = routableGoal(goalCell);

const path = findJitteredPath(
  grid,
  { cx: startCell.cx, cz: startCell.cz },
  { cx: routeGoal.cx, cz: routeGoal.cz },
  isOpen,
  0,
);
if (!path) {
  console.error(
    `derive-walk: no path from (${startCell.cx},${startCell.cz}) to (${routeGoal.cx},${routeGoal.cz})` +
      `${routeGoal.cx === goalCell.cx && routeGoal.cz === goalCell.cz ? "" : ` (nearest occupiable cell to the target's own (${goalCell.cx},${goalCell.cz}))`}.`
  );
  process.exit(1);
}

// -- 2. follow -------------------------------------------------------------
// STRICT RUN FOLLOWING, not string-pulling.
//
// The first version of this tool string-pulled the A* path (aim at the
// furthest waypoint in line of sight) and wedged the player against a
// doorway jamb at (5618,3889), grinding in place while `moveCircle` slid
// it along the wall. The lesson generalises: a 4-connected grid path is
// already a sequence of AXIS-ALIGNED runs, and walking those runs
// end-to-end is both the shortest script (one look per corner) and the only
// approach that enters a two-cell doorway square-on. Cutting corners saves
// a metre and costs the whole derivation.
//
// So: collapse the path into collinear runs, then walk to each run's end
// point, turning once per corner.
// STRING-PULL FIRST, now that it is safe to. A* is 4-connected, so its
// route through an open room is a staircase of one-cell steps; following it
// literally emits a look step per stair and produces a 25-command script
// that reads as noise in a diff. Pulling the path taut against the geometry
// (keep a waypoint only when the segment past it is NOT radius-clear)
// collapses that to one leg per real corner.
//
// Doorway cells are ALWAYS kept: a pulled segment that clips a door jamb is
// how the un-clearance-aware first draft wedged, and a door is the one place
// where the head-on approach is load-bearing rather than cosmetic.
const pulled = [path[0]];
for (let i = 1; i < path.length - 1; i++) {
  const anchor = pulled[pulled.length - 1];
  const keep =
    isDoorCell(path[i]) ||
    isDoorCell(path[i + 1]) ||
    !losClearForRadius(grid, cellCenter(anchor), cellCenter(path[i + 1]), PLAYER_RADIUS_MM, isOpen);
  if (keep) pulled.push(path[i]);
}
pulled.push(path[path.length - 1]);

const runs = [];
for (let i = 1; i < pulled.length; i++) {
  const prev = pulled[i - 1];
  const cur = pulled[i];
  const dir = `${Math.sign(cur.cx - prev.cx)},${Math.sign(cur.cz - prev.cz)}`;
  const last = runs[runs.length - 1];
  if (last && last.dir === dir) last.end = cur;
  else runs.push({ dir, start: prev, end: cur });
}
// The final waypoint is the goal cell; walking all the way onto the target
// itself would stand the player inside it, so the last run is trimmed by
// the caller's --stop-mm during the walk loop rather than here.

const LOOK_EMIT_THRESHOLD_MDEG = 2000;
const ARRIVE_MM = 120;

const script = [];
let camYaw = entryYaw;
let walkStart = null;
let runIdx = 0;
const trace = [];
let stalled = false;

const walkFrom = planSim.tick;
for (let t = walkFrom; t < walkFrom + MAX_TICKS; t++) {
  const p = playerPos(planSim);
  trace.push({ tick: t, xMm: p.xMm, zMm: p.zMm, camYaw });

  if (dist(p, target) <= STOP_MM) break;
  if (runIdx >= runs.length) break;

  let aim = cellCenter(runs[runIdx].end);
  // Advance when we have arrived at this run's end, or travelled past it
  // along the run's own direction (a 200mm/tick step can overshoot a 250mm
  // cell, and waiting to be "close" to a point already behind us is exactly
  // how a follower starts oscillating).
  const from = cellCenter(runs[runIdx].start);
  const runVec = { x: aim.xMm - from.xMm, z: aim.zMm - from.zMm };
  const along = ((p.xMm - from.xMm) * runVec.x + (p.zMm - from.zMm) * runVec.z) / Math.max(1, runVec.x ** 2 + runVec.z ** 2);
  if (dist(p, aim) <= ARRIVE_MM || along >= 1) {
    runIdx++;
    if (runIdx >= runs.length) break;
    aim = cellCenter(runs[runIdx].end);
  }

  // Stall guard. With runs there is no corner-cutting left to blame, so a
  // stall here means the route is genuinely impassable for this collider —
  // a finding, not something to steer around. Report it rather than
  // silently emitting a script that does not arrive.
  if (trace.length > 25) {
    const then = trace[trace.length - 25];
    if (dist(then, p) < 80) {
      stalled = true;
      break;
    }
  }

  const want = bearingMdeg(p, aim);
  const delta = shortest(want - camYaw);
  if (Math.abs(delta) > LOOK_EMIT_THRESHOLD_MDEG) {
    const dx = Math.round(delta / MDEG_PER_PX);
    if (dx !== 0) {
      if (walkStart !== null) {
        script.push({ key: "KeyW", downAtTick: walkStart, upAtTick: t });
        walkStart = null;
      }
      script.push({ pointer: "look", atTick: t, dx, dy: 0 });
      camYaw = wrap(camYaw + dx * MDEG_PER_PX);
    }
  }

  if (walkStart === null) walkStart = t;
  planSim.submit(faceCommand(t + 1, camYaw));
  planSim.submit(moveCommand(t + 1, 1000, 0));
  planSim.step();
}
if (walkStart !== null) script.push({ key: "KeyW", downAtTick: walkStart, upAtTick: planSim.tick });

// Final aim: turn to face the target itself, so the interact arc check below
// is about the pose the scenario will actually be in.
const endPos = playerPos(planSim);
const finalBearing = bearingMdeg(endPos, target);
const finalDx = Math.round(shortest(finalBearing - camYaw) / MDEG_PER_PX);
if (finalDx !== 0) {
  script.push({ pointer: "look", atTick: planSim.tick, dx: finalDx, dy: 0 });
  camYaw = wrap(camYaw + finalDx * MDEG_PER_PX);
}

// -- 3. VERIFY by replaying the emitted script into a FRESH sim ------------
// This is the part that makes the output a measurement. Anything the
// follower did that the emitted script does not reproduce shows up here as a
// different final pose.
function replay(emitted) {
  const { sim, yaw: entry } = makeSim();
  let yaw = entry;
  let held = false;
  const last = emitted.reduce((m, s) => Math.max(m, s.atTick ?? s.upAtTick ?? 0), 0);
  for (let t = sim.tick; t <= last; t++) {
    for (const step of emitted) {
      if (step.pointer === "look" && step.atTick === t) yaw = wrap(yaw + step.dx * MDEG_PER_PX);
      if (step.key && step.downAtTick === t) held = true;
      if (step.key && step.upAtTick === t) held = false;
    }
    sim.submit(faceCommand(t + 1, yaw));
    if (held) sim.submit(moveCommand(t + 1, 1000, 0));
    sim.step();
  }
  return { sim, yaw };
}

const { sim: checkSim, yaw: finalYaw } = replay(script);
const finalPos = playerPos(checkSim);
const finalDist = dist(finalPos, target);
const bearingErr = Math.abs(shortest(bearingMdeg(finalPos, target) - finalYaw));

// Would the sim accept an interact from here? Range and arc are the two
// checks `interactSystem` applies; a script that arrives outside either is a
// gate that walks convincingly and asserts nothing.
const inRange = finalDist <= INTERACTABLE_RADIUS_MM;
const inArc = bearingErr <= INTERACTABLE_ARC_MDEG / 2;

// Pitch to aim at the target's height, in look pixels. Positive dy pitches
// DOWN (the convention reserva-readability measured against the live build).
const dropM = EYE_HEIGHT_M - TARGET_HEIGHT_M;
const pitchMdeg = (Math.atan2(dropM, Math.max(0.001, finalDist / 1000)) * 180000) / Math.PI;
const pitchDy = Math.round(pitchMdeg / MDEG_PER_PX);

const report = {
  seed: SEED,
  config: CONFIG || "(default)",
  target: { ...target, heightM: TARGET_HEIGHT_M },
  stalled,
  commandCount: script.length,
  finalTick: checkSim.tick,
  finalPos,
  finalYawMdeg: finalYaw,
  distMm: Math.round(finalDist),
  bearingErrMdeg: Math.round(bearingErr),
  inRange,
  inArc,
  suggestedPitchDy: pitchDy,
  script,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`seed ${SEED}  config ${report.config}`);
  console.log(`target ${JSON.stringify(target)}  height ${TARGET_HEIGHT_M}m`);
  console.log(`arrived tick ${report.finalTick} at (${finalPos.xMm},${finalPos.zMm}) yaw ${finalYaw}`);
  console.log(`distance ${report.distMm}mm (limit ${INTERACTABLE_RADIUS_MM})  bearing error ${report.bearingErrMdeg}mdeg (limit ${INTERACTABLE_ARC_MDEG / 2})`);
  console.log(`sim would accept interact: range ${inRange ? "OK" : "FAIL"}, arc ${inArc ? "OK" : "FAIL"}${stalled ? "  [STALLED]" : ""}`);
  console.log(`suggested look dy (pitch down onto the target): ${pitchDy}px  -- CONFIRM IN THE BROWSER`);
  console.log(`\n${JSON.stringify(script)}`);
}

process.exit(stalled || !inRange || !inArc ? 1 : 0);
