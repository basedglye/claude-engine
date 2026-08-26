// Unit tests for @claude-engine/server (Phase 3 Scope C), run against the
// built dist/ (npm run test -w @claude-engine/server builds first).
// Hand-rolled assert-and-exit script matching this repo's scripts/smoke.mjs
// style. Uses the platform-global WebSocket client (Node 22+) against a
// real startGameServer instance on an ephemeral port — no mocking of ws.
import { startGameServer, devAuth, ticketAuth, issueTicket } from "../dist/index.js";
import { replay } from "../../core/dist/index.js";

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
 * A join-based game, component-derived actor->entity lookup (never a
 * setup-closure Map — see docs/reviews/phase-3.md item 1 / net-api.md).
 * Also records any command whose stamped tick doesn't match the tick it
 * actually executes in — the regression check for item 2's tick-stamp bug
 * (a commutative accumulator game could pass with mis-stamped commands by
 * coincidence; this check doesn't depend on the game's math at all).
 */
function createGameSetup() {
  const tickMismatches = [];
  function setup(sim) {
    sim.addSystem((s) => {
      for (const c of s.commands()) {
        if (c.tick !== s.tick) tickMismatches.push({ stampedTick: c.tick, executedTick: s.tick, type: c.type });

        if (c.type === "@net/join") {
          let existing;
          for (const [id, owner] of s.withComponent("owner")) {
            if (owner === c.actor) existing = id;
          }
          if (existing !== undefined) continue;
          const entity = s.spawn();
          s.setComponent(entity, "pos", { x: 0, z: 0 });
          s.setComponent(entity, "owner", c.actor);
        } else if (c.type === "@net/leave") {
          for (const [id, owner] of s.withComponent("owner")) {
            if (owner === c.actor) {
              s.removeComponent(id, "pos");
              s.removeComponent(id, "owner");
              break;
            }
          }
        } else if (c.type === "move") {
          for (const [id, owner] of s.withComponent("owner")) {
            if (owner === c.actor) {
              const pos = s.getComponent(id, "pos");
              if (pos) {
                s.setComponent(id, "pos", { x: pos.x + c.payload.dx, z: pos.z + (c.payload.dz ?? 0) });
              }
              break;
            }
          }
        }
      }
    });
  }
  return { setup, tickMismatches };
}

/** Waits for the next message of a specific `t`, discarding anything else —
 *  needed because an open session receives periodic "state" broadcasts
 *  (every tick by default) that would otherwise race whatever message a
 *  check is actually waiting for. */
function messageOfType(ws, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error(`Timed out waiting for a "${type}" message`));
    }, timeoutMs);
    function handler(e) {
      const msg = JSON.parse(e.data);
      if (msg.t !== type) return;
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(msg);
    }
    ws.addEventListener("message", handler);
  });
}
function onceClose(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
  });
}
function onceOpen(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("open", () => resolve(), { once: true });
  });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectAndHello(url, token) {
  const ws = new WebSocket(url);
  await onceOpen(ws);
  ws.send(JSON.stringify({ t: "hello", proto: 1, token }));
  return ws;
}

const moveRule = { validate: (p) => typeof p?.dx === "number", maxPerTick: 1, maxPerSecond: 100 };

// --- devAuth: only "dev:"-prefixed tokens accepted --------------------------
{
  const auth = devAuth();
  check("devAuth accepts dev:-prefixed tokens", (await auth.authenticate("dev:alice"))?.playerId === "alice");
  check("devAuth rejects non-dev: tokens", (await auth.authenticate("alice")) === null);
  check("devAuth rejects empty player id", (await auth.authenticate("dev:")) === null);
}

// --- ticketAuth: HMAC-signed, expiring ------------------------------------
{
  const secret = "test-secret";
  const auth = ticketAuth(secret);
  const ticket = issueTicket(secret, "bob", { ttlMs: 60_000 });
  check("ticketAuth accepts a validly signed, unexpired ticket", (await auth.authenticate(ticket))?.playerId === "bob");
  check("ticketAuth rejects a tampered signature", (await auth.authenticate(ticket + "x")) === null);
  check("ticketAuth rejects garbage tokens", (await auth.authenticate("not-a-ticket")) === null);

  const expired = issueTicket(secret, "bob", { ttlMs: -1 });
  check("ticketAuth rejects an expired ticket", (await auth.authenticate(expired)) === null);
}

// --- live server: auth-failed close, welcome, superseded, validation -------
{
  const { setup, tickMismatches } = createGameSetup();
  const server = await startGameServer({
    seed: "server-test-seed",
    setup,
    auth: devAuth(),
    commands: { move: moveRule },
    port: 0,
  });
  const url = `ws://127.0.0.1:${server.port}`;

  // invalid token -> close(auth-failed) before any sim interaction
  {
    const ws = await connectAndHello(url, "not-a-dev-token");
    const closeMsg = await messageOfType(ws, "close");
    check("invalid token: server sends close(auth-failed)", closeMsg.t === "close" && closeMsg.code === "auth-failed");
    await onceClose(ws);
  }

  // valid token -> welcome with server-assigned actor
  const wsA = await connectAndHello(url, "dev:alice");
  const welcomeA = await messageOfType(wsA, "welcome");
  check("valid token: welcome carries the server-assigned actor", welcomeA.t === "welcome" && welcomeA.actor === "player:alice");
  check("welcome's playerId matches the authenticated identity", welcomeA.playerId === "alice");

  // duplicate playerId -> the existing (first) connection is superseded;
  // the new connection gets its own welcome. Both wsA and wsA2 are already
  // receiving periodic "state" broadcasts by this point, hence messageOfType.
  const wsA2 = await connectAndHello(url, "dev:alice");
  const [closeOnA, welcomeOnA2] = await Promise.all([messageOfType(wsA, "close"), messageOfType(wsA2, "welcome")]);
  check("duplicate playerId: the superseded (first) connection is closed with code=superseded", closeOnA.t === "close" && closeOnA.code === "superseded");
  check("duplicate playerId: the new connection receives its own welcome", welcomeOnA2.t === "welcome" && welcomeOnA2.actor === "player:alice");

  // unknown command type -> reject
  wsA2.send(JSON.stringify({ t: "input", seq: 1, intents: [{ type: "no-such-command" }] }));
  const rejectUnknown = await messageOfType(wsA2, "reject");
  check("unregistered command type rejects with unknown-type", rejectUnknown.t === "reject" && rejectUnknown.reason === "unknown-type");

  // invalid payload -> reject
  wsA2.send(JSON.stringify({ t: "input", seq: 2, intents: [{ type: "move", payload: { dx: "not-a-number" } }] }));
  const rejectInvalid = await messageOfType(wsA2, "reject");
  check("invalid payload rejects with invalid-payload", rejectInvalid.t === "reject" && rejectInvalid.reason === "invalid-payload");

  // valid move, then a second move in the same tick exceeds maxPerTick: 1
  wsA2.send(JSON.stringify({ t: "input", seq: 3, intents: [{ type: "move", payload: { dx: 1 } }] }));
  wsA2.send(JSON.stringify({ t: "input", seq: 4, intents: [{ type: "move", payload: { dx: 1 } }] }));
  await sleep(200); // let a few ticks pass so both messages land in the same or adjacent tick windows
  const stats = server.stats();
  check("valid move is accepted (commandsAccepted > 0)", stats.commandsAccepted > 0);

  wsA.close();
  wsA2.close();
  await server.stop();
  check("no command executed on a different tick than it was stamped for", tickMismatches.length === 0);
}

// --- Scope C session lifecycle (docs/reviews/phase-3.md item 4): a
// superseded connection's actor leaves the command log with a matching
// @net/leave before the new connection's @net/join, so lifecycle stays 1:1
// with real connections (no orphaned entity, no duplicate join).
{
  const { setup } = createGameSetup();
  const lifecycleServer = await startGameServer({
    seed: "server-lifecycle-seed",
    setup,
    auth: devAuth(),
    commands: { move: moveRule },
    port: 0,
  });
  const lifecycleUrl = `ws://127.0.0.1:${lifecycleServer.port}`;

  const wsFirst = await connectAndHello(lifecycleUrl, "dev:carol");
  await messageOfType(wsFirst, "welcome");
  const wsSecond = await connectAndHello(lifecycleUrl, "dev:carol"); // supersedes wsFirst
  await Promise.all([messageOfType(wsFirst, "close"), messageOfType(wsSecond, "welcome")]);
  await sleep(150); // let the queued leave/join land in a tick

  // Two real connections happened (the original, then the superseding one),
  // so the log should show exactly that: join (original connect), leave
  // (supersede evicts it), join (the new connection) — 1:1 with what
  // actually connected/departed, in that order.
  const lifecycleLog = lifecycleServer.commandLog();
  const carolEvents = lifecycleLog.filter(
    (c) => c.actor === "player:carol" && (c.type === "@net/join" || c.type === "@net/leave")
  );
  check(
    "supersede: command log shows join, leave, join — 1:1 with the two real connections",
    carolEvents.length === 3 &&
      carolEvents[0].type === "@net/join" &&
      carolEvents[1].type === "@net/leave" &&
      carolEvents[2].type === "@net/join"
  );

  wsSecond.close();
  await lifecycleServer.stop();
}

// --- Scope C write-ahead race (docs/reviews/phase-3.md item 2): commands
// accepted while a persistence store's appendCommands() is in flight must
// never execute in the imminent tick without being recorded. A deliberately
// macrotask-async mock store reproduces this — better-sqlite3's wrapped-sync
// promises resolve in a microtask, so pg-like async latency needs an
// explicit macrotask boundary (setTimeout) to exercise the race at all.
{
  function makeDelayedStore(delayMs) {
    const log = [];
    return {
      log,
      async createGame(opts) {
        return { id: opts.id, name: opts.name, seed: opts.seed, protoVersion: 1, createdAt: new Date(0).toISOString() };
      },
      async getGame() {
        return null;
      },
      async appendCommands(_gameId, commands) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        log.push(...commands);
      },
      async commandsSince() {
        return [];
      },
      async saveSnapshot() {},
      async latestSnapshot() {
        return null;
      },
      async close() {},
    };
  }

  const raceMoveRule = { validate: (p) => typeof p?.dx === "number", maxPerTick: 50, maxPerSecond: 1000 };
  const delayedStore = makeDelayedStore(30);
  const { setup, tickMismatches } = createGameSetup();
  const raceServer = await startGameServer({
    seed: "server-race-seed",
    setup,
    auth: devAuth(),
    commands: { move: raceMoveRule },
    port: 0,
    store: delayedStore,
    gameId: "race-game",
  });
  const raceUrl = `ws://127.0.0.1:${raceServer.port}`;
  const wsRace = await connectAndHello(raceUrl, "dev:racer");
  await messageOfType(wsRace, "welcome");

  let raceSeq = 0;
  const pump = setInterval(() => {
    wsRace.send(JSON.stringify({ t: "input", seq: ++raceSeq, intents: [{ type: "move", payload: { dx: 1 } }] }));
  }, 10); // faster than the tick interval, to maximize overlap with the store's artificial delay
  await sleep(1000);
  clearInterval(pump);
  await sleep(200); // let any in-flight appendCommands() calls settle
  wsRace.close();
  await raceServer.stop();

  // commandsAccepted counts only CommandRule-validated intents (the "move"
  // traffic this test pumps) — the log additionally contains the session's
  // own @net/join, which never goes through that counter.
  const accepted = raceServer.stats().commandsAccepted;
  const loggedMoves = delayedStore.log.filter((c) => c.type === "move").length;
  check(
    "write-ahead: every accepted command is recorded in the store's log (no race-dropped commands)",
    accepted === loggedMoves
  );
  if (accepted !== loggedMoves) {
    console.log(`  accepted=${accepted} loggedMoves=${loggedMoves} totalLogged=${delayedStore.log.length}`);
  }
  check("write-ahead: no command executed on a different tick than it was stamped for", tickMismatches.length === 0);
  if (tickMismatches.length > 0) {
    console.log(`  ${tickMismatches.length} mismatch(es), e.g. ${JSON.stringify(tickMismatches[0])}`);
  }

  // A fresh setup (its own tickMismatches/component state) for the replay
  // side — this must be a game-logic clone, not the live server's instance.
  const { setup: replaySetup } = createGameSetup();
  const replayedHashes = replay("server-race-seed", replaySetup, delayedStore.log, raceServer.world.tick);
  const replayedFinalHash = replayedHashes[replayedHashes.length - 1];
  check(
    "write-ahead: replaying the store's persisted log matches the server's own final hash",
    replayedFinalHash === raceServer.world.stateHash()
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
