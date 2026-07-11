// Smoke test: a toy game on the sim kernel, verified through the harness,
// plus a replay-equivalence check. Run with: node scripts/smoke.mjs
import { Sim, replay } from "../packages/core/dist/index.js";
import { runScenario } from "../packages/harness/dist/index.js";

function setup(sim) {
  const player = sim.spawn();
  sim.setComponent(player, "pos", { x: 0, y: 0 });
  sim.setComponent(player, "hp", { value: 100 });
  const loot = sim.rng.fork("loot");

  // movement system: consume "move" commands
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const pos = s.getComponent(player, "pos");
      pos.x += c.payload.dx;
      pos.y += c.payload.dy;
      s.emit("moved", { ...pos });
    }
  });

  // hazard system: deterministic random damage every 10 ticks
  sim.addSystem((s) => {
    if (s.tick % 10 !== 0) return;
    const hp = s.getComponent(player, "hp");
    hp.value -= loot.int(1, 3);
    s.emit("damaged", { hp: hp.value });
  });
}

const commands = [
  { tick: 5, actor: "p1", type: "move", payload: { dx: 3, dy: 4 } },
  { tick: 20, actor: "p1", type: "move", payload: { dx: 1, dy: 0 } },
];

const verdict = runScenario({
  name: "smoke",
  seed: "claude-engine-smoke-1",
  ticks: 100,
  setup,
  commands,
  assertions: [
    { description: "player moved to (4,4)", check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos.x === 4 && pos.y === 4;
      } },
    { description: "player took hazard damage", check: (s) => s.getComponent(1, "hp").value < 100 },
    { description: "events were emitted", check: (s) => s.eventsSince(0).length > 0 },
  ],
});

console.log(JSON.stringify(verdict, null, 2));

// Replay equivalence: same seed + commands must reproduce the same hashes.
const a = replay("claude-engine-smoke-1", setup, commands, 100);
const b = replay("claude-engine-smoke-1", setup, commands, 100);
const identical = a.every((h, i) => h === b[i]);
const matchesVerdict = a[a.length - 1] === verdict.finalStateHash;

console.log(`replay equivalence: ${identical ? "PASS" : "FAIL"}`);
console.log(`replay matches harness final hash: ${matchesVerdict ? "PASS" : "FAIL"}`);
if (!verdict.passed || !identical || !matchesVerdict) process.exit(1);
