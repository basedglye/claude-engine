// Unit tests for @claude-engine/core's Phase 3 Scope A additions (Rng state
// capture, Sim.forkRng, Sim.restore), run against the built dist/ (npm run
// test -w @claude-engine/core builds first). Hand-rolled assert-and-exit
// script, matching this repo's scripts/smoke.mjs / packages/assets style
// rather than pulling in Node's test runner.
import { Sim, Rng, RestoreError } from "../dist/index.js";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

// --- Rng state round-trip --------------------------------------------------
{
  const rng = new Rng("core-rng-roundtrip");
  for (let i = 0; i < 5; i++) rng.next();
  const state = rng.getState();
  const resumed = Rng.fromState(state);
  const a = Array.from({ length: 10 }, () => rng.next());
  const b = Array.from({ length: 10 }, () => resumed.next());
  check(
    "Rng: fromState(getState()) continues the identical draw sequence",
    a.every((v, i) => v === b[i])
  );
}

// --- forkRng: duplicate label throws ---------------------------------------
{
  const sim = new Sim("core-fork-duplicate");
  sim.forkRng("x");
  let threw = false;
  try {
    sim.forkRng("x");
  } catch {
    threw = true;
  }
  check("Sim.forkRng: duplicate label throws", threw);
}

// --- forkRng: after step() throws ------------------------------------------
{
  const sim = new Sim("core-fork-after-step");
  sim.addSystem(() => {});
  sim.step();
  let threw = false;
  try {
    sim.forkRng("late");
  } catch {
    threw = true;
  }
  check("Sim.forkRng: called after step() throws", threw);
}

// --- restore: v:1 (evidence-only) snapshot rejected -------------------------
{
  const sim = new Sim("core-restore-v1");
  const v1Snapshot = { v: 1, tick: 0, nextEntity: 1, stateHash: 0, components: {} };
  let threw = false;
  try {
    sim.restore(v1Snapshot);
  } catch (err) {
    threw = err instanceof RestoreError;
  }
  check("Sim.restore: v:1 snapshot rejected with RestoreError", threw);
}

// --- restore: fork-label mismatch throws RestoreError -----------------------
{
  const simA = new Sim("core-restore-mismatch");
  simA.forkRng("alpha");
  const snap = simA.snapshot();

  const simB = new Sim("core-restore-mismatch");
  simB.forkRng("beta"); // different registered label than the snapshot's
  let threw = false;
  try {
    simB.restore(snap);
  } catch (err) {
    threw = err instanceof RestoreError;
  }
  check("Sim.restore: fork-label mismatch throws RestoreError", threw);
}

// --- golden equivalence: continuous run vs. snapshot -> fresh sim -> setup
// -> restore -> replay remaining commands, at N/2, with the root Rng AND a
// tracked forkRng() stream both drawn from on either side of the snapshot.
{
  function setupGolden(sim) {
    const player = sim.spawn();
    sim.setComponent(player, "hp", { value: 100000 });
    const loot = sim.forkRng("loot");
    sim.addSystem((s) => {
      const hp = s.getComponent(player, "hp");
      hp.value -= loot.int(1, 3); // tracked-fork draw, every tick
      hp.value -= s.rng.int(0, 1); // root-stream draw, every tick
      s.emit("tick", { hp: hp.value });
    });
  }

  const SEED = "core-golden-restore";
  const N = 40;
  const HALF = N / 2;

  const continuous = new Sim(SEED);
  setupGolden(continuous);
  for (let t = 0; t < N; t++) continuous.step();
  const continuousHash = continuous.stateHash();

  const half = new Sim(SEED);
  setupGolden(half);
  for (let t = 0; t < HALF; t++) half.step();
  const snapshot = half.snapshot();

  check("golden: snapshot() emits v:2 with root + fork Rng state", snapshot.v === 2 && snapshot.rng.forks.length === 1);

  const restored = new Sim(SEED);
  setupGolden(restored); // setup() re-registers the "loot" fork label
  restored.restore(snapshot);
  for (let t = HALF; t < N; t++) restored.step();
  const restoredHash = restored.stateHash();

  check(
    "golden: continuous N-tick run == snapshot-at-N/2 -> restore -> replay tail (stateHash)",
    continuousHash === restoredHash
  );
  if (continuousHash !== restoredHash) {
    console.log(`  continuous=${continuousHash} restored=${restoredHash}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
