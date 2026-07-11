# __NAME__

A ClaudeEngine top-down 2D starter (worldforge `topdown-2d` template). WASD
moves the player one grid tile at a time over a small field of procedurally
generated icon sprites, rendered through an orthographic camera on
`renderer-three` (no separate 2D renderer package).

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
