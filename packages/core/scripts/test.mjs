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
      let value = hp.value - loot.int(1, 3); // tracked-fork draw, every tick
      value -= s.rng.int(0, 1); // root-stream draw, every tick
      s.setComponent(player, "hp", { value });
      s.emit("tick", { hp: value });
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
        // Write-through, never in-place (Sim.stateHash()'s Phase-H2 contract).
        const next = { x: pos.x + c.payload.dx, y: pos.y + c.payload.dy };
        s.setComponent(player, "pos", next);
        s.emit("moved", { ...next });
      }
    });
    sim.addSystem((s) => {
      if (s.tick % 10 !== 0) return;
      const hp = s.getComponent(player, "hp");
      const value = hp.value - loot.int(1, 3);
      s.setComponent(player, "hp", { value });
      s.emit("damaged", { hp: value });
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
  // Re-pinned ONCE in Phase H2a lane 1 (docs/PHASE-H2.md contract A): the
  // hash became incremental — a fold of per-entry FNV digests rather than
  // one byte stream — so every value moved exactly once, with no change to
  // the logic being hashed. Pre-H2 value: 919868270.
  check(`hash stability: seeded scenario stateHash pinned at 3849639990 (H2a re-pin) — got ${hash}`, hash === 3849639990);
  check("hash stability: stateHashSlow() agrees with the incremental stateHash()", sim.stateHashSlow() === hash);
}

// --- incremental stateHash: the write-through contract (docs/PHASE-H2.md A)
{
  const sim = new Sim("core-incremental-hash");
  const a = sim.spawn();
  const b = sim.spawn();
  sim.setComponent(a, "pos", { x: 1, y: 2 });
  sim.setComponent(a, "hp", { value: 10 });
  sim.setComponent(b, "pos", { x: 3, y: 4 });

  check("incremental: agrees with slow on a fresh sim", sim.stateHash() === sim.stateHashSlow());

  // Every write path must invalidate the cached entry, or the incremental
  // hash silently reports the pre-write state.
  const beforeWrite = sim.stateHash();
  sim.setComponent(a, "pos", { x: 9, y: 2 });
  check("incremental: setComponent moves the hash", sim.stateHash() !== beforeWrite);
  check("incremental: setComponent stays in step with slow", sim.stateHash() === sim.stateHashSlow());

  const beforeRemove = sim.stateHash();
  sim.removeComponent(a, "hp");
  check("incremental: removeComponent moves the hash", sim.stateHash() !== beforeRemove);
  check("incremental: removeComponent stays in step with slow", sim.stateHash() === sim.stateHashSlow());

  // Re-adding the SAME component name to the SAME entity with a DIFFERENT
  // value is the case a cache that only invalidates on delete would miss.
  sim.setComponent(a, "hp", { value: 77 });
  check("incremental: re-added component stays in step with slow", sim.stateHash() === sim.stateHashSlow());

  const beforeDespawn = sim.stateHash();
  sim.despawn(b);
  check("incremental: despawn moves the hash", sim.stateHash() !== beforeDespawn);
  check("incremental: despawn stays in step with slow", sim.stateHash() === sim.stateHashSlow());

  // An emptied store is still distinguishable from one that never existed —
  // the pre-H2 hash folded component names per store, and so does this one.
  const emptied = new Sim("core-incremental-empty");
  const e = emptied.spawn();
  emptied.setComponent(e, "ghost", { v: 1 });
  emptied.removeComponent(e, "ghost");
  const never = new Sim("core-incremental-empty");
  never.spawn();
  check(
    "incremental: a created-then-emptied component store still hashes differently from one that never existed",
    emptied.stateHash() !== never.stateHash() && emptied.stateHash() === emptied.stateHashSlow()
  );

  // Negative control: the ONE thing the cross-check exists to catch. An
  // in-place mutation is invisible to setComponent(), so the cached entry
  // hash goes stale and the two hashes MUST disagree. If this check ever
  // passes-by-agreeing, stateHashSlow() has stopped biting.
  const violator = new Sim("core-writethrough-violation");
  const v = violator.spawn();
  violator.setComponent(v, "pos", { x: 0, y: 0 });
  violator.stateHash(); // populate the cache
  violator.getComponent(v, "pos").x = 42; // the banned move
  check(
    "incremental: an in-place component mutation makes stateHash() and stateHashSlow() disagree",
    violator.stateHash() !== violator.stateHashSlow()
  );

  // restore() clears the cache wholesale, so a restored sim's incremental
  // hash cannot inherit entries from the state it replaced.
  const src = new Sim("core-incremental-restore");
  const s1 = src.spawn();
  src.setComponent(s1, "pos", { x: 5, y: 5 });
  const snap = src.snapshot();
  const dst = new Sim("core-incremental-restore");
  const d1 = dst.spawn();
  dst.setComponent(d1, "pos", { x: 999, y: 999 });
  dst.stateHash(); // populate a cache with the WRONG values
  dst.restore(snap);
  check(
    "incremental: restore() clears the entry cache (restored hash matches the source)",
    dst.stateHash() === snap.stateHash && dst.stateHash() === dst.stateHashSlow()
  );
}

// --- incremental stateHash: cost, at the spec's 300-entity fixture --------
// Review-read, NOT asserted (a timing assertion in a unit suite is a
// flake generator). docs/PHASE-H2.md §12 states the expectation: >= 10x.
{
  const bench = new Sim("core-hash-bench");
  for (let i = 0; i < 300; i++) {
    const e = bench.spawn();
    bench.setComponent(e, "pos", { xMm: i * 137, zMm: i * 31 });
    bench.setComponent(e, "guest", { archetypeId: `arch-${i % 7}`, segment: "budget", state: "queued", roomEntity: 0, stayUntilTick: 0, queueIndex: i % 12, patienceTicks: 0 });
    bench.setComponent(e, "navAgent", { goalCx: i % 40, goalCz: i % 30, path: [], pathIdx: 0, repathAtTick: 0, jitterSeed: i, stuckTicks: 0 });
  }
  const REPS = 200;
  bench.stateHash(); // warm the cache; steady state is "nothing dirty"
  let t0 = performance.now();
  for (let i = 0; i < REPS; i++) bench.stateHash();
  const incrementalUs = ((performance.now() - t0) * 1000) / REPS;
  t0 = performance.now();
  for (let i = 0; i < REPS; i++) bench.stateHashSlow();
  const slowUs = ((performance.now() - t0) * 1000) / REPS;
  console.log(
    `  hash bench @300 entities x3 components: incremental ${incrementalUs.toFixed(1)} us/call, slow ${slowUs.toFixed(1)} us/call (${(slowUs / incrementalUs).toFixed(1)}x)`
  );
  check("hash bench: the two paths agree at the 300-entity fixture", bench.stateHash() === bench.stateHashSlow());
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
