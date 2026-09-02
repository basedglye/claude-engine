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
// WHY THE look-lock CONFIG, AND WHY IT IS A QUIET SET
// The spec names "bedroom with mess props" as one of the four signed
// screenshots, and a cold run of the shipped world has no messes in it --
// nobody has checked out yet. `look-lock` (apps/hotel/src/sim/game.ts
// SCENARIO_CONFIGS) pre-dirties the bedroom nearest the lobby at setup, the
// same way `upkeep-click`'s config does, and additionally suppresses BOTH
// guest arrivals and the candidate round.
//
// That second half was not tidiness. Twice, at different stages, a person
// walked into the shot and stood between the camera and the monitor: first
// a guest (the shipped arrival schedule puts one at the desk well inside
// this run's ~130 ticks), then a candidate (they wait at lobby cells beside
// the desk). The reticle raycast resolves against the nearest REGISTERED
// interactable, so the focus click resolved to a PERSON and the terminal
// never focused. It surfaced only as "screenRect() returned undefined", and
// the cause was visible nowhere but in the tick-84 screenshot, which showed
// a purple guest rig filling the frame. An art gate wants a controlled set
// for the same reason a photographer clears one; people have their own
// gates.
//
// The page is driven to the config via ?worldforgeConfig=, and this file's
// own `setup` uses setupNamed with the same name, so the replay sim and the
// live page build the same world -- a mismatch there diverges on tick 1
// with no symptom but exit 3.
//
// DERIVATION OF THE COMMITTED LITERALS
// Every look-pixel and tick literal below came from
// `node apps/hotel/scripts/derive-walk.mjs`, which emits a tick-gated
// script and then PROVES it by replaying it into a fresh sim and reporting
// the achieved pose. Measured, seed hotel-h2-look-1:
//
//   leg 1  --to mess:0 --stop-mm 1400
//          arrives tick 24, 1292mm from the mess, bearing error 104 mdeg,
//          range OK / arc OK, 8 commands
//   leg 2  --to 1375,3625 --stop-mm 1300 --after <leg 1>
//          arrives tick 61 at (2488,3719), 1117mm from the terminal anchor,
//          bearing error 8 mdeg, range OK / arc OK, 11 commands
//
// PITCH. The terminal sits at 1.15m and the eye at 1.6m, so at ~1.1m range
// the screen is below the reticle and a dy of 0 raycasts over it and
// focuses nothing. derive-walk computes the geometric answer and says so,
// but explicitly does NOT verify the reticle raycast, which is a Three.js
// fact about where the quad actually projects. dy 100 was confirmed against
// the running build: the tick-82 screenshot of a failing run showed the
// monitor in frame but slightly above the reticle at dy 120, which is what
// located the working value. Sign convention as reserva-readability
// records it -- positive dy pitches DOWN, 220 mdeg per look pixel.
//
// A NOTE ON A WRONG TURN, KEPT SO IT IS NOT RETAKEN. An earlier revision of
// this gate concluded the monitor faced the wrong way (render/screens.ts
// orients it by a constant measured against the H1b seed) and re-derived
// the walk to stand on the QUEUE side instead. That change was reverted:
// the monitor is reachable from the clerk side exactly as shipped, and the
// real cause of every failure attributed to orientation was elsewhere --
// boot recovery replaying this session's own record over the live world
// mid-walk (fixed in main.ts), plus the people in shot described above.
// The orientation constant may still be worth deriving rather than
// committing, but it is NOT what was breaking this gate, and re-litigating
// it from these symptoms would waste the same afternoon twice.
//
// SCREENSHOT ORDER IS LOad-BEARING. The `screen-readability` probe analyses
// the MOST RECENTLY captured screenshot (packages/harness/src/browser.ts),
// so the focused-terminal capture must be last. The other three are the
// look-lock's evidence, not the probe's input.
import { setupNamed } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h2-look-1";
const CONFIG = "look-lock";

// SHOT TICKS, AND WHY EACH ONE SITS INSIDE A LONG HOLD.
//
// The H2b review found that three of the four committed screenshots did not
// reproduce: the harness requests a tick and captures at or after it, so a
// shot taken mid-stride lands on a different pose every run (measured:
// requested 26 -> actual 26, 29 and 32 across three runs; only the
// stationary terminal shot was byte-identical). A look-lock whose evidence
// cannot be re-captured is not a lock -- nothing can be diffed against it
// later to prove the look has not moved.
//
// TWO THINGS CAUSED THAT DRIFT, AND BOTH ARE HANDLED HERE.
//
// 1. The shot was taken while walking. The walk now STOPS at each of the
//    three world poses and holds still; the camera is motionless for the
//    whole window a capture can land in, so drift cannot change the frame.
//
// 2. Capturing is itself slow, and the capture loop is SERIAL
//    (packages/harness/src/browser.ts: pollUntilTick -> page.screenshot, in
//    order). Under headless SwiftShader one `page.screenshot()` costs
//    27-37 ticks of wall clock, so each capture pushes the NEXT request
//    late. A first attempt at this fix used ~10-tick holds and still
//    drifted 54 -> 70, straight through the hold and into the next leg.
//    The holds below are therefore ~60+ ticks with each shot near the START
//    of its hold. Drift only ever runs late, never early, so that margin is
//    one-sided. Measured after the fix: 8->8, 85->85, 155->155, 300->301.
//
// FOCUS EASE IS THE SAME PROBLEM WEARING A DIFFERENT HAT. The focused
// screen view only snaps square-on to the quad once `focusEase` reaches 1,
// and that easing is per-RENDERED-FRAME (main.ts FOCUS_EASE_STEP = 0.12,
// so ~9 frames), not per tick. On hardware that is ~0.15s; under headless
// SwiftShader, where this gate measures ~10fps, it is closer to a FULL
// SECOND -- ~18 ticks. Capturing the terminal 7 ticks after the click gave
// a half-eased camera: the screen skewed, half behind the desk, and the
// readability probe read calibContrast 0 because `screenRect()` (sampled
// after the run, fully eased) described a quad the pixels did not contain.
// SHOT_TERMINAL therefore sits ~47 ticks after the click.
//
// If a leg is ever re-derived, the shot must stay inside its hold with the
// margin intact. The run is ~360 ticks (~18s) for this reason; that is the
// price of evidence that reproduces, and this gate is not on a hot path.
const SHOT_LOBBY = 10; //    hold: ticks 0..59    (no input at all before it)
const SHOT_CORRIDOR = 85; // hold: ticks 68..129
const SHOT_BEDROOM = 165; // hold: ticks 147..248 (pitch lands at 150)
const FOCUS_CLICK_TICK = 298;
const SHOT_TERMINAL = 345; // hold: ticks 298..end

// Pitch, in look pixels; positive is DOWN at 220 mdeg/px (reserva-readability's
// recorded convention). derive-walk computes these geometrically from the
// target height and range and prints them, but does NOT verify the reticle
// raycast -- see this file's header.
const PITCH_BEDROOM = 210; // onto a 0.25m mess at 1292mm
const PITCH_TERMINAL = 100; // onto the 1.15m screen at 1111mm

/** Shot 1 -- the LOBBY, from the spawn, facing the way the player spawns
 *  (yaw 0, due south). No input at all precedes it, so this pose is exact
 *  on every engine and every run.
 *
 *  WHY THIS DIRECTION, MEASURED RATHER THAN CHOSEN. A scouting run shot all
 *  four cardinal directions from this spawn and compared them: south is the
 *  only one that reads as architecture. It looks across the lobby and
 *  THROUGH the corridor doorway, so the frame carries a door frame, a
 *  receding floor and a ceiling edge -- layered depth. East is a bare
 *  corner, north is a flat door panel, and west (down the lobby's 10m
 *  length, which is what "lobby wide" naively suggests) is a near-featureless
 *  field, because an empty 5.5m room ending in a flat far wall has nothing
 *  in it to read. The previous revision's lobby shot walked south while
 *  capturing and landed one metre from the south wall.
 *
 *  The general rule that scouting established, worth keeping: with no
 *  surface detail at gameplay distance, THIS look only reads where a frame
 *  contains an opening and layered depth. Flat-on views of large surfaces
 *  render as untextured fields whatever the room actually is. */
const LEG_1_LOBBY = [];

/** Shot 2 -- the CORRIDOR, from its mouth, looking down its 5.25m run.
 *  Derived: --to 5250,9500 --stop-mm 5200 (walks ~1.4m south of spawn and
 *  turns to face along the corridor). Ends tick 8 at (5875,4525) yaw 352740.
 *
 *  Standing deep INSIDE the corridor was tried and rejected: the side walls
 *  are ~1m away and fill the frame at an oblique angle, which is the
 *  polygon-soup case above. From the mouth the doorway frames the run. */
const LEG_2_CORRIDOR = [
  { key: "KeyW", downAtTick: 60, upAtTick: 67 },
  { pointer: "look", atTick: 67, dx: -33, dy: 0 },
];

/** Shot 3 -- the BEDROOM (room 3), pre-dirtied by the `look-lock` config,
 *  with the mess on the floor ahead.
 *  Derived: --to mess:0 --stop-mm 1300 --start-tick 130.
 *  Ends tick 147 at (3466,5318), 1292mm from the mess, pitch 210.
 *
 *  STOP DISTANCE IS THE FRAMING, AND IT IS A COMPROMISE. Backing off to
 *  1831mm gives a gentler 34-degree look-down that holds more of the room,
 *  but at that range the camera stands at x3986 -- OUTSIDE room 3's east
 *  wall (the room spans x375..3875) -- and the wall occludes the mess
 *  entirely. That was measured, not guessed: the 1831mm frame contains no
 *  mess at all. 1292mm puts the camera inside the room with the mess in
 *  frame, which is what "bedroom with mess props" has to mean. */
const LEG_3_BEDROOM = [
  { pointer: "look", atTick: 130, dx: 33, dy: 0 },
  { key: "KeyW", downAtTick: 130, upAtTick: 132 },
  { pointer: "look", atTick: 132, dx: -162, dy: 0 },
  { key: "KeyW", downAtTick: 132, upAtTick: 136 },
  { pointer: "look", atTick: 136, dx: -234, dy: 0 },
  { key: "KeyW", downAtTick: 136, upAtTick: 141 },
  { pointer: "look", atTick: 141, dx: -95, dy: 0 },
  { key: "KeyW", downAtTick: 141, upAtTick: 146 },
  { pointer: "look", atTick: 146, dx: -65, dy: 0 },
  // Pitch down onto the mess for the shot, then back to level before
  // walking on -- pitch is presentation and persists, so leaving it in
  // would add to the terminal leg's own pitch and raycast into the floor.
  { pointer: "look", atTick: 150, dx: 0, dy: PITCH_BEDROOM },
  { pointer: "look", atTick: 249, dx: 0, dy: -PITCH_BEDROOM },
];

/** Shot 4 -- the focused TERMINAL, from the desk.
 *  Derived: --to 1375,3625 --stop-mm 1300 --start-tick 255.
 *  Ends tick 292 at (2488,3719), 1111mm from the anchor, and the tool
 *  reports range OK / arc OK -- i.e. the sim would accept the interact,
 *  which is what the focus click below then proves through the real
 *  reticle raycast. */
const LEG_4_TERMINAL = [
  { pointer: "look", atTick: 255, dx: -756, dy: 0 },
  { key: "KeyW", downAtTick: 255, upAtTick: 260 },
  { pointer: "look", atTick: 260, dx: 87, dy: 0 },
  { key: "KeyW", downAtTick: 260, upAtTick: 265 },
  { pointer: "look", atTick: 265, dx: 262, dy: 0 },
  { key: "KeyW", downAtTick: 265, upAtTick: 269 },
  { pointer: "look", atTick: 269, dx: 133, dy: 0 },
  { key: "KeyW", downAtTick: 269, upAtTick: 274 },
  { pointer: "look", atTick: 274, dx: 402, dy: 0 },
  { key: "KeyW", downAtTick: 274, upAtTick: 291 },
  { pointer: "look", atTick: 291, dx: -3, dy: 0 },
];

export default {
  name: "art-lock",
  seed: SEED,
  ticks: 360,
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
      ...LEG_1_LOBBY,
      ...LEG_2_CORRIDOR,
      ...LEG_3_BEDROOM,
      ...LEG_4_TERMINAL,
      // Pitch down onto the monitor, then click it. Split from the walk's
      // final yaw correction so the pose is settled before the raycast --
      // a click on the same tick as a look is a click against last frame's
      // camera.
      { pointer: "look", atTick: 294, dx: 0, dy: PITCH_TERMINAL },
      { pointer: "click", atTick: FOCUS_CLICK_TICK },
    ],
    screenshotAtTicks: [SHOT_LOBBY, SHOT_CORRIDOR, SHOT_BEDROOM, SHOT_TERMINAL],
    probes: [
      { probe: "screen-readability", appId: "reserva" },
      { probe: "frame-time-p95" },
      { probe: "draw-calls" },
      { probe: "sim-tick-ms" },
    ],
    timeoutMs: 90000,
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
    // ARCHITECTURE B6 / spec section 11 item 4. A draw-call COUNT is
    // hardware-independent, so this one is the spec's number verbatim.
    "drawCalls.max": { max: 300 },
    // FRAME TIME IS SCOPED, AND THE SCOPE IS THE HONEST PART.
    //
    // The spec's budget is p95 <= 16.7 ms — the 60fps promise, and it is a
    // HARDWARE target. This gate does not run on hardware: the harness
    // launches headless Chromium with --use-angle=swiftshader, a software
    // rasteriser, because that is the only configuration in which Three's
    // shaders compile at all in CI (without those flags the canvas comes up
    // blank with no console error). 16.7 ms is not reachable there by any
    // amount of optimisation, and asserting it would mean a permanently red
    // gate that everyone learns to ignore — which is worse than no gate.
    //
    // Measured on this machine, five runs of this scenario after the H2b
    // art pass: p95 86.5 / 96.3 / 106.2 / 108.1 / 114.7 ms (avg ~40 ms
    // over ~150 frames per run). The ceiling below is ~1.5x the observed
    // maximum: loose enough that ordinary scheduling noise never reds it,
    // tight enough that anything approaching a doubling of software render
    // cost does.
    //
    // What this gate therefore claims: "the software-rendered frame cost
    // has not regressed". What it does NOT claim, and what no CI run on
    // this harness can: that the game hits 60fps on a GPU. That number
    // needs a hardware run, and it belongs in the look-lock sign-off
    // alongside the human screenshot review, where a real machine is
    // already in the loop.
    "frameTimeP95.p95Ms": { max: 170 },
    // ARCHITECTURE B8's sim budget, checked here too because the art pass
    // must not have quietly moved sim cost around.
    "simTickMs.avgMs": { max: 5 },
  },
};
