// save-resume -- Phase H2b gate 8 (docs/PHASE-H2.md section 13, "H2b
// gates"). Proves load-on-boot persistence: `listGames()` + the
// `"./recover"` subpath's `recoverSim` reconstructing a live game from
// whatever the store's most recent record holds, instead of always
// starting fresh at a fixed id (deferral row 1, docs/PHASE-H2.md section
// 4). Also proves `resetEntityKeyedHostState()` runs on the boot-recovery
// path (H1b item 6), not just quick-load's, and that clicking a guest
// which spawned AFTER the recovery still works end to end.
//
// THE RELOAD PROBLEM -- READ THIS BEFORE CHANGING THE INPUT SCRIPT
// docs/PHASE-H2.md's gate-8 text says "reload the page". This scenario
// does NOT do that, and the reason is load-bearing, not a shortcut:
//
//   installTestHook's commandLog() (packages/renderer-three/src/
//   test-hook.ts) is a plain in-memory array scoped to ONE page load.
//   packages/harness/src/browser.ts's runBrowserMode reads it exactly
//   ONCE, at the very end of the whole browser run, and THAT read is what
//   becomes both the in-process assertion replay and the --verify-replay
//   bundle (packages/harness/src/cli.ts). A real `location.reload()` (or
//   Playwright navigating the page again) would start a brand-new, EMPTY
//   commandLog() -- every command recorded before the reload is gone from
//   the array read at the end. Every assertion below, and --verify-replay
//   itself, would then evaluate against a replay bundle silently
//   truncated to "whatever ran after the reload" -- exit 0, green, and
//   proving nothing about the pre-reload half of the run. This is exactly
//   the hazard apps/hotel/src/main.ts's quickLoad() doc comment already
//   worked out for F9 (rebuild the sim IN PLACE rather than reload),
//   generalized here to the boot path itself.
//
//   This lane's file scope is apps/hotel/src/main.ts and this scenario
//   file ONLY -- packages/harness (which would need a "reload but keep
//   stitching commandLog across the navigation" primitive to make a
//   literal reload sound) is explicitly out of scope, and no such
//   primitive exists today (`InputStep`'s union has key/pointer steps,
//   nothing that navigates a page).
//
//   THE RESOLUTION SHIPPED HERE: main.ts's F6 keydown handler re-invokes
//   `recoverViaBootPathAgain()` -- which shares its recovery body
//   (`recoverFromGames`) with `recoverOnBoot()`, the function a real page
//   load calls once, automatically, at module init -- in place, against
//   the live `sim`, the same way F9 already re-invokes quick-load logic
//   in place. F6 exercises the real recovery code path (`listGames()` ->
//   `recoverSim()` -> `sim.restore()` -> `resetEntityKeyedHostState()`)
//   byte-for-byte -- it is not a stand-in written for this test, it runs
//   the same logic the boot path runs -- without ever discarding the
//   command log a sound --verify-replay depends on. This is a deliberate,
//   disclosed deviation from the spec's literal "reload the page"
//   wording, forced by the harness's lack of a reload primitive and this
//   lane's scope boundary; it is not a claim that this gate exercises
//   page-load mechanics themselves (index.html parsing, module
//   re-evaluation, IndexedDB reopening from cold) -- only the recovery
//   LOGIC those mechanics would eventually call. See the H2b
//   implementation report for the full ruling and what was tried and
//   rejected instead (a genuine entity-id-collision counterfactual --
//   see "WHAT THIS GATE DOES NOT PROVE" below).
//
// WHY THE HASH ASSERTIONS READ SIM STATE, NOT A HOOK PROBE
// Same reasoning as save-restore.scenario.mjs's own header comment: a
// browser scenario's assertions run against a FRESH headless Sim built by
// replaying the captured command log, so a value living only in main.ts's
// closures (hook.saveState()) is invisible to them. F6's
// `recoverViaBootPathAgain()`, on success, submits `debug.saveRestoreRecord` (the same
// saveRestoreDebugCommand/saveRestoreDebugSystem F9 already uses) carrying
// {savedTick, savedHash, restoredHash} -- so the assertions below read
// that component off the REPLAYED sim, exactly like save-restore's do.
// This is also the mechanism docs/PHASE-H2.md's deferral table (last row)
// prescribes: "asserts through the recovered hash, not through replay of
// a discarded branch" -- the marker's payload is data baked live into a
// command, replay-safe regardless of what the replayed reconstruction's
// OWN world looks like at that tick.
//
// WHY F5/F6 LAND IN A FULLY QUIET WINDOW, BEFORE ANY GUEST EXISTS, AND
// WHAT THIS GATE DOES NOT PROVE (deliberately, not by oversight)
// F5_TICK/F6_TICK below are 5 ticks apart with ZERO commands anywhere in
// between (no move/look/click/screen input), and this seed's first guest
// doesn't spawn until tick 100 -- so nothing at all changes between F5 and
// F6. This is NOT the same "pinned against a wall" no-op save-restore.
// scenario.mjs relies on (docs/PHASE-H2.md's deferral table explicitly
// says this gate must not inherit THAT pattern); it's a stronger, cleaner
// one: nothing happens at all, so `recoverSim`'s snapshot+tail
// reconstruction is provably identical to the live world at that instant,
// independent of any input-effect coincidence.
//
// Landing BEFORE any guest exists is also load-bearing for the walk/click
// leg, for a reason that has nothing to do with replay: `interactSystem`
// only accepts a click on a guest that is BOTH `state: "queued"` AND
// `queueIndex === 0` (the desk queue's head) -- packages the widening
// comment in apps/hotel/src/sim/game.ts calls out. Nothing in this
// scenario ever clears the queue (no desk decision is ever made), so
// whichever guest becomes queue head FIRST holds that slot for the rest
// of the run. If F5/F6 landed after guest 0, 1, or 2 already existed
// (this seed's guests spawn at 100, 217, 286, 358, ...), THEY would
// already occupy the queue head, and the "post-restore-spawned" guest
// this gate is supposed to click would sit behind them forever --
// clickable in principle, but never reachable through interactSystem in
// THIS scenario. Restoring before tick 100 guarantees the very first
// guest to ever exist is the one this gate walks up to, and that guest
// necessarily spawns after F6_TICK.
//
// This was a deliberate choice after trying the alternative: forcing an
// actual entity-id COLLISION (discard a guest between F5 and F6, let
// `nextEntity` rewind, and have a later guest spawn reuse that exact id --
// the literal H1b item-6 hazard) and clicking that specific reused id to
// prove `resetEntityKeyedHostState()` is NECESSARY, not just present. That
// was built and worked LIVE (verified with a throwaway node harness
// against the compiled sim, replicating main.ts's calibration-then-real
// restore sequence bit for bit). It was rejected for THIS committed gate
// because it is fundamentally unsound under --verify-replay: replay
// reconstructs the world by walking the FULL captured command log forward
// from tick 0 ONE TIME, in one continuous pass -- it never calls
// `Sim.restore()`, because a restore is not a command. So a live-browser
// session that genuinely rewound `nextEntity` and reused an id produces a
// command log whose `interact{target: <that reused id>}` step, when
// replayed against a world that NEVER rewound, resolves to whatever
// unrelated entity happens to hold that number in the continuous
// timeline -- not the guest the live session actually clicked. Any
// assertion built on "the replayed world's entity N is now presenting"
// would be checking a coincidence of the replayed (unperturbed) numbering,
// not evidence of the live (perturbed) session's behaviour. This is a
// structural property of the harness's replay model, not a defect in this
// scenario's design, and it is exactly why the deferral table's guidance
// ("assert through the recovered hash, not through replay of a discarded
// branch") reads the way it does. Consequently: this gate proves the
// recovery LOGIC (hash equality, `resetEntityKeyedHostState()` running
// without breaking subsequent registration) but does not, and structurally
// cannot via this harness, prove the adversarial counterfactual that a
// missing `resetEntityKeyedHostState()` call would specifically manifest
// as a stale-guard click failure on a reused id. Flagged here loudly per
// the task's own instruction, rather than shipping a collision-based
// assertion whose replay leg would be checking the wrong world.
//
// DERIVING THE WALK (task requirement: use the committed tool, don't
// hand-derive) via apps/hotel/scripts/derive-walk.mjs:
//   node apps/hotel/scripts/derive-walk.mjs --seed hotel-h2-resume-1 \
//     --to guest:0 --start-tick 700 --stop-mm 1200 --target-height-m 1.5
// reported: target entity 19 (derive-walk's own fresh, unperturbed sim's
// id for this guest -- irrelevant here, see below) at (625,2625); arrived
// tick 720 at (1632,2536), distance 1011mm (limit 1500), bearing error
// 29mdeg (limit 30000), "sim would accept interact: range OK, arc OK",
// suggested look-down pitch 26px. `guest:0` (the first guest ever to
// spawn) is the correct selector given the queue-head constraint explained
// above. `guest:N` selects "the Nth entity with a `guest` component, in
// encounter order" -- since this scenario's F5/F6 never discard or shift
// anything (the quiet-window property above), guest index 0 here IS the
// same real guest, at the same tick, same position, as guest index 0 in
// derive-walk's own plain simulation -- entity NUMBERS may still differ
// by whatever this scenario's saveRestoreDebug marker consumes, but
// `pointer:"click"` resolves its target by live raycast against
// registered interactables (packages/player-fps), exactly like a real
// player's click, so that numbering detail is invisible to the script
// below. The pitch (dy) and yaw (dx) were then hand-tuned against the real
// browser build (derive-walk does not verify the reticle raycast, only the
// range/arc a raycast hit would need to already satisfy): the reported
// walk lands the player right at a wall corner that occludes most of the
// guest from most angles, and the reticle only grazes the guest's
// shoulder at the best (dx, dy) pair found (78, 41) -- close, not
// confirmed centered. See "WHAT THIS GATE DOES NOT PROVE" above and the
// H2b implementation report: the `anyGuestPresenting` assertion below is
// the one assertion this gate could NOT get to a reliable pass, and it is
// shipped RED rather than papered over. Every other assertion (the boot
// recovery itself, the hash equality, the post-restore spawn, the tick
// count, and --verify-replay's own hash cross-check) passes.
import { setup } from "../apps/hotel/dist-game/sim/game.js";

const SEED = "hotel-h2-resume-1";

// A fully quiet window (see the header comment): no move/look/click/screen
// command lands within many ticks of either tick, and this seed's first
// guest doesn't spawn until tick 100, so nothing at all changes between
// F5 and F6.
const F5_TICK = 50;
const F6_TICK = 55;

// derive-walk's own start-tick for the walk leg: comfortably after guest
// index 0 (spawns at tick 100, the first guest to ever exist -- see the
// queue-head reasoning above) has had time to be up and walking toward
// its queue spot.
const WALK_START_TICK = 700;
const LOOK_1_DX = -463;
const WALK_TICKS_START = 700;
const WALK_TICKS_END = 724;
const LOOK_2_DX = -320;
// derive-walk's suggested pitch-down onto the target, tuned against the
// real browser build (see the header comment's derivation note).
const LOOK_2_DY = 207;
/** The final turn onto the head slot, derived as its own leg. */
const AIM_DX = 746;
const AIM_TICK = 725;
// A few ticks of settle margin past derive-walk's reported arrival (720)
// before clicking, so the player has actually reached the reported pose
// rather than clicking mid-step.
const INTERACT_TICK = 728;

// F6_TICK + 500, the exit criterion's "continue 500+ ticks through fresh
// guest spawns" -- comfortably cleared by SETTLE_TICK below (900), which
// also gives interactSystem time to process the click and settle the
// guest's state before final state is read.
const MIN_POST_RESTORE_TICKS = 500;
const SETTLE_TICK = 900;

function saveRestoreDebug(s) {
  for (const e of s.entities()) {
    const d = s.getComponent(e, "saveRestoreDebug");
    if (d) return d;
  }
  return undefined;
}

function guestArrivedEvents(s) {
  return s.eventsSince(0).filter((e) => e.type === "guest.arrived");
}

/** The click's effect, read off guest STATE rather than a numeric entity
 *  id (see "WHAT THIS GATE DOES NOT PROVE" above for why a specific id
 *  cannot be asserted through replay here): interactSystem only moves a
 *  guest out of plain queued-and-waiting into "presenting" when a click
 *  actually reaches it (packages/renderer-three registered-interactable
 *  raycast -> makeInteract -> interactSystem's queue-head branch). If the
 *  click had been swallowed (no registered object under the reticle, e.g.
 *  a stale-guard false negative), no guest would ever reach this state. */
function anyGuestPresenting(s) {
  for (const e of s.entities()) {
    const g = s.getComponent(e, "guest");
    if (g && g.state === "presenting") return true;
  }
  return false;
}

export default {
  name: "save-resume",
  seed: SEED,
  ticks: SETTLE_TICK,
  setup,
  assertions: [
    {
      description: "a boot-path recovery actually ran (F6's recoverOnBoot() completed and submitted the saveRestoreDebug marker) -- guards against a vacuous pass if F6 silently no-oped",
      check: (s) => saveRestoreDebug(s) !== undefined,
    },
    {
      description: "the recorded hashes are real numbers, not a degenerate placeholder",
      check: (s) => {
        const d = saveRestoreDebug(s);
        return d !== undefined && typeof d.savedHash === "number" && typeof d.restoredHash === "number";
      },
    },
    {
      description: "restoredHash === savedHash: the boot path reconstructed EXACTLY the F5 state -- guarded by the quiet window above so this is a genuine equality check, not a coincidence of nothing having happened",
      check: (s) => {
        const d = saveRestoreDebug(s);
        return d !== undefined && d.savedHash === d.restoredHash;
      },
    },
    {
      description: "at least one guest spawned strictly after F6_TICK (the restore point) -- the walk target must actually be a post-restore-spawned guest, not a pre-existing one",
      check: (s) => guestArrivedEvents(s).some((e) => e.tick > F6_TICK),
    },
    {
      description: `at least ${MIN_POST_RESTORE_TICKS} ticks elapsed after the restore, through fresh guest spawns, before this run ends (docs/PHASE-H2.md gate 8's own bar)`,
      check: (s) => s.tick - F6_TICK >= MIN_POST_RESTORE_TICKS,
    },
    {
      description: "the post-restore-spawned guest was actually clickable: interacting with it moved it into 'presenting', proving the click reached interactSystem via a registered interactable rather than being silently swallowed",
      check: anyGuestPresenting,
    },
  ],
  browser: {
    app: "@claude-engine/hotel",
    input: [
      { pointer: "lock", atTick: 0 },
      { key: "F5", downAtTick: F5_TICK, upAtTick: F5_TICK },
      { key: "F6", downAtTick: F6_TICK, upAtTick: F6_TICK },
      // APPROACH FROM NORTH OF THE QUEUE, NOT ALONG IT.
      //
      // The first derivation walked to 1011mm from the queue head and the
      // sim agreed the pose was legal (range OK, arc OK) -- but the click
      // never resolved to the head guest. The reason was only visible by
      // dumping the world at the click tick: EIGHT guests were queued in a
      // row along z=2625 from x=625 to x=2375, and the player was standing
      // at x=1632 -- inside the line, 89mm from the guest in slot 4. The
      // reticle hit the nearest queued guest, and `interactSystem`
      // correctly refused it, because presenting requires queueIndex === 0.
      // A gate aimed down the length of a queue is aimed at the wrong
      // person by construction.
      //
      // So the walk now goes to the open lobby NORTH of the queue row and
      // looks SOUTH at the head slot, where the sight line crosses no other
      // slot. Derived with apps/hotel/scripts/derive-walk.mjs in two legs
      // (--to 625,1625 then --to 625,2625 --after), measured: arrives tick
      // 725 at (695,2141), 489mm from the head slot, bearing error 90 mdeg,
      // range OK / arc OK, suggested pitch 53px.
      { pointer: "look", atTick: WALK_START_TICK, dx: LOOK_1_DX, dy: 0 },
      { key: "KeyW", downAtTick: WALK_TICKS_START, upAtTick: WALK_TICKS_END },
      { pointer: "look", atTick: WALK_TICKS_END, dx: LOOK_2_DX, dy: 0 },
      { pointer: "look", atTick: AIM_TICK, dx: AIM_DX, dy: LOOK_2_DY },
      { pointer: "click", atTick: INTERACT_TICK },
    ],
    screenshotAtTicks: [INTERACT_TICK, SETTLE_TICK],
    timeoutMs: 60000,
  },
};
