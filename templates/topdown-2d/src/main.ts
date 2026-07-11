import * as THREE from "three";
import { Rng, Sim } from "@claude-engine/core";
import { createThreeHost, createOrthographicCamera, installTestHook, type SceneContext } from "@claude-engine/renderer-three";
import { generateIconSvg } from "@claude-engine/assets";
import { svgToTexture } from "@claude-engine/assets/web";
import {
  setup,
  PLAYER_ENTITY,
  TILE_SIZE,
  GRID_HALF,
  movementKeymap,
  generateWorldItems,
  type GridPos,
  type PlayerHp,
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

const items = generateWorldItems(sim.seed);
const camera = createOrthographicCamera((GRID_HALF * 2 + 2) * TILE_SIZE);

const host = createThreeHost(sim, {
  canvas,
  camera,
  stepSim: () => sim.step(),
  submit: (command) => hook.submit(command),
  keymap: movementKeymap("player"),
  syncScene(ctx: SceneContext, world, alpha) {
    ctx.camera.position.set(0, 0, 10);
    ctx.camera.lookAt(0, 0, 0);

    ctx.scenery("grid", () => {
      const size = (GRID_HALF * 2 + 1) * TILE_SIZE;
      const grid = new THREE.GridHelper(size, GRID_HALF * 2 + 1, 0x555555, 0x333333);
      grid.rotation.x = Math.PI / 2;
      return grid;
    });

    items.forEach((spec, i) => {
      ctx.scenery(`item-${i}`, () => {
        const svg = generateIconSvg(new Rng(spec.iconSeed));
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(TILE_SIZE * 0.7, TILE_SIZE * 0.7),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })
        );
        plane.position.set(spec.x * TILE_SIZE, spec.y * TILE_SIZE, -0.1);
        svgToTexture(svg).then((texture) => {
          (plane.material as THREE.MeshBasicMaterial).map = texture;
          (plane.material as THREE.MeshBasicMaterial).needsUpdate = true;
        });
        return plane;
      });
    });

    const pos = world.getComponent<GridPos>(PLAYER_ENTITY, "pos");
    const prevPos = world.getComponent<GridPos>(PLAYER_ENTITY, "prevPos");
    const hp = world.getComponent<PlayerHp>(PLAYER_ENTITY, "hp");
    if (!pos || !prevPos) return;

    const playerObj = ctx.objectFor(
      PLAYER_ENTITY,
      () => new THREE.Mesh(new THREE.PlaneGeometry(TILE_SIZE * 0.8, TILE_SIZE * 0.8), new THREE.MeshBasicMaterial({ color: 0xffcc33 }))
    ) as THREE.Mesh;

    const x = prevPos.x + (pos.x - prevPos.x) * alpha;
    const y = prevPos.y + (pos.y - prevPos.y) * alpha;
    playerObj.position.set(x * TILE_SIZE, y * TILE_SIZE, 0);

    if (hp) {
      const material = playerObj.material as THREE.MeshBasicMaterial;
      material.color.setHex(hp.value < 100 ? 0xff5533 : 0xffcc33);
    }
  },
});

window.addEventListener("beforeunload", () => host.stop());
