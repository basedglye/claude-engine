import * as THREE from "three";
import { Rng, Sim } from "@claude-engine/core";
import { createThreeHost, installTestHook, type SceneContext } from "@claude-engine/renderer-three";
import { terrainToGeometry, toBufferGeometry, playScore } from "@claude-engine/assets/web";
import { generateScore } from "@claude-engine/assets";
import {
  setup,
  PLAYER_ENTITY,
  movementKeymap,
  generateWorldTerrain,
  generateWorldProps,
  generatePropMeshFor,
  type PlayerHp,
  type PlayerPos,
} from "./game.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("__NAME__: missing #app canvas in index.html");

const sim = new Sim("__NAME__-1");
setup(sim);

const hook = installTestHook({
  world: sim,
  submit: (command) => sim.submit(command),
  app: "__PACKAGE_NAME__",
});

const terrain = generateWorldTerrain(sim.seed);
const props = generateWorldProps(sim.seed);

const PROP_COLORS: Record<string, number> = { rock: 0x8a8a8a, tree: 0x2e6b3a, crystal: 0x66c2ff };

// Muted by default (browsers block autoplay); press M to toggle music —
// generateScore/playScore behind a real user gesture, per docs/PHASE-2.md.
let musicHandle: { stop(): void } | null = null;
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyM") return;
  if (musicHandle) {
    musicHandle.stop();
    musicHandle = null;
    return;
  }
  const ctx = new AudioContext();
  const score = generateScore(new Rng(sim.seed).fork("music"));
  musicHandle = playScore(score, ctx);
});

const host = createThreeHost(sim, {
  canvas,
  stepSim: () => sim.step(),
  submit: (command) => hook.submit(command),
  keymap: movementKeymap("player"),
  syncScene(ctx: SceneContext, world, alpha) {
    ctx.camera.position.set(0, 14, 16);
    ctx.camera.lookAt(0, 0, 0);

    ctx.scenery("terrain", () => {
      const geometry = terrainToGeometry(terrain);
      const material = new THREE.MeshStandardMaterial({ color: 0x2f6f4f });
      return new THREE.Mesh(geometry, material);
    });

    props.forEach((spec, i) => {
      ctx.scenery(`prop-${i}`, () => {
        const mesh = generatePropMeshFor(spec);
        const geometry = toBufferGeometry(mesh);
        const material = new THREE.MeshStandardMaterial({ color: PROP_COLORS[spec.kind] ?? 0xffffff });
        const obj = new THREE.Mesh(geometry, material);
        obj.position.set(spec.x, 0, spec.z);
        return obj;
      });
    });

    const pos = world.getComponent<PlayerPos>(PLAYER_ENTITY, "pos");
    const prevPos = world.getComponent<PlayerPos>(PLAYER_ENTITY, "prevPos");
    const hp = world.getComponent<PlayerHp>(PLAYER_ENTITY, "hp");
    if (!pos || !prevPos) return;

    const playerObj = ctx.objectFor(
      PLAYER_ENTITY,
      () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffcc33 }))
    ) as THREE.Mesh;

    const x = prevPos.x + (pos.x - prevPos.x) * alpha;
    const z = prevPos.z + (pos.z - prevPos.z) * alpha;
    playerObj.position.set(x, 0.5, z);

    if (hp) {
      const material = playerObj.material as THREE.MeshStandardMaterial;
      material.color.setHex(hp.value < 100 ? 0xff5533 : 0xffcc33);
    }
  },
});

window.addEventListener("beforeunload", () => host.stop());
