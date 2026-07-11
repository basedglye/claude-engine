// Unit tests for @claude-engine/persistence (Phase 3 Scope D), run against
// the built dist/ (npm run test -w @claude-engine/persistence builds
// first). Hand-rolled assert-and-exit script matching this repo's
// scripts/smoke.mjs style. SQLite (dev driver) always runs; the Postgres
// conformance + crash-recovery suite runs only when DATABASE_URL is set
// (CI provides a service container; skipped cleanly otherwise).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Sim } from "../../core/dist/index.js";
import { sqliteStore, postgresStore, recoverSim } from "../dist/index.js";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

function setupGame(sim) {
  const player = sim.spawn();
  sim.setComponent(player, "hp", { value: 100000 });
  const loot = sim.forkRng("loot");
  sim.addSystem((s) => {
    const hp = s.getComponent(player, "hp");
    hp.value -= loot.int(1, 3);
    hp.value -= s.rng.int(0, 1);
  });
}

/** One shared conformance + crash-recovery suite, run against any GameStore. */
async function runConformanceSuite(store, label) {
  const gameId = `test-${randomUUID()}`;
  const seed = `persistence-golden-${gameId}`;

  const record = await store.createGame({ id: gameId, name: "conformance", seed });
  check(`[${label}] createGame returns the record`, record.id === gameId && record.seed === seed);

  const fetched = await store.getGame(gameId);
  check(`[${label}] getGame round-trips the record`, fetched?.id === gameId && fetched?.seed === seed);

  check(`[${label}] getGame(missing) returns null`, (await store.getGame(`missing-${randomUUID()}`)) === null);

  // --- crash-recovery golden: N ticks + mid-run snapshot, "crash" (discard
  // the sim), recoverSim, continue to 2N -> hash equals an uninterrupted
  // 2N-tick run's.
  const N = 30;

  const continuous = new Sim(seed);
  setupGame(continuous);
  for (let t = 0; t < 2 * N; t++) continuous.step();
  const continuousHash = continuous.stateHash();

  const live = new Sim(seed);
  setupGame(live);
  const commandsSoFar = [];
  for (let t = 0; t < N; t++) {
    live.step();
  }
  await store.appendCommands(gameId, commandsSoFar); // no commands in this scenario; exercises the empty-batch path
  await store.saveSnapshot(gameId, live.snapshot());
  // "crash": the live sim is discarded; only the store survives.

  const { sim: recovered } = await recoverSim(store, gameId, setupGame);
  check(`[${label}] recoverSim restores to the snapshot tick`, recovered.tick === N);
  for (let t = N; t < 2 * N; t++) recovered.step();
  check(
    `[${label}] crash recovery: recovered 2N-tick hash == uninterrupted run's`,
    recovered.stateHash() === continuousHash
  );

  // --- recovery with no snapshot yet (pure command-log replay) ------------
  const gameId2 = `test-${randomUUID()}`;
  const seed2 = `persistence-nolog-${gameId2}`;
  await store.createGame({ id: gameId2, name: "no-snapshot", seed: seed2 });

  const commandsGame2 = [
    { tick: 3, actor: "p1", type: "noop", payload: {} },
    { tick: 7, actor: "p1", type: "noop", payload: {} },
  ];
  await store.appendCommands(gameId2, commandsGame2);
  const sinceZero = await store.commandsSince(gameId2, 0);
  check(
    `[${label}] commandsSince(0) returns appended commands in tick order`,
    sinceZero.length === 2 && sinceZero[0].tick === 3 && sinceZero[1].tick === 7
  );
  check(`[${label}] latestSnapshot returns null before any snapshot is saved`, (await store.latestSnapshot(gameId2)) === null);

  const { sim: fromLog } = await recoverSim(store, gameId2, (sim) => {
    const player = sim.spawn();
    sim.setComponent(player, "hits", { value: 0 });
    sim.addSystem((s) => {
      for (const c of s.commands()) {
        if (c.type !== "noop") continue;
        const hits = s.getComponent(player, "hits");
        hits.value += 1;
      }
    });
  });
  check(`[${label}] recoverSim with no snapshot replays the full command log`, fromLog.tick === 7);
  check(`[${label}] recoverSim(missing gameId) rejects`, await recoverSim(store, `missing-${randomUUID()}`, () => {}).then(() => false, () => true));
}

const sqlitePath = join(mkdtempSync(join(tmpdir(), "claude-engine-persistence-")), "test.db");
const sqlite = sqliteStore(sqlitePath);
try {
  await runConformanceSuite(sqlite, "sqlite");
} finally {
  await sqlite.close();
  rmSync(sqlitePath, { force: true });
}

if (process.env.DATABASE_URL) {
  const pg = postgresStore(process.env.DATABASE_URL);
  try {
    await runConformanceSuite(pg, "postgres");
  } finally {
    await pg.close();
  }
} else {
  console.log("SKIP: postgres conformance suite (DATABASE_URL not set)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
