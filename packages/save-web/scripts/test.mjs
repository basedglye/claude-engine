// Unit tests for @claude-engine/save-web, run under fake-indexeddb (no real
// browser). Hand-rolled assert-and-exit script matching
// packages/persistence/scripts/test.mjs's style, since the two backends
// (sqliteStore, webStore) must be provably interchangeable.
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// --- The real hotel sim round-trip ---------------------------------------
//
// The toy game above proves the store's contract in isolation, deliberately
// without a hotel import (packages/save-web must not depend on apps/hotel
// as a real dependency). This section is different on purpose: it proves
// the store against apps/hotel's ACTUAL sim — forked RNG streams, guest
// spawning, held documents, mid-decision state, planted fraud — because
// that is exactly the state a naive snapshot/restore would silently lose.
// Per docs/PHASE-H1.md gate 4: "the browser gate proves wiring, the unit
// test proves the store."
//
// Reaching the hotel sim: a dev-only import of the COMPILED
// apps/hotel/dist-game/sim/game.js — the same artifact scenarios/*.mjs use
// and the same one the browser bundles (game.ts's own header note). The
// alternative (a TS project reference into apps/hotel/src) would make
// save-web's build depend on the hotel app's build graph; importing the
// compiled output only creates a *test-time* ordering (hotel must be built
// before `npm run test --workspace @claude-engine/save-web`), not a
// build-time one, and matches how every existing scenario reaches the sim.
// That ordering dependency is made loud rather than a cryptic
// "Cannot find module": if the artifact is missing, this script exits 1
// with an actionable message before ever attempting the import.
const HOTEL_DIST_GAME_URL = new URL("../../../apps/hotel/dist-game/sim/game.js", import.meta.url);
const HOTEL_DIST_RULES_URL = new URL("../../../apps/hotel/dist-game/sim/rules.js", import.meta.url);
if (!existsSync(fileURLToPath(HOTEL_DIST_GAME_URL)) || !existsSync(fileURLToPath(HOTEL_DIST_RULES_URL))) {
  console.error(
    "FAIL: apps/hotel/dist-game/sim/{game,rules}.js is missing.\n" +
      '  This test proves @claude-engine/save-web against the real hotel sim, not a toy.\n' +
      '  Build the hotel app first: npm run build --workspace @claude-engine/hotel\n' +
      "  (this compiles apps/hotel/src/sim/**/*.ts to apps/hotel/dist-game/, the same\n" +
      "  artifact the browser bundles), then re-run this test."
  );
  process.exit(1);
}

const { DEFAULTS: HOTEL_DEFAULTS, setupWithConfig } = await import(HOTEL_DIST_GAME_URL);
const { H1_RULES, evaluateRules } = await import(HOTEL_DIST_RULES_URL);
const { generateGroundFloor } = await import("../../interiors/dist/index.js");
const { atan2Mdeg, cellOfMm } = await import("../../space/dist/index.js");

const CLERK_ACTOR = "clerk";

/** Mirrors scenarios/lib/hotel-desk.mjs's spawnClerk: a stationary
 *  `player`-component actor parked on the desk terminal anchor, facing the
 *  queue head, so `interactSystem`'s range/arc check passes. Kept
 *  self-contained here rather than importing the repo-root scenarios/lib
 *  helper, so packages/save-web's test has no dependency outside
 *  already-built package/app dist output. */
function spawnClerk(sim, floor) {
  const head = floor.desk.queueCells[0];
  const headXMm = head.cx * 250 + 125;
  const headZMm = head.cz * 250 + 125;
  const clerk = sim.spawn();
  sim.setComponent(clerk, "pos", { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
  sim.setComponent(clerk, "prevPos", { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
  const yawMdeg = atan2Mdeg(headXMm - floor.desk.xMm, headZMm - floor.desk.zMm);
  sim.setComponent(clerk, "yaw", { mdeg: yawMdeg });
  sim.setComponent(clerk, "prevYaw", { mdeg: yawMdeg });
  sim.setComponent(clerk, "player", { actor: CLERK_ACTOR });
  return clerk;
}

function scan(sim, component) {
  const out = [];
  for (const entity of sim.entities()) {
    const c = sim.getComponent(entity, component);
    if (c !== undefined) out.push([entity, c]);
  }
  return out;
}

/** The clerk's brain, evaluated directly against `live` each cadence tick
 *  (no packages/bots dependency needed — this test drives the desk itself,
 *  mirroring clerkBot's two-step cadence from hotel-desk.mjs's makeDecide:
 *  interact the queue head, then evaluate H1_RULES and submit
 *  desk.decision). A high fraud rate means violations are actually
 *  planted; the clerk decides honestly (errorRate 0) so both accepted and
 *  denied paths get exercised. */
function clerkDecide(sim, grid, floor) {
  const hotel = scan(sim, "hotel")[0]?.[1];
  if (!hotel) return undefined;

  const guests = scan(sim, "guest");
  const presenting = guests.find(([, g]) => g.state === "presenting");
  if (presenting) {
    const [guestEntity] = presenting;
    const found = scan(sim, "reservation").find(([, r]) => r.guestEntity === guestEntity && !r.decided);
    if (!found) return undefined;
    const [reservationEntity, res] = found;
    const docs = scan(sim, "document")
      .filter(([, d]) => d.ownerEntity === guestEntity)
      .map(([, d]) => ({ docType: d.docType, fields: d.fields }));
    const violations = evaluateRules(H1_RULES, docs, res.fields, { day: hotel.day, lists: {} });
    const accept = violations.length === 0;
    const vacant = scan(sim, "roomUnit").find(([, r]) => r.occupantEntity === 0);
    return { type: "desk.decision", payload: { reservationEntity, accept, roomEntity: vacant ? vacant[0] : 0 } };
  }

  const head = floor.desk.queueCells[0];
  const waiting = guests.find(([entity, g]) => {
    if (g.state !== "queued" || g.queueIndex !== 0) return false;
    const pos = sim.getComponent(entity, "pos");
    if (!pos) return false;
    const cell = cellOfMm(grid, pos.xMm, pos.zMm);
    return cell.cx === head.cx && cell.cz === head.cz;
  });
  if (waiting) return { type: "interact", payload: { target: waiting[0] } };
  return undefined;
}

/** Drives a real hotel run through createSavePump, recovers it via
 *  recoverSim, and checks: (1) an equal stateHash at the pumped boundary,
 *  (2) an equal stateHash after both sims separately run further
 *  input-free ticks (catches un-captured RNG fork streams — a restore that
 *  only matches at the boundary and diverges on later guest spawns would
 *  slip past a boundary-only check), and (3) that the boundary was actually
 *  a hard one: a guest mid-check-in (presenting, undecided reservation,
 *  documents held), a decision already applied (checkedIn + ledger), and
 *  fraud planted and still undecided, all verified true by assertion, not
 *  assumed from the seed/config. */
// Fixed, committed seed (not derived from the test's random gameId) — the
// hard boundary this test targets (a presenting guest with an undecided
// reservation and held documents, an already-applied decision, and planted
// fraud still undecided, ALL AT THE SAME TICK) does not occur for every
// seed within a 500-tick run; it depends on how the guest-spawn/guest-fraud
// RNG streams happen to interleave. Verified empirically against this exact
// config (guestCount 10, spawnTickMin 10, fraudRatePermille 800): this seed
// reaches the simultaneous boundary at tick 250, with comfortable margin
// before N_TICKS. A random-UUID-derived seed was tried first and found
// flaky (roughly 2 of 5 sampled seeds never reached the simultaneous
// boundary in 500 ticks) — exactly the vacuous-pass failure mode this
// project has hit before, so this test pins a known-good seed instead of
// trusting one to turn up.
const HOTEL_ROUNDTRIP_SEED = "hotel-h1b-store-1";

async function runHotelRoundTrip(label, wrapStore) {
  const gameId = `test-${randomUUID()}`;
  const seed = HOTEL_ROUNDTRIP_SEED;
  const rawStore = webStore(freshDbName());
  const store = wrapStore ? wrapStore(rawStore) : rawStore;
  await store.createGame({ id: gameId, name: "hotel-roundtrip", seed });

  // snapshotEveryTicks larger than the run: the ONLY snapshot is the
  // manual snapshotNow() taken once the hard boundary below is confirmed,
  // so the recovered sim's tail-replay path is exercised deterministically
  // from a known point rather than whatever tick the periodic timer landed on.
  const pump = createSavePump({ store, gameId, snapshotEveryTicks: 100_000 });

  const config = { ...HOTEL_DEFAULTS, guestCount: 10, spawnTickMin: 10, fraudRatePermille: 800, fixture: "normal" };
  const setupHotel = (sim) => setupWithConfig(sim, config);

  const live = new Sim(seed);
  setupHotel(live);
  const floor = generateGroundFloor(seed);
  const grid = floor.grid;
  spawnClerk(live, floor);

  const N_TICKS = 500;
  const CLERK_EVERY_TICKS = 5;

  let hardBoundaryTick;
  let everSawPresentingHeld = false;
  let everSawDecisionApplied = false;
  let everSawFraudInFlight = false;

  for (let t = 1; t <= N_TICKS; t++) {
    let submittedThisTick = false;
    if (t % CLERK_EVERY_TICKS === 0) {
      const decision = clerkDecide(live, grid, floor);
      if (decision) {
        pump.submit({ tick: t, actor: CLERK_ACTOR, type: decision.type, payload: decision.payload }, (c) => live.submit(c));
        submittedThisTick = true;
      }
    }
    // recoverSim's tail replay (packages/persistence/src/recover.ts) only
    // knows about ticks that have at least one recorded command — it has
    // no other source of "how far the live run actually got". A tick with
    // no commands leaves no trace in the log, so if the LAST driven tick
    // happened to have no clerk decision, the recovered sim would stop
    // short of N_TICKS even though live kept stepping. Pin the final tick
    // with a harmless marker command (matched by no system, so it never
    // touches sim state) whenever the clerk had nothing to say.
    if (t === N_TICKS && !submittedThisTick) {
      pump.submit({ tick: t, actor: CLERK_ACTOR, type: "save-web-test.tick-marker", payload: {} }, (c) => live.submit(c));
    }
    live.step();

    if (hardBoundaryTick === undefined) {
      const presenting = scan(live, "guest").find(([, g]) => g.state === "presenting");
      let presentingHeld = false;
      if (presenting) {
        const [guestEntity] = presenting;
        const hasUndecidedRes = scan(live, "reservation").some(([, r]) => r.guestEntity === guestEntity && !r.decided);
        const hasHeldDoc = scan(live, "document").some(([, d]) => d.ownerEntity === guestEntity && d.heldBy !== 0);
        presentingHeld = hasUndecidedRes && hasHeldDoc;
      }
      const decisionApplied = live.eventsSince(0).some((e) => e.type === "guest.checkedIn");
      const fraudInFlight = scan(live, "reservation").some(([, r]) => r.plantedViolations.length > 0 && !r.decided);

      everSawPresentingHeld = everSawPresentingHeld || presentingHeld;
      everSawDecisionApplied = everSawDecisionApplied || decisionApplied;
      everSawFraudInFlight = everSawFraudInFlight || fraudInFlight;

      // Require the boundary past tick 30 so the queue has had time to
      // form (a snapshot at tick 1 would be a vacuous "nothing happened
      // yet" pass).
      if (t >= 30 && presentingHeld && decisionApplied && fraudInFlight) {
        hardBoundaryTick = t;
        await pump.snapshotNow(live);
      }
    }
  }
  await pump.flush();

  check(
    `[${label}] hotel run reached a mid-check-in guest (presenting, undecided reservation, documents held) at some point`,
    everSawPresentingHeld
  );
  check(`[${label}] hotel run reached at least one applied desk decision (guest.checkedIn)`, everSawDecisionApplied);
  check(`[${label}] hotel run had planted fraud still undecided at some point`, everSawFraudInFlight);
  check(
    `[${label}] all three conditions held SIMULTANEOUSLY at the snapshotted tick (the actual boundary this test targets)`,
    hardBoundaryTick !== undefined
  );

  const liveHashAtEnd = live.stateHash();
  const liveTickAtEnd = live.tick;

  const { sim: recovered } = await recoverSim(rawStore, gameId, setupHotel);
  check(`[${label}] recoverSim after createSavePump round-trip: recovered stateHash === live stateHash`, recovered.stateHash() === liveHashAtEnd);
  check(`[${label}] recovered tick matches`, recovered.tick === liveTickAtEnd);

  // Post-restore continuation: both sims keep running, unattended, well
  // past the snapshot AND past the pumped tail. If the restore only
  // captured the queue/reservation/document state but missed a forked RNG
  // stream (guest-spawn, guest-fraud, jitter seeds), the two would diverge
  // here even though they matched at the boundary above.
  const POST_RESTORE_TICKS = 300;
  for (let i = 0; i < POST_RESTORE_TICKS; i++) {
    live.step();
    recovered.step();
  }
  check(
    `[${label}] both sims stay hash-identical after ${POST_RESTORE_TICKS} further input-free ticks post-restore (forked RNG streams captured, not just re-seeded)`,
    live.stateHash() === recovered.stateHash()
  );

  await rawStore.close();
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
await runHotelRoundTrip("hotel: normal store");
await runHotelRoundTrip("hotel: slow store (risk 3)", slowStoreWrapper);
await runExportImport();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll checks passed.`);
}
