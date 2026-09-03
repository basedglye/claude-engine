// C3-W1: re-derive a browser gate's tick-gated look+move script for a given
// seed and target, against the CURRENT compiled sim
// (apps/hotel/dist-game/sim/game.js) and the CURRENT generated layout
// (packages/interiors/dist/index.js) -- the same two build outputs the
// browser app itself loads. Run `npm run build` first.
//
// Usage:
//   node apps/hotel/scripts/derive-walk.mjs <seed> <target> [--forward-ticks N] [--hold-ms MS]
//
// <target> is one of:
//   corridor-door   -- doors[0], the lobby<->corridor doorway
//   entrance-door   -- doors[floor.entranceDoorIndex], the street<->lobby door
//   desk-terminal   -- floor.desk (xMm/zMm), yawMdeg is the desk's own facing
//   room:<N>        -- floor.bedrooms[N].goal cell, N=0..3
//
// Method (matches packages/player-fps/src/index.ts's applyLook and
// apps/hotel/src/sim/game.ts's interactSystem bearing math exactly, so the
// numbers below are what a REAL pointer-lock mousemove + WASD hold would
// produce, not an approximation of it):
//   1. Spawn a fresh Sim with the compiled setup(), read the player's
//      spawn pos/yaw (yaw is always 0 at spawn -- see createFpsController).
//   2. bearing = atan2Mdeg(target.x - player.x, target.z - player.z)
//      (space's atan2Mdeg, the exact function interactSystem itself calls).
//   3. look1Px = round(angleDeltaMdeg(camYaw, bearing) / SENS), camYaw +=
//      look1Px * SENS (SENS=220 mdeg/px, player-fps's default).
//   4. Replay a KeyW hold (moveCommand(forwardMilli=1000) each tick, at the
//      now-current camYaw as the player's facing) tick by tick through the
//      REAL compiled sim for `--forward-ticks` ticks (default: probe 1..20
//      and report the first N whose rest position is inside the target's
//      interact range AND arc after a corrective look, since axis-separated
//      collision means position is not a closed-form function of hold time).
//   5. corrective look2: bearing from the rest position to the target;
//      look2Px = round(angleDeltaMdeg(camYaw, bearing2) / SENS).
//   6. PROOF: replay the exact derived script (face-equivalent via the same
//      camYaw arithmetic, moveCommand hold, then an interactCommand at the
//      target entity) into a FRESH Sim and report the achieved pose
//      (final camYaw, position, distance to target) and whether
//      interactSystem would accept it (distance <= radiusMm and
//      |angleDelta| <= arcMdeg/2), by checking the actual sim outcome: did
//      a "door"/interact-accepting event fire, or an interact-denied event
//      with what reason.
import { Sim } from "../../../packages/core/dist/index.js";
import { atan2Mdeg, angleDeltaMdeg } from "../../../packages/space/dist/index.js";
import { generateGroundFloor } from "../../../packages/interiors/dist/index.js";
import {
  setup,
  PLAYER_ENTITY,
  faceCommand,
  moveCommand,
  interactCommand,
  INTERACTABLE_RADIUS_MM,
  INTERACTABLE_ARC_MDEG,
} from "../dist-game/sim/game.js";

const SENS = 220; // player-fps DEFAULT_SENSITIVITY_MDEG_PER_PX

function parseArgs(argv) {
  const [seed, target, ...rest] = argv;
  const opts = { forwardTicksMax: 20 };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--forward-ticks") opts.forwardTicks = Number(rest[++i]);
    if (rest[i] === "--hold-ms") opts.holdMs = Number(rest[++i]);
  }
  if (!seed || !target) {
    console.error("usage: node derive-walk.mjs <seed> <target> [--forward-ticks N]");
    process.exit(2);
  }
  return { seed, target, ...opts };
}

function resolveTarget(floor, targetName) {
  if (targetName === "corridor-door") {
    const d = floor.doors[0];
    return { xMm: d.xMm, zMm: d.zMm, doorIndex: d.doorIndex, kind: "door" };
  }
  if (targetName === "entrance-door") {
    const d = floor.doors[floor.entranceDoorIndex];
    return { xMm: d.xMm, zMm: d.zMm, doorIndex: d.doorIndex, kind: "door" };
  }
  if (targetName === "desk-terminal") {
    return { xMm: floor.desk.xMm, zMm: floor.desk.zMm, kind: "desk" };
  }
  if (targetName.startsWith("room:")) {
    const n = Number(targetName.split(":")[1]);
    const b = floor.bedrooms[n];
    const CELL_SIZE_MM = 250;
    return { xMm: b.goalCx * CELL_SIZE_MM + CELL_SIZE_MM / 2, zMm: b.goalCz * CELL_SIZE_MM + CELL_SIZE_MM / 2, kind: "room", roomId: b.roomId };
  }
  throw new Error(`unknown target ${targetName}`);
}

function playerPose(sim) {
  const pos = sim.getComponent(PLAYER_ENTITY, "pos");
  const yaw = sim.getComponent(PLAYER_ENTITY, "yaw");
  return { xMm: pos.xMm, zMm: pos.zMm, yawMdeg: yaw.mdeg };
}

function bearingTo(from, target) {
  return atan2Mdeg(target.xMm - from.xMm, target.zMm - from.zMm);
}

function pxForDelta(camYaw, bearing) {
  // Signed delta FROM camYaw TO bearing (bearing - camYaw, wrapped to
  // (-180000,180000]) -- angleDeltaMdeg(a,b) computes a-b, so bearing goes
  // first. Swapping the arguments here once produced deltas of the wrong
  // sign (every derived look turned the camera away from the target); this
  // ordering was checked against the fps-look-interact header derivation
  // (bearing1=343_400 from camYaw=0 -> delta=-16_600 -> dx=-75) and matches.
  const delta = angleDeltaMdeg(bearing, camYaw);
  return Math.round(delta / SENS);
}

function main() {
  const { seed, target: targetName, forwardTicks } = parseArgs(process.argv.slice(2));
  const floor = generateGroundFloor(seed);
  const target = resolveTarget(floor, targetName);

  // Step 1-3: spawn pose + first look.
  let sim = new Sim(seed);
  setup(sim);
  const spawnPose = playerPose(sim);
  let camYaw = spawnPose.yawMdeg; // 0 at spawn
  const bearing1 = bearingTo(spawnPose, target);
  const look1Px = pxForDelta(camYaw, bearing1);
  camYaw = (camYaw + look1Px * SENS) % 360_000;
  if (camYaw < 0) camYaw += 360_000;

  // Step 4: probe hold durations (or use the forced one) with the real
  // compiled sim, using faceCommand(camYaw) each tick to hold the facing
  // (equivalent to "no further look input during the hold").
  function poseAfterHold(nTicks) {
    const s = new Sim(seed);
    setup(s);
    for (let t = 1; t <= nTicks; t++) {
      s.submit(faceCommand(t, camYaw));
      s.submit(moveCommand(t, 1000, 0));
      s.step();
    }
    return playerPose(s);
  }

  const candidates = [];
  const tryTicks = forwardTicks ? [forwardTicks] : Array.from({ length: 20 }, (_, i) => i + 1);
  for (const n of tryTicks) {
    const pose = poseAfterHold(n);
    const bearing2 = bearingTo(pose, target);
    const look2Px = pxForDelta(camYaw, bearing2);
    const finalYaw = (camYaw + look2Px * SENS + 360_000) % 360_000;
    const distMm = Math.round(Math.hypot(target.xMm - pose.xMm, target.zMm - pose.zMm));
    const angleOk = Math.abs(angleDeltaMdeg(finalYaw, bearingTo(pose, target))) <= INTERACTABLE_ARC_MDEG / 2;
    const distOk = distMm <= INTERACTABLE_RADIUS_MM;
    candidates.push({ n, pose, bearing2, look2Px, finalYaw, distMm, angleOk, distOk });
  }
  const chosen = candidates.find((c) => c.distOk && c.angleOk) ?? candidates[candidates.length - 1];

  // Step 6: PROOF -- replay the derived script into a fresh Sim, using
  // faceCommand to stand in for the two pointer "look" steps (both apply
  // the identical camYaw arithmetic derived above) and a real
  // interactCommand at the tick the click would fire.
  const proof = new Sim(seed);
  setup(proof);
  for (let t = 1; t <= chosen.n; t++) {
    proof.submit(faceCommand(t, camYaw));
    proof.submit(moveCommand(t, 1000, 0));
    proof.step();
  }
  proof.submit(faceCommand(chosen.n, chosen.finalYaw));
  // interactCommand needs a target entity id, not a doorIndex/coords; find
  // the entity whose component matches this target's identity.
  let targetEntity;
  for (const e of proof.entities()) {
    if (target.kind === "door") {
      const d = proof.getComponent(e, "door");
      if (d && d.doorIndex === target.doorIndex) targetEntity = e;
    } else if (target.kind === "desk") {
      const t2 = proof.getComponent(e, "terminal");
      if (t2) targetEntity = e;
    }
  }
  const before = proof.eventsSince(0).length;
  if (targetEntity !== undefined) proof.submit(interactCommand(chosen.n + 1, targetEntity));
  proof.step();
  const newEvents = proof.eventsSince(before);
  const finalPose = playerPose(proof);

  const report = {
    seed,
    target: targetName,
    spawnPose,
    look1: { bearingMdeg: bearing1, dxPx: look1Px, camYawAfter: (spawnPose.yawMdeg + look1Px * SENS + 360_000) % 360_000 },
    holdTicks: chosen.n,
    poseAfterHold: chosen.pose,
    look2: { bearingMdeg: chosen.bearing2, dxPx: chosen.look2Px, camYawAfter: chosen.finalYaw },
    distMmAfterHold: chosen.distMm,
    distOk: chosen.distOk,
    angleOk: chosen.angleOk,
    targetEntityFound: targetEntity !== undefined,
    proofFinalPose: finalPose,
    proofNewEvents: newEvents,
    scriptSteps: [
      { pointer: "lock", atTick: 0 },
      { pointer: "look", atTick: 0, dx: look1Px, dy: 0 },
      { key: "KeyW", downAtTick: 0, upAtTick: chosen.n },
      { pointer: "look", atTick: chosen.n, dx: chosen.look2Px, dy: 0 },
      { pointer: "click", atTick: chosen.n },
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
