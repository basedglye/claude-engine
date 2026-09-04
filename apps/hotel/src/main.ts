import * as THREE from "three";
import { Sim, RestoreError, type EntityId, type IWorld, type Command, type SimSnapshot } from "@claude-engine/core";
import {
  createThreeHost,
  installTestHook,
  type FrameStats,
  type SceneContext,
  type ScreenRect,
  type ThreeHost,
} from "@claude-engine/renderer-three";
import { SCREEN_W } from "@claude-engine/surface-ui";
import type { GroundFloor, DoorSpec } from "@claude-engine/interiors";
import { createFpsController } from "@claude-engine/player-fps";
import { webStore, memoryStore, indexedDbAvailable, createSavePump, exportSave } from "@claude-engine/save-web";
// The "./recover" exports subpath (packages/persistence/package.json)
// resolves straight to recover.ts's compiled output without pulling in the
// package barrel's Node-only siblings (sqliteStore / postgresStore, which
// import better-sqlite3 / pg and would break Vite's browser bundle).
import { recoverSim } from "@claude-engine/persistence/recover";
import {
  setup,
  setupNamed,
  SCENARIO_CONFIGS,
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
import { syncUpkeepObjects } from "./render/upkeep.js";
import { syncHeldDocuments, pruneHeldDocuments } from "./render/documents.js";
import { syncTerminalScreens, SCREEN_W_M, SCREEN_H_M, type TerminalScreen } from "./render/screens.js";
// -- The "real hotel" look (apps/hotel/docs/decisions/2026-09-02-real-hotel-look.md):
//    host-side only; every module degrades to flat colours when the CC0
//    payload is not fetched, and none of it touches sim state.
import { buildArchitecture } from "./render/architecture.js";
import { buildExterior } from "./render/exterior.js";
import { createDoorLeaf } from "./render/door-leaf.js";
import { configureRenderer, buildLighting, setFlickerEnabled, isFlickerEnabled, type LightingRig } from "./render/lighting.js";
import { buildFixtures } from "./render/fixtures.js";
import { buildDecor } from "./render/decor.js";
import { createHud, type HudState } from "./render/hud.js";
import { createDeskStamp } from "./render/desk-stamp.js";
import { assetStatus } from "./render/assets.js";
import type { InteractableKind, Interactable, Hotel } from "./sim/components.js";
import { RENOVATE_COST_MINOR } from "./sim/economy.js";
import { createWalkthrough } from "./render/walkthrough.js";
import type { HotelTier } from "./render/procedural.js";
import { installHoverLookFallback } from "./render/pointer-fallback.js";

const canvasEl = document.querySelector<HTMLCanvasElement>("#app");
if (!canvasEl) throw new Error("apps/hotel: missing #app canvas in index.html");
// Non-null binding so closures below keep the narrowing (TS18047 otherwise).
const canvas: HTMLCanvasElement = canvasEl;

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
// ?worldforgeConfig=<name> selects one of the committed SCENARIO_CONFIGS
// (e.g. "upkeep-demo") in place of the plain setup(). This takes a NAME,
// never arbitrary JSON off the query string: a named config is a fixed,
// code-reviewed world (bounded set of pre-dirtied rooms, door states, spawn
// points) that a scenario file can commit a seed and literals against, so a
// browser gate stays reproducible and auditable. Accepting free-form config
// JSON from the URL would let anyone hand the page arbitrary starting sim
// state (or worse, non-JSON payloads probing for injection) -- the whole
// point of the seed+input-log replay model is that a world is fully
// described by committed, reviewable inputs, not by whatever a link happens
// to carry. An unknown or absent name keeps today's setup(sim).
const configParam = new URLSearchParams(window.location.search).get("worldforgeConfig");
if (configParam && configParam in SCENARIO_CONFIGS) {
  setupNamed(sim, configParam);
} else {
  setup(sim);
}

// -- H2b load-on-boot persistence (docs/PHASE-H2.md section 5C, deferral
//    row 1): `listGames()`/`deleteGame()` now exist, and the live game id
//    is no longer a single fixed constant -- boot recovers the most
//    recently played game (see recoverOnBoot below), and both quick-load
//    and the audit-save id-switch mint a fresh derived id off whatever
//    branch they're forking from. `gameId` is therefore `let`, not
//    `const`, and everything downstream that needs "the id we're currently
//    writing to" (the pump, quickSave/quickLoad, the audit-save hook) reads
//    it live rather than closing over a fixed value.
const GAME_ID_PREFIX = "hotel-sp";
let gameId = GAME_ID_PREFIX;
// A sandboxed host (the claude.ai artifact viewer) denies IndexedDB; fall
// back to a session-only memory store so the write-ahead pump and F5/F9
// keep working, and say so once in the console rather than throwing on
// every command.
const store = indexedDbAvailable() ? webStore() : memoryStore();
if (!indexedDbAvailable()) console.info("GRAND FOYER: IndexedDB unavailable in this host; saves are session-only.");
// Not top-level-awaited (vite's default build target predates it) --
// quickSave() below awaits this promise before its first store access, so
// a record is guaranteed to exist under `gameId` by the time exportSave()
// needs it. Idempotent (put(), not add()) so it is harmless to have already
// created this exact id -- and it's superseded (gameReady reassigned) the
// moment recoverOnBoot() finds and recovers an existing game instead of
// starting fresh under this default id.
/**
 * The games that existed BEFORE this session touched the store — captured
 * as a promise chained ahead of `createGame` below, so it can never observe
 * this session's own record.
 *
 * THIS IS LOAD-BEARING, NOT TIDINESS. Boot recovery originally listed games
 * after `createGame` had run and took `games[0]`, which is this session's
 * OWN freshly-created `hotel-sp` — a record that by then already holds the
 * first few ticks of commands the save pump has written. `recoverSim` then
 * replayed those commands into a throwaway sim and `sim.restore()`d the
 * live world back onto them, mid-run, while the render loop was ticking.
 *
 * The symptoms were nastily indirect and cost most of an afternoon: browser
 * gates went to exit 3 (the recovered world no longer matched a headless
 * replay of the same command log, and a spurious `debug.saveRestoreRecord`
 * entered the stream), the player teleported mid-walk so `art-lock`'s
 * camera ended up buried in geometry with no monitor in frame, and the live
 * dev server froze at whatever tick recovery began at because `tickSim`
 * correctly refuses to step while `loadInFlight` is true. None of those
 * read as "boot recovery ate its own tail".
 *
 * Listing first makes the rule structural: recovery can only ever consider
 * a game some EARLIER session wrote.
 */
const gamesBeforeBoot: Promise<{ id: string; name: string; seed: string; latestSnapshotTick?: number }[]> =
  store.listGames();

let gameReady: Promise<unknown> = gamesBeforeBoot.then(() =>
  store.createGame({ id: gameId, name: GAME_ID_PREFIX, seed: sim.seed })
);

// Every command submission is routed through the pump's submit (wired into
// installTestHook's `submit` option below) -- that is what makes the
// write-ahead guarantee real: a command is durably queued (the in-memory
// WAL) before the sim ever sees it, not just "eventually written somewhere
// after the fact." `pump` is `let`, not `const`: createSavePump() closes
// over a fixed gameId at construction (packages/save-web has no
// "repoint this pump" API, and that package is out of this lane's scope),
// so switching the live game id means constructing a *new* pump and
// reassigning this binding -- installTestHook's `submit` option below
// closes over the variable `pump`, not a snapshot of today's pump object,
// so every call site downstream keeps working the instant the swap
// happens.
let pump = createSavePump({ store, gameId, snapshotEveryTicks: 2000 });

// Disambiguates fresh derived ids minted in the same millisecond (quick-load
// spam, or a quick-load immediately followed by an audit save) -- part of
// the `hotel-sp@<savedTick>-<n>` scheme below.
let deriveSeq = 0;

/** The `SaveFile` shape `@claude-engine/save-web`'s exportSave/importSave
 *  round-trip (packages/save-web/src/save.ts) -- reproduced here (not
 *  imported; it's a private, unexported interface of that module) because
 *  this function needs `importSave`'s parsing but NOT its id-generation
 *  (`store.createGame({name, seed})` with no `id`, which always mints a
 *  random UUID -- see below). */
interface HotelSaveFile {
  v: 1;
  game: { name: string; seed: string };
  commands: Command[];
  snapshot: SimSnapshot | null;
}

/**
 * Import a captured save (exportSave's JSON) as a game record under a
 * CHOSEN id, rather than importSave's random `crypto.randomUUID()` --
 * docs/PHASE-H2.md section 5C's derived-id scheme
 * (`hotel-sp@<savedTick>-<n>`) needs the id to be predictable and
 * meaningful (it names the tick it forked from), which importSave's API
 * has no parameter for. Otherwise identical to importSave: a fresh record,
 * never overwriting an existing id (store.createGame's `put` is keyed on
 * this NEW id, which deriveGameId() below guarantees is unused).
 */
async function importSaveAs(json: string, id: string): Promise<string> {
  const file = JSON.parse(json) as HotelSaveFile;
  if (file.v !== 1) {
    throw new Error(`importSaveAs: unsupported save file version ${(file as { v: unknown }).v}`);
  }
  const record = await store.createGame({ id, name: file.game.name, seed: file.game.seed });
  if (file.commands.length > 0) {
    await store.appendCommands(record.id, file.commands);
  }
  if (file.snapshot) {
    await store.saveSnapshot(record.id, file.snapshot);
  }
  return record.id;
}

/** `hotel-sp@<savedTick>-<n>` -- the derived-id scheme itself (section 5C).
 *  Named by the tick it forked from so two branches born at different
 *  points are distinguishable at a glance in `listGames()`'s output; `n`
 *  breaks ties within the same tick. */
function deriveGameId(atTick: number): string {
  return `${GAME_ID_PREFIX}@${atTick}-${deriveSeq++}`;
}

/**
 * Point every "currently active save" binding at a new game id: flush
 * whatever the OLD pump still has queued (so no in-flight command is lost
 * -- the WAL guarantee extends across an id switch, not just within one
 * id's lifetime), then swap `gameId`/`pump`/`gameReady` together as one
 * atomic-looking step. Shared by quickLoad's id-switch and recoverOnBoot's
 * (both "start writing new commands under a different, already-populated
 * game record" -- the audit-save id-switch section 5C also names will use
 * this same helper once econ.audit gains a host-side save hook; not wired
 * to that event in THIS lane, see the report). */
async function switchLiveGame(id: string, record: Promise<unknown>): Promise<void> {
  await pump.flush();
  gameId = id;
  pump = createSavePump({ store, gameId, snapshotEveryTicks: 2000 });
  gameReady = record;
}

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
// (the whole point of a quicksave) rides on exportSave/importSaveAs
// (B8's bug-report-replay tool, repurposed as a save "slot"): F5 captures
// the CURRENT live game's FULL command log as of that instant into an
// in-memory JSON string. Commands submitted after F5 keep landing in that
// same id's continuously-growing log (autosave keeps working normally) --
// but per section 5C's quick-load id semantics, F9 no longer just imports
// into a throwaway id and discards it: it imports as a fresh DERIVED id
// (`deriveGameId`, `hotel-sp@<savedTick>-<n>`) whose command log ends
// exactly at the F5 tick, AND makes that derived id the new live `gameId`
// (`switchLiveGame`) -- so every command submitted from this point on
// lands under the branch F9 actually reverted to, not interleaved into the
// abandoned branch's still-growing log. The abandoned branch's own record
// is never truncated or deleted (section 5C: "the abandoned branch's
// records are what make a save a bug report") -- it simply stops being the
// live id.
let savedJson: string | undefined;
let savedTick: number | undefined;
let savedHash: number | undefined;
let restoredHash: number | undefined;
// Guards tickSim (below) against advancing the live sim while a quick-load
// (or boot recovery, see recoverOnBoot below) is mid-flight -- the load is
// async (recoverSim awaits the store) and the render loop's fixed-tick
// accumulator is not, so without this a tick could step a half-restored
// world (docs/PHASE-H1.md risk 3's class of bug, applied to the load path
// instead of the save path).
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
  await store.saveSnapshot(gameId, snapshot);
  savedJson = await exportSave(store, gameId);
}

async function quickLoad(): Promise<void> {
  if (!savedJson) return; // F9 before any F5: a deliberate no-op (see the scenario's non-vacuous guard).
  loadInFlight = true;
  try {
    const forkedFromTick = savedTick ?? sim.tick;
    const loadedGameId = await importSaveAs(savedJson, deriveGameId(forkedFromTick));
    const { sim: loaded, record } = await recoverSim(store, loadedGameId, setup);
    sim.restore(loaded.snapshot());
    resetEntityKeyedHostState();
    restoredHash = sim.stateHash();
    // The id-switch: from this point on, quickSave/the pump/autosave all
    // write under the branch F9 just reverted to, per the doc comment
    // above.
    await switchLiveGame(loadedGameId, Promise.resolve(record));
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

/**
 * Load-on-boot (docs/PHASE-H2.md section 5C, deferral row 1 and gate 8):
 * recovers the most recently played game via `listGames()` +
 * `recoverSim`, instead of always starting fresh at a fixed id. Runs
 * against the `sim` object that has ALREADY had `setup(sim)` called on it
 * synchronously above (so rendering/controls/etc. can start immediately
 * without blocking on IndexedDB) -- if a save is found, this rebuilds the
 * target state via `recoverSim` against a throwaway sim exactly like
 * `quickLoad` does, then applies it to the SAME live `sim` in place via
 * `sim.restore()`. Same reasoning as quickLoad's doc comment above for why
 * in-place rather than a fresh Sim/page reload; `loadInFlight` (shared with
 * quickLoad) covers the async gap here too.
 *
 * RestoreError handling (open question 8): `Sim.restore()` throws
 * `RestoreError` on a v:1 snapshot or a forkRng label mismatch --
 * docs/PHASE-H2.md's non-goals are explicit that an H1-shaped save fails
 * this check BY DESIGN (this app's `setup()` has grown new forkRng streams
 * since H1; policy, not a bug). CHOICE MADE HERE: silent fresh start, not a
 * diegetic notice. Reasoning: (1) the fresh `sim` this function inherits is
 * already fully playable the instant this catch fires -- there is no
 * broken or half-loaded state to explain to the player, only an absent
 * one, which is exactly what a brand-new game looks like anyway; (2) a
 * diegetic in-world notice is new player-visible UI, which CLAUDE.md's
 * working conventions require to go through the i18n `t()` table -- that
 * table, and any screen/HUD surface to host the string, live outside this
 * lane's file scope (apps/hotel/src/main.ts and this scenario only), so
 * building it here would mean either a scope violation or an un-i18n'd
 * string shipped against house style. If a future lane wants the notice,
 * this is the one call site to add it at.
 */
/**
 * The recovery itself, given an already-resolved, already-ordered games
 * list (newest-first per `listGames()`'s ordering contract): recovers
 * `games[0]` via `recoverSim`, applies it to the live `sim` in place, and
 * submits the replay-visible marker. Shared by `recoverOnBoot` (which
 * filters `gamesBeforeBoot` -- see that constant's comment for why a STALE
 * pre-boot list, not a fresh query, is what a genuine "boot" recovery must
 * use) and the F6 test trigger below (which intentionally does NOT filter
 * or reuse a stale list -- see F6's own comment for why a fresh query is
 * correct there instead).
 */
async function recoverFromGames(games: readonly { id: string }[]): Promise<void> {
  if (games.length === 0) return; // Nothing to recover -- the sim already running is correct.
  const mostRecent = games[0];
  try {
    const { sim: loaded, record } = await recoverSim(store, mostRecent.id, setup);
    sim.restore(loaded.snapshot());
    resetEntityKeyedHostState();
    restoredHash = sim.stateHash();
    await switchLiveGame(record.id, Promise.resolve(record));
    // Same replay-visible marker quickLoad submits (see its doc comment):
    // a host-only hash comparison living only in this closure is
    // invisible to a headless replay of the captured command log, so the
    // fact of a successful recovery — and the hashes involved — has to
    // ride into sim state as a command, exactly like F9's does. This is
    // also how the save-resume gate's F6 test trigger (see the "F6"
    // keydown handler below) makes a boot-path recovery assertable at all
    // without a real page navigation destroying the harness's replay
    // bundle.
    hook.submit(saveRestoreDebugCommand(sim.tick + 1, savedTick ?? -1, savedHash ?? -1, restoredHash));
  } catch (err) {
    if (!(err instanceof RestoreError)) throw err; // Anything else (a store/IDB fault) is a real bug -- surface it.
    // Silent fresh start (see recoverOnBoot's doc comment above) -- the sim
    // already running stays exactly as it is; nothing left to do.
  }
}

async function recoverOnBoot(): Promise<void> {
  loadInFlight = true;
  try {
    // The PRE-BOOT list, never a fresh `store.listGames()` — see
    // `gamesBeforeBoot`'s comment for what recovering this session's own
    // record does.
    await recoverFromGames((await gamesBeforeBoot).filter((g) => g.id !== gameId));
  } finally {
    loadInFlight = false;
  }
}
void recoverOnBoot();

/**
 * The save-resume gate's F6 test trigger (see the "F6" keydown handler
 * below for why a real page reload can't be used to drive this). Unlike
 * `recoverOnBoot`, this reads a FRESH `store.listGames()` and does NOT
 * filter out the current `gameId` -- by the time a player (or a test)
 * presses F6, minutes into a session, the live game's own record is
 * exactly what a real reload's boot path would find and correctly recover
 * (it is no longer the empty, still-being-created record `gamesBeforeBoot`
 * exists to guard against; that race is a boot-instant-only hazard). A
 * fresh query is required here for the SAME reason `gamesBeforeBoot` was
 * introduced in the first place: `gamesBeforeBoot` is a promise resolved
 * exactly once, at module init, from whatever the store held before this
 * session existed -- reusing it here would mean F6 forever "recovers" that
 * same stale, pre-session snapshot (or nothing, on a fresh store) no
 * matter how much has been saved since, silently no-opping every time it
 * is pressed after the first.
 */
async function recoverViaBootPathAgain(): Promise<void> {
  loadInFlight = true;
  try {
    await recoverFromGames(await store.listGames());
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

// -- HUD (render/hud.ts): entry overlay, reticle and interaction prompt.
//    Pure DOM with pointer-events:none, hidden entirely while a terminal is
//    focused so the readability probe never sees it. `locked` and
//    `thirdPerson` are mirrored here because FpsController exposes neither;
//    the mirrors are presentation-only and never reach the sim. --
const hud = createHud();
// Desk feedback stamp (render/desk-stamp.ts): a host-side flash on the
// focused terminal when a check-in resolves, driven by the sim event stream.
const deskStamp = createDeskStamp();
// Escalation-visibility notices (creative-org cycle 5): a rising star tier
// activates new desk procedures (rules.ts, blacklist row at 2 stars) and
// MAILBOX bulletins arrive -- but that change is invisible to a player
// mid-shift. Watch the sim event stream (host-side, zero goldens, same
// pattern as the desk stamp) and surface a readable notice. Deferred until
// the player leaves the terminal, since the change usually fires at the
// midnight audit while the screen is focused (the HUD is hidden then).
let pendingNotice: string | undefined;
let lastStampFrameMs = performance.now();
let thirdPersonMirror = false;
/** The controller's own notion of "locked" (real pointer lock OR the
 *  harness's synthetic lock — both go through applyLockChange and land in
 *  the input trace), so the HUD agrees with what movement is gated on. */
function controllerLocked(): boolean {
  const trace = controller.inputTrace();
  for (let i = trace.length - 1; i >= 0; i--) {
    const entry = trace[i];
    if (entry && entry.kind === "lock") return entry.locked;
  }
  return false;
}
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code === "KeyV" && !e.repeat) thirdPersonMirror = !thirdPersonMirror;
});

/** Hold-to-fast-forward state (host-only; see tickSim). */
const FAST_FORWARD_STEPS = 8;
let fastForwardHeld = false;
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code === "KeyT" && !e.repeat) fastForwardHeld = true;
});
window.addEventListener("keyup", (e: KeyboardEvent) => {
  if (e.code === "KeyT") fastForwardHeld = false;
});
window.addEventListener("blur", () => {
  fastForwardHeld = false;
});

// -- Quality toggle (Q): reload with the opposite worldforceQuality. A true
//    in-place swap would rebuild every scene group and the light rig; a
//    reload is instant, honest, and keeps the pose via the seed. --
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code === "KeyQ" && !e.repeat && !focusedScreen) {
    const url = new URL(window.location.href);
    const cur = url.searchParams.get("worldforgeQuality");
    url.searchParams.set("worldforgeQuality", cur === "low" ? "high" : "low");
    window.location.href = url.toString();
  }
  // Flicker toggle (L): the tier-0 fluorescent/lamp flicker on or off.
  if (e.code === "KeyL" && !e.repeat && !focusedScreen) {
    setFlickerEnabled(!isFlickerEnabled());
  }
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
  // The `draw-calls` / `frame-time-p95` probes (docs/PHASE-H2.md §5F).
  // Read live through a late-bound reference: `createThreeHost` is
  // constructed BELOW this call (it needs `hook.submit`), so the slot
  // cannot capture the host directly. Reporting zeros before the host
  // exists would be worse than reporting nothing, so the probes' own
  // "refuse to report an unmeasured number" guard in the harness sees an
  // empty sample set instead and fails as infra.
  frameStats: (): FrameStats => hostRef?.frameStats() ?? { drawCalls: 0, frameMsSamples: [] },
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
  // Time compression (hold T): extra sim steps in the same host tick. The
  // sim is a pure function of (seed, tick-stamped command log), so running
  // more ticks per frame changes nothing about determinism or replay; it
  // only shortens the real-time wait between the day's beats. Disabled
  // while a screen is focused (typing on the terminal) and never in the
  // harness (the start barrier / synthetic runs never hold the key).
  if (fastForwardHeld && !focusedScreen) {
    for (let i = 1; i < FAST_FORWARD_STEPS; i++) {
      sim.step();
      hook.notifyTick(sim.tick);
    }
  }
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
/** The same guard, for everything H2a added that a player must be able to
 *  click: messes, props, printed resumes on the tray, and candidates. Same
 *  hazard, same reset (see resetEntityKeyedHostState below). */
const registeredUpkeepInteractables = new Set<EntityId>();

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
  registeredUpkeepInteractables.clear();
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
/** Sim ticks after focus at which the ease is forced to 1 (the camera
 *  lands exactly on the target pose). The ease step is per FRAME, so under
 *  a slow renderer (the harness's SwiftShader, or a weak GPU) too few frames
 *  fit between focus and a screenshot tick and the camera is still moving
 *  when the readability probe reads its rectangle later. Tick-gating the
 *  end of the ease makes the settled pose frame-rate independent. */
const FOCUS_SETTLE_TICKS = 8;
let focusStartTick = -1;
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
  if (!hit) {
    // Clicked OFF the screen while focused: leave the terminal and resume
    // play. This is a real user gesture, so requestPointerLock() is
    // honoured immediately -- unlike the Esc path, which the browser
    // refuses for ~1.3s after Escape, leaving the player unlocked and
    // feeling stuck at the desk (reported in live play 2026-09-03).
    hook.submit(screenBlurCommand(sim.tick + 1));
    canvas.requestPointerLock();
    return;
  }
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
  // F6: the save-resume gate's test-only trigger for "reload the page and
  // let the boot path recover" (docs/PHASE-H2.md gate 8). A REAL reload
  // cannot be used to drive this from the harness: installTestHook's
  // commandLog() (packages/renderer-three/src/test-hook.ts) is a plain
  // in-memory array scoped to one page load, and runBrowserMode reads it
  // exactly ONCE, at the end of the whole run, to build the replay bundle
  // (packages/harness/src/browser.ts) -- a real navigation would silently
  // truncate that bundle to whatever ran after the reload, exactly the
  // failure mode this app's quickLoad() doc comment above already explains
  // for F9, generalized to boot itself. F6 sidesteps it the same way
  // quickLoad does: it re-invokes `recoverViaBootPathAgain()` (NOT
  // `recoverOnBoot()` itself -- see that function's own doc comment for
  // why it must read a stale, pre-session games list and F6 must not), in
  // place, against the SAME live `sim` -- so the gate exercises the real
  // recovery code path (listGames() -> recoverSim() -> sim.restore() ->
  // resetEntityKeyedHostState(), the exact sequence recoverOnBoot() also
  // runs) byte-for-byte, without ever discarding the command log a sound
  // --verify-replay depends on. Not reachable outside a harness-driven
  // session in any way that matters: a real player has no reason to press
  // F6, and pressing it is harmless (it just re-recovers whatever the
  // store's most recent game already is).
  if (e.code === "F6") {
    e.preventDefault();
    void recoverViaBootPathAgain();
    return;
  }
  if (!focusedScreen) return;
  if (e.code === "Escape") {
    // Blur only. Do NOT auto re-lock: the browser refuses requestPointerLock
    // for ~1.3s after Escape, so the call would silently fail and strand the
    // player unlocked. Clicking the canvas (a fresh gesture) re-locks; the
    // HUD prompt says so, and clicking off the screen also exits directly.
    hook.submit(screenBlurCommand(sim.tick + 1));
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

// Late-bound so the test hook's frameStats() slot (installed above) can reach
// the host that is constructed below it. `let` rather than `const` because
// the assignment genuinely happens after the declaration.
// eslint-disable-next-line prefer-const
let hostRef: ThreeHost | undefined;

let lightingRig: LightingRig | undefined;
let lightingTier = -1;
const sceneryByTier = new Map<number, THREE.Object3D>();

/** The hotel singleton, read fresh each frame (invariant 4: hosts render,
 *  sims decide -- the tier is sim state the renderer only ever reads). */
function readHotel(world: IWorld): Hotel | undefined {
  for (const entity of world.entities()) {
    const hotel = world.getComponent<Hotel>(entity, "hotel");
    if (hotel) return hotel;
  }
  return undefined;
}

/** True within ~1.5 m of the clerk-side terminal anchor -- the walkthrough's
 *  "walk to the desk" step. Presentation-only distance in mm. */
function playerNearDesk(world: IWorld): boolean {
  const pos = world.getComponent<Pos>(PLAYER_ENTITY, "pos");
  if (!pos) return false;
  const dx = pos.xMm - floor.desk.xMm;
  const dz = pos.zMm - floor.desk.zMm;
  return dx * dx + dz * dz <= 1500 * 1500;
}

// -- Walkthrough (render/walkthrough.ts): event-driven, skippable with H,
//    never blocks input. Reads the sim's event stream incrementally. --
const walkthrough = createWalkthrough();
/** Events are consumed by TICK, not by index: the sim trims its event log
 *  to a retention window, so an index cursor would skip or repeat. */
let walkthroughLastTick = -1;
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.code === "KeyH" && !e.repeat && !focusedScreen) walkthrough.skip();
});

// -- Pointer-lock fallback (render/pointer-fallback.ts): when a sandboxed
//    host refuses pointer lock (the claude.ai artifact iframe does), look
//    follows the hovering cursor instead. Deltas go through the REAL mouse
//    path so the handedness fix in player-fps applies; lock state goes
//    through the same normalizer a real pointerlockchange would. --
/** requestPointerLock that never throws or rejects uncaught (sandboxed
 *  iframes refuse it); the hover-look fallback decides what to do next. */
function requestLockQuietly(): void {
  try {
    const r = (canvas.requestPointerLock as () => void | Promise<void>)();
    if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
  } catch {
    /* refused */
  }
}
installHoverLookFallback(canvas, {
  requestLock: () => requestLockQuietly(),
  isLocked: () => document.pointerLockElement === canvas,
  onLook: (dx, dy) => controller.pointerHandlers.onLook?.(dx, dy),
  setLocked: (locked) => controller.pointerHandlers.onPointerLockChange?.(locked),
});

const host = createThreeHost(sim, {
  canvas,
  // The lighting rig in render/lighting.ts replaces three-host's default
  // ambient + sun; the renderer gets shadows and filmic tone mapping.
  defaultLights: false,
  onRendererCreated(renderer) {
    configureRenderer(renderer);
  },
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
      if (!focusedScreen) focusStartTick = sim.tick;
      focusedScreen = screen;
      focusEase = sim.tick - focusStartTick >= FOCUS_SETTLE_TICKS ? 1 : Math.min(1, focusEase + FOCUS_EASE_STEP);
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
      focusStartTick = -1;
    }

    // HUD state, derived entirely from host-side facts already known here.
    const pointerLocked = controllerLocked();
    const targetEntity = pointerLocked && !focusedScreen ? controller.currentTarget() : undefined;
    const targetKind: InteractableKind | undefined =
      targetEntity !== undefined ? world.getComponent<Interactable>(targetEntity, "interactable")?.kind : undefined;
    // Walkthrough: feed only the events since the last frame.
    const newEvents = sim.eventsSince(walkthroughLastTick + 1);
    if (newEvents.length > 0) walkthroughLastTick = newEvents[newEvents.length - 1]!.tick;
    const nowStampMs = performance.now();
    const stampDtMs = Math.min(100, nowStampMs - lastStampFrameMs);
    lastStampFrameMs = nowStampMs;
    deskStamp.update(newEvents, focusedScreen?.group, stampDtMs);
    for (const e of newEvents) {
      if (e.type === "hotel.starsChanged") {
        const to = (e.payload as { to?: number } | undefined)?.to ?? 0;
        const from = (e.payload as { from?: number } | undefined)?.from ?? 0;
        if (to > from) pendingNotice = "New procedure in effect — check MAILBOX";
      } else if (e.type === "mail.bulletinDelivered" && pendingNotice === undefined) {
        pendingNotice = "New bulletin in your MAILBOX";
      }
    }
    if (pendingNotice !== undefined && !focusedScreen) {
      hud.notice(pendingNotice);
      pendingNotice = undefined;
    }
    const hotelNow = readHotel(world);
    walkthrough.advance({
      tick: sim.tick,
      events: newEvents.map((e) => ({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> })),
      hotel: hotelNow ? { tier: hotelNow.tier, cash: hotelNow.cash, stars: hotelNow.stars, day: hotelNow.day } : undefined,
      nearDesk: playerNearDesk(world),
      renovateCostMinor: hotelNow ? (RENOVATE_COST_MINOR[hotelNow.tier + 1] ?? 0) : 0,
    });
    const hudState: HudState = {
      walkthrough: walkthrough.current(),
      endCard: walkthrough.endCard(),
      phase: focusedScreen ? "focused" : pointerLocked ? "playing" : assetStatus.pending > 0 ? "loading" : "entry",
      locked: pointerLocked,
      thirdPerson: thirdPersonMirror,
      target: targetKind,
      loading: {
        pending: assetStatus.pending,
        ok: assetStatus.texturesOk + assetStatus.modelsOk,
        missing: assetStatus.texturesMissing + assetStatus.modelsMissing,
        manifest: assetStatus.manifest,
      },
    };
    hud.update(hudState);
  },
  syncScene(ctx: SceneContext, world: IWorld, alpha: number) {
    // The building: architecture (walls/floors/trim/desk from the same grid
    // the sim collides against), the street outside, light fixtures and
    // static decor. Built once; textures and glTF models upgrade in place.
    // Keyed by tier: each tier's scenery is built once on first sight and
    // swapped by visibility, so a RENOVATE press changes the building the
    // same frame the sim changes `hotel.tier`.
    const tierNumber = readHotel(world)?.tier ?? 0;
    const hotelTier: HotelTier = tierNumber >= 2 ? 2 : tierNumber === 1 ? 1 : 0;
    const tierGroup = ctx.scenery(`hotel-t${hotelTier}`, () => {
      const g = new THREE.Group();
      g.add(buildArchitecture(floor, hotelTier));
      g.add(buildExterior(floor, hotelTier));
      // Decor before fixtures: both share one RoomOccupancy per room
      // (placement.ts), and paintings must claim wall space before sconces.
      g.add(buildDecor(floor, hotelTier));
      g.add(buildFixtures(floor, hotelTier));
      return g;
    });
    sceneryByTier.set(hotelTier, tierGroup);
    for (const [t, g] of sceneryByTier) g.visible = t === hotelTier;
    if (lightingTier !== hotelTier || !lightingRig) {
      lightingRig?.dispose();
      lightingRig = buildLighting(floor, ctx.scene, ctx.renderer, hotelTier);
      lightingTier = hotelTier;
    }
    const rig: LightingRig = lightingRig;
    rig.update(world, performance.now());

    terminalScreens = syncTerminalScreens(ctx, world, controller.registerInteractable);

    for (const entity of world.entities()) {
      const door = world.getComponent<Door>(entity, "door");
      if (!door) continue;
      const spec = doorSpecByIndex.get(door.doorIndex);
      if (!spec) continue;

      let group = doorGroups.get(entity);
      if (!group) {
        // createDoorLeaf positions the leaf in world space exactly like
        // interiors' generateDoorMesh did (centered on the door span), so
        // the same pivot trick applies: group at the door center, leaf
        // offset by the inverse, rotate the group to swing on the hinge.
        const mesh = createDoorLeaf(spec, { entrance: spec.doorIndex === floor.entranceDoorIndex });
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
    // -- H2a: everything else a player has to be able to see and click --
    //    messes, props, printed resumes on the tray, and candidates.
    //    Registered as interactables the same way doors and guest rigs are;
    //    without this the whole housekeeping/maintenance/hiring layer is
    //    invisible and unclickable in the actual game while every headless
    //    gate stays green.
    const upkeep = syncUpkeepObjects(ctx, world, alpha, controller.registerInteractable, registeredUpkeepInteractables, floor);
    for (const entity of upkeep.live) liveGuests.add(entity);
    pruneCharacters(liveGuests);

    // -- held-document view: docs/PHASE-H1.md "Held-item inspect". --
    syncHeldDocuments(ctx, world, ctx.camera, PLAYER_ENTITY);
    pruneHeldDocuments(world, PLAYER_ENTITY);
  },
});

hostRef = host;

window.addEventListener("beforeunload", () => host.stop());
