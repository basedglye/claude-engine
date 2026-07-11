// Unit tests for @claude-engine/bots (Phase 3 Scope E), run against the
// built dist/ (npm run test -w @claude-engine/bots builds first).
// Hand-rolled assert-and-exit script matching this repo's scripts/smoke.mjs
// style.
import { createBot, scripted, randomWalk } from "../dist/index.js";

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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
