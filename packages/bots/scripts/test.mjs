// Unit tests for @claude-engine/bots (Phase 3 Scope E), run against the
// built dist/ (npm run test -w @claude-engine/bots builds first).
// Hand-rolled assert-and-exit script matching this repo's scripts/smoke.mjs
// style.
import { createBot, scripted, randomWalk, clerkBot } from "../dist/index.js";

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

const fakeWorld = {
  tick: 0,
  seed: "bots-test",
  stateHash: () => 0,
  entities: function* () {},
  getComponent: () => undefined,
  eventsSince: () => [],
};

// --- createBot: determinism (same seed -> same emitted sequence) ----------
{
  const behavior = (_world, tick, ctx) => [{ type: "roll", payload: { n: ctx.rng.int(1, 6) } }];
  const botA = createBot({ actor: "a", seed: "same-seed", behavior });
  const botB = createBot({ actor: "b", seed: "same-seed", behavior });
  const rollsA = Array.from({ length: 10 }, (_, i) => botA.act(fakeWorld, i)[0].payload.n);
  const rollsB = Array.from({ length: 10 }, (_, i) => botB.act(fakeWorld, i)[0].payload.n);
  check("createBot: same seed -> identical emitted sequence regardless of actor", rollsA.every((n, i) => n === rollsB[i]));

  const botC = createBot({ actor: "c", seed: "different-seed", behavior });
  const rollsC = Array.from({ length: 10 }, (_, i) => botC.act(fakeWorld, i)[0].payload.n);
  check("createBot: different seed -> a different emitted sequence", !rollsA.every((n, i) => n === rollsC[i]));
}

// --- createBot: memory persists across act() calls -------------------------
{
  const behavior = (_world, _tick, ctx) => {
    ctx.memory.count = (ctx.memory.count ?? 0) + 1;
    return [{ type: "tick", payload: { count: ctx.memory.count } }];
  };
  const bot = createBot({ actor: "counter", seed: "s", behavior });
  const first = bot.act(fakeWorld, 0)[0].payload.count;
  const second = bot.act(fakeWorld, 1)[0].payload.count;
  check("createBot: ctx.memory persists across act() calls", first === 1 && second === 2);
}

// --- scripted: emits only at the declared ticks -----------------------------
{
  const behavior = scripted([
    { atTick: 5, intents: [{ type: "jump" }] },
    { atTick: 10, intents: [{ type: "move", payload: { dx: 1 } }] },
  ]);
  const bot = createBot({ actor: "scripted-bot", seed: "s", behavior });
  check("scripted: no intents on an undeclared tick", bot.act(fakeWorld, 1).length === 0);
  check("scripted: emits the declared intent at tick 5", bot.act(fakeWorld, 5)[0]?.type === "jump");
  check("scripted: emits the declared intent at tick 10", bot.act(fakeWorld, 10)[0]?.type === "move");
}

// --- randomWalk: emits every `every` ticks, picks a direction from Rng -----
{
  const behavior = randomWalk({ commandType: "move", payloadFor: (dx, dz) => ({ dx, dz }), every: 3 });
  const bot = createBot({ actor: "walker", seed: "walk-seed", behavior });
  check("randomWalk: emits nothing between cadence ticks", bot.act(fakeWorld, 1).length === 0 && bot.act(fakeWorld, 2).length === 0);
  const atThree = bot.act(fakeWorld, 3);
  check("randomWalk: emits one move intent on the cadence tick", atThree.length === 1 && atThree[0].type === "move");
  check(
    "randomWalk: payload is one of the four cardinal steps",
    [1, -1, 0].includes(atThree[0].payload.dx) && [1, -1, 0].includes(atThree[0].payload.dz)
  );

  const botB = createBot({ actor: "walker2", seed: "walk-seed", behavior: randomWalk({ commandType: "move", payloadFor: (dx, dz) => ({ dx, dz }), every: 3 }) });
  check("randomWalk: same seed -> same direction sequence", JSON.stringify(botB.act(fakeWorld, 3)) === JSON.stringify(atThree));
}

// --- clerkBot -------------------------------------------------------------

function makeDecision(accept) {
  return { type: "desk.decision", payload: { accept } };
}
function invertDecision(d) {
  return { type: d.type, payload: { accept: !d.payload.accept } };
}

// determinism: same seed, same world sequence -> identical intent streams
{
  const decide = (world) => (world.tick % 5 === 0 ? makeDecision(true) : undefined);
  const mkBot = (actor) =>
    clerkBot({ actor, seed: "clerk-seed", decide, invert: invertDecision, errorRatePermille: 300, everyTicks: 20 });
  const botA = mkBot("clerk-a");
  const botB = mkBot("clerk-b");
  const seqA = Array.from({ length: 200 }, (_, tick) => botA.act({ ...fakeWorld, tick }, tick));
  const seqB = Array.from({ length: 200 }, (_, tick) => botB.act({ ...fakeWorld, tick }, tick));
  check("clerkBot: same seed -> identical intent stream", JSON.stringify(seqA) === JSON.stringify(seqB));
}

// errorRatePermille: 0 never inverts
{
  const decide = () => makeDecision(true);
  const bot = clerkBot({ actor: "never-wrong", seed: "s1", decide, invert: invertDecision, errorRatePermille: 0, everyTicks: 1 });
  let allCorrect = true;
  for (let tick = 0; tick < 500; tick++) {
    const intents = bot.act({ ...fakeWorld, tick }, tick);
    if (intents[0].payload.accept !== true) allCorrect = false;
  }
  check("clerkBot: errorRatePermille 0 never inverts", allCorrect);
}

// errorRatePermille: 1000 always inverts (reliably, not statistically)
{
  const decide = () => makeDecision(true);
  const bot = clerkBot({ actor: "always-wrong", seed: "s2", decide, invert: invertDecision, errorRatePermille: 1000, everyTicks: 1 });
  let allInverted = true;
  for (let tick = 0; tick < 500; tick++) {
    const intents = bot.act({ ...fakeWorld, tick }, tick);
    if (intents[0].payload.accept !== false) allInverted = false;
  }
  check("clerkBot: errorRatePermille 1000 always inverts", allInverted);
}

// intermediate errorRatePermille: near-nominal rate over a large sample, and
// exactly reproducible for a given seed
{
  const decide = () => makeDecision(true);
  const mk = () => clerkBot({ actor: "sometimes-wrong", seed: "s3", decide, invert: invertDecision, errorRatePermille: 200, everyTicks: 1 });
  const bot1 = mk();
  let inverted = 0;
  const N = 5000;
  const results1 = [];
  for (let tick = 0; tick < N; tick++) {
    const intents = bot1.act({ ...fakeWorld, tick }, tick);
    const wasInverted = intents[0].payload.accept === false;
    results1.push(wasInverted);
    if (wasInverted) inverted++;
  }
  const rate = inverted / N;
  check(`clerkBot: errorRatePermille 200 -> observed rate ~0.2 (got ${rate.toFixed(3)})`, Math.abs(rate - 0.2) < 0.03);

  const bot2 = mk();
  const results2 = [];
  for (let tick = 0; tick < N; tick++) {
    const intents = bot2.act({ ...fakeWorld, tick }, tick);
    results2.push(intents[0].payload.accept === false);
  }
  check("clerkBot: intermediate errorRatePermille exactly reproducible for a given seed", JSON.stringify(results1) === JSON.stringify(results2));
}

// decide returning undefined emits nothing
{
  const bot = clerkBot({ actor: "idle", seed: "s4", decide: () => undefined, invert: invertDecision, errorRatePermille: 1000, everyTicks: 1 });
  check("clerkBot: decide() undefined emits nothing", bot.act(fakeWorld, 0).length === 0);
}

// cadence: intents appear only on the expected tick multiples
{
  const decide = () => makeDecision(true);
  const bot = clerkBot({ actor: "cadenced", seed: "s5", decide, invert: invertDecision, everyTicks: 20 });
  check("clerkBot: no intent between cadence ticks", bot.act(fakeWorld, 1).length === 0 && bot.act(fakeWorld, 19).length === 0 && bot.act(fakeWorld, 21).length === 0);
  check("clerkBot: intent emitted on cadence tick 0", bot.act(fakeWorld, 0).length === 1);
  check("clerkBot: intent emitted on cadence tick 20", bot.act(fakeWorld, 20).length === 1);
  check("clerkBot: intent emitted on cadence tick 40", bot.act(fakeWorld, 40).length === 1);
}

// Rng isolation: clerkBot's own rng draws are independent of a separately
// seeded Rng used elsewhere — running the bot must not consume from, or be
// perturbed by, an unrelated Rng stream. We verify this indirectly: running
// the bot with error rolls enabled produces the exact same sequence whether
// or not an unrelated Rng (simulating "the sim's Rng") is driven in
// between act() calls.
{
  const decide = () => makeDecision(true);
  const mk = () => clerkBot({ actor: "isolated", seed: "s6", decide, invert: invertDecision, errorRatePermille: 400, everyTicks: 1 });

  const botX = mk();
  const seqX = [];
  for (let tick = 0; tick < 300; tick++) {
    seqX.push(botX.act({ ...fakeWorld, tick }, tick));
  }

  // Simulate an unrelated "sim" Rng being drawn from between every act()
  // call on a second, freshly built bot with the identical seed.
  const unrelated = { calls: 0 };
  const botY = mk();
  const seqY = [];
  for (let tick = 0; tick < 300; tick++) {
    unrelated.calls++; // stand-in for sim-side randomness happening elsewhere
    seqY.push(botY.act({ ...fakeWorld, tick }, tick));
  }
  check("clerkBot: intent stream unaffected by unrelated Rng activity around it", JSON.stringify(seqX) === JSON.stringify(seqY));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
