// Unit tests for @claude-engine/save-web, run under fake-indexeddb (no real
// browser). Hand-rolled assert-and-exit script matching
// packages/persistence/scripts/test.mjs's style, since the two backends
// (sqliteStore, webStore) must be provably interchangeable.
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { Sim } from "../../core/dist/index.js";
import { webStore, createSavePump, exportSave, importSave } from "../dist/index.js";
import { recoverSim } from "../../persistence/dist/index.js";

let failures = 0;
function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

function freshDbName() {
  return `test-db-${randomUUID()}`;
}

/** A small deterministic setup, entirely local to this test file (no hotel
 *  import — save-web must not depend on apps/hotel). A counter incremented
 *  by "inc" commands, plus a Rng-driven "roll" command so snapshot/restore
 *  of forked Rng streams is exercised too. */
function setupCounterGame(sim) {
  const fork = sim.forkRng("rolls");
  const e = sim.spawn();
  sim.setComponent(e, "counter", { value: 0, rolls: [] });
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      const state = s.getComponent(e, "counter");
      if (c.type === "inc") {
        state.value += c.payload?.by ?? 1;
      } else if (c.type === "roll") {
        state.rolls.push(fork.int(0, 99));
      }
    }
  });
}

// --- GameStore conformance, mirroring packages/persistence's suite -------
async function runStoreConformance() {
  const store = webStore(freshDbName());
  const gameId = `test-${randomUUID()}`;
  const seed = `save-web-golden-${gameId}`;

  const record = await store.createGame({ id: gameId, name: "conformance", seed });
  check("createGame returns the record", record.id === gameId && record.seed === seed);

  const fetched = await store.getGame(gameId);
  check("getGame round-trips the record", fetched?.id === gameId && fetched?.seed === seed);
  check("getGame(missing) returns null", (await store.getGame(`missing-${randomUUID()}`)) === null);

  // commandsSince boundaries: exact tick, a tick with no commands, a future
  // tick, tick 0.
  await store.appendCommands(gameId, [
    { tick: 0, actor: "p1", type: "noop", payload: {} },
    { tick: 3, actor: "p1", type: "noop", payload: {} },
    { tick: 7, actor: "p1", type: "noop", payload: {} },
  ]);
  const sinceNeg1 = await store.commandsSince(gameId, -1);
  check("commandsSince(-1) includes tick 0", sinceNeg1.length === 3 && sinceNeg1[0].tick === 0);
  const since0 = await store.commandsSince(gameId, 0);
  check("commandsSince(0) excludes tick 0, includes 3 and 7 in order", since0.length === 2 && since0[0].tick === 3 && since0[1].tick === 7);
  const since2 = await store.commandsSince(gameId, 2);
  check("commandsSince at the exact tick before a command includes it", since2.length === 2 && since2[0].tick === 3);
  const since3 = await store.commandsSince(gameId, 3);
  check("commandsSince(afterTick===tick) excludes that tick's own commands", since3.length === 1 && since3[0].tick === 7);
  const since4 = await store.commandsSince(gameId, 4);
  check("commandsSince for a tick with no commands at that exact tick still finds later ones", since4.length === 1 && since4[0].tick === 7);
  const since100 = await store.commandsSince(gameId, 100);
  check("commandsSince(future tick) returns empty", since100.length === 0);

  check("latestSnapshot returns null before any snapshot is saved", (await store.latestSnapshot(gameId)) === null);

  await store.close();
}

// --- Intra-tick ordering: many commands appended across several
// appendCommands() calls for the same tick come back in submission order. --
async function runIntraTickOrdering() {
  const store = webStore(freshDbName());
  const gameId = `test-${randomUUID()}`;
  await store.createGame({ id: gameId, name: "ordering", seed: "s" });

  await store.appendCommands(gameId, [{ tick: 5, actor: "p1", type: "a", payload: { n: 0 } }]);
  await store.appendCommands(gameId, [
    { tick: 5, actor: "p1", type: "a", payload: { n: 1 } },
    { tick: 5, actor: "p1", type: "a", payload: { n: 2 } },
  ]);
  await store.appendCommands(gameId, [{ tick: 5, actor: "p1", type: "a", payload: { n: 3 } }]);
  // Interleave a different tick to make sure it doesn't perturb tick 5's idx counter.
  await store.appendCommands(gameId, [{ tick: 6, actor: "p1", type: "a", payload: { n: 99 } }]);
  await store.appendCommands(gameId, [{ tick: 5, actor: "p1", type: "a", payload: { n: 4 } }]);

  const commands = await store.commandsSince(gameId, 0);
  const tick5 = commands.filter((c) => c.tick === 5).map((c) => c.payload.n);
  check(
    "commands appended across multiple appendCommands() calls for one tick come back in submission order",
    JSON.stringify(tick5) === JSON.stringify([0, 1, 2, 3, 4])
  );
  const tick6 = commands.filter((c) => c.tick === 6).map((c) => c.payload.n);
  check("an interleaved different tick is unaffected", JSON.stringify(tick6) === JSON.stringify([99]));

  await store.close();
}

// --- latestSnapshot picks the highest tick -------------------------------
async function runLatestSnapshot() {
  const store = webStore(freshDbName());
  const gameId = `test-${randomUUID()}`;
  await store.createGame({ id: gameId, name: "snap", seed: "s" });

  check("latestSnapshot with zero snapshots returns null", (await store.latestSnapshot(gameId)) === null);

  await store.saveSnapshot(gameId, { v: 2, tick: 10, nextEntity: 1, stateHash: 111, components: {}, rng: { root: { s: [1] }, forks: [] } });
  await store.saveSnapshot(gameId, { v: 2, tick: 30, nextEntity: 1, stateHash: 333, components: {}, rng: { root: { s: [1] }, forks: [] } });
  await store.saveSnapshot(gameId, { v: 2, tick: 20, nextEntity: 1, stateHash: 222, components: {}, rng: { root: { s: [1] }, forks: [] } });

  const latest = await store.latestSnapshot(gameId);
  check("latestSnapshot picks the highest tick", latest?.tick === 30 && latest?.stateHash === 333);

  await store.close();
}

// --- The round-trip that matters: drive a real Sim through the pump, then
// recoverSim from the store, assert an identical stateHash. Optionally
// wraps appendCommands with artificial latency (risk 3's slow-store probe).
async function runSimRoundTrip(label, wrapStore) {
  const gameId = `test-${randomUUID()}`;
  const seed = `save-web-roundtrip-${gameId}`;
  const rawStore = webStore(freshDbName());
  const store = wrapStore ? wrapStore(rawStore) : rawStore;
  await store.createGame({ id: gameId, name: "roundtrip", seed });

  const pump = createSavePump({ store, gameId, snapshotEveryTicks: 100 });

  const live = new Sim(seed);
  setupCounterGame(live);

  const N_TICKS = 500;
  for (let t = 1; t <= N_TICKS; t++) {
    if (t % 3 === 0 || t === N_TICKS) {
      pump.submit({ tick: t, actor: "p1", type: "inc", payload: { by: t % 7 } }, (c) => live.submit(c));
    }
    if (t % 11 === 0) {
      pump.submit({ tick: t, actor: "p1", type: "roll", payload: {} }, (c) => live.submit(c));
    }
    live.step();
    if (t === 200) {
      await pump.snapshotNow(live);
    }
  }
  await pump.flush();

  const liveHash = live.stateHash();

  const { sim: recovered } = await recoverSim(rawStore, gameId, setupCounterGame);
  check(`[${label}] recoverSim after createSavePump round-trip: recovered stateHash === live stateHash`, recovered.stateHash() === liveHash);
  check(`[${label}] recovered tick matches`, recovered.tick === N_TICKS);

  await rawStore.close();
  return { liveHash, recoveredHash: recovered.stateHash() };
}

/** A deliberately slow store wrapper: adds latency to appendCommands, per
 *  risk 3 — if the pump design were wrong (a tick consuming a command the
 *  pump hadn't already logged), this would surface as a hash mismatch. */
function slowStoreWrapper(inner) {
  return {
    ...inner,
    async appendCommands(gameId, commands) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return inner.appendCommands(gameId, commands);
    },
  };
}

// --- exportSave / importSave round-trip ----------------------------------
async function runExportImport() {
  const gameId = `test-${randomUUID()}`;
  const seed = `save-web-export-${gameId}`;
  const store = webStore(freshDbName());
  await store.createGame({ id: gameId, name: "export-test", seed });

  const live = new Sim(seed);
  setupCounterGame(live);
  for (let t = 1; t <= 50; t++) {
    const commands = t % 4 === 0 || t === 50 ? [{ tick: t, actor: "p1", type: "inc", payload: { by: 2 } }] : [];
    if (commands.length > 0) {
      await store.appendCommands(gameId, commands);
      for (const c of commands) live.submit(c);
    }
    live.step();
    if (t === 25) {
      await store.saveSnapshot(gameId, live.snapshot());
    }
  }
  const originalHash = live.stateHash();

  const json = await exportSave(store, gameId);
  const newGameId = await importSave(store, json);
  check("importSave returns a fresh gameId, distinct from the source", newGameId !== gameId);

  const { sim: reimported } = await recoverSim(store, newGameId, setupCounterGame);
  check("exportSave/importSave round-trip reaches an equal stateHash", reimported.stateHash() === originalHash);
  check("exportSave/importSave round-trip preserves tick", reimported.tick === 50);

  await store.close();
}

await runStoreConformance();
await runIntraTickOrdering();
await runLatestSnapshot();
await runSimRoundTrip("normal store");
await runSimRoundTrip("slow store (risk 3)", slowStoreWrapper);
await runExportImport();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll checks passed.`);
}
