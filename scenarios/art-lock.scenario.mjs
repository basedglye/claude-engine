// art-lock -- Phase H2b gate 7 (docs/PHASE-H2.md section 13, "H2b gates",
// and section 11, "The art look-lock -- a gate, not an opinion").
//
// WHAT THIS GATE IS FOR
// H2b puts a PS1 look on the entire hotel: a dithered 32-colour atlas at
// 64 px/m, planar UVs, baked vertex-colour lighting, vertex jitter and an
// affine UV warp. Exactly one surface class must be EXEMPT -- the
// surface-ui screen quad -- because affine warp on an 8x8 bitmap font
// destroys the one thing the whole game is played through
// (apps/hotel/docs/ARCHITECTURE.md B6). H1b measured what breaking that
// costs: mip filtering alone collapsed the calibration contrast from 241
// to 41 while the screen still looked colourful.
//
// So this gate walks the shipped build through the four poses the look-lock
// is signed against, and then measures the screen WITH THE SHADER LIVE ON
// EVERYTHING ELSE, against H1b's unchanged thresholds. A jitter or warp
// leaking onto the quad fails it mechanically rather than aesthetically.
// The frame-time and draw-call budgets ride along in the same verdict.
//
// WHAT IT CANNOT GATE, SAID OUT LOUD
// "Charming, not programmer art" has no probe, and inventing one would be a
// fake gate. Section 11 splits the lock honestly: the mechanical half is
// here and in packages/interiors' atlas/texel unit tests; the human half is
// a named review step where Chris drives the build and views these four
// screenshots, after which look-lock.ts is frozen behind a review turn.
//
// WHY THE upkeep-demo CONFIG
// The spec names "bedroom with mess props" as one of the four signed
// screenshots, and a cold run of the shipped world has no messes in it --
// nobody has checked out yet. `upkeep-demo` (apps/hotel/src/sim/game.ts
// SCENARIO_CONFIGS) is the same committed config `upkeep-click` uses: it
// pre-dirties the bedroom nearest the lobby at setup. The page is driven to
// it via ?worldforgeConfig=, and this file's own `setup` uses setupNamed
// with the same name, so the replay sim and the live page build the same
// world -- a mismatch there diverges on tick 1 with no symptom but exit 3.
//
// DERIVATION OF THE COMMITTED LITERALS
// Every look-pixel and tick literal below came from
// `node apps/hotel/scripts/derive-walk.mjs`, which emits a tick-gated
// script and then PROVES it by replaying it into a fresh sim and reporting
// the achieved pose. Measured, seed hotel-h2-look-1, config upkeep-demo:
//
//   leg 1  --to mess:0 --stop-mm 1400
//          arrives tick 24, 1292mm from the mess, bearing error 104 mdeg,
//          range OK / arc OK, 8 commands
//   leg 2  --to 1375,3625 --stop-mm 1300 --after <leg 1>
//          arrives tick 61 at (2488,3719), 1117mm from the terminal
//          anchor, bearing error 8 mdeg, range OK / arc OK, 11 commands
//
// PITCH. The terminal sits at 1.15m and the eye at 1.6m, so at ~1.1m range
// the screen is well below the reticle and a dy of 0 raycasts over it and
// focuses nothing. derive-walk computes the geometric answer (100px down)
// but explicitly does NOT verify the reticle raycast, which is a Three.js
// fact about where the quad actually projects -- reserva-readability's
// header records the same caveat and the same sign convention (positive dy
// pitches DOWN, 220 mdeg per look pixel). 100 was confirmed against the
// running build.
//
// SCREENSHOT ORDER IS LOad-BEARING. The `screen-readability` probe analyses
// the MOST RECENTLY captured screenshot (packages/harness/src/browser.ts),
// so the focused-terminal capture must be last. The other three are the
// look-lock's evidence, not the probe's input.
import { setupNamed } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h2-look-1";
const CONFIG = "upkeep-demo";

// Ticks the four signed screenshots are taken at. Named, because the review
// step refers to them by name and a bare number in a diff says nothing.
const SHOT_LOBBY = 3;
const SHOT_CORRIDOR = 16;
const SHOT_BEDROOM = 26;
const FOCUS_CLICK_TICK = 65;
const SHOT_TERMINAL = 72;

/** Derived leg 1: spawn -> the pre-dirtied bedroom, ending looking at a mess. */
const LEG_1 = [
  { key: "KeyW", downAtTick: 0, upAtTick: 9 },
  { pointer: "look", atTick: 9, dx: -162, dy: 0 },
  { key: "KeyW", downAtTick: 9, upAtTick: 13 },
  { pointer: "look", atTick: 13, dx: -234, dy: 0 },
  { key: "KeyW", downAtTick: 13, upAtTick: 18 },
  { pointer: "look", atTick: 18, dx: -95, dy: 0 },
  { key: "KeyW", downAtTick: 18, upAtTick: 23 },
  { pointer: "look", atTick: 23, dx: -65, dy: 0 },
]

/** Derived leg 2: bedroom -> back to the front desk, facing the terminal. */
const LEG_2 = [
  { pointer: "look", atTick: 24, dx: -756, dy: 0 },
  { key: "KeyW", downAtTick: 24, upAtTick: 29 },
  { pointer: "look", atTick: 29, dx: 87, dy: 0 },
  { key: "KeyW", downAtTick: 29, upAtTick: 34 },
  { pointer: "look", atTick: 34, dx: 262, dy: 0 },
  { key: "KeyW", downAtTick: 34, upAtTick: 38 },
  { pointer: "look", atTick: 38, dx: 133, dy: 0 },
  { key: "KeyW", downAtTick: 38, upAtTick: 43 },
  { pointer: "look", atTick: 43, dx: 402, dy: 0 },
  { key: "KeyW", downAtTick: 43, upAtTick: 60 },
  { pointer: "look", atTick: 60, dx: -3, dy: 0 },
];

export default {
  name: "art-lock",
  seed: SEED,
  ticks: 80,
  setup: (sim) => setupNamed(sim, CONFIG),
  assertions: [
    {
      description:
        "the player holds terminal focus -- the click resolved through the real reticle raycast and the sim revalidated range and arc, so the readability probe below is measuring a genuinely focused screen rather than a lucky camera pose",
      check: (s) => {
        for (const e of s.entities()) {
          const t = s.getComponent(e, "terminal");
          if (t) return t.focusedBy === "player";
        }
        return false;
      },
    },
    {
      description:
        "no screen.denied and no interact-denied events -- the focus click passed the sim's own proximity and facing revalidation",
      check: (s) =>
        !s.eventsSince(0).some((e) => e.type === "screen.denied" || e.type === "interact-denied"),
    },
    {
      description:
        "the pre-dirtied bedroom still holds its messes at the end of the run -- the bedroom screenshot the look-lock is signed against has actual mess props in it, rather than being an empty room that happens to render",
      check: (s) => {
        let messes = 0;
        for (const e of s.entities()) if (s.getComponent(e, "mess")) messes++;
        return messes >= 2;
      },
    },
    {
      description:
        "a broken prop exists -- the same screenshot shows the maintenance verb's subject, which H2b restyles and Phase 3 builds on",
      check: (s) => {
        for (const e of s.entities()) {
          const p = s.getComponent(e, "prop");
          if (p && p.broken) return true;
        }
        return false;
      },
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    configName: CONFIG,
    input: [
      { pointer: "lock", atTick: 0 },
      ...LEG_1,
      ...LEG_2,
      // Pitch down onto the monitor, then click it. Split from the walk's
      // final yaw correction so the pose is settled before the raycast --
      // a click on the same tick as a look is a click against last frame's
      // camera.
      { pointer: "look", atTick: 62, dx: 0, dy: 100 },
      { pointer: "click", atTick: FOCUS_CLICK_TICK },
    ],
    screenshotAtTicks: [SHOT_LOBBY, SHOT_CORRIDOR, SHOT_BEDROOM, SHOT_TERMINAL],
    probes: [
      { probe: "screen-readability", appId: "reserva" },
      { probe: "frame-time-p95" },
      { probe: "draw-calls" },
      { probe: "sim-tick-ms" },
    ],
    timeoutMs: 45000,
  },
  feelTargets: {
    // UNCHANGED from reserva-readability. That is the point: these are
    // H1b's numbers, re-measured with the PS1 shader live on every other
    // surface in the frame. If jitter or affine warp reached the quad they
    // would move, and H1b's own perturbation evidence (mip filtering alone
    // took contrast 241 -> 41) is the calibration for how hard they move.
    "screenReadability.texelScale": { min: 1.0 },
    "screenReadability.calibContrast": { min: 60 },
    "screenReadability.calibPitchErr": { max: 0.1 },
    // ARCHITECTURE B6 / spec section 11 item 4.
    "drawCalls.max": { max: 300 },
    "frameTimeP95.p95Ms": { max: 16.7 },
    // ARCHITECTURE B8's sim budget, checked here too because the art pass
    // must not have quietly moved sim cost around.
    "simTickMs.avgMs": { max: 5 },
  },
};
