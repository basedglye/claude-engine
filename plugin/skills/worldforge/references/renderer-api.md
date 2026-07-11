# `@claude-engine/renderer-three` API reference

The web-first render host. Owns the WebGL renderer, scene, camera, resize
handling, and the fixed-tick/render loop. Contains **no game-specific
knowledge** — entity→visual mapping is entirely the game's `syncScene`
callback. Never mutates sim state except through the `submit` it's given
(invariant #4).

```ts
function startHostLoop(world: IWorld, opts: RenderHostOptions): () => void;
interface RenderHostOptions {
  onTick: () => void;                                  // once per sim tick
  onRender: (world: IWorld, alpha: number) => void;     // once per animation frame
}

function createThreeHost(world: IWorld, options: ThreeHostOptions): ThreeHost;
interface ThreeHostOptions {
  canvas: HTMLCanvasElement;
  stepSim: () => void;                                  // advance the sim exactly one tick
  submit: (command: Command) => void;                   // the ONLY sim-affecting surface
  syncScene: (ctx: SceneContext, world: IWorld, alpha: number) => void;
  keymap?: Record<string, (world: IWorld) => Command | null>;
  camera?: THREE.Camera;                                // defaults to a PerspectiveCamera
}
interface ThreeHost { stop(): void; }

interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D;
  scenery(key: string, create: () => THREE.Object3D): THREE.Object3D;
}

function createOrthographicCamera(viewHeight: number, near?: number, far?: number): THREE.OrthographicCamera;
```

- `objectFor(entity, create)`: get-or-create the scene object for an entity;
  the host disposes/removes it once the entity no longer exists in the
  world (checked once per frame). Use for anything tied to sim state.
- `scenery(key, create)`: get-or-create **host-owned, non-entity** scenery
  (ground planes, grids, static decoration) keyed by a string you choose.
  Disposed on `stop()`. Use this instead of `scene.add()` directly for
  anything that should be cleaned up when the host stops.
- `camera`: omit for the default perspective camera (most 3D scenes); pass
  `createOrthographicCamera(viewHeight)` for a top-down 2D look (see the
  `topdown-2d` template). `resize()` keeps whichever projection you chose in
  sync with the canvas aspect ratio either way.
- `keymap`: `KeyboardEvent.code` → command factory, invoked once per sim
  tick while the key is held; returning `null` submits nothing.

## Test hook (`installTestHook`)

The page-side contract browser-mode harness runs rely on — install it once
in `main.ts`, right after constructing the `Sim`:

```ts
function installTestHook(opts: { world: IWorld; submit: (command: Command) => void; app: string; tickRateHz?: number }): WorldforgeHook;
interface WorldforgeHook {
  world: IWorld;
  submit(command: Command): void;          // the ONLY sim-affecting capability — same shape as invariant #4
  commandLog(): readonly Command[];        // every command submitted through the hook, in order
  info: { app: string; tickRateHz: number };
}
```

Sets `window.__WORLDFORGE__`. Wrap your own `submit` with the hook's before
passing it to `createThreeHost`'s `options.submit`, so every command —
whether from the keymap or from a harness-driven `--browser` input script —
gets recorded:

```ts
const hook = installTestHook({ world: sim, submit: (c) => sim.submit(c), app: "@claude-engine/my-game" });
const host = createThreeHost(sim, {
  // ...
  submit: (command) => hook.submit(command),
});
```

This is not a new mutation channel — it's `IWorld` reads plus the same
`submit(Command)` write surface every host already has, per invariant #4.
Both starter templates wire it this way; copy the pattern for any new game.
