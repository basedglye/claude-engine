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

// --- Phase H0 Scope B: despawn, componentsOf, indexed eventsSince,
// eventRetentionTicks ------------------------------------------------------

// --- despawn: removes entity from entities() and every component store ----
{
  const sim = new Sim("core-despawn-basic");
  const a = sim.spawn();
  const b = sim.spawn();
  sim.setComponent(a, "pos", { x: 1 });
  sim.setComponent(a, "hp", { v: 10 });
  sim.setComponent(b, "pos", { x: 2 });

  sim.despawn(a);

  check(
    "despawn: entity removed from entities()",
    ![...sim.entities()].includes(a) && [...sim.entities()].includes(b)
  );
  check("despawn: getComponent returns undefined for every store", sim.getComponent(a, "pos") === undefined && sim.getComponent(a, "hp") === undefined);
  check("despawn: other entity's components untouched", sim.getComponent(b, "pos")?.x === 2);
}

// --- despawn: ids are not reused after despawn + spawn ---------------------
{
  const sim = new Sim("core-despawn-no-reuse");
  const a = sim.spawn();
  const b = sim.spawn();
  sim.despawn(a);
  const c = sim.spawn();
  check("despawn: nextEntity stays monotonic, spawned id not reused", c !== a && c > b);
}

// --- componentsOf: exact set, stable order, empty for unknown entity -------
{
  const sim = new Sim("core-componentsof");
  const e = sim.spawn();
  sim.setComponent(e, "pos", { x: 1, y: 2 });
  sim.setComponent(e, "hp", { value: 5 });
  sim.setComponent(e, "vel", { dx: 0 });

  const first = [...sim.componentsOf(e)];
  const second = [...sim.componentsOf(e)];
  check(
    "componentsOf: returns exactly the attached components",
    first.length === 3 &&
      first.some(([n, v]) => n === "pos" && v.x === 1 && v.y === 2) &&
      first.some(([n, v]) => n === "hp" && v.value === 5) &&
      first.some(([n, v]) => n === "vel" && v.dx === 0)
  );
  check(
    "componentsOf: stable order across repeated calls",
    first.map(([n]) => n).join(",") === second.map(([n]) => n).join(",")
  );
  check(
    "componentsOf: empty iterable for an unknown entity",
    [...sim.componentsOf(999999)].length === 0
  );

  sim.removeComponent(e, "hp");
  const afterRemove = [...sim.componentsOf(e)];
  check(
    "componentsOf: reflects removeComponent",
    afterRemove.length === 2 && !afterRemove.some(([n]) => n === "hp")
  );
}

// --- eventsSince: equivalence with a reference filter implementation -------
{
  const sim = new Sim("core-events-since-equivalence");
  sim.addSystem((s) => {
    // emit 0-2 events per tick, deterministically, so ticks vary in density
    // (including some ticks with zero events)
    const n = s.tick % 3;
    for (let i = 0; i < n; i++) s.emit("e", { tick: s.tick, i });
  });

  const TICKS = 50;
  for (let t = 0; t < TICKS; t++) sim.step();

  const log = sim.eventsSince(0); // full log, for building the reference
  const referenceFilter = (tick) => log.filter((e) => e.tick >= tick);

  const boundaryTicks = [0, 1, 2, 3, TICKS - 1, TICKS, TICKS + 1, 1000];
  let allMatch = true;
  for (const t of boundaryTicks) {
    const got = sim.eventsSince(t);
    const want = referenceFilter(t);
    const same =
      got.length === want.length && got.every((e, i) => e === want[i] || JSON.stringify(e) === JSON.stringify(want[i]));
    if (!same) {
      allMatch = false;
      console.log(`  eventsSince(${t}) mismatch: got ${got.length}, want ${want.length}`);
    }
  }
  check("eventsSince: binary-search implementation matches reference filter at boundary ticks", allMatch);
}

// --- eventRetentionTicks: unbounded by default ------------------------------
{
  const sim = new Sim("core-retention-unbounded");
  sim.addSystem((s) => s.emit("e", { tick: s.tick }));
  const TICKS = 500;
  for (let t = 0; t < TICKS; t++) sim.step();
  check("eventRetentionTicks: unbounded by default keeps every event across a long run", sim.eventsSince(0).length === TICKS);
}

// --- eventRetentionTicks: trims old events, keeps recent ones --------------
{
  const RETENTION = 10;
  const sim = new Sim("core-retention-bounded", { eventRetentionTicks: RETENTION });
  sim.addSystem((s) => s.emit("e", { tick: s.tick }));
  const TICKS = 100;
  for (let t = 0; t < TICKS; t++) sim.step();

  const all = sim.eventsSince(0);
  check(
    `eventRetentionTicks: only the most-recent ${RETENTION} ticks survive`,
    all.length === RETENTION && all[0].tick === TICKS - RETENTION + 1 && all[all.length - 1].tick === TICKS
  );
  check(
    "eventRetentionTicks: eventsSince(0) after trimming returns only retained events",
    sim.eventsSince(0).every((e) => e.tick > TICKS - RETENTION)
  );
}

// --- hash stability: seeded scenario stateHash pinned before/after change ---
{
  function setupHashPin(sim) {
    const player = sim.spawn();
    sim.setComponent(player, "pos", { x: 0, y: 0 });
    sim.setComponent(player, "hp", { value: 100 });
    const loot = sim.forkRng("loot");
    sim.addSystem((s) => {
      for (const c of s.commands()) {
        if (c.type !== "move") continue;
        const pos = s.getComponent(player, "pos");
        pos.x += c.payload.dx;
        pos.y += c.payload.dy;
        s.emit("moved", { ...pos });
      }
    });
    sim.addSystem((s) => {
      if (s.tick % 10 !== 0) return;
      const hp = s.getComponent(player, "hp");
      hp.value -= loot.int(1, 3);
      s.emit("damaged", { hp: hp.value });
    });
  }

  const commands = [
    { tick: 5, actor: "p1", type: "move", payload: { dx: 3, dy: 4 } },
    { tick: 20, actor: "p1", type: "move", payload: { dx: 1, dy: 0 } },
  ];

  const sim = new Sim("claude-engine-smoke-1");
  setupHashPin(sim);
  const byTick = new Map();
  for (const c of commands) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  for (let t = 1; t <= 100; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
  }
  const hash = sim.stateHash();
  check(`hash stability: seeded scenario stateHash pinned at 919868270 (unchanged by this change) — got ${hash}`, hash === 919868270);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
