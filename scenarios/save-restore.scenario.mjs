// save-restore -- Phase H1b gate 4 (docs/PHASE-H1.md gate 4, "Exit
// criteria"). Proves the browser WIRING of @claude-engine/save-web into
// apps/hotel: F5 quick-saves via createSavePump.snapshotNow() +
// exportSave(), F9 quick-loads by importSave()-ing that frozen JSON as a
// brand-new game id and recoverSim()-ing it, then applying the result to
// the LIVE sim in place via Sim.restore() (apps/hotel/src/main.ts's
// quickLoad() -- see its doc comment for why in-place, not a page reload
// or a swapped Sim object). The headless companion half of this gate
// (packages/save-web/scripts/test.mjs) already proves the store itself by
// round-tripping the real compiled hotel sim through webStore +
// createSavePump + recoverSim at a mid-check-in boundary; this scenario
// proves the browser can actually drive that path end to end.
//
// TICK-GATED, NOT WALL-CLOCK (H0 deferral rule 6, restated for H1B) -- every
// input step below is gated on window.__WORLDFORGE__.world.tick via the
// start barrier, per docs/reviews/phase-H0.md rounds 2-3.
//
// WHY THE ASSERTION READS SIM STATE, NOT A HOOK PROBE
// docs/PHASE-H1.md gate 4 says "the hotel records {savedTick, savedHash,
// restoredHash} into a hook slot; a save-restore probe reads it." A NEW
// probe kind is packages/harness territory, out of this task's scope
// (apps/hotel + this scenario file only). packages/harness/src/cli.ts's
// runBrowserMode evaluates a browser scenario's `assertions` against a
// FRESH headless Sim built by replaying the captured command log
// (window.__WORLDFORGE__.commandLog()) through scenario.setup() -- so a
// host-only value (a hash comparison living only in main.ts's closures) is
// invisible to it no matter what. The fix used here: quickLoad() submits
// ONE command, `debug.saveRestoreRecord` (apps/hotel/src/sim/game.ts's
// saveRestoreDebugCommand), through hook.submit() right after a quick-load
// completes, carrying {savedTick, savedHash, restoredHash} as its payload.
// A small additive system (saveRestoreDebugSystem) stores that payload into
// a `saveRestoreDebug` singleton component, created LAZILY -- only when
// that command is actually submitted, so every OTHER scenario (none of
// which ever press F5/F9) has zero extra entities and an unperturbed
// stateHash; verified against corridor-headon/checkin-rush/fraud-catch/
// walk-collide's golden hashes, all unchanged by this addition. The
// assertions below then read that component off the REPLAYED sim, which is
// "an assertion over recorded state" -- the command is recorded (WAL-queued
// and present in the replay bundle) exactly like any other player command.
//
// DERIVATION OF THE COMMITTED LITERALS (seed hotel-h1-save-1)
// A throwaway script (node, importing the built apps/hotel/dist-game/sim/
// game.js and packages/core/dist, run from outside this repo's source
// tree) constructed a real Sim for this seed, called setup(), and stepped
// it 100 ticks while submitting a forward "move" command every tick
// (mirroring a held KeyW), printing player pos + stateHash() at several
// ticks:
//   spawn: { xMm: 5875, zMm: 3375 }, yaw 0
//   tick 1:  { xMm: 5875, zMm: 3575 }              hash 4071970922
//   tick 10: { xMm: 5875, zMm: 4375 } (pinned)      hash 3401183333
//   tick 40: { xMm: 5875, zMm: 4375 }               hash 3308430067
//   tick 90: { xMm: 5875, zMm: 4375 }               hash 1766358549
// The player is pinned against a wall by ~tick 10 (due-north spawn facing,
// yaw 0, straight into the lobby's interior), so WALK_TICKS below is
// intentionally generous (30, then 42-80) rather than tuned to a moving
// endpoint -- what matters for this gate is NOT where the player ends up,
// it's that the world (guests spawning/queueing/walking under
// guestSpawnSystem/guestBrainSystem/pathSystem, none of which need player
// input) keeps changing stateHash() every single tick sampled above, so a
// broken "quick load" that silently no-ops (or that reverts to the WRONG
// point) is guaranteed to produce a stateHash mismatch rather than an
// accidental match -- see "PROVING NON-VACUOUSNESS" below.
//
// F5 (tick 40) and F9 (tick 90) both land in a command-quiet window (KeyW
// is released at tick 30 and not pressed again until tick 42; released
// again at 80, not pressed again before 90) -- deliberately, so the pump's
// write-ahead queue is fully flushed and idle by the time quickSave()'s
// exportSave() reads the store, and there is no player-input race between
// "the command that triggered the save" and "the state exportSave actually
// captures."
//
// PROVING NON-VACUOUSNESS (task requirement, verified by hand, not just
// asserted here): every assertion below explicitly guards against the
// saveRestoreDebug component being absent (F9 never having run, or having
// silently failed) BEFORE comparing hashes -- an absent-vs-absent
// undefined!==undefined pass is impossible because `check` requires the
// component to exist first. Verified live, twice, by breaking the gate and
// confirming it reds:
//   1. Commented out the F9 input step entirely -> saveRestoreDebug is
//      never created -> assertion 1 ("a quick-load happened") fails ->
//      exit 1.
//   2. Temporarily neutered quickLoad() in main.ts (commented out
//      `sim.restore(loaded.snapshot())`, leaving restoredHash computed from
//      the UN-restored, still-at-tick-90 live sim) -> the marker command
//      IS recorded (assertion 1 still passes) but savedHash !==
//      restoredHash -> assertion 2 fails -> exit 1. Both reverted before
//      committing.
import { setup } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h1-save-1";
const WALK_TICKS_1 = 30;
const F5_TICK = 40;
const WALK_TICKS_2_START = 42;
const WALK_TICKS_2_END = 80;
const F9_TICK = 90;
// Comfortable margin past F9_TICK: quickLoad() rewinds the live sim's tick
// counter back to whatever tick F5 actually landed on (see the doc comment
// above main.ts's quickLoad -- the load is asynchronous and races the
// live tick, so the exact saved tick is not pinned to F5_TICK), then
// tickSim() resumes stepping forward from there. This tick also forces the
// harness to poll (pollUntilTick) until the sim has had time to apply the
// post-restore saveRestoreDebugCommand, rather than reading finalState the
// instant the F9 keydown is dispatched, before the (async) quick-load has
// necessarily even started.
const SETTLE_TICK = 150;

function saveRestoreDebug(s) {
  for (const e of s.entities()) {
    const d = s.getComponent(e, "saveRestoreDebug");
    if (d) return d;
  }
  return undefined;
}

export default {
  name: "save-restore",
  seed: SEED,
  ticks: SETTLE_TICK,
  setup,
  assertions: [
    {
      description: "a quick-load actually ran: the saveRestoreDebug marker exists (F9 was pressed, quickLoad() completed, and the resulting command was submitted and replayed)",
      check: (s) => saveRestoreDebug(s) !== undefined,
    },
    {
      description: "the recorded hashes are real numbers, not a degenerate placeholder -- guards against a vacuous undefined-vs-undefined pass",
      check: (s) => {
        const d = saveRestoreDebug(s);
        return d !== undefined && typeof d.savedHash === "number" && typeof d.restoredHash === "number";
      },
    },
    {
      description: "restoredHash === savedHash: F9 reverted the live sim to exactly the F5 point, discarding the walking that happened in between (the world keeps changing every tick via guest spawn/queue/nav even with no player input, so a no-op or wrong-point 'load' provably produces a mismatch here rather than an accidental match)",
      check: (s) => {
        const d = saveRestoreDebug(s);
        return d !== undefined && d.savedHash === d.restoredHash;
      },
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    input: [
      { pointer: "lock", atTick: 0 },
      { key: "KeyW", downAtTick: 0, upAtTick: WALK_TICKS_1 },
      { key: "F5", downAtTick: F5_TICK, upAtTick: F5_TICK },
      { key: "KeyW", downAtTick: WALK_TICKS_2_START, upAtTick: WALK_TICKS_2_END },
      { key: "F9", downAtTick: F9_TICK, upAtTick: F9_TICK },
    ],
    screenshotAtTicks: [SETTLE_TICK],
    timeoutMs: 30000,
  },
};
