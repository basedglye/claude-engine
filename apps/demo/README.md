# ClaudeEngine Demo

Phase 1 disposable browser-playable toy demo proving the renderer-three host works. The sim logic in `src/game.ts` is also run headless by the harness (`npm run harness -- demo-walk`) to prove that browser and headless runs use the identical sim module.

## Running

```bash
npm run dev -w @claude-engine/demo
```

Open http://localhost:5173 in your browser to play the demo.

## Build

```bash
npm run build -w @claude-engine/demo
```

This compiles the sim module separately (`npm run build:game`) to `dist-game/` so the harness can import the exact same compiled output the browser uses.
