import * as THREE from "three";
import { Sim } from "@claude-engine/core";
import { createThreeHost, installTestHook, type SceneContext } from "@claude-engine/renderer-three";
import { setup, PLAYER_ENTITY, movementKeymap, type PlayerHp, type PlayerPos } from "./game.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/demo: missing #app canvas in index.html");

const netUrl = new URLSearchParams(window.location.search).get("net");

if (netUrl) {
  void runNetMode(canvas, netUrl);
} else {
  runOfflineMode(canvas);
}

/** The Phase 1 offline demo: a local Sim, WASD input, no networking. */
function runOfflineMode(canvas: HTMLCanvasElement): void {
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
}

/**
 * Net mode (docs/PHASE-3.md Scope G): `?net=ws://host:port` connects to a
 * running `npm run serve -w @claude-engine/demo` instead of running a local
 * Sim. The client never steps a sim (stepSim is a no-op) — it only renders
 * @claude-engine/net's replicated ClientWorld, and submits WASD input as
 * CommandIntents (movementKeymap's Command.tick/actor are discarded here;
 * the server assigns both).
 */
async function runNetMode(canvas: HTMLCanvasElement, url: string): Promise<void> {
  const { createClientSession } = await import("@claude-engine/net");
  const { webSocketTransport } = await import("@claude-engine/net/web");

  const token = `dev:demo-${Math.random().toString(36).slice(2, 8)}`;
  const session = createClientSession({ transport: webSocketTransport(url), token });

  // Agent/debug visibility, the net-mode counterpart of installTestHook's
  // window.__WORLDFORGE__ for offline mode — read-only, no submit surface
  // beyond what session.submitIntent already exposes.
  (window as unknown as { __NET_SESSION__: typeof session }).__NET_SESSION__ = session;

  const host = createThreeHost(session.world, {
    canvas,
    stepSim: () => undefined,
    submit: (command) => session.submitIntent({ type: command.type, payload: command.payload }),
    keymap: movementKeymap("net"), // actor is discarded by submit() above; the server stamps it
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

      for (const entity of world.entities()) {
        const pos = world.getComponent<PlayerPos>(entity, "pos");
        if (!pos) continue;
        const prevPos = session.world.getPrevComponent<PlayerPos>(entity, "pos") ?? pos;
        const owner = world.getComponent<string>(entity, "owner");
        const isSelf = owner === session.actor;

        const obj = ctx.objectFor(
          entity,
          () =>
            new THREE.Mesh(
              new THREE.BoxGeometry(1, 1, 1),
              new THREE.MeshStandardMaterial({ color: isSelf ? 0xffcc33 : 0x3388ff })
            )
        ) as THREE.Mesh;

        const x = prevPos.x + (pos.x - prevPos.x) * alpha;
        const z = prevPos.y + (pos.y - prevPos.y) * alpha;
        obj.position.set(x, 0.5, z);
      }
    },
  });

  window.addEventListener("beforeunload", () => {
    host.stop();
    session.close();
  });
}
