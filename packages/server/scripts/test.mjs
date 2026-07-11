// Unit tests for @claude-engine/server (Phase 3 Scope C), run against the
// built dist/ (npm run test -w @claude-engine/server builds first).
// Hand-rolled assert-and-exit script matching this repo's scripts/smoke.mjs
// style. Uses the platform-global WebSocket client (Node 22+) against a
// real startGameServer instance on an ephemeral port — no mocking of ws.
import { startGameServer, devAuth, ticketAuth, issueTicket } from "../dist/index.js";

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
  const spawned = new Map(); // playerId -> entity
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type === "@net/join") {
        const entity = s.spawn();
        s.setComponent(entity, "pos", { x: 0, z: 0 });
        s.setComponent(entity, "owner", c.payload.playerId);
        spawned.set(c.payload.playerId, entity);
      } else if (c.type === "@net/leave") {
        const entity = spawned.get(c.payload.playerId);
        if (entity !== undefined) s.removeComponent(entity, "pos");
      } else if (c.type === "move") {
        const entity = spawned.get(c.actor.replace(/^player:/, ""));
        if (entity !== undefined) {
          const pos = s.getComponent(entity, "pos");
          if (pos) {
            pos.x += c.payload.dx;
            pos.z += c.payload.dz ?? 0;
          }
        }
      }
    }
  });
}

function onceMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => resolve(JSON.parse(e.data)), { once: true });
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
  const server = await startGameServer({
    seed: "server-test-seed",
    setup: setupGame,
    auth: devAuth(),
    commands: { move: moveRule },
    port: 0,
  });
  const url = `ws://127.0.0.1:${server.port}`;

  // invalid token -> close(auth-failed) before any sim interaction
  {
    const ws = await connectAndHello(url, "not-a-dev-token");
    const closeMsg = await onceMessage(ws);
    check("invalid token: server sends close(auth-failed)", closeMsg.t === "close" && closeMsg.code === "auth-failed");
    await onceClose(ws);
  }

  // valid token -> welcome with server-assigned actor
  const wsA = await connectAndHello(url, "dev:alice");
  const welcomeA = await onceMessage(wsA);
  check("valid token: welcome carries the server-assigned actor", welcomeA.t === "welcome" && welcomeA.actor === "player:alice");
  check("welcome's playerId matches the authenticated identity", welcomeA.playerId === "alice");

  // duplicate playerId -> the existing (first) connection is superseded;
  // the new connection gets its own welcome.
  const wsA2 = await connectAndHello(url, "dev:alice");
  const [closeOnA, welcomeOnA2] = await Promise.all([onceMessage(wsA), onceMessage(wsA2)]);
  check("duplicate playerId: the superseded (first) connection is closed with code=superseded", closeOnA.t === "close" && closeOnA.code === "superseded");
  check("duplicate playerId: the new connection receives its own welcome", welcomeOnA2.t === "welcome" && welcomeOnA2.actor === "player:alice");

  // unknown command type -> reject
  wsA2.send(JSON.stringify({ t: "input", seq: 1, intents: [{ type: "no-such-command" }] }));
  const rejectUnknown = await onceMessage(wsA2);
  check("unregistered command type rejects with unknown-type", rejectUnknown.t === "reject" && rejectUnknown.reason === "unknown-type");

  // invalid payload -> reject
  wsA2.send(JSON.stringify({ t: "input", seq: 2, intents: [{ type: "move", payload: { dx: "not-a-number" } }] }));
  const rejectInvalid = await onceMessage(wsA2);
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
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
