// Failing example scenario: deliberately includes an assertion that will fail.
// This demonstrates mixed pass/fail assertion results.

function setup(sim) {
  const player = sim.spawn();
  sim.setComponent(player, "pos", { x: 0, y: 0 });

  // Simple movement system: advances player by 1 in x each tick
  sim.addSystem((s) => {
    const pos = s.getComponent(player, "pos");
    pos.x += 1;
    s.emit("tick_moved", { x: pos.x });
  });
}

const commands = [];

export default {
  name: "failing-example",
  seed: "claude-engine-failing-example-1",
  ticks: 20,
  setup,
  commands,
  assertions: [
    {
      description: "player moved from origin",
      check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos.x > 0;
      },
    },
    {
      description: "player reached x:999",
      check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos.x === 999;
      },
    },
  ],
};
