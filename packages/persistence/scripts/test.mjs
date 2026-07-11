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

/**
 * A join-based multiplayer setup, matching scenarios/lib/net-game.mjs's
 * component-derived actor->entity lookup (docs/reviews/phase-3.md item 1):
 * no setup-closure Map, so a fresh setup() call before Sim.restore() has
 * nothing that needs rebuilding — the lookup just re-derives from whatever
 * components restore() puts back. This is what the crash-recovery golden
 * below exercises end to end.
 */
function setupMultiplayerGame(sim) {
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type === "@net/join") {
        let existing;
        for (const [id, owner] of s.withComponent("owner")) {
          if (owner === c.actor) existing = id;
        }
        if (existing !== undefined) continue;
        const entity = s.spawn();
        s.setComponent(entity, "pos", { x: 0, z: 0 });
        s.setComponent(entity, "owner", c.actor);
      } else if (c.type === "move") {
        let entity;
        for (const [id, owner] of s.withComponent("owner")) {
          if (owner === c.actor) entity = id;
        }
        if (entity === undefined) continue;
        const pos = s.getComponent(entity, "pos");
        pos.x += c.payload.dx;
        pos.z += c.payload.dz;
      }
    }
  });
}

function byTickMap(commands) {
  const m = new Map();
  for (const c of commands) {
    const list = m.get(c.tick) ?? [];
    list.push(c);
    m.set(c.tick, list);
  }
  return m;
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

  // --- crash-recovery golden: a join, commands before AND after a snapshot
  // taken strictly before the crash tick, "crash" (discard the sim),
  // recoverSim, continue with fresh post-restart commands -> hash equals an
  // uninterrupted run's. This is the composition the engine promises
  // (snapshot -> restore -> replay-tail -> continue) and the one a naive
  // golden (snapshot with no pending tail) would never catch failing.
  const N_SNAPSHOT = 10;
  const N_CRASH = 20;
  const N_FINAL = 40;
  const actor = `player:golden-${gameId}`;

  const commandsBeforeCrash = [
    { tick: 1, actor, type: "@net/join", payload: {} },
    { tick: 5, actor, type: "move", payload: { dx: 1, dz: 0 } }, // before the snapshot
    { tick: 15, actor, type: "move", payload: { dx: 0, dz: 1 } }, // after the snapshot, before the crash
    // recoverSim replays to the last *command's* tick, not the true crash
    // tick (trailing command-free ticks are lost, by design — a crash can
    // lose an unexecuted tail); a command exactly at the crash tick keeps
    // this golden's recovered.tick assertion exact rather than testing that
    // separately-documented, non-blocking limitation.
    { tick: N_CRASH, actor, type: "move", payload: { dx: 0, dz: -2 } },
  ];
  const commandsAfterRestart = [
    { tick: 25, actor, type: "move", payload: { dx: 1, dz: 1 } }, // fresh, submitted post-recovery
    { tick: 35, actor, type: "move", payload: { dx: -1, dz: 0 } },
  ];

  const continuous = new Sim(seed);
  setupMultiplayerGame(continuous);
  const contByTick = byTickMap([...commandsBeforeCrash, ...commandsAfterRestart]);
  for (let t = 1; t <= N_FINAL; t++) {
    for (const c of contByTick.get(t) ?? []) continuous.submit(c);
    continuous.step();
  }
  const continuousHash = continuous.stateHash();

  const live = new Sim(seed);
  setupMultiplayerGame(live);
  const liveByTick = byTickMap(commandsBeforeCrash);
  for (let t = 1; t <= N_CRASH; t++) {
    const tickCommands = liveByTick.get(t) ?? [];
    for (const c of tickCommands) live.submit(c);
    if (tickCommands.length > 0) await store.appendCommands(gameId, tickCommands); // write-ahead, per tick
    live.step();
    if (t === N_SNAPSHOT) await store.saveSnapshot(gameId, live.snapshot());
  }
  // "crash": the live sim is discarded; only the store survives.

  const { sim: recovered } = await recoverSim(store, gameId, setupMultiplayerGame);
  check(
    `[${label}] recoverSim restores to the snapshot tick + replays the persisted tail to the crash tick`,
    recovered.tick === N_CRASH
  );

  // Continue post-restart exactly like a live server would: fresh commands
  // submitted directly, not read back from the store.
  const restartByTick = byTickMap(commandsAfterRestart);
  for (let t = N_CRASH + 1; t <= N_FINAL; t++) {
    for (const c of restartByTick.get(t) ?? []) recovered.submit(c);
    recovered.step();
  }
  check(
    `[${label}] crash recovery (join + pre/post-snapshot commands + post-restart continuation): recovered hash == continuous run's`,
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
