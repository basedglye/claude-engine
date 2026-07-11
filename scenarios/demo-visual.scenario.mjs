// Browser-mode scenario for apps/demo (docs/PHASE-2.md Scope E). Drives real
// WASD keyboard input against the live renderer-three host via Playwright,
// closing the Phase 1 review's outstanding live-WASD evidence gap
// mechanically: a screenshot shows the player displaced from origin, and
// the run replays headlessly via `--replay` (browser mode captures its own
// command log through the test hook as this verdict's replay bundle).
import { setup } from "../apps/demo/dist-game/game.js";

export default {
  name: "demo-visual",
  seed: "claude-engine-demo-visual-1",
  ticks: 30,
  setup,
  assertions: [],
  browser: {
    app: "@claude-engine/demo",
    input: [{ key: "KeyD", downMs: 0, upMs: 750 }],
    screenshotAtTicks: [2, 15],
    probes: [{ probe: "fps", sampleMs: 500 }, { probe: "input-latency", key: "KeyD", component: "pos", samples: 3 }],
    timeoutMs: 20000,
  },
  feelTargets: {
    "fps.avg": { min: 5 },
    "inputLatency.avgMs": { max: 3000 },
  },
};
