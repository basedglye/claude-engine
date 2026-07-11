// Runs the exact same compiled module the browser app uses
// (src/game.ts -> dist-game/game.js via `npm run build:game`), headless and
// then (via `--browser`) against the live renderer.
import { setup, moveCommand } from "../dist-game/game.js";

const commands = [
  moveCommand(5, "player", 1, 0),
  moveCommand(10, "player", 0, 1),
  moveCommand(15, "player", 1, 0),
];

export default {
  name: "__NAME__-first-run",
  seed: "__NAME__-1",
  ticks: 30,
  setup,
  commands,
  assertions: [
    {
      description: "player moved off the origin",
      check: (s) => {
        const pos = s.getComponent(1, "pos");
        return pos.x !== 0 || pos.z !== 0;
      },
    },
    {
      description: "movement events were emitted",
      check: (s) => s.eventsSince(0).some((e) => e.type === "moved"),
    },
  ],
  browser: {
    app: "__PACKAGE_NAME__",
    input: [{ key: "KeyD", downMs: 0, upMs: 500 }],
    screenshotAtTicks: [2, 10],
    probes: [{ probe: "fps", sampleMs: 500 }],
    timeoutMs: 20000,
  },
  feelTargets: {
    "fps.avg": { min: 5 },
  },
};
