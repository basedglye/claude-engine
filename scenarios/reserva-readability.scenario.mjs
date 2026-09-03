// reserva-readability -- Phase H1b gate 5 (docs/PHASE-H1.md, "Exit
// criteria" and "Readability as a gate").
//
// WHAT THIS GATE IS FOR
// The whole premise of GRAND FOYER is that you manage the hotel by reading a
// screen inside the world. So "the screen renders" is not the bar; "a human
// could read it" is. This gate walks the player to the front desk, focuses
// the terminal, switches apps on it by clicking the in-world screen, and
// then measures the rendered monitor against the legibility floor
// apps/hotel/docs/ARCHITECTURE.md B7 sets: at least one screen pixel per
// surface texel, plus a 1-texel calibration checkerboard whose alternation
// survives. A blurred, mip-filtered, mis-scaled or warped screen collapses
// that checkerboard even while looking colourful, which is how this fails on
// *illegible* rather than merely on *blank*.
//
// TICK-GATED, NOT WALL-CLOCK
// Every input step below waits on window.__WORLDFORGE__.world.tick, and the
// app starts held at tick 0 by the start barrier. docs/reviews/phase-H0.md
// rounds 2-3 are the reason: wall-clock steps made the H0 gate land on 8 or 9
// move ticks depending on scheduling, which produced a "green streak over a
// varying command count" that two separate reports called passing and that
// did not reproduce. The bar is a CONSTANT command count per engine.
//
// DERIVATION OF THE COMMITTED LITERALS (seed hotel-h1-look-1)
// Cycle 3 re-derivation (lobby deepened -- see fps-look-interact's header
// for why this is not a pure translation): apps/hotel/scripts/derive-walk.mjs
//   node apps/hotel/scripts/derive-walk.mjs hotel-h1-look-1 desk-terminal
//   player spawn      (5625, 4375), yaw 0
//   terminal anchor   (2732, 4611) [floor.desk.xMm/zMm], radiusMm 1500,
//                      arcMdeg 60000
//   bearing to it      276700 mdeg
// player-fps turns at 220 mdeg per look-px:
//   dx1Px = round(angleDeltaMdeg(276700, 0)/220) = -379 -> camYaw 276620
// The script probes hold durations 1..20 ticks (moveCommand forwardMilli
// =1000 each tick) through the REAL compiled sim and takes the first whose
// rest position is inside the terminal's interact range AND arc after a
// corrective look: N=14, landing at (2853, 4697), 1489mm from the
// terminal (just inside the 1500mm radius).
//   bearing2 = 276800 mdeg -> dx2Px = round(angleDeltaMdeg(276800,
//   276620)/220) = 1 -> camYaw 276840
// PROOF: replaying face(276620)+move(1000,0) ticks 1..14, then
// face(276840) and interact(terminalEntity) at tick 15 into a fresh Sim
// left the terminal's component as {station:"frontdesk",
// focusedBy:"player"} -- the click resolves and the sim accepts focus.
//
// PITCH IS REQUIRED, AND ITS SIGN WAS MEASURED
// The monitor sits at 1.15m and the eye at 1.6m, so at ~1.3m range the
// screen is ~20 degrees BELOW the reticle -- with dy 0 the click raycasts
// over the top of it and focuses nothing. Probed live, dy +45 and +89 both
// focus and dy -45/-89 do not (positive dy pitches down). dy 70 sits in the
// middle of the measured working band.
//
// THE APP SWITCH IS DELIBERATE
// RESERVA is the shell's default open app, so clicking its taskbar button
// from a cold start would assert nothing -- openAppId would read "reserva"
// whether or not the click did anything, which is exactly the vacuous-gate
// shape docs/reviews/phase-H0.md round 1 blocked on. So the script clicks
// AUDIT first and RESERVA second: the final openAppId is only "reserva"
// because two in-world screen clicks landed where they were aimed, and the
// screen.appOpened assertion pins the app id rather than accepting any
// switch.
//
// Taskbar rects come from the shell's own layout() -- the same pure integer
// function paintSpec places from and reduce hit-tests against -- so these
// UVs cannot drift from where the buttons are drawn:
//   taskbar:reserva {x:4,  y:460, w:80, h:16} -> centre u 0.0688 v 0.0250
//   taskbar:audit   {x:88, y:460, w:80, h:16} -> centre u 0.2000 v 0.0250
import { setup } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h1-look-1";
const WALK_TICKS = 14;
const LOOK_DX = -379;
const LOOK_DY = 70;
const RESERVA_UV = { u: 0.0688, v: 0.025 };
const AUDIT_UV = { u: 0.2, v: 0.025 };

/** The shell state lives verbatim in the terminal's `screenApp` component. */
function shellState(s) {
  for (const e of s.entities()) {
    const app = s.getComponent(e, "screenApp");
    if (app) return app.state;
  }
  return undefined;
}

export default {
  name: "reserva-readability",
  seed: SEED,
  ticks: 60,
  setup,
  assertions: [
    {
      description: "the player holds terminal focus (interact resolved through the reticle raycast, and the sim revalidated range and arc)",
      check: (s) => {
        for (const e of s.entities()) {
          const t = s.getComponent(e, "terminal");
          if (t) return t.focusedBy === "player";
        }
        return false;
      },
    },
    {
      description: 'the shell has RESERVA open -- reached by clicking AUDIT then RESERVA on the in-world screen, so this cannot read "reserva" by default',
      check: (s) => shellState(s)?.openAppId === "reserva",
    },
    {
      description: 'a screen.appOpened event with appId "audit" was emitted (the first screenClick actually switched apps)',
      check: (s) =>
        s.eventsSince(0).some((e) => e.type === "screen.appOpened" && e.payload && e.payload.appId === "audit"),
    },
    {
      description: 'a screen.appOpened event with appId "reserva" was emitted (the second screenClick switched back)',
      check: (s) =>
        s.eventsSince(0).some((e) => e.type === "screen.appOpened" && e.payload && e.payload.appId === "reserva"),
    },
    {
      description: "no screen.denied events -- every screen click passed the sim's focus and proximity revalidation",
      check: (s) => !s.eventsSince(0).some((e) => e.type === "screen.denied"),
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    input: [
      { pointer: "lock", atTick: 0 },
      // Turn toward the terminal and pitch down onto it, while the start
      // barrier still holds the sim at tick 0 -- so tick 1 already moves in
      // the right direction.
      { pointer: "look", atTick: 0, dx: LOOK_DX, dy: LOOK_DY },
      { key: "KeyW", downAtTick: 0, upAtTick: WALK_TICKS },
      // Focus the terminal by clicking it: the host raycasts, the sim
      // revalidates range and arc, per the H0 anti-cheat posture.
      { pointer: "click", atTick: WALK_TICKS + 4 },
      { pointer: "screenClick", atTick: WALK_TICKS + 10, u: AUDIT_UV.u, v: AUDIT_UV.v },
      { pointer: "screenClick", atTick: WALK_TICKS + 16, u: RESERVA_UV.u, v: RESERVA_UV.v },
    ],
    screenshotAtTicks: [WALK_TICKS + 22],
    probes: [{ probe: "screen-readability", appId: "reserva" }, { probe: "sim-tick-ms" }],
    timeoutMs: 30000,
  },
  feelTargets: {
    // The architectural floor, measured rather than hoped: below 1 texel per
    // surface pixel the 8x8 font cannot resolve. The live focus pose reads
    // ~1.38 at 1280x720 and ~1.15 at 900x600, so 1.0 leaves real headroom
    // without being loose enough to admit a blurred screen.
    "screenReadability.texelScale": { min: 1.0 },
    "screenReadability.calibContrast": { min: 60 },
    "screenReadability.calibPitchErr": { max: 0.1 },
    "simTickMs.avgMs": { max: 10 },
  },
};
