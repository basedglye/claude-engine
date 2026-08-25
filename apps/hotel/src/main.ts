import * as THREE from "three";
import { Sim, type EntityId, type IWorld } from "@claude-engine/core";
import { createThreeHost, installTestHook, type SceneContext, type ScreenRect } from "@claude-engine/renderer-three";
import { SCREEN_W } from "@claude-engine/surface-ui";
import { toBufferGeometry } from "@claude-engine/assets/web";
import { generateDoorMesh, type GroundFloor, type DoorSpec } from "@claude-engine/interiors";
import { createFpsController } from "@claude-engine/player-fps";
import { webStore, createSavePump, exportSave, importSave } from "@claude-engine/save-web";
// Deep import, not the package barrel: @claude-engine/persistence's index.ts
// also re-exports sqliteStore/postgresStore, which pull in better-sqlite3
// and pg (Node natives + node:crypto) at the top of their modules. Vite
// would try to resolve those for the browser bundle and fail. recover.ts
// itself imports only @claude-engine/core plus type-only store types
// (docs/PHASE-H1.md section B: "verified to have no Node imports") — going
// straight at the compiled file sidesteps the barrel's Node-only siblings
// entirely, since it's a plain subpath import (persistence has no
// "exports" map restricting it).
import { recoverSim } from "@claude-engine/persistence/dist/recover.js";
import {
  setup,
  loadGroundFloor,
  faceCommand,
  moveCommand,
  interactCommand,
  screenClickCommand,
  screenKeyCommand,
  screenBlurCommand,
  saveRestoreDebugCommand,
  PLAYER_ENTITY,
  PLAYER_ACTOR,
  type Pos,
  type Yaw,
  type Door,
  type Terminal,
} from "./sim/game.js";
import type { Guest } from "./sim/components.js";
import { syncCharacter, pruneCharacters } from "./render/characters.js";
import { syncHeldDocuments, pruneHeldDocuments } from "./render/documents.js";
import { syncTerminalScreens, SCREEN_W_M, SCREEN_H_M, type TerminalScreen } from "./render/screens.js";

const canvas = document.querySelector<HTMLCanvasElement>("#app");
if (!canvas) throw new Error("apps/hotel: missing #app canvas in index.html");

// Seed must match scenarios/fps-look-interact.scenario.mjs's declared seed
// (docs/PHASE-H0.md exit criterion 1: "seed hotel-h0-look-1"). A browser
// scenario's --verify-replay reconstructs a fresh `Sim` from the scenario's
// `seed` field (packages/harness/src/index.ts's `verifyReplay`), and
// GroundFloor geometry/spawn/doors are a pure function of the seed
// (determinism rule 5) -- if this literal ever drifts from the live app's
// seed, headless replay diverges from the browser session on the very
// first tick (different spawn point, different door layout), independent
// of any command-log or trig determinism issue.
// The harness passes the scenario's seed as ?worldforgeSeed=... so the
// browser run and the headless replay of its command log describe the same
// world. A scenario whose seed differs from the app's would otherwise
// diverge with no symptom beyond exit 3.
const DEFAULT_SEED = "hotel-h0-look-1";
const seedParam = new URLSearchParams(window.location.search).get("worldforgeSeed");
const sim = new Sim(seedParam ?? DEFAULT_SEED, { eventRetentionTicks: 600 });
setup(sim);

// -- H1b save/load (docs/PHASE-H1.md section B + "Host (main.ts)
//    additions"): a single fixed game id, since H1 has no save UI
//    (listGames/deleteGame are the recorded future change, not made here).
//    The game record is created (idempotently -- put(), not add()) before
//    any command is submitted, so a quicksave's exportSave() always finds
//    a record to hang commands off of. --
const GAME_ID = "hotel-sp";
const store = webStore();
// Not top-level-awaited (vite's default build target predates it) --
// quickSave() below awaits this promise before its first store access, so
// the record is guaranteed to exist by the time exportSave() needs it.
const gameReady: Promise<unknown> = store.createGame({ id: GAME_ID, name: "hotel-sp", seed: sim.seed });

// Every command submission is routed through the pump's submit (wired into
// installTestHook's `submit` option below) -- that is what makes the
// write-ahead guarantee real: a command is durably queued (the in-memory
// WAL) before the sim ever sees it, not just "eventually written somewhere
// after the fact."
const pump = createSavePump({ store, gameId: GAME_ID, snapshotEveryTicks: 2000 });

// F5/F9 quick-save/quick-load state (docs/PHASE-H1.md open question 6):
// this app rebuilds the sim IN PLACE rather than reloading the page or
// constructing a fresh Sim object. Reasoning:
//   1. installTestHook's commandLog() is a plain in-memory array scoped to
//      one page load (packages/renderer-three/src/test-hook.ts) -- a
//      reload starts a fresh, empty log. Browser-mode scenario assertions
//      (and --verify-replay) are evaluated by replaying window.__WORLDFORGE__
//      .commandLog() through a headless Sim (packages/harness/src/cli.ts's
//      runBrowserMode). A reload would silently truncate that replay bundle
//      to whatever ran after the reload, breaking every assertion in any
//      scenario that saves and loads -- with no error, just wrong answers.
//   2. A reload also tears down and re-creates the whole Three.js scene,
//      WebGL context, and pointer-lock state for no functional gain here.
//   3. `Sim.restore()` (packages/core/src/sim.ts) is designed to mutate an
//      EXISTING Sim's components/tick/rng in place -- recoverSim() already
//      uses it internally. Building the target state with recoverSim (as
//      the spec directs) against a throwaway Sim, then applying it to the
//      live `sim` via `sim.restore(loaded.snapshot())`, gets an identical
//      result without ever changing the `sim` object's identity, so every
//      closure below (controller, hook, host, tickSim) keeps working
//      unmodified -- no teardown/re-wire step, no lost commandLog.
// The "quick load reverts to the F5 point, discarding the walk since" part
// (the whole point of a quicksave) rides on exportSave/importSave
// (B8's bug-report-replay tool, repurposed as a save "slot"): F5 captures
// the store's FULL command log for GAME_ID as of that instant into an
// in-memory JSON string. Commands submitted after F5 keep landing in
// GAME_ID's own continuously-growing log (autosave keeps working normally),
// but F9 imports the captured JSON as a BRAND NEW game id (importSave never
// reuses an id) whose command log ends exactly at the F5 tick -- so
// recoverSim on that fresh id reconstructs precisely the F5 state, not
// whatever GAME_ID has grown to since.
let savedJson: string | undefined;
let savedTick: number | undefined;
let savedHash: number | undefined;
let restoredHash: number | undefined;
// Guards tickSim (below) against advancing the live sim while a quick-load
// is mid-flight -- the load is async (recoverSim awaits the store) and the
// render loop's fixed-tick accumulator is not, so without this a tick could
// step a half-restored world (docs/PHASE-H1.md risk 3's class of bug,
// applied to the load path instead of the save path).
let loadInFlight = false;

async function quickSave(): Promise<void> {
  await gameReady;
  // Snapshot FIRST, synchronously, before any await -- sim.tick/stateHash()
  // read right now, alongside the snapshot object itself, are pinned to
  // this exact instant. Deliberately NOT pump.snapshotNow(sim): that
  // helper flushes (an await) *then* takes the snapshot, and the render
  // loop keeps ticking across that await (guest AI advances every tick
  // with no player command involved, docs/PHASE-H1.md's guestBrainSystem/
  // pathSystem run unconditionally) -- so the snapshot it would take could
  // already be a few ticks newer than whatever this function read
  // afterwards, and savedHash would silently disagree with what actually
  // got persisted. Taking the snapshot up front and reusing that SAME
  // object for both the persisted bytes and the recorded hash removes the
  // gap entirely.
  const snapshot = sim.snapshot();
  savedTick = sim.tick;
  savedHash = snapshot.stateHash;
  await pump.flush();
  await store.saveSnapshot(GAME_ID, snapshot);
  savedJson = await exportSave(store, GAME_ID);
}

async function quickLoad(): Promise<void> {
  if (!savedJson) return; // F9 before any F5: a deliberate no-op (see the scenario's non-vacuous guard).
  loadInFlight = true;
  try {
    const loadedGameId = await importSave(store, savedJson);
    const { sim: loaded } = await recoverSim(store, loadedGameId, setup);
    sim.restore(loaded.snapshot());
    resetEntityKeyedHostState();
    restoredHash = sim.stateHash();
    // Carries {savedTick, savedHash, restoredHash} into sim-visible (and
    // therefore replay-visible) state -- see saveRestoreDebugCommand's doc
    // comment. Uses hook.submit (not a raw sim.submit) so it is also
    // WAL-queued and appears in the harness's replay bundle like any other
    // command.
    hook.submit(saveRestoreDebugCommand(sim.tick + 1, savedTick ?? -1, savedHash ?? -1, restoredHash));
  } finally {
    loadInFlight = false;
  }
}

// Re-derive the same pure GroundFloor from the seed for meshes. Deliberately
// NOT reusing a game.ts closure across the module boundary — main.ts calls
// the same pure function independently, exactly as game.ts does inside
// setup() (docs/PHASE-H0.md determinism rule 5).
const floor: GroundFloor = loadGroundFloor(sim.seed);
const doorSpecByIndex = new Map<number, DoorSpec>(floor.doors.map((d) => [d.doorIndex, d]));

const controller = createFpsController({
  actor: PLAYER_ACTOR,
  playerEntity: PLAYER_ENTITY,
  readPose(world: IWorld) {
    const pos = world.getComponent<Pos>(PLAYER_ENTITY, "pos");
    const yaw = world.getComponent<Yaw>(PLAYER_ENTITY, "yaw");
    if (!pos || !yaw) return undefined;
    return { xMm: pos.xMm, zMm: pos.zMm, yawMdeg: yaw.mdeg };
  },
  makeFace: (tick, yawMdeg) => faceCommand(tick, yawMdeg),
  makeMove: (tick, forwardMilli, strafeMilli) => moveCommand(tick, forwardMilli, strafeMilli),
  makeInteract: (tick, target) => interactCommand(tick, target),
  // H1b screen-click seam (docs/PHASE-H0.md's synthetic-input contract,
  // restated for screens): both a real click on the focused quad and the
  // harness's synthetic `screenClick(u, v)` step go through THIS SAME
  // uvToPixel + makeScreenClick pair inside player-fps's
  // `applyScreenClick` -- main.ts's own click listener below calls
  // `controller.applyScreenClick(u, v)` rather than resolving px/py and
  // submitting itself, so there is exactly one code path from a uv hit to
  // a `screen.click` command, real or synthetic.
  screen: {
    uvToPixel: (u, v) => focusedScreen?.surface.uvToPixel(u, v),
    makeScreenClick: (tick, px, py) => screenClickCommand(tick, px, py),
  },
});

// Opt-in start barrier (phase-H0 round-2 review, blocking item 1): only
// present when the harness navigates here with ?worldforgeStartPaused=1,
// which it only does for scenarios with tick-gated input steps
// (packages/harness/src/browser.ts). Every other caller of this page
// (production, demo-visual, demo-walk, a plain browser visit) gets
// startPaused: false, hook.startBarrier stays undefined, and tickSim below
// behaves exactly as it always has.
const startPaused = new URLSearchParams(window.location.search).has("worldforgeStartPaused");

const hook = installTestHook({
  world: sim,
  // Routed through the pump, not straight to sim.submit -- see the H1b
  // save/load block above. Every command, whether from the player, a
  // synthetic harness step, or a screen click, is WAL-queued before the sim
  // applies it.
  submit: (command) => pump.submit(command, (c) => sim.submit(c)),
  app: "@claude-engine/hotel",
  pointer: controller.syntheticPointer,
  tickTimings: () => tickTimings,
  startPaused,
  screenRect: () => computeScreenRect(),
});

/** The save-restore gate's hook slot (docs/PHASE-H1.md gate 4), wired the
 *  same way screenRect/tickTimings are: an extra optional getter set on the
 *  hook object after installTestHook() returns it, read live on each call
 *  rather than snapshotted -- so a scenario probing mid-run always sees the
 *  current values. Not part of WorldforgeHook itself (that interface lives
 *  in @claude-engine/renderer-three, out of this app's scope) -- exactly
 *  the same shape screenRect/tickTimings would have had if this app didn't
 *  get to pass them as installTestHook options. */
interface HotelSaveState {
  savedTick: number | undefined;
  savedHash: number | undefined;
  restoredHash: number | undefined;
}
(hook as typeof hook & { saveState(): HotelSaveState }).saveState = (): HotelSaveState => ({
  savedTick,
  savedHash,
  restoredHash,
});

// -- Per-tick timing, recorded for the sim-tick-ms probe / tickTimings(). --
const tickTimings: number[] = [];
const MAX_TICK_TIMINGS = 600;

/** Wraps sim.step(): calls controller.onTick(world, submit) immediately
 *  before stepping (per docs/PHASE-H0.md host module wiring), then records
 *  the tick's wall-clock duration for tickTimings()/the sim-tick-ms probe. */
function tickSim(): void {
  // Honour the start barrier: while it exists and hasn't been released,
  // the sim takes zero steps — world.tick stays genuinely 0, so a
  // harness `downAtTick: 0` step fires at the real tick 0 on every engine
  // instead of racing page-load latency (phase-H0 round-2 review item 1).
  // The host loop's fixed-tick accumulator (packages/renderer-three/src/
  // host-loop.ts) keeps draining normally either way -- returning here
  // early just means each drained tick did no work, so there is no
  // spiral-of-death and no special-casing needed in the host loop itself.
  if (hook.startBarrier && !hook.startBarrier.released) return;
  // Pause the accumulator across a quick-load's async gap (see quickLoad()
  // above) -- a tick here would apply player intent to a sim that
  // sim.restore() is (or is about to be) mutating out from under it.
  if (loadInFlight) return;
  controller.onTick(sim, (command) => hook.submit(command));
  const start = performance.now();
  sim.step();
  const elapsedMs = performance.now() - start;
  tickTimings.push(elapsedMs);
  // Let the harness dispatch any tick-gated input queued for this tick,
  // synchronously and in-page. Polling world.tick from out of process and
  // then dispatching over a round trip is bounded-late — it cost a move
  // command at a key-up boundary, which is exactly the trigger
  // docs/reviews/phase-H0.md round 3 recorded for this fix.
  hook.notifyTick(sim.tick);
  if (tickTimings.length > MAX_TICK_TIMINGS) tickTimings.shift();
}

// Door meshes: a THREE.Group per door entity, pivoted at the door's hinge so
// flipping door.open visibly swings the panel (legible on a screenshot per
// docs/PHASE-H0.md exit criterion 1). Rebuilt lazily; found each frame by
// scanning entities()+getComponent (IWorld exposes no withComponent — only
// Sim does), never cached against a doorIndex assumed stable across restore.
const doorGroups = new Map<EntityId, THREE.Group>();
const DOOR_SWING_OPEN_RAD = Math.PI / 2;

// A presenting-eligible guest (queue head) has no `interactable` component
// (interactSystem handles it via the `guest` component directly, see
// docs/PHASE-H1.md's interactSystem widening) but the player-fps click
// pipeline still raycasts against explicitly *registered* interactable
// objects (packages/player-fps) -- so guest rigs must be registered the
// same way door meshes are, or a queue-head guest could never be clicked
// to trigger "presenting". Registered once per entity (guarded by this
// Set), the same create-once discipline as objectFor itself.
const registeredGuestInteractables = new Set<EntityId>();

/**
 * Reset entity-keyed host state `Sim.restore()` can invalidate (H1b review
 * item 6). `restore()` rewinds `nextEntity`, so a spawn after a quick-load
 * can reuse an id this session already holds bookkeeping for.
 * `rigsByEntity`/`heldDocs` (render/characters.ts, render/documents.ts) are
 * safe without an entry here: they're only ever written inside
 * `SceneContext.objectFor`'s create callback, so they self-heal on every
 * frame's own live-entity prune. `registeredGuestInteractables` is a plain
 * guard Set with no analogous prune -- once an id is marked registered it
 * is never re-registered, even after the Object3D it named was disposed
 * and a DIFFERENT (reused-id) guest now needs registering in its place, so
 * the controller's raycast list keeps pointing at a pruned object and a
 * real player cannot click the new guest. Named as its own step, not an
 * ad-hoc line at the F9 call site, because this is a general seam: any
 * future entity-keyed host registry that doesn't self-heal through
 * objectFor belongs in this same function, and Phase 2's load menu will
 * exercise it for real (docs/reviews/phase-H1b.md item 6). */
function resetEntityKeyedHostState(): void {
  registeredGuestInteractables.clear();
}

// -- Terminal focus / screen input (docs/PHASE-H1.md, "Host (main.ts)
//    additions"): `interact` -> `terminal.focusedBy` (sim, via the normal
//    player-fps click pipeline, since the terminal quad is registered as an
//    interactable exactly like doors/guests below) -> the host notices the
//    component here, eases the camera, exits pointer lock, and maps the
//    mouse to the quad by raycast each frame. Click -> `uvToPixel` ->
//    `screen.click{px,py}`; keydown -> `screen.key{code}`; ESC -> blur
//    command, camera return, relock. `screen.cursor` is deliberately never
//    submitted — the hover raycast below is host-side paint input only,
//    read fresh each click, never sim state (a 60Hz mouse would flood the
//    command log for zero sim meaning).
let latestCamera: THREE.Camera | undefined;
let focusedScreen: TerminalScreen | undefined;
let terminalScreens: Map<EntityId, TerminalScreen> = new Map();
let focusEase = 0; // 0 = normal FPS pose, 1 = fully eased toward the screen
const FOCUS_EASE_STEP = 0.12;
// How far back the focused camera sits from the monitor.
//
// This used to be a constant tuned by eye at one window size, which is a
// trap: too close cropped the monitor's edge out of a small viewport, too
// far dropped texelScale to 0.72 and the text turned to mush. Both failure
// modes are viewport-dependent, so a single number cannot be right.
//
// Derive it instead. The screen quad is SCREEN_W_M x SCREEN_H_M metres; a
// perspective camera with vertical FOV `fovV` and aspect `a` shows, at
// distance d, a frustum 2*d*tan(fovV/2) tall and that times `a` wide. Solve
// for the distance at which the quad occupies FIT_FRACTION of the smaller
// dimension, and take whichever constraint binds. That maximises
// texelScale (screen pixels per surface pixel, which
// apps/hotel/docs/ARCHITECTURE.md B7 requires to be at least 1) while
// keeping the whole monitor — including the calibration strip the
// readability probe samples — inside the frame at ANY viewport.
const FOCUS_FIT_FRACTION = 0.92;
function focusStandBackM(camera: THREE.PerspectiveCamera): number {
  const halfV = Math.tan((camera.fov * Math.PI) / 360);
  const byHeight = SCREEN_H_M / 2 / (halfV * FOCUS_FIT_FRACTION);
  const byWidth = SCREEN_W_M / 2 / (halfV * camera.aspect * FOCUS_FIT_FRACTION);
  return Math.max(byHeight, byWidth);
}
/** Matches SCREEN_Y_M in render/screens.ts -- eye level looking straight at the monitor. */
const SCREEN_EYE_Y_M = 1.15;
const raycaster = new THREE.Raycaster();

function ndcFromClient(clientX: number, clientY: number): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  const y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  return new THREE.Vector2(x, y);
}

function raycastFocusedScreen(clientX: number, clientY: number): { u: number; v: number } | undefined {
  if (!focusedScreen || !latestCamera) return undefined;
  raycaster.setFromCamera(ndcFromClient(clientX, clientY), latestCamera);
  const hits = raycaster.intersectObject(focusedScreen.screenMesh, false);
  const hit = hits[0];
  if (!hit || !hit.uv) return undefined;
  return { u: hit.uv.x, v: hit.uv.y };
}

/** The `screenRect()` slot `installTestHook` exposes for the
 *  screen-readability probe (packages/renderer-three/src/test-hook.ts):
 *  the focused screen quad's projected axis-aligned pixel rect in the
 *  viewport, plus `texelScale` (projected width / SCREEN_W). Projects the
 *  screen PLANE's own world-space AABB (not the housing, which is
 *  slightly larger) through the live camera and canvas size -- renderer-
 *  three supplies only the slot; hotel is the one app that knows which
 *  quad is focused and how big it actually rendered. */
function computeScreenRect(): ScreenRect | undefined {
  if (!focusedScreen || !latestCamera) return undefined;
  const box = new THREE.Box3().setFromObject(focusedScreen.screenMesh);
  const corners = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ];
  const viewportW = canvas.clientWidth;
  const viewportH = canvas.clientHeight;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    const ndc = corner.clone().project(latestCamera);
    const px = ((ndc.x + 1) / 2) * viewportW;
    const py = ((1 - ndc.y) / 2) * viewportH;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return { x: Math.round(minX), y: Math.round(minY), w: Math.round(w), h: Math.round(h), texelScale: w / SCREEN_W };
}

// Registered BEFORE createThreeHost() below, so this listener runs first
// (DOM dispatches same-target listeners in registration order) and can
// `stopImmediatePropagation()` to swallow three-host's own click handler,
// which otherwise unconditionally calls `canvas.requestPointerLock()` on
// every canvas click — exactly the re-lock we must NOT trigger while
// focused and clicking the screen.
canvas.addEventListener("click", (e: MouseEvent) => {
  if (!focusedScreen) return;
  e.stopImmediatePropagation();
  const hit = raycastFocusedScreen(e.clientX, e.clientY);
  if (!hit) return;
  // THE seam: hand the raw uv to player-fps's applyScreenClick, the exact
  // function `syntheticPointer.screenClick(u, v)` calls too -- everything
  // downstream (uvToPixel, command construction, submit cadence) is now
  // shared byte-for-byte between a real click and a harness screenClick.
  controller.applyScreenClick?.(hit.u, hit.v);
});

window.addEventListener("keydown", (e: KeyboardEvent) => {
  // F5/F9 quick-save/quick-load: handled globally, before the
  // screen-focused branch below, so a focused screen never sees these as a
  // screen.key command and pressing them never triggers a real browser
  // reload (in case F5/F9 ever do reach the chrome, e.g. outside the
  // sandboxed CDP input path this app is normally driven through).
  if (e.code === "F5") {
    e.preventDefault();
    void quickSave();
    return;
  }
  if (e.code === "F9") {
    e.preventDefault();
    void quickLoad();
    return;
  }
  if (!focusedScreen) return;
  if (e.code === "Escape") {
    hook.submit(screenBlurCommand(sim.tick + 1));
    canvas.requestPointerLock();
    return;
  }
  hook.submit(screenKeyCommand(sim.tick + 1, e.code));
});

function findFocusedTerminal(world: IWorld): EntityId | undefined {
  for (const entity of world.entities()) {
    const terminalComp = world.getComponent<Terminal>(entity, "terminal");
    if (terminalComp && terminalComp.focusedBy === PLAYER_ACTOR) return entity;
  }
  return undefined;
}

const host = createThreeHost(sim, {
  canvas,
  stepSim: tickSim,
  submit: (command) => hook.submit(command),
  pointerHandlers: controller.pointerHandlers,
  onFrame(camera: THREE.Camera, world: IWorld, alpha: number) {
    // player-fps drives the normal FPS pose first; the focus ease below
    // overrides it only while a terminal is focused.
    controller.onFrame(camera, world, alpha);
    latestCamera = camera;

    const focusedEntity = findFocusedTerminal(world);
    const screen = focusedEntity !== undefined ? terminalScreens.get(focusedEntity) : undefined;
    if (screen) {
      if (!focusedScreen) {
        // Just focused this frame: exit pointer lock so the mouse is free
        // to hover/click the quad (pointer stays captured to the canvas —
        // the browser cursor simply becomes visible again).
        document.exitPointerLock();
      }
      focusedScreen = screen;
      focusEase = Math.min(1, focusEase + FOCUS_EASE_STEP);
      // screen.screenMesh.position is LOCAL to its parent group (a small
      // z-offset off the housing, see render/screens.ts) -- reading it as
      // if it were a world position was one real bug here: the ease
      // target landed near the scene origin, nowhere near the desk.
      // getWorldPosition/getWorldQuaternion fix that. The OTHER real bug
      // (H1b review round 2) was deriving the ease's stand-back direction
      // from wherever the player happened to be standing when they
      // clicked interact, rather than from the screen's own (now
      // correctly oriented, see render/screens.ts's -PI/2 comment) front
      // normal -- an off-axis approach angle put the ease camera staring
      // at the housing's thin edge instead of its face. The mesh's own
      // world-space +Z normal is the single correct target regardless of
      // which side the player walked up from (the plane is DoubleSide, so
      // it is visible either way; this just frames it face-on).
      const screenWorldPos = screen.screenMesh.getWorldPosition(new THREE.Vector3());
      const screenWorldQuat = screen.screenMesh.getWorldQuaternion(new THREE.Quaternion());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenWorldQuat);
      const targetPos = screenWorldPos.clone().addScaledVector(normal, focusStandBackM(camera as THREE.PerspectiveCamera));
      targetPos.y = SCREEN_EYE_Y_M;
      camera.position.lerp(targetPos, focusEase);
      // Same convention player-fps's own onFrame uses (see its comment on
      // sim-forward-vs-camera-facing): a camera at rotation.y = r looks
      // along (-sin r, -cos r); matching a heading of (sin yaw, cos yaw)
      // requires r = yaw + PI. Deliberately NOT using Object3D.lookAt() /
      // Quaternion.setFromRotationMatrix() here — empirically it collapsed
      // to an identity quaternion for this camera in this host loop, for
      // reasons not worth chasing when this simpler, already-proven
      // convention was sitting right there.
      const dx = screenWorldPos.x - camera.position.x;
      const dz = screenWorldPos.z - camera.position.z;
      const desiredYawRad = Math.atan2(dx, dz);
      const targetRotY = desiredYawRad + Math.PI;
      camera.rotation.order = "YXZ";
      let dy = targetRotY - camera.rotation.y;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      camera.rotation.y += dy * focusEase;
      camera.rotation.x += (0 - camera.rotation.x) * focusEase;
      camera.rotation.z = 0;
    } else {
      focusedScreen = undefined;
      focusEase = 0;
    }
  },
  syncScene(ctx: SceneContext, world: IWorld, alpha: number) {
    ctx.scenery("floor-mesh", () => {
      const geometry = toBufferGeometry(floor.mesh);
      const material = new THREE.MeshStandardMaterial({ vertexColors: true });
      return new THREE.Mesh(geometry, material);
    });

    terminalScreens = syncTerminalScreens(ctx, world, controller.registerInteractable);

    for (const entity of world.entities()) {
      const door = world.getComponent<Door>(entity, "door");
      if (!door) continue;
      const spec = doorSpecByIndex.get(door.doorIndex);
      if (!spec) continue;

      let group = doorGroups.get(entity);
      if (!group) {
        const doorMesh = generateDoorMesh(spec);
        const geometry = toBufferGeometry(doorMesh);
        const material = new THREE.MeshStandardMaterial({ vertexColors: true });
        const mesh = new THREE.Mesh(geometry, material);
        // generateDoorMesh already positions the panel in world space
        // (docs/PHASE-H0.md's door mesh is centered on the door cell), so
        // pivot the group at the door center and offset the mesh by the
        // inverse to rotate around that hinge point rather than the scene
        // origin.
        group = new THREE.Group();
        group.position.set(spec.xMm / 1000, 0, spec.zMm / 1000);
        mesh.position.set(-spec.xMm / 1000, 0, -spec.zMm / 1000);
        group.add(mesh);
        doorGroups.set(entity, group);
        ctx.scene.add(group);
        controller.registerInteractable(entity, group);
      }
      group.rotation.y = door.open ? DOOR_SWING_OPEN_RAD : 0;
    }

    // -- guest characters: articulated Object3D limb rigs, interpolated
    //    exactly like the player (prevPos/pos, prevYaw/yaw + alpha), posed
    //    from guest.state + this frame's actual displacement. See
    //    render/characters.ts (apps/hotel/docs/ARCHITECTURE.md B6). --
    const liveGuests = new Set<EntityId>();
    for (const entity of world.entities()) {
      const guest = world.getComponent<Guest>(entity, "guest");
      if (!guest) continue;
      const pos = world.getComponent<Pos>(entity, "pos");
      const prevPos = world.getComponent<Pos>(entity, "prevPos");
      const yaw = world.getComponent<Yaw>(entity, "yaw");
      const prevYaw = world.getComponent<Yaw>(entity, "prevYaw");
      if (!pos || !prevPos || !yaw || !prevYaw) continue;
      liveGuests.add(entity);
      const rigRoot = syncCharacter(ctx, entity, guest, pos, prevPos, yaw, prevYaw, alpha);
      if (rigRoot && !registeredGuestInteractables.has(entity)) {
        controller.registerInteractable(entity, rigRoot);
        registeredGuestInteractables.add(entity);
      }
    }
    pruneCharacters(liveGuests);

    // -- held-document view: docs/PHASE-H1.md "Held-item inspect". --
    syncHeldDocuments(ctx, world, ctx.camera, PLAYER_ENTITY);
    pruneHeldDocuments(world, PLAYER_ENTITY);
  },
});

window.addEventListener("beforeunload", () => host.stop());
