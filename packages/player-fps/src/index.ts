import * as THREE from "three";
import type { Command, EntityId, IWorld } from "@claude-engine/core";
import type { PointerHandlers, SyntheticPointer } from "@claude-engine/renderer-three";
import { angleDeltaMdeg, FULL_TURN_MDEG } from "@claude-engine/space";

export interface FpsControllerOptions {
  actor: string;
  playerEntity: EntityId;
  /** Read the player's authoritative sim pose. */
  readPose(world: IWorld): { xMm: number; zMm: number; yawMdeg: number } | undefined;
  /** Command factories — the controller never constructs Commands itself. */
  makeFace(tick: number, yawMdeg: number): Command;
  makeMove(tick: number, forwardMilli: number, strafeMilli: number): Command;
  makeInteract(tick: number, target: EntityId): Command;
  /** Submit yaw drift only when |camYaw - simYaw| exceeds this (default 500 mdeg). */
  yawDriftThresholdMdeg?: number;
  mouseSensitivityMdegPerPx?: number; // default 220
  eyeHeightM?: number; // default 1.6
  thirdPersonBoomM?: number; // default 3.5
  /** KeyboardEvent.code that toggles first/third person. Default "KeyV". */
  toggleViewKey?: string;
  /** H1b screen-focus support (docs/PHASE-H1.md "The screen contract").
   *  Optional and additive: a game with no in-world screens never sets
   *  this, and `syntheticPointer.screenClick` is simply absent (matching
   *  how `pointer` itself is absent for a game with no controller at all).
   *  When present, this is THE shared uv -> command path: both a real
   *  click while a screen is focused and `syntheticPointer.screenClick`
   *  must route through the exact same `uvToPixel` + `makeScreenClick`
   *  call this controller makes internally (see `applyScreenClick` below)
   *  — that sharing is the whole reason a green synthetic screenClick gate
   *  says anything about the real mouse path (docs/PHASE-H0.md's
   *  synthetic-input contract, restated for screens). */
  screen?: {
    /** The currently-focused screen's surface-UV -> integer surface-pixel
     *  mapping (the app's `createScreenSurface().uvToPixel`, per-terminal),
     *  or undefined when no screen is focused right now. Read fresh on
     *  every click/screenClick — never cached, since focus can change
     *  tick to tick. */
    uvToPixel(u: number, v: number): { px: number; py: number } | undefined;
    /** Command factory for a resolved screen click — mirrors makeInteract. */
    makeScreenClick(tick: number, px: number, py: number): Command;
  };
}

export interface FpsController {
  /** Wire into ThreeHostOptions. */
  pointerHandlers: PointerHandlers;
  onFrame(camera: THREE.Camera, world: IWorld, alpha: number): void;
  /** Per-tick input pump: emits at most one face + one move command for the
   *  upcoming tick from held WASD keys + accumulated look. */
  onTick(world: IWorld, submit: (c: Command) => void): void;
  /** The synthetic pointer implementation for installTestHook. */
  syntheticPointer: SyntheticPointer;
  /** THE shared uv -> command path (present only when `screen` was
   *  configured). The app's own real-click handling for a focused screen
   *  (raycast the quad, get a uv hit) must call this exact function rather
   *  than reimplementing uvToPixel + submit — that is what makes a green
   *  synthetic `screenClick` gate certify the real mouse path too, per the
   *  H0 synthetic-input contract this restates for screens. */
  applyScreenClick?(u: number, v: number): void;
  /** Reticle target resolution: raycast from camera center against the
   *  registered interactable objects; returns the sim entity or undefined.
   *  Presentation-side suggestion only — the sim revalidates. */
  currentTarget(): EntityId | undefined;
  registerInteractable(entity: EntityId, object: THREE.Object3D): void;
  /** Replayable input trace. */
  inputTrace(): readonly InputTraceEntry[];
}

/** One normalized input event, recorded post-normalization. */
export type InputTraceEntry =
  | { atMs: number; kind: "lock"; locked: boolean }
  | { atMs: number; kind: "look"; dxPx: number; dyPx: number }
  | { atMs: number; kind: "click" }
  | { atMs: number; kind: "key"; code: string; down: boolean }
  | { atMs: number; kind: "screenClick"; u: number; v: number; resolved: boolean };

const DEFAULT_YAW_DRIFT_THRESHOLD_MDEG = 500;
const DEFAULT_SENSITIVITY_MDEG_PER_PX = 220;
const DEFAULT_EYE_HEIGHT_M = 1.6;
const DEFAULT_BOOM_M = 3.5;
const DEFAULT_TOGGLE_KEY = "KeyV";
const PITCH_CLAMP_MDEG = 89_000; // ~89 deg, presentation-only clamp

export function createFpsController(opts: FpsControllerOptions): FpsController {
  const yawDriftThresholdMdeg = opts.yawDriftThresholdMdeg ?? DEFAULT_YAW_DRIFT_THRESHOLD_MDEG;
  const sensitivityMdegPerPx = opts.mouseSensitivityMdegPerPx ?? DEFAULT_SENSITIVITY_MDEG_PER_PX;
  const eyeHeightM = opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
  const thirdPersonBoomM = opts.thirdPersonBoomM ?? DEFAULT_BOOM_M;
  const toggleViewKey = opts.toggleViewKey ?? DEFAULT_TOGGLE_KEY;

  // Free-running camera look state (presentation only — never sim state).
  // camYawMdeg wraps into [0, 360_000); camPitchMdeg is clamped, never a
  // command, never read by the sim.
  let camYawMdeg = 0;
  let camPitchMdeg = 0;
  let camInitialized = false;

  let locked = false;
  let thirdPerson = false;

  const heldKeys = new Set<string>();
  const trace: InputTraceEntry[] = [];

  const interactables = new Map<EntityId, THREE.Object3D>();
  const objectToEntity = new Map<THREE.Object3D, EntityId>();
  let raycastCamera: THREE.Camera | undefined;
  const raycaster = new THREE.Raycaster();

  let pendingClickTarget: EntityId | undefined;
  let clickRequested = false;

  // H1b screen-focus queue — mirrors pendingClickTarget/clickRequested's
  // shape exactly, so a resolved screen click rides the same per-tick
  // cadence (submitted from onTick, not synchronously) as every other
  // command this controller produces.
  let pendingScreenClickPx: { px: number; py: number } | undefined;
  let screenClickRequested = false;

  function nowMs(): number {
    return Date.now();
  }

  function ensureCamInitialized(world: IWorld): void {
    if (camInitialized) return;
    const pose = opts.readPose(world);
    if (pose) {
      camYawMdeg = pose.yawMdeg;
      camInitialized = true;
    }
  }

  function wrapMdeg(mdeg: number): number {
    let m = mdeg % FULL_TURN_MDEG;
    if (m < 0) m += FULL_TURN_MDEG;
    return m;
  }

  function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }

  // ---------------------------------------------------------------------
  // THE SYNTHETIC-INPUT SEAM (docs/PHASE-H0.md, "the synthetic-input
  // contract" — the load-bearing testability decision). Real DOM events are
  // normalized down to px deltas / booleans by the thin listeners in
  // `pointerHandlers` below, then handed to `applyLook` / `applyClick` /
  // `applyLockChange`. `syntheticPointer.look/click/lock` call these SAME
  // three functions directly, one frame after normalization and zero frames
  // before any game logic. Everything from here down — sensitivity scaling,
  // yaw accumulation, drift thresholding, face quantization, the reticle
  // raycast against the real Three scene, target resolution, command
  // construction, and the trace recorder — is shared byte-for-byte between
  // real and synthetic input. The only thing synthetic input skips is DOM
  // event plumbing that carries no logic, which is why a green synthetic
  // (harness/browser) gate certifies the real mouse/keyboard path too.
  // ---------------------------------------------------------------------

  function applyLook(dxPx: number, dyPx: number): void {
    trace.push({ atMs: nowMs(), kind: "look", dxPx, dyPx });
    camYawMdeg = wrapMdeg(camYawMdeg + dxPx * sensitivityMdegPerPx);
    camPitchMdeg = clamp(camPitchMdeg + dyPx * sensitivityMdegPerPx, -PITCH_CLAMP_MDEG, PITCH_CLAMP_MDEG);
  }

  function applyClick(): void {
    trace.push({ atMs: nowMs(), kind: "click" });
    // Resolve against the real scene right now, at the exact moment of the
    // click — same path real and synthetic input both go through.
    const target = resolveTarget();
    if (target !== undefined) {
      pendingClickTarget = target;
      clickRequested = true;
    }
  }

  // THE H1b screen-click seam. `syntheticPointer.screenClick(u, v)` calls
  // this directly; the app's real screen-click handling (raycasting its own
  // focused quad while unlocked, since screen focus exits pointer lock —
  // see docs/PHASE-H1.md "The screen contract") must call this SAME
  // function with the uv it resolved, rather than computing uvToPixel and
  // submitting a command itself. If real and synthetic clicks diverge here,
  // the readability and check-in browser gates stop meaning anything: they
  // would only ever prove the synthetic path works, never the mouse a
  // player actually uses (docs/PHASE-H0.md's synthetic-input contract).
  function applyScreenClick(u: number, v: number): void {
    const resolved = opts.screen?.uvToPixel(u, v);
    trace.push({ atMs: nowMs(), kind: "screenClick", u, v, resolved: resolved !== undefined });
    if (!resolved) return;
    pendingScreenClickPx = resolved;
    screenClickRequested = true;
  }

  function applyLockChange(isLocked: boolean): void {
    trace.push({ atMs: nowMs(), kind: "lock", locked: isLocked });
    locked = isLocked;
  }

  function applyKey(code: string, down: boolean): void {
    trace.push({ atMs: nowMs(), kind: "key", code, down });
    if (down) heldKeys.add(code);
    else heldKeys.delete(code);
    if (down && code === toggleViewKey) {
      thirdPerson = !thirdPerson;
    }
  }

  // -- Real DOM-facing normalization (no logic beyond unwrapping events) --

  function onLook(dxPx: number, dyPx: number): void {
    applyLook(dxPx, dyPx);
  }
  function onClick(): void {
    applyClick();
  }
  function onPointerLockChange(isLocked: boolean): void {
    applyLockChange(isLocked);
  }

  const pointerHandlers: PointerHandlers = {
    onLook,
    onClick,
    onPointerLockChange,
  };

  // Real keyboard input is owned by this controller (see report: WASD
  // plumbing choice) rather than routed through ThreeHostOptions.keymap, so
  // the toggle key and held-key state share the same trace recorder as
  // mouse look/click. We install our own window listeners the same way
  // three-host does for its own keymap.
  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    applyKey(e.code, true);
  }
  function onKeyUp(e: KeyboardEvent): void {
    applyKey(e.code, false);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  const syntheticPointer: SyntheticPointer = {
    lock(): void {
      applyLockChange(true);
    },
    look(dxPx: number, dyPx: number): void {
      applyLook(dxPx, dyPx);
    },
    click(): void {
      applyClick();
    },
  };
  // `screenClick` is attached only when the game configured `screen`
  // support — additive, exactly like `pointer` itself being absent for a
  // game with no controller. A scenario that declares a screenClick step
  // against a hook whose pointer has no `screenClick` fails fast with
  // BrowserInfraError (packages/harness/src/browser.ts), naming this.
  if (opts.screen) {
    syntheticPointer.screenClick = (u: number, v: number): void => {
      applyScreenClick(u, v);
    };
  }

  function resolveTarget(): EntityId | undefined {
    if (!raycastCamera) return undefined;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), raycastCamera);
    const objects = Array.from(interactables.values());
    const hits = raycaster.intersectObjects(objects, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        const entity = objectToEntity.get(obj);
        if (entity !== undefined) return entity;
        obj = obj.parent;
      }
    }
    return undefined;
  }

  function registerInteractable(entity: EntityId, object: THREE.Object3D): void {
    interactables.set(entity, object);
    objectToEntity.set(object, entity);
  }

  function currentTarget(): EntityId | undefined {
    return resolveTarget();
  }

  function onTick(world: IWorld, submit: (c: Command) => void): void {
    ensureCamInitialized(world);
    const pose = opts.readPose(world);
    if (!pose) return;

    // face{} — sim state. Submitted at most once per tick, only past drift
    // threshold, quantized (whole millidegrees — camYawMdeg already is).
    // Stamp at world.tick + 1, not world.tick: onTick runs before
    // sim.step() (main.ts's tickSim wraps stepSim as
    // `controller.onTick(...); sim.step()`), so world.tick here is the
    // pre-step tick T while the command actually executes in the step that
    // produces T+1. Matches the server's convention
    // (packages/server/src/server.ts's doTick drain: `sim.tick + 1`) --
    // phase-H0 review item 2, the same stamp!=execution-tick class phase 3
    // removed from the server. Headless replay (replayToSim) executes a
    // command stamped T in the step producing T, so an unstamped mismatch
    // here would shift every replayed command by one tick relative to the
    // live browser session; a command submitted at world.tick===0 would
    // also be silently dropped by replayToSim's `for (t = 1..ticks)` loop.
    const drift = Math.abs(angleDeltaMdeg(camYawMdeg, pose.yawMdeg));
    if (drift > yawDriftThresholdMdeg) {
      submit(opts.makeFace(world.tick + 1, camYawMdeg));
    }

    // move{} — held WASD relative to the current SIM yaw; sim does the trig.
    // Gated on pointer lock: without lock there is no live look/movement
    // session, so held keys (e.g. stale from before a lock loss) submit
    // nothing.
    if (!locked) return;
    let forwardMilli = 0;
    let strafeMilli = 0;
    if (heldKeys.has("KeyW")) forwardMilli += 1000;
    if (heldKeys.has("KeyS")) forwardMilli -= 1000;
    if (heldKeys.has("KeyD")) strafeMilli += 1000;
    if (heldKeys.has("KeyA")) strafeMilli -= 1000;
    if (forwardMilli !== 0 || strafeMilli !== 0) {
      submit(opts.makeMove(world.tick + 1, forwardMilli, strafeMilli));
    }

    // interact{} — proposed by the click seam, consumed here so it rides
    // the same per-tick cadence as everything else the sim revalidates.
    if (clickRequested) {
      clickRequested = false;
      if (pendingClickTarget !== undefined) {
        submit(opts.makeInteract(world.tick + 1, pendingClickTarget));
      }
      pendingClickTarget = undefined;
    }

    // screen.click{px,py} — resolved uv->pixel, queued by applyScreenClick,
    // submitted here so it rides the same per-tick cadence as face/move/
    // interact above rather than firing mid-tick.
    if (screenClickRequested) {
      screenClickRequested = false;
      const px = pendingScreenClickPx;
      pendingScreenClickPx = undefined;
      if (px && opts.screen) {
        submit(opts.screen.makeScreenClick(world.tick + 1, px.px, px.py));
      }
    }
  }

  function onFrame(camera: THREE.Camera, world: IWorld, alpha: number): void {
    raycastCamera = camera;

    ensureCamInitialized(world);
    const pose = opts.readPose(world);
    if (!pose) return;

    // Interpolate the sim's discrete tick-to-tick pose by alpha for a
    // smooth camera at render rate. Positions arrive in millimetres,
    // angles in millidegrees — convert to metres/degrees for Three here,
    // at the render boundary, never earlier.
    const prevPose = readPrevPose(world);
    const xMm = prevPose ? lerp(prevPose.xMm, pose.xMm, alpha) : pose.xMm;
    const zMm = prevPose ? lerp(prevPose.zMm, pose.zMm, alpha) : pose.zMm;
    const simYawMdeg = prevPose
      ? lerpAngleMdeg(prevPose.yawMdeg, pose.yawMdeg, alpha)
      : pose.yawMdeg;

    const xM = xMm / 1000;
    const zM = zMm / 1000;

    const yawRad = (camYawMdeg / 1000) * (Math.PI / 180);
    const pitchRad = (camPitchMdeg / 1000) * (Math.PI / 180);

    if (!thirdPerson) {
      camera.position.set(xM, eyeHeightM, zM);
    } else {
      // Naive spring-arm boom: placed directly behind the SIM yaw (not the
      // free-look camera yaw), at a fixed distance, no collision sweep
      // against the level geometry. Accepted jank for H0 per
      // docs/PHASE-H0.md open question 4 — the boom can clip through walls;
      // a proper implementation would sphere-cast the boom against the nav
      // grid / scene and pull it in on hit. Deliberately deferred.
      const simYawRad = (simYawMdeg / 1000) * (Math.PI / 180);
      const boomX = xM - Math.sin(simYawRad) * thirdPersonBoomM;
      const boomZ = zM - Math.cos(simYawRad) * thirdPersonBoomM;
      camera.position.set(boomX, eyeHeightM, boomZ);
    }

    camera.rotation.order = "YXZ";
    // Sim forward at yaw 0 is +Z (moveSystem integrates dz = forward *
    // cosMdeg(yaw)), while a THREE camera at rotation.y = 0 looks down -Z.
    // A camera with rotation.y = r looks along (-sin r, -cos r), so matching
    // a sim heading of (sin yaw, cos yaw) requires r = yaw + PI. Getting
    // this wrong points the camera exactly opposite the way "forward" walks
    // and the way interactSystem's bearing check faces, which reads as a
    // black screen at yaw 0 and a reticle that drifts off targets as you
    // turn.
    camera.rotation.y = yawRad + Math.PI;
    camera.rotation.x = -pitchRad;
    camera.rotation.z = 0;
  }

  function readPrevPose(world: IWorld): { xMm: number; zMm: number; yawMdeg: number } | undefined {
    const prevPos = world.getComponent<{ xMm: number; zMm: number }>(opts.playerEntity, "prevPos");
    const prevYaw = world.getComponent<{ mdeg: number }>(opts.playerEntity, "prevYaw");
    if (!prevPos || !prevYaw) return undefined;
    return { xMm: prevPos.xMm, zMm: prevPos.zMm, yawMdeg: prevYaw.mdeg };
  }

  function lerp(a: number, b: number, alpha: number): number {
    return a + (b - a) * alpha;
  }

  function lerpAngleMdeg(a: number, b: number, alpha: number): number {
    const delta = angleDeltaMdeg(b, a);
    return wrapMdeg(a + delta * alpha);
  }

  function inputTrace(): readonly InputTraceEntry[] {
    return trace;
  }

  const controller: FpsController = {
    pointerHandlers,
    onFrame,
    onTick,
    syntheticPointer,
    currentTarget,
    registerInteractable,
    inputTrace,
  };
  if (opts.screen) controller.applyScreenClick = applyScreenClick;
  return controller;
}
