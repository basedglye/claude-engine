import * as THREE from "three";
import { Sim } from "@claude-engine/core";
import { createThreeHost, installTestHook, type SceneContext } from "@claude-engine/renderer-three";
import { setup, PLAYER_ENTITY, movementKeymap, type PlayerHp, type PlayerPos } from "./game.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/demo: missing #app canvas in index.html");

const sim = new Sim("claude-engine-demo-1");
setup(sim);

const hook = installTestHook({
  world: sim,
  submit: (command) => sim.submit(command),
  app: "@claude-engine/demo",
});

const host = createThreeHost(sim, {
  canvas,
  stepSim: () => sim.step(),
  submit: (command) => hook.submit(command),
  keymap: movementKeymap("player"),
  syncScene(ctx: SceneContext, world, alpha) {
    ctx.camera.position.set(0, 12, 14);
    ctx.camera.lookAt(0, 0, 0);

    ctx.scenery("ground", () => {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshStandardMaterial({ color: 0x2f6f4f })
      );
      ground.rotation.x = -Math.PI / 2;
      return ground;
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
    const z = prevPos.y + (pos.y - prevPos.y) * alpha;
    playerObj.position.set(x, 0.5, z);

    if (hp) {
      const material = playerObj.material as THREE.MeshStandardMaterial;
      material.color.setHex(hp.value < 100 ? 0xff5533 : 0xffcc33);
    }
  },
});

window.addEventListener("beforeunload", () => host.stop());
