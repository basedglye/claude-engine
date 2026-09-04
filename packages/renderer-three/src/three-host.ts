import * as THREE from "three";
import type { Command, EntityId, IWorld } from "@claude-engine/core";
import { startHostLoop } from "./host-loop.js";
import type { FrameStats } from "./test-hook.js";

/**
 * Everything a game's `syncScene` callback needs to draw the current world.
 * The host owns the renderer/scene/camera lifecycle; games only ever read
 * `IWorld` and place/update their own `Object3D`s via `objectFor`.
 */
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The WebGL renderer, exposed so a game can configure tone mapping,
   *  shadow maps, output color space, etc. Host owns its lifecycle
   *  (creation/dispose); games only ever configure it. */
  renderer: THREE.WebGLRenderer;
  /** Get-or-create the scene object for an entity. The host disposes/removes
   *  objects whose entity no longer exists in the world. */
  objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D;
  /** Get-or-create host-owned non-entity scenery (ground, sky, etc), keyed by
   *  a game-chosen string. Disposed on stop(), unlike objects added directly
   *  to `scene`. */
  scenery(key: string, create: () => THREE.Object3D): THREE.Object3D;
}

/**
 * Pointer input, alongside the existing keyboard `keymap`. The host owns
 * listener lifecycle (added on start, removed on stop) and requests pointer
 * lock on canvas click when handlers are present.
 */
export interface PointerHandlers {
  /** Normalized relative look deltas (movementX/Y px). Called from the real
   *  mousemove listener only while pointer-locked. */
  onLook?(dxPx: number, dyPx: number): void;
  /** Button 0 down while pointer-locked. */
  onClick?(): void;
  onPointerLockChange?(locked: boolean): void;
}

export interface ThreeHostOptions {
  canvas: HTMLCanvasElement;
  /** Advance the sim exactly one tick. Host owns timing; sim owns logic. */
  stepSim: () => void;
  /** Command ingress — the ONLY way the host affects the sim. */
  submit: (command: Command) => void;
  /** Game-supplied view sync, called once per animation frame with the
   *  interpolation alpha in [0,1). All game-specific visuals live here. */
  syncScene: (ctx: SceneContext, world: IWorld, alpha: number) => void;
  /** KeyboardEvent.code -> command factory. Fired once per sim tick while the
   *  key is held; returning null submits nothing. */
  keymap?: Record<string, (world: IWorld) => Command | null>;
  /** Optional pre-constructed camera (e.g. via createOrthographicCamera for
   *  a top-down game). Defaults to a standard PerspectiveCamera — existing
   *  callers are unaffected. */
  camera?: THREE.Camera;
  /** Pointer input, alongside the existing keyboard `keymap`. The host owns
   *  listener lifecycle (added on start, removed on stop) and requests
   *  pointer lock on canvas click when handlers are present. */
  pointerHandlers?: PointerHandlers;
  /** Called once per animation frame after syncScene, before render — the
   *  hook player-fps uses to drive the camera at refresh rate. */
  onFrame?(camera: THREE.Camera, world: IWorld, alpha: number): void;
  /** Scene light levels (H2b). Additive and optional: a game that bakes its
   *  lighting into vertex colours wants a bright, near-flat rig, and one
   *  that does not wants the historical default. Defaults are the
   *  pre-H2b values, so no existing caller changes. */
  ambientIntensity?: number;
  keyLightIntensity?: number;
  /** When false, the host adds NO default lights (no ambient, no sun) —
   *  for a game that builds its own lighting rig. Defaults to true, so
   *  every existing caller (living-world, scenarios, the harness) is
   *  unaffected. */
  defaultLights?: boolean;
  /** Passed through to the WebGLRenderer constructor alongside `canvas`.
   *  Optional; omitting it preserves today's `{ antialias: true }`. */
  rendererOptions?: { antialias?: boolean; powerPreference?: WebGLPowerPreference };
  /** Called once, right after the renderer is created and before the
   *  render loop starts, so a game can configure tone mapping / shadow
   *  maps / etc. before anything ever renders. */
  onRendererCreated?(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void;
}

export interface ThreeHost {
  stop(): void;
  /** Render statistics for the H2b `draw-calls` / `frame-time-p95` probes
   *  (see `FrameStats` in test-hook.ts). Lives here rather than in the app
   *  because the WebGLRenderer — the only thing that knows the real draw
   *  count — is owned by this host and deliberately never handed out. The
   *  app wires this into `installTestHook({ frameStats })`. */
  frameStats(): FrameStats;
}

/** A top-down-friendly orthographic camera: `viewHeight` world units are
 *  visible top-to-bottom; width follows on first resize(). */
export function createOrthographicCamera(viewHeight: number, near = 0.1, far = 1000): THREE.OrthographicCamera {
  const halfHeight = viewHeight / 2;
  return new THREE.OrthographicCamera(-halfHeight, halfHeight, halfHeight, -halfHeight, near, far);
}

/**
 * A Three.js render host: owns the WebGL renderer, scene, camera, lighting,
 * resize handling, and the fixed-tick/render loop. It never mutates sim
 * state directly (invariant #4, hosts render / sims decide) — the only
 * sim-affecting surface is `options.submit`. It carries no game-specific
 * knowledge: entity->visual mapping is entirely the game's `syncScene`.
 */
export function createThreeHost(world: IWorld, options: ThreeHostOptions): ThreeHost {
  const {
    canvas,
    stepSim,
    submit,
    syncScene,
    keymap,
    pointerHandlers,
    onFrame,
    defaultLights = true,
    rendererOptions,
    onRendererCreated,
  } = options;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, ...rendererOptions });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = options.camera ?? new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

  if (defaultLights) {
    const ambient = new THREE.AmbientLight(0xffffff, options.ambientIntensity ?? 0.6);
    const sun = new THREE.DirectionalLight(0xffffff, options.keyLightIntensity ?? 0.8);
    sun.position.set(5, 10, 5);
    scene.add(ambient, sun);
  }

  onRendererCreated?.(renderer, scene);

  const objects = new Map<EntityId, THREE.Object3D>();
  const scenery = new Map<string, THREE.Object3D>();

  function objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D {
    let obj = objects.get(entity);
    if (!obj) {
      obj = create();
      objects.set(entity, obj);
      scene.add(obj);
    }
    return obj;
  }

  function sceneryFor(key: string, create: () => THREE.Object3D): THREE.Object3D {
    let obj = scenery.get(key);
    if (!obj) {
      obj = create();
      scenery.set(key, obj);
      scene.add(obj);
    }
    return obj;
  }

  function disposeObject(obj: THREE.Object3D): void {
    scene.remove(obj);
    obj.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });
  }

  function pruneStaleObjects(): void {
    const live = new Set(world.entities());
    for (const [entity, obj] of objects) {
      if (!live.has(entity)) {
        disposeObject(obj);
        objects.delete(entity);
      }
    }
  }

  const ctx: SceneContext = { scene, camera, renderer, objectFor, scenery: sceneryFor };

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    } else if (camera instanceof THREE.OrthographicCamera) {
      // Preserve the vertical view size the caller configured; only
      // left/right follow the canvas aspect ratio.
      const viewHeight = camera.top - camera.bottom;
      const halfWidth = (viewHeight * aspect) / 2;
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.updateProjectionMatrix();
    }
  }
  resize();
  window.addEventListener("resize", resize);

  const heldKeys = new Set<string>();
  function onKeyDown(e: KeyboardEvent): void {
    heldKeys.add(e.code);
  }
  function onKeyUp(e: KeyboardEvent): void {
    heldKeys.delete(e.code);
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function isPointerLocked(): boolean {
    return document.pointerLockElement === canvas;
  }
  function onCanvasClick(): void {
    // A sandboxed host (an iframe without allow-pointer-lock) throws or
    // rejects here. Swallow it: the game's own fallback (if any) listens
    // for pointerlockerror / the absence of pointerlockchange, and an
    // uncaught error would otherwise spam the console on every click.
    try {
      const r = (canvas.requestPointerLock as () => void | Promise<void>)();
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch {
      /* refused; fallback handles it */
    }
  }
  function onMouseMove(e: MouseEvent): void {
    if (!isPointerLocked()) return;
    pointerHandlers?.onLook?.(e.movementX, e.movementY);
  }
  function onMouseDown(e: MouseEvent): void {
    if (!isPointerLocked() || e.button !== 0) return;
    pointerHandlers?.onClick?.();
  }
  function onPointerLockChange(): void {
    pointerHandlers?.onPointerLockChange?.(isPointerLocked());
  }
  if (pointerHandlers) {
    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("pointerlockchange", onPointerLockChange);
  }

  function pumpInput(): void {
    if (!keymap) return;
    for (const code of heldKeys) {
      const factory = keymap[code];
      if (!factory) continue;
      const command = factory(world);
      if (command) submit(command);
    }
  }

  // -- frame statistics (H2b probes) ------------------------------------
  // A bounded ring: a long browser gate must not grow an unbounded array,
  // and a p95 over the whole run is what the budget is written against, so
  // the window is large enough (600 frames ~ 10s at 60Hz) to be a real
  // distribution rather than a spot reading.
  const MAX_FRAME_SAMPLES = 600;
  const frameMsSamples: number[] = [];
  let lastFrameMs: number | undefined;
  let lastDrawCalls = 0;

  const stopLoop = startHostLoop(world, {
    onTick: () => {
      pumpInput();
      stepSim();
    },
    onRender: (w, alpha) => {
      pruneStaleObjects();
      syncScene(ctx, w, alpha);
      onFrame?.(camera, w, alpha);
      renderer.render(scene, camera);
      // Read AFTER render(): renderer.info.render.calls is reset at the
      // start of each render and filled during it, so sampling before would
      // report the previous frame's count off by one frame — a small lie,
      // but exactly the kind a probe should not tell.
      lastDrawCalls = renderer.info.render.calls;
      const nowMs = performance.now();
      if (lastFrameMs !== undefined) {
        frameMsSamples.push(nowMs - lastFrameMs);
        if (frameMsSamples.length > MAX_FRAME_SAMPLES) frameMsSamples.shift();
      }
      lastFrameMs = nowMs;
    },
  });

  return {
    frameStats(): FrameStats {
      return { drawCalls: lastDrawCalls, frameMsSamples: frameMsSamples.slice() };
    },
    stop(): void {
      stopLoop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (pointerHandlers) {
        canvas.removeEventListener("click", onCanvasClick);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("pointerlockchange", onPointerLockChange);
      }
      for (const obj of objects.values()) disposeObject(obj);
      objects.clear();
      for (const obj of scenery.values()) disposeObject(obj);
      scenery.clear();
      renderer.dispose();
    },
  };
}
