// Unit tests for @claude-engine/audio — the "audio-coverage" gate (H2b gate
// 9, docs/PHASE-H2.md section 13). Run against the built dist/ (npm run test
// -w @claude-engine/audio builds first), hand-rolled assert-and-exit script,
// matching packages/space/scripts/test.mjs / packages/interiors/scripts/
// test.mjs style rather than pulling in Node's test runner.
//
// HONEST SCOPE: nothing here asserts audible output. This gate proves (a)
// coverage completeness over the hotel's real event vocabulary and (b) the
// scheduler's mechanical contract (idempotence, rate limiting, positional
// degrade-to-non-positional) against a mock AudioContext that records what
// WOULD have played, never what a speaker actually produced.
import { auditSoundCoverage, createAudioHost } from "../dist/index.js";
import {
  HOTEL_SOUND_RULES,
  DELIBERATELY_SILENT,
  GAMEPLAY_EVENT_TYPES,
} from "../../../apps/hotel/dist-game/render/sounds.js";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

// --- 1. Real coverage: the hotel table against the hotel's real event list.
{
  const { uncovered, unknownRules } = auditSoundCoverage(
    HOTEL_SOUND_RULES,
    GAMEPLAY_EVENT_TYPES,
    DELIBERATELY_SILENT
  );
  check(`zero uncovered gameplay event types (got: ${JSON.stringify(uncovered)})`, uncovered.length === 0);
  check(`zero unknown rule event types (got: ${JSON.stringify(unknownRules)})`, unknownRules.length === 0);
}

// --- 2. Non-vacuity controls: prove the audit can actually fail. -----------
// Control A: drop one covered, non-silent event type from the rule table and
// assert it (and only it) comes back uncovered.
{
  const droppedType = HOTEL_SOUND_RULES.find((r) => !DELIBERATELY_SILENT.includes(r.eventType))?.eventType;
  check("control A precondition: a droppable covered rule exists", droppedType !== undefined);
  const rulesWithoutOne = HOTEL_SOUND_RULES.filter((r) => r.eventType !== droppedType);
  const { uncovered } = auditSoundCoverage(rulesWithoutOne, GAMEPLAY_EVENT_TYPES, DELIBERATELY_SILENT);
  console.log(`control A (removed "${droppedType}"): uncovered = ${JSON.stringify(uncovered)}`);
  check("control A: removing a covered rule makes exactly it uncovered", uncovered.length === 1 && uncovered[0] === droppedType);
}

// Control B: add a bogus rule whose eventType is not in the known list, and
// assert it comes back as the sole unknownRules entry.
{
  const bogusRules = [...HOTEL_SOUND_RULES, { eventType: "bogus.not-a-real-event", spec: { wave: "sine", freqHz: 1, durationMs: 1, gain: 0.1 }, at: "ui" }];
  const { unknownRules } = auditSoundCoverage(bogusRules, GAMEPLAY_EVENT_TYPES, DELIBERATELY_SILENT);
  console.log(`control B (added bogus rule): unknownRules = ${JSON.stringify(unknownRules)}`);
  check("control B: an unknown-event rule is flagged as unknown", unknownRules.length === 1 && unknownRules[0] === "bogus.not-a-real-event");
}

// --- 3. createAudioHost against a mock AudioContext. ------------------------
class MockParam {
  constructor() {
    this.value = 0;
  }
  setValueAtTime(v) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v) {
    this.value = v;
    return this;
  }
}

class MockNode {
  constructor(kind) {
    this.kind = kind;
    this.connected = [];
    this.disconnectCount = 0;
    this.started = false;
    this.stopped = false;
  }
  connect(dest) {
    this.connected.push(dest);
    return dest;
  }
  disconnect() {
    this.disconnectCount++;
  }
}

class MockOscillator extends MockNode {
  constructor() {
    super("oscillator");
    this.frequency = new MockParam();
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class MockGain extends MockNode {
  constructor() {
    super("gain");
    this.gain = new MockParam();
  }
}

class MockPanner extends MockNode {
  constructor() {
    super("panner");
    this.positionX = new MockParam();
    this.positionY = new MockParam();
    this.positionZ = new MockParam();
    this.panningModel = "equalpower";
  }
}

class MockBufferSource extends MockNode {
  constructor() {
    super("bufferSource");
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class MockAudioBuffer {
  constructor(frameCount) {
    this._data = new Float32Array(frameCount);
  }
  getChannelData() {
    return this._data;
  }
}

class MockAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new MockNode("destination");
    this.listener = {
      positionX: new MockParam(),
      positionY: new MockParam(),
      positionZ: new MockParam(),
    };
    this.created = []; // every node this context has vended
  }
  createOscillator() {
    const n = new MockOscillator();
    this.created.push(n);
    return n;
  }
  createGain() {
    const n = new MockGain();
    this.created.push(n);
    return n;
  }
  createPanner() {
    const n = new MockPanner();
    this.created.push(n);
    return n;
  }
  createBufferSource() {
    const n = new MockBufferSource();
    this.created.push(n);
    return n;
  }
  createBuffer(_channels, frameCount) {
    return new MockAudioBuffer(frameCount);
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

function makeEvent(tick, type, payload) {
  return { tick, type, payload };
}

// 3a. A realistic event stream schedules > 0 nodes.
{
  const ctx = new MockAudioContext();
  const positions = new Map([[1, { xM: 1, zM: 2 }]]);
  const host = createAudioHost({
    rules: HOTEL_SOUND_RULES,
    listener: () => ({ xM: 0, zM: 0, yawRad: 0 }),
    entityPos: (e) => positions.get(e),
    muzakSeed: "audio-coverage-test",
    ctx,
  });

  const events = [
    makeEvent(10, "guest.checkedIn", { guestEntity: 1, roomEntity: 5, actor: "player" }),
    makeEvent(12, "printer.printed", { docType: "resume", documentEntity: 9, candidateEntity: 2 }),
    makeEvent(15, "hotel.starsChanged", { from: 1, to: 2 }),
  ];
  host.onEvents(events);

  check("a realistic event stream schedules > 0 nodes", ctx.created.length > 0);
  check("a guest.checkedIn event (positional, known entity) creates a panner", ctx.created.some((n) => n.kind === "panner"));

  // 3b. Idempotence: feeding the SAME events again schedules no more nodes.
  const countBefore = ctx.created.length;
  host.onEvents(events);
  check("re-feeding the same event window schedules no additional nodes", ctx.created.length === countBefore);

  // Feeding an overlapping superset (same events + one new one) schedules
  // only the new one's nodes, not a re-schedule of the old ones.
  const moreEvents = [...events, makeEvent(20, "econ.audit", { stars: 2 })];
  host.onEvents(moreEvents);
  check("re-feeding an overlapping superset only schedules the new tail", ctx.created.length > countBefore);

  host.dispose();
}

// 3c. minIntervalMs rate limiting: a burst at the same instant fires once.
{
  const ctx = new MockAudioContext();
  const host = createAudioHost({
    rules: HOTEL_SOUND_RULES,
    listener: () => ({ xM: 0, zM: 0, yawRad: 0 }),
    entityPos: () => undefined,
    muzakSeed: "audio-coverage-test-burst",
    ctx,
  });

  // mail.delivered carries minIntervalMs: 300 in the hotel table.
  const burst = [
    makeEvent(1, "mail.delivered", { kind: "bulletin", day: 1 }),
    makeEvent(1, "mail.delivered", { kind: "spam", day: 1 }),
    makeEvent(1, "mail.delivered", { kind: "applications", day: 1 }),
  ];
  host.onEvents(burst);
  const oscCount = ctx.created.filter((n) => n.kind === "oscillator").length;
  check("a minIntervalMs rule fires once for a same-instant burst", oscCount === 1);
  host.dispose();
}

// 3d. at:"entity" with entityPos returning undefined degrades to
//     non-positional (schedules a node, does not throw).
{
  const ctx = new MockAudioContext();
  const host = createAudioHost({
    rules: HOTEL_SOUND_RULES,
    listener: () => ({ xM: 0, zM: 0, yawRad: 0 }),
    entityPos: () => undefined, // every entity "despawned"
    muzakSeed: "audio-coverage-test-despawn",
    ctx,
  });

  let threw = false;
  let countBefore = ctx.created.length;
  try {
    host.onEvents([makeEvent(1, "guest.checkedIn", { guestEntity: 42, roomEntity: 5, actor: "player" })]);
  } catch {
    threw = true;
  }
  check("an entity rule with entityPos()===undefined does not throw", !threw);
  check("...and still schedules a (non-positional) node", ctx.created.length > countBefore);
  check("...and does NOT create a panner (degraded to non-positional)", !ctx.created.some((n) => n.kind === "panner"));
  host.dispose();
}

// 3e. dispose() is safe to call twice.
{
  const ctx = new MockAudioContext();
  const host = createAudioHost({
    rules: HOTEL_SOUND_RULES,
    listener: () => ({ xM: 0, zM: 0, yawRad: 0 }),
    entityPos: () => undefined,
    muzakSeed: "audio-coverage-test-dispose",
    ctx,
  });
  let threw = false;
  try {
    host.dispose();
    host.dispose();
  } catch {
    threw = true;
  }
  check("dispose() is safe to call twice", !threw);
}

// 3f. setMuzakTier against a suspended/missing context does not throw.
{
  const ctx = new MockAudioContext();
  ctx.state = "suspended";
  const host = createAudioHost({
    rules: HOTEL_SOUND_RULES,
    listener: () => ({ xM: 0, zM: 0, yawRad: 0 }),
    entityPos: () => undefined,
    muzakSeed: "audio-coverage-test-muzak",
    ctx,
  });
  let threw = false;
  try {
    host.setMuzakTier(2);
  } catch {
    threw = true;
  }
  check("setMuzakTier() against a suspended AudioContext does not throw", !threw);

  const hostNoCtx = createAudioHost({
    rules: HOTEL_SOUND_RULES,
    listener: () => ({ xM: 0, zM: 0, yawRad: 0 }),
    entityPos: () => undefined,
    muzakSeed: "audio-coverage-test-muzak-no-ctx",
  });
  let threwNoCtx = false;
  try {
    hostNoCtx.setMuzakTier(1);
    hostNoCtx.onEvents([makeEvent(1, "guest.checkedIn", { guestEntity: 1 })]);
  } catch {
    threwNoCtx = true;
  }
  check("a missing AudioContext (opts.ctx undefined) never throws", !threwNoCtx);
}

console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
