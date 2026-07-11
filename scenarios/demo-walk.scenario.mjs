// Runs the *exact same compiled module* the browser demo uses
// (apps/demo/src/game.ts -> apps/demo/dist-game/game.js via `npm run
// build:game -w @claude-engine/demo`), proving the demo is agent-verifiable
// headless without a browser.
import { setup, moveCommand } from "../apps/demo/dist-game/game.js";

const commands = [
  moveCommand(5, "player", 1, 0),
  moveCommand(10, "player", 0, 1),
  moveCommand(15, "player", 1, 0),
  moveCommand(20, "player", 0, 1),
];

export default {
  name: "demo-walk",
  seed: "claude-engine-demo-walk-1",
  ticks: 30,
  setup,
  commands,
  assertions: [
    {
      description: "player walked to (2,2)",
      check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos.x === 2 && pos.y === 2;
      },
    },
    {
      description: "movement events were emitted",
      check: (s) => s.eventsSince(0).some((e) => e.type === "moved"),
    },
  ],
};
