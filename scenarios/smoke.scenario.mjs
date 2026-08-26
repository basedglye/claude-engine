// Smoke test scenario: a toy game on the sim kernel.
// This is a port of the scenario inlined in scripts/smoke.mjs.

function setup(sim) {
  const player = sim.spawn();
  sim.setComponent(player, "pos", { x: 0, y: 0 });
  sim.setComponent(player, "hp", { value: 100 });
  const loot = sim.forkRng("loot");

  // movement system: consume "move" commands
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type !== "move") continue;
      const pos = s.getComponent(player, "pos");
      // Write-through, never in-place (Sim.stateHash()'s Phase-H2 contract).
      const next = { x: pos.x + c.payload.dx, y: pos.y + c.payload.dy };
      s.setComponent(player, "pos", next);
      s.emit("moved", { ...next });
    }
  });

  // hazard system: deterministic random damage every 10 ticks
  sim.addSystem((s) => {
    if (s.tick % 10 !== 0) return;
    const hp = s.getComponent(player, "hp");
    const value = hp.value - loot.int(1, 3);
    s.setComponent(player, "hp", { value });
    s.emit("damaged", { hp: value });
  });
}

const commands = [
  { tick: 5, actor: "p1", type: "move", payload: { dx: 3, dy: 4 } },
  { tick: 20, actor: "p1", type: "move", payload: { dx: 1, dy: 0 } },
];

export default {
  name: "smoke",
  seed: "claude-engine-smoke-1",
  ticks: 100,
  setup,
  commands,
  checkpoints: [10, 50, 100],
  assertions: [
    {
      description: "player moved to (4,4)",
      check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos.x === 4 && pos.y === 4;
      },
    },
    {
      description: "player took hazard damage",
      check: (s) => s.getComponent(1, "hp").value < 100,
    },
    {
      description: "events were emitted",
      check: (s) => s.eventsSince(0).length > 0,
    },
  ],
};
