// Unit tests for @claude-engine/net (Phase 3 Scope B), run against the built
// dist/ (npm run test -w @claude-engine/net builds first). Hand-rolled
// assert-and-exit script matching this repo's scripts/smoke.mjs style.
// The client session is exercised with a scripted fake transport — no
// sockets, no wall-clock flakiness.
import {
  encodeMessage,
  decodeClientMessage,
  decodeServerMessage,
  ProtocolError,
  DEFAULT_LIMITS,
  createClientSession,
} from "../dist/index.js";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

function throws(fn, errorClass) {
  try {
    fn();
    return false;
  } catch (err) {
    return errorClass ? err instanceof errorClass : true;
  }
}

// --- decodeClientMessage: boundary validation -------------------------------
check(
  "decodeClientMessage: oversized message throws ProtocolError",
  throws(() => decodeClientMessage("x".repeat(DEFAULT_LIMITS.maxMessageBytes + 1)), ProtocolError)
);
check(
  "decodeClientMessage: malformed JSON throws ProtocolError",
  throws(() => decodeClientMessage("{not json"), ProtocolError)
);
check(
  "decodeClientMessage: missing discriminant throws ProtocolError",
  throws(() => decodeClientMessage(JSON.stringify({ foo: "bar" })), ProtocolError)
);
check(
  "decodeClientMessage: reserved intent type (@net/join) rejected",
  throws(
    () => decodeClientMessage(JSON.stringify({ t: "input", seq: 1, intents: [{ type: "@net/join" }] })),
    ProtocolError
  )
);
check(
  "decodeClientMessage: too many intents in one message throws ProtocolError",
  throws(
    () =>
      decodeClientMessage(
        JSON.stringify({
          t: "input",
          seq: 1,
          intents: Array.from({ length: DEFAULT_LIMITS.maxIntentsPerMessage + 1 }, () => ({ type: "move" })),
        })
      ),
    ProtocolError
  )
);
{
  const decoded = decodeClientMessage(JSON.stringify({ t: "input", seq: 1, intents: [{ type: "move", payload: { dx: 1 } }] }));
  check("decodeClientMessage: valid input message round-trips", decoded.t === "input" && decoded.intents[0].type === "move");
}
check(
  "decodeServerMessage: malformed JSON throws ProtocolError",
  throws(() => decodeServerMessage("{not json"), ProtocolError)
);

// --- fake transport for client-session tests --------------------------------
function makeFakeTransport() {
  let messageHandler;
  let closeHandler;
  const sent = [];
  return {
    transport: {
      send(raw) {
        sent.push(JSON.parse(raw));
      },
      onMessage(h) {
        messageHandler = h;
      },
      onClose(h) {
        closeHandler = h;
      },
      close() {},
    },
    sent,
    deliver(msg) {
      messageHandler(encodeMessage(msg));
    },
    triggerClose(info) {
      closeHandler?.(info);
    },
  };
}

function moveIntent(dx, dy) {
  return { type: "move", payload: { dx, dy } };
}

/** Mirrors a hypothetical server-side move system: pos += payload. */
function movePredict(view, intents) {
  for (const intent of intents) {
    if (intent.type !== "move") continue;
    const pos = view.getComponent(1, "pos") ?? { x: 0, y: 0 };
    view.patch(1, "pos", { x: pos.x + intent.payload.dx, y: pos.y + intent.payload.dy });
  }
}

function welcomeMessage(entities) {
  return {
    t: "welcome",
    proto: 1,
    playerId: "p1",
    actor: "player:p1",
    seed: "net-test-seed",
    tick: 0,
    tickRateHz: 20,
    state: { tick: 0, stateHash: 0, entities, removed: [] },
  };
}

function stateMessage(tick, entities, ackSeq, events = []) {
  return { t: "state", state: { tick, stateHash: tick, entities, removed: [] }, ackSeq, events };
}

// --- local intent visible before ack ----------------------------------------
{
  const { transport, deliver } = makeFakeTransport();
  const session = createClientSession({ transport, token: "dev:p1", predict: movePredict, pingIntervalMs: 0 });
  deliver(welcomeMessage([[1, [["pos", { x: 0, y: 0 }]]]]));
  session.submitIntent(moveIntent(1, 0));
  const pos = session.world.getComponent(1, "pos");
  check("local intent is visible in ClientWorld before any server ack", pos.x === 1 && pos.y === 0);
  check("pendingIntents reflects the unacked intent", session.stats().pendingIntents === 1);
  session.close();
}

// --- divergent authority: converges, corrections increments -----------------
// Corrections are judged once nothing the client itself sent is still
// outstanding: an intent still awaiting ack diverging from authority is
// expected latency, not a misprediction (that's the next test). Here the
// intent IS acked, but authority disagrees with what was predicted for it
// (e.g. something else also moved the entity) — a genuine correction.
{
  const { transport, deliver } = makeFakeTransport();
  const session = createClientSession({ transport, token: "dev:p1", predict: movePredict, pingIntervalMs: 0 });
  deliver(welcomeMessage([[1, [["pos", { x: 0, y: 0 }]]]]));
  session.submitIntent(moveIntent(1, 0)); // predicts pos.x = 1, seq 1

  deliver(stateMessage(1, [[1, [["pos", { x: 5, y: 0 }]]]], 1)); // acks seq 1, but authority says x=5, not the predicted x=1

  check(
    "after a divergent (but acked) authoritative state, the world converges to authority",
    session.world.getComponent(1, "pos").x === 5
  );
  check("corrections incremented: acked authority disagreed with the overlay's prediction", session.stats().corrections === 1);
  session.close();
}

// --- predict matches server logic under latency: corrections stays 0 -------
{
  const { transport, deliver } = makeFakeTransport();
  const session = createClientSession({ transport, token: "dev:p1", predict: movePredict, pingIntervalMs: 0 });
  deliver(welcomeMessage([[1, [["pos", { x: 0, y: 0 }]]]]));
  session.submitIntent(moveIntent(1, 0)); // predicts pos.x = 1, seq 1, unacked

  // Simulated latency: an intermediate state arrives before the server has
  // processed the move (still unacked) — authority lags the prediction,
  // which must NOT count as a correction.
  deliver(stateMessage(1, [[1, [["pos", { x: 0, y: 0 }]]]], 0));
  check("world keeps predicting locally while the intent is still unacked", session.world.getComponent(1, "pos").x === 1);
  check("no correction recorded while latency is outstanding", session.stats().corrections === 0);

  // The ack finally arrives, and authority matches exactly what was predicted.
  deliver(stateMessage(2, [[1, [["pos", { x: 1, y: 0 }]]]], 1));

  check(
    "predict matching server logic under latency: world reflects authority exactly once acked",
    session.world.getComponent(1, "pos").x === 1
  );
  check("acked intents are pruned", session.stats().pendingIntents === 0);
  check("corrections stays 0 when prediction matches eventual authority", session.stats().corrections === 0);
  session.close();
}

// --- reject drops the pending intent and stops predicting it ---------------
{
  const { transport, deliver } = makeFakeTransport();
  const session = createClientSession({ transport, token: "dev:p1", predict: movePredict, pingIntervalMs: 0 });
  deliver(welcomeMessage([[1, [["pos", { x: 0, y: 0 }]]]]));
  session.submitIntent(moveIntent(1, 0)); // seq 1
  deliver({ t: "reject", seq: 1, type: "move", reason: "rate-limited" });

  check("rejected intent is dropped from pendingIntents", session.stats().pendingIntents === 0);
  check("rejects counter records the reason", session.stats().rejects["rate-limited"] === 1);
  check("world no longer reflects the rejected prediction", session.world.getComponent(1, "pos").x === 0);
  session.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
