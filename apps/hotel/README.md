# hotel

Phase H0 "Walk the Lobby" — a small procedurally generated hotel ground
floor. WASD + mouse-look to walk around and collide with walls; click while
looking at a door within range to open/close it. See `docs/DESIGN.md` and
`docs/ARCHITECTURE.md` for game context and `docs/PHASE-H0.md` (repo root)
for the implementation spec.

The sim logic in `src/sim/game.ts` is core+space+interiors only (headless-safe)
and is run both by the browser (via `src/main.ts`) and by the headless
harness against the same compiled `dist-game/game.js` artifact:

- `scenarios/walk-collide.scenario.mjs` (headless)
- `scenarios/fps-look-interact.scenario.mjs` (browser)

## Running

```bash
npm run dev -w @claude-engine/hotel
```

## Build + verify

```bash
npm run build -w @claude-engine/hotel
npm run harness --silent -- walk-collide --verify-replay
```
