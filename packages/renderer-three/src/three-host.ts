import * as THREE from "three";
import type { Command, EntityId, IWorld } from "@claude-engine/core";
import { startHostLoop } from "./host-loop.js";

/**
 * Everything a game's `syncScene` callback needs to draw the current world.
 * The host owns the renderer/scene/camera lifecycle; games only ever read
 * `IWorld` and place/update their own `Object3D`s via `objectFor`.
 */
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Get-or-create the scene object for an entity. The host disposes/removes
   *  objects whose entity no longer exists in the world. */
  objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D;
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
}

export interface ThreeHost {
  stop(): void;
}

/**
 * A Three.js render host: owns the WebGL renderer, scene, camera, lighting,
 * resize handling, and the fixed-tick/render loop. It never mutates sim
 * state directly (invariant #4, hosts render / sims decide) — the only
 * sim-affecting surface is `options.submit`. It carries no game-specific
 * knowledge: entity->visual mapping is entirely the game's `syncScene`.
 */
export function createThreeHost(world: IWorld, options: ThreeHostOptions): ThreeHost {
  const { canvas, stepSim, submit, syncScene, keymap } = options;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 10, 5);
  scene.add(ambient, sun);

  const objects = new Map<EntityId, THREE.Object3D>();

  function objectFor(entity: EntityId, create: () => THREE.Object3D): THREE.Object3D {
    let obj = objects.get(entity);
    if (!obj) {
      obj = create();
      objects.set(entity, obj);
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

  const ctx: SceneContext = { scene, camera, objectFor };

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
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

  function pumpInput(): void {
    if (!keymap) return;
    for (const code of heldKeys) {
      const factory = keymap[code];
      if (!factory) continue;
      const command = factory(world);
      if (command) submit(command);
    }
  }

  const stopLoop = startHostLoop(world, {
    onTick: () => {
      pumpInput();
      stepSim();
    },
    onRender: (w, alpha) => {
      pruneStaleObjects();
      syncScene(ctx, w, alpha);
      renderer.render(scene, camera);
    },
  });

  return {
    stop(): void {
      stopLoop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      for (const obj of objects.values()) disposeObject(obj);
      objects.clear();
      renderer.dispose();
    },
  };
}
