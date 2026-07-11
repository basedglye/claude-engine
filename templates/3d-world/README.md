# __NAME__

A ClaudeEngine 3D world starter (worldforge `3d-world` template). WASD moves
the player over procedurally generated terrain, dotted with a few
procedurally generated props. Press `M` to toggle a short generated music
loop (muted by default — browsers block autoplay until a user gesture).

The sim logic in `src/game.ts` is also run headless by the harness
(`npm run harness -- apps/__NAME__/scenarios/first-run.scenario.mjs`) to
prove the browser and headless runs share the identical sim module.

## Running

```bash
npm run dev -w __PACKAGE_NAME__
```

## Build + verify

```bash
npm run build -w __PACKAGE_NAME__
npm run harness --silent -- apps/__NAME__/scenarios/first-run.scenario.mjs
npm run harness --silent -- apps/__NAME__/scenarios/first-run.scenario.mjs --browser
```
