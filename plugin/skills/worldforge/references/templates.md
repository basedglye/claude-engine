# Starter templates

`npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>`
copies `templates/<template>/` to `apps/<app-name>/`, renaming the package
to `@claude-engine/<app-name>` and replacing `__NAME__`/`__PACKAGE_NAME__`
placeholders throughout. Both templates build, pass their headless scenario,
and pass a `--browser` run **unedited** — that's the mechanical bar a new
template addition has to clear too.

Both share the same shape: `src/game.ts` (sim, headless-only), `src/main.ts`
(host wiring), `scenarios/first-run.scenario.mjs` (headless + `--browser`
verification), `package.json` / `tsconfig.json` / `tsconfig.game.json` /
`vite.config.ts` / `index.html` matching `apps/demo`'s established shape.

## `3d-world`

Perspective camera (the `createThreeHost` default). WASD moves a player
entity continuously over generated terrain, ground-following via
`heightAt()`. A handful of `generatePropMesh` props (`rock`/`tree`/
`crystal`) are scattered from a forked `Rng`. Press `M` to toggle a short
generated music loop (`generateScore`/`playScore`), muted by default —
browsers block autoplay, so this is wired behind the real keypress, not a
page-load side effect.

Key pattern: `generateWorldTerrain(seed)` and `generateWorldProps(seed)` in
`game.ts` are pure functions of the world seed alone (`new Rng(seed).fork(
"terrain"/"props")`) — they never touch the live `sim.rng`. `game.ts` calls
them for ground-following (a real gameplay concern); `main.ts` calls the
*same* functions independently to build the visible terrain mesh and prop
meshes. Same seed, same result, computed twice, zero shared mutable state
between sim and renderer. Nothing terrain/prop-related is stored as a sim
component.

## `topdown-2d`

Orthographic camera (`createOrthographicCamera`, sized to the grid). WASD
moves the player one grid tile per held tick — deliberately coarser than
the 3D template, matching a grid game's feel. A handful of tiles are
decorated with `generateIconSvg` sprites rasterized via `svgToTexture`.
Same seed-only regeneration pattern as `3d-world`: `generateWorldItems(seed)`
lives in `game.ts`, called independently by `main.ts` for rendering.

No new renderer package — `createOrthographicCamera` is an addition to
`@claude-engine/renderer-three` itself (`ThreeHostOptions.camera`,
`SceneContext.camera` widened to `THREE.Camera`), not a parallel 2D host.
Existing perspective-camera callers are unaffected; `resize()` handles both
camera kinds.

## Extending a template (or writing a new one)

- Keep `game.ts` importing only `@claude-engine/core` and, if needed, the
  pure root of `@claude-engine/assets` — it must build under
  `tsconfig.game.json`'s DOM-free `lib`, and it's what the harness runs
  directly.
- Wire `installTestHook` in `main.ts` immediately after constructing the
  `Sim`, before `createThreeHost` — every template does this from commit
  one so `--browser` verification works without further setup.
- Give every template a `scenarios/first-run.scenario.mjs` with a
  `browser` spec and at least one `feelTargets` bound — the plugin's
  `npm run check:plugin` gate checks that a scenario file exists, and the
  review/exit-criteria bar for any template is "scaffold, build, headless
  scenario, and `--browser` all pass with no edits."
