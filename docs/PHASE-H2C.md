# Phase H2c spec — "The Look, Closed"

Status: **planned** (step-1 output of the [WORKFLOW.md](WORKFLOW.md) loop).
Parent: [PLAN-ALPHA.md](PLAN-ALPHA.md). Predecessor:
[PHASE-H2.md](PHASE-H2.md) — H2b's spec, which **stands**; this document
amends four of its numbers and adds one gate, and says so in place.
Assessment: [ASSESSMENT-ALPHA.md](ASSESSMENT-ALPHA.md).

**H2c is not a new phase. It is the closing of H2b.** There is one review
gate for both, its verdict goes to `docs/reviews/phase-H2b.md`, and it
reviews the whole `hotel-phase-2b` diff against `main` — H2b's six lanes
plus H2c's four — as one diff of one verification shape.

> **⚠ CONTRACT CHANGES IN THIS SPEC**
> - `@claude-engine/harness` — new probe `surface-contrast` (additive).
> - `@claude-engine/renderer-three` — new test-hook slot `surfaceRects()`
>   (additive, `installTestHook`).
> - [PHASE-H2.md](PHASE-H2.md) §11 item 4's `frame-time-p95 ≤ 16.7 ms`
>   budget is **re-based into two numbers** (§4). This is an amendment to a
>   committed exit criterion and is the reason this document exists rather
>   than a fix-list.

---

## 1. Scope

1. **Fix the value-separation regression** (floor / wall / ceiling read as
   one warm-brown band) and **gate it mechanically** with a new
   `surface-contrast` probe whose threshold is *measured from the committed
   reference screenshot*, not chosen.
2. **Re-base the frame-time budget** into a software ceiling (regression
   detection, SwiftShader, method recorded) and a hardware number (measured
   once, by a human, on real hardware).
3. **Unstick `art-lock`.** The terminal focus click is unreliable at the
   derived pose; four consecutive runs failed with `screenRect()` undefined
   and a pitch sweep of dy 40/60/75/90 changed nothing, so it is the
   standing position, not the pitch. Fix the pose, and close the tooling gap
   that let a "proven" pose fail: extend `apps/hotel/scripts/derive-walk.mjs`
   to verify the **reticle raycast**, which it currently does not.
4. **Rule on `save-resume`** and record the ruling in the spec rather than
   leaving it to the review to discover (§6).
5. **Run the H2b review gate** to PASS, including the two human steps.

### Non-goals (H2c is a closing pass; its gravity is toward H3 and it must not fall in)

- **No new art content.** No new materials, props, signage or rooms. Fixing
  value separation means changing the value relationships of the nine
  material ids that already exist, not adding a tenth.
- **No change to `look-lock.ts`'s two constants** (`jitterGridPx: 160`,
  `affineWarp: true`) unless the sign-off in §8 gate 12 rejects them. They
  are the subject of the lock, not the fix.
- **No `stateHash` change of any kind.** The byte-identical golden sweep is
  still the review's first act, and this spec's diff is inside it.
- **No harness `reload` primitive** (§6). It is registered as engine debt
  with a trigger, not built here.
- **No multi-floor, no Phase 3 work.** H3a runs in parallel on its own
  branch and shares no file with this one.
- **No relaxation of any threshold to make a gate pass.** The two H2b
  numbers that move (§4) move by re-basing with a stated method, and the
  spec states what would have been the wrong move.

---

## 2. The six open items, dispositioned

From [BRIEF-ALPHA-PLAN.md](BRIEF-ALPHA-PLAN.md) §3, each with its H2c
disposition. The review gate audits this table.

| # | Item | Disposition |
|---|---|---|
| 1 | `art-lock` (gate 7) committed RED; focus click unreliable at the derived pose; the four look-lock screenshots are not yet the four poses the sign-off signs | **H2c lane 3.** Fix the pose; the screenshots are re-captured and re-committed before any sign-off. Note what already holds and must keep holding: with the PS1 shader live on every other surface, `screen-readability` reads texelScale **1.38** / calibContrast **241.32** / calibPitchErr **0** — byte-for-byte H1b's numbers. Gate 7's actual subject (the B6 screen-quad exemption) is **proven**; only the harness's ability to reach the pose is broken. Do not "fix" the exemption. |
| 2 | `frame-time-p95` measured 108 ms against a 16.7 ms budget written for hardware | **H2c lane 2, §4.** Re-based into two numbers with methods. |
| 3 | Floor/wall/ceiling have lost value separation | **H2c lane 1, §3.** Fixed *and* gated. |
| 4 | `save-resume` may or may not have landed | **Landed, uncommitted, with a disclosed deviation.** `scenarios/save-resume.scenario.mjs` exists in the tree as an untracked file (measured 2026-09-02). Ruling in §6. |
| 5 | The look-lock human sign-off | **Gate 12.** Cannot be performed by an agent; scheduled, with its inputs listed. |
| 6 | No H2b review gate has run | **Gate 13.** Fable review into `docs/reviews/phase-H2b.md`; fix until PASS; merge. |

Plus one item the brief did not list, found while planning: **the branch did
not build at 2026-09-02 measurement time** (`packages/interiors/src/mesh-gen.ts`,
`TS2552: Cannot find name 'ATLAS_SIZE_PX'`, lines 286–287) because a
concurrent session was mid-edit on the half-texel UV inset. The orchestrator
must reconcile with that session before starting — see
[ASSESSMENT-ALPHA.md](ASSESSMENT-ALPHA.md) §0 and
[PLAN-ALPHA.md](PLAN-ALPHA.md) §6.2 rules 2–3. **`npm run check:goldens`
passing is not evidence that the tree builds**: `golden-sweep` runs against
already-built `dist`.

---

## 3. The value-separation fix, and the gate that makes it stick

### 3.1 What is actually wrong

`packages/interiors/src/atlas.ts` gives each material a base HSL and three
shades at ±0.08 lightness:

| material | H | S | L |
|---|---|---|---|
| `floor:lobby` | 35 | 0.30 | 0.55 |
| `floor:corridor` | 220 | 0.06 | 0.55 |
| `wall` | 40 | 0.14 | 0.72 |
| `ceiling` | 0 | 0.00 | 0.85 |

In the atlas those are separated. In a rendered *room* they are not, and the
spec must be precise about why rather than guess, because the fix depends on
it. Three candidate causes, all live, and the lane's first job is to
measure which dominate:

1. **The vertex-colour lighting bake multiplies on top.** A corridor
   gradient and window falloff applied multiplicatively compress the top of
   the range far more than the bottom; a ceiling at L 0.85 under a 0.5
   multiplier lands on top of a wall at L 0.72 under 0.9.
2. **Hue convergence.** `floor:lobby` H 35 and `wall` H 40 are five degrees
   apart. Once value separation compresses, there is nothing else left to
   separate them by.
3. **UV bleed between atlas tiles.** A concurrent session is already
   addressing this with a half-texel inset (its own comment records lobby
   floor quads sampling the corridor tile and ceiling quads sampling the
   lobby floor). Bleed alone can produce the "noise, not a room" reading.

### 3.2 The fix, constrained

Free to change: the nine `MATERIAL_BASE_HSL` rows, `SHADES_PER_MATERIAL`
spread, and the bake's multiplier range. Not free to change: the palette
size gate (≤32), texel density (64 ± 16 px/m), `look-lock.ts`, or anything
that moves a `stateHash`.

The design target, stated as a rule rather than a look: **at any pose inside
a room, floor, wall and ceiling must be separable by value alone** — a
greyscale conversion of the screenshot must still read as three surfaces.
That is the property the gate measures, it is why the gate is a *contrast*
gate and not a colour gate, and it is what "reads as a room" means
mechanically.

### 3.3 New contract — the `surface-contrast` probe

**[public-contract ⚠ additive]** `@claude-engine/harness` and
`@claude-engine/renderer-three`.

```ts
// packages/harness/src/browser.ts -- added to the ProbeSpec union.
//
// Analyses an already-captured screenshot (the screenshotAtTicks capture
// path, same as `screen-readability` -- no second capture) and measures
// whether the hotel's three big surfaces are separable BY VALUE ALONE.
// This is the mechanical half of roadmap risk 7: an atlas can satisfy
// palette size, dither presence and texel density and still render a room
// as one brown band, which is exactly what happened in H2b and was caught
// by eye against a committed screenshot rather than by any gate.
| {
    probe: "surface-contrast";
    /** Named surface regions to compare, resolved through the app's
     *  `surfaceRects()` hook slot. Every name must resolve or the probe
     *  raises BrowserInfraError -- see "refuse, do not report zero". */
    surfaces: readonly string[];   // e.g. ["floor", "wall", "ceiling"]
  }

/** Per-surface mean relative luminance (Rec. 709, 0..255) plus the
 *  pairwise separations, reported flat so feelTargets can address them:
 *    surfaceContrast.mean.floor
 *    surfaceContrast.sep.floor_wall
 *    surfaceContrast.sep.wall_ceiling
 *    surfaceContrast.sep.min          <- the one gates assert on
 *    surfaceContrast.px.floor         <- sampled pixel count per surface
 */
```

```ts
// packages/renderer-three/src/test-hook.ts -- additive slot, exactly the
// `screenRect()` precedent: the PAGE knows where its own geometry is; the
// harness must not guess screen rectangles from a pinned pose (a pose that
// drifts by one tick then silently samples a doorway is the H2b art-lock
// failure wearing a different hat).
export interface TestHook {
  // ...existing slots...
  /** Axis-aligned screen rectangles, in captured-image pixels, of named
   *  world surfaces currently in view -- projected from the ACTUAL floor
   *  mesh, not from constants. Returns only rects that are fully on-screen,
   *  unoccluded at their centre, and at least `minPx` in area; a surface
   *  that cannot be reported honestly is OMITTED rather than approximated. */
  surfaceRects?(names: readonly string[], minPx?: number):
    Record<string, { x: number; y: number; w: number; h: number }>;
}
```

**Refuse, do not report zero** — the `frame-time-p95` / `draw-calls`
precedent, now a stated rule for every probe:

- `surfaceRects()` absent → `BrowserInfraError` (exit 2), message naming the
  missing slot.
- any requested surface missing from the returned record → `BrowserInfraError`,
  naming which and why the app omitted it.
- any returned rect under `minPx` (default 400 px) → `BrowserInfraError`.
  A separation computed over 30 pixels is not a measurement.

*Rejected: fixed screen rectangles pinned per scenario tick.* Cheaper, and
it is the failure mode this project already has scars from — a pose that
drifts samples the wrong thing and reports a confident number. *Rejected:
sampling the atlas bytes instead of the frame.* That is the unit gate that
already exists and already passes; the regression is in what the *renderer*
does to those bytes, so the measurement must be taken from the pixels.
(Left to implementer judgement, per [PLAN-ALPHA.md](PLAN-ALPHA.md) §8.8: the
projection method inside `surfaceRects()`.)

### 3.4 The threshold is measured, not chosen

**`surfaceContrast.sep.min` is derived from `apps/hotel/docs/evidence/h2a-upkeep-objects.png`** —
the committed screenshot everybody agrees reads correctly as a room — minus
a stated margin.

Procedure, and the lane must report every number:

1. Run the probe's analysis offline against the committed H2a screenshot,
   with the same three surfaces hand-identified. Record `sep.min`. Call it
   `S_ref`.
2. Run it against a screenshot of the current (regressed) build at a
   comparable pose. Record `sep.min`. Call it `S_bad`. The gate is only
   meaningful if `S_bad < S_ref` by a wide margin; if it is not, the probe
   is measuring the wrong thing and the lane stops and reports.
3. Set the budget to **`floor(S_ref × 0.75)`**, and commit `S_ref`, `S_bad`
   and the resulting budget in a comment beside it.

Choosing 0.75 is a judgement; deriving `S_ref` is not, and the comment must
distinguish them. **A budget set to whatever the current build produces is
forbidden**, and the review will check the commit order: the threshold
commit must precede the fix commit, and the fix commit must show the gate
going from red to green.

---

## 4. Re-basing the frame-time budget

[PHASE-H2.md](PHASE-H2.md) §11 item 4 says `frame-time-p95 ≤ 16.7 ms`. The
harness renders through headless SwiftShader and measured **108 ms**. The
budget is not wrong and the renderer is not necessarily slow; the *pairing*
is meaningless. Two numbers replace one.

**A. The software ceiling (`frameTimeP95.p95Ms`), asserted in `art-lock`.**
Purpose: regression detection only. It says nothing about playability and
its comment must say so in those words.

- Method, recorded beside the number: five `art-lock` runs on headless
  Chromium with `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`, at the pinned scene and pose, machine
  otherwise idle. Take the **median** of the five p95 values; the budget is
  `ceil(median × 1.5)`.
- The 1.5 headroom factor is a judgement and is labelled as one. The median
  is not.
- **This number is re-derived, with the same method, whenever the scene's
  entity count changes materially** — which H3b does. It is a tripwire, not
  a contract.

**B. The hardware number, measured once, by a human.** Chris runs the built
game on real hardware (`.claude/launch.json`, port 5199 — front the tab; a
background tab throttles rAF and `frameStats()` reports zeros), walks the
`art-lock` route, and reports p95 from `frameStats()`. Recorded in
ARCHITECTURE B8 beside the software ceiling, with the date, the GPU, and the
viewport size. **It is not asserted by any gate** — no gate can, and the
spec says so rather than pretending. It is the number that answers "is this
playable", and until it exists, nobody knows.

If B comes back above 16.7 ms, that is a real finding and a Phase 3 input
(B8's fix order item 3 is already done; the next lever is draw-call count at
multi-floor scale). It is not a reason to touch A.

*Rejected: relaxing 16.7 to whatever SwiftShader produces.* That is the
exact move this project's process exists to prevent, and it would silently
retire the only forward-looking perf signal the browser gates have.
*Rejected: dropping the probe.* It refuses to report an unmeasured number,
so it is honest already; it just needs a budget written in its own units.

---

## 5. Unsticking `art-lock`

### 5.1 The failure

Four consecutive runs failed with `screenRect()` undefined at the focus
tick; a pitch sweep of dy 40/60/75/90 changed nothing. The camera is
therefore not merely mis-pitched — the tick-26 and tick-72 screenshots show
it buried in near-plane geometry, i.e. **the standing position is wrong**.
Two consequences, and the second is the one that matters:

- the focus click never lands, so the probe cannot run; and
- the four committed screenshots are **not the four poses the human sign-off
  is supposed to sign**. Re-capture is mandatory before gate 12.

### 5.2 The fix, and the tooling gap it exposes

`apps/hotel/scripts/derive-walk.mjs` emits a tick-gated browser input script
from "walk to X and look at it", and proves it by replaying the emitted
steps into a fresh sim — reporting achieved pose, distance, bearing error,
and whether `interactSystem` would accept an interact from there. It does
**not** verify the reticle raycast. That is precisely the gap `art-lock`
fell into: the sim would accept an interact from the derived pose, and the
renderer's raycast still did not hit the screen quad.

**H2c closes the gap.** `derive-walk.mjs` gains a raycast check:

```js
// apps/hotel/scripts/derive-walk.mjs -- new final stage of the proof.
//
// The sim's interact acceptance and the renderer's reticle raycast are two
// different questions and H2b learned the difference the expensive way:
// `interactSystem` accepted an interact from the derived pose while the
// reticle never hit the screen quad, so `screenRect()` came back undefined
// on four consecutive runs and a pitch sweep changed nothing (the standing
// POSITION was wrong, not the pitch).
//
// deriveWalk() now returns, in addition to its existing fields:
//   raycast: {
//     checked: boolean;     // false ONLY if the target has no host mesh;
//                           //   the script exits 1 rather than pass silently
//     hits: boolean;        // did a ray from the achieved pose down the
//                           //   reticle centre hit the target's mesh first
//     firstHit: string;     // what it hit instead, when it did not
//     marginPx: number;     // distance from the reticle to the nearest
//                           //   edge of the target's projected rect
//   }
// Exit 1 unless hits === true && marginPx >= MIN_RETICLE_MARGIN_PX.
```

The check runs against the same host geometry the page builds (the
`SCENARIO_CONFIGS` + `setupNamed` + `?worldforgeConfig=` machinery H2b
already uses so both sides build the same world from one committed object) —
otherwise it is a second geometric description that can drift, which is the
mistake `mesh-gen` was written specifically to avoid.

**Non-vacuity for the tool itself:** the lane must show `derive-walk`
exiting 1 on the *current, known-bad* art-lock pose, and exiting 0 on the
fixed one. A tool that cannot reproduce the failure it was built for is not
evidence.

### 5.3 The four screenshots

Re-captured at the fixed poses and committed to
`apps/hotel/docs/evidence/`: **lobby wide, corridor, bedroom with mess
props, focused terminal**. These are gate 12's subject. Each is committed
alongside the tick it was captured at and the scenario commit that produced
it.

---

## 6. Ruling on `save-resume`

**The gate as shipped is ACCEPTED, with its limitation recorded in the spec
rather than only in the scenario's header comment.**

What it does: F6 re-invokes `recoverOnBoot()` — the exact function module
init calls once, automatically — in place, against the live sim, exercising
`listGames()` → `recoverSim()` → `sim.restore()` →
`resetEntityKeyedHostState()` byte-for-byte, then continues through fresh
guest spawns and one interact on a post-restore-spawned guest.

Why it does not literally reload: `installTestHook`'s `commandLog()` is a
plain in-memory array scoped to one page load, and `runBrowserMode` reads it
**once**, at the end of the whole run — that read is both the assertion
replay and the `--verify-replay` bundle. A real `location.reload()` would
start an empty log; every assertion and the replay itself would then
evaluate against a bundle silently truncated to "whatever ran after the
reload" — exit 0, green, proving nothing about the first half of the run.
That is the worst possible failure shape on this project and the deviation
correctly refuses it.

**What the gate therefore does NOT prove, stated plainly and carried:** page
-load mechanics themselves — `index.html` parsing, module re-evaluation,
IndexedDB reopening from cold, and entity-id collisions arising from a
genuinely fresh JS heap.

**Registered as engine debt with a trigger:** `@claude-engine/harness` needs
a `reload` input step that navigates the page and *stitches* `commandLog()`
across the navigation. **Trigger: the first defect attributable to cold
page-load recovery, or the alpha playtest (H4b) — whichever comes first.**
Not built in H2c; H2c's lane scope is `apps/hotel/src/main.ts` and the
scenario file, and widening it to `packages/harness` mid-close is exactly
the scope creep that turns a closing pass into a phase.

---

## 7. Determinism rules specific to H2c

1. **Nothing in this phase may move a `stateHash`.** The byte-identical
   golden sweep over all 12 pins is the review's first act, unchanged from
   [PHASE-H2.md](PHASE-H2.md) determinism rule 4. The atlas value changes,
   the bake changes, the probe and the hook slot are all host-side.
2. **The atlas stays a pure function of the world seed**, byte-identical per
   seed, with no transcendental `Math.*` — the H2b lane discovered the spec's
   own comment was wrong about which purity root `atlas.ts` lands in; it is a
   purity root and it stays one.
3. **The interiors mesh golden re-pins**, once, in the value-separation
   commit — expected and already named in [PHASE-H2.md](PHASE-H2.md) §5D.
   Nothing else may re-pin alongside it, and the commit does one thing.
4. **`surfaceRects()` is host-side and never consulted by sim code.** No
   probe output enters a component. (Invariant 2's asset rule.)
5. **No sim-side use of any measured art number.** The `sep.min` budget
   lives in a scenario's `feelTargets` and in a comment; it is never read by
   the game.

---

## 8. Gates — pass criteria and non-vacuity obligations

Gates 7–10 are [PHASE-H2.md](PHASE-H2.md) §13's H2b gates, restated with
their H2c status. Gates 11–13 are new.

| # | Gate | Pass criteria | Non-vacuity obligation (the lane must perform it and report all exit codes) |
|---|---|---|---|
| 7 | **`art-lock`** (Chromium **and** Firefox, `--browser --verify-replay`) | exit 0 both engines; constant command counts; `screenReadability.texelScale ≥ 1.0`, `calibContrast ≥ 60`, `calibPitchErr ≤ 0.1`; `drawCalls.max ≤ 300`; `simTickMs.avgMs ≤ 5`; `frameTimeP95.p95Ms ≤` §4A's derived ceiling; four screenshots captured at the fixed poses | Compile the retro material **without** `exempt` for the screen quad in the built output → `calibContrast` must collapse (H1b's own evidence: mip filtering alone took 241 → 41) and the gate must red on that assertion and no other. Restore by clean rebuild; re-verify green. |
| 8 | **`save-resume`** | exit 0, `--verify-replay`; recovered hash equals recorded hash; ≥500 further ticks through fresh spawns; one interact on a post-restore-spawned guest succeeds | Break `resetEntityKeyedHostState()` (skip the entity-keyed map clear) in the built output → the post-restore interact must fail and the gate must red there. |
| 9 | **`audio-coverage`** | zero uncovered, zero unknown over the hotel's rule table and the full gameplay event-type list; `createAudioHost` schedules >0 nodes against a mock `AudioContext` over a recorded `one-man-week` stream | Already proven in H2b with both non-vacuity controls. Re-run and report; no new perturbation required. |
| 10 | **Byte-identical headless goldens** | `npm run check:goldens` 12/12, exit 0, against the H2a-pinned values (`smoke 3849639990`, `checkin-rush 1978775531`, `one-man-week 3423109909`, `corridor-headon 2843227394`) | Corrupt one pin → sweep must exit non-zero naming that scenario; restore. (Proven once in H2b; re-prove after the mesh re-pin, because that is the commit most likely to have moved something it should not.) |
| 11 | **`surface-contrast` in `art-lock`** (new) | `surfaceContrast.sep.min ≥ floor(S_ref × 0.75)` at the bedroom and lobby screenshots; `px` ≥ 400 for every surface | **Three obligations.** (a) The probe must red against a screenshot of the *pre-fix* build — report `S_bad` and the red assertion. (b) The probe must raise `BrowserInfraError` (exit 2, not a pass) when `surfaceRects()` is stubbed out. (c) Force the bake multiplier to a constant so all three surfaces converge → gate reds on `sep.min`. |
| 12 | **The look-lock human sign-off** (new; cannot be performed by an agent) | Chris views the four re-captured screenshots **and drives the build himself** (port 5199, tab fronted). The test is roadmap risk 7's: *if a screenshot needs a caption to parse, it fails.* He also listens to the audio once — no gate asserts audible output and none can. The review then records `LOOK-LOCKED: <commit>` against the exact contents of `look-lock.ts` and the atlas synthesis source. | The inputs are the artifacts, not a report: the four committed screenshots, the commit SHA, and a running build. **After sign-off, any change to `look-lock.ts` or `packages/interiors/src/atlas.ts` is a public-contract change requiring a review turn.** |
| 13 | **The H2b review gate** (new) | Fable reviews the whole `hotel-phase-2b` diff against `main` — H2b's six lanes and H2c's four — into `docs/reviews/phase-H2b.md`. **The upkeep-click gate is treated as BLOCKING if absent**, per the H2a review's ruling 5; it is present and green on both engines, so the review's job is to re-verify that, not to accept it. Fix-list loops until PASS, then merge. | The reviewer re-runs everything and applies its own perturbations, chosen independently of this table — standing practice since H1a. |

---

## 9. Implementation lanes (→ = dependency; ∥ = parallel)

Four lanes, disjoint by file. Fewer than the five-lane cap because the tree
does not offer five disjoint regions here, and
[PLAN-ALPHA.md](PLAN-ALPHA.md) §6.4 says to run fewer and say so rather than
manufacture parallelism.

| Lane | Tier | Files (exclusive) | Verification | Non-vacuity |
|---|---|---|---|---|
| **1. Value separation** | Sonnet | `packages/interiors/src/atlas.ts`, `packages/interiors/src/mesh-gen.ts`, `packages/interiors/scripts/test.mjs`, `apps/hotel/docs/evidence/**` | `npm run build`; `npm run test -w @claude-engine/interiors`; `npm run check:goldens`; the offline `S_ref`/`S_bad` measurement (§3.4) | The mesh golden must re-pin **exactly once**, in its own commit, and the goldens must otherwise be 12/12 |
| **2. The probe** | Sonnet | `packages/harness/src/browser.ts`, `packages/harness/src/surface-contrast.ts` (new), `packages/renderer-three/src/test-hook.ts`, `apps/hotel/src/render/**` (the `surfaceRects` implementation only) | `npm run build`; `npx eslint .`; probe run against both committed screenshots | Gate 11 obligations (a)–(c) |
| **3. The pose + derive-walk** | Sonnet | `apps/hotel/scripts/derive-walk.mjs`, `scenarios/art-lock.scenario.mjs` | `derive-walk` on old and new poses; `art-lock` on Chromium then Firefox, `--verify-replay` | §5.2's obligation: exit 1 on the known-bad pose, exit 0 on the fixed one. Gate 7's obligation |
| **4. Perf re-base + docs** | Haiku | `apps/hotel/docs/ARCHITECTURE.md`, `apps/hotel/docs/HANDOFF.md`, and the `feelTargets` **comment** in `scenarios/art-lock.scenario.mjs` — **contested with lane 3; lane 3 owns the file, lane 4 supplies the text in its report** | five-run median procedure (§4A) | The recorded method must reproduce: a second five-run median within the stated headroom |

**Order.** Lane 1 ∥ lane 2 ∥ lane 4 from the start. Lane 3 needs lane 2's
probe only for its `feelTargets` entry, so it starts immediately on the pose
work and integrates the probe entry last. Gate 11 needs lanes 1 and 2.
Gate 12 needs lanes 1 and 3 complete and committed. Gate 13 needs everything.

**Contested files, orchestrator-only:** `package.json`,
`docs/ROADMAP-HOTEL.md`, `docs/reviews/**`, and — unusually — the whole tree
until the concurrent session noted in §2 has been reconciled.

---

## 10. Risks (with early warning signs)

1. **The value fix chases the wrong cause.** Three candidates in §3.1; the
   half-texel inset may already be most of it. *Early sign:* the lane's
   `S_bad` measurement barely moves after the HSL change — that means bleed
   or the bake was the dominant term and the palette was fine. Measure
   before changing.
2. **The look-lock is re-opened by the fix.** Changing material values is
   changing the look, and the lock exists to end that. *Mitigation:* the
   lock has not been signed yet, so this is the last free change. *Early
   sign:* a second round of value tuning after gate 11 goes green — that is
   taste iterating past a passed gate, and it is where risk 6 ("art fiddling
   consumes the schedule") lives.
3. **The pose fix moves the readability numbers.** texelScale 1.38 /
   contrast 241.32 are pose-dependent. *Early sign:* `screen-readability`
   green but materially different from H1b's figures — investigate before
   accepting; a *better* number from a closer pose is also a changed test.
4. **The software ceiling gets re-derived on a busy machine** and comes out
   generous enough to never bite. *Early sign:* a five-run median with a
   spread wider than the 1.5 headroom factor. Re-run on an idle machine.
5. **The concurrent session and this one collide.** *Early sign:* any
   `git status` path not declared by a live lane. [PLAN-ALPHA.md](PLAN-ALPHA.md)
   §6.2 rules 2–3; stop and reconcile, never `git add -A`.
6. **Gate 12 blocks indefinitely** because it needs a person. *Mitigation:*
   it is the only step between H2c and the H3b unlock, and H3a runs in
   parallel throughout, so the critical path does not idle. *Early sign:* H3a
   nearing its own gate with gate 12 unscheduled — raise it then, explicitly.

---

## 11. Open questions (deliberate implementer judgement)

1. The nine `MATERIAL_BASE_HSL` values after the fix, and whether the answer
   is value spread, hue spread, or a narrower bake multiplier range — decide
   from the §3.1 measurement, not from taste, and record which term
   dominated.
2. `SHADES_PER_MATERIAL` (currently 3) and whether the palette budget is
   better spent on more shades per material or more materials.
3. The projection method inside `surfaceRects()` — mesh-quad projection vs
   depth-buffer sampling vs a centre-ray probe per named surface.
4. `MIN_RETICLE_MARGIN_PX` in `derive-walk`'s raycast check.
5. Which two screenshots gate 11 asserts on (the bedroom is mandatory; the
   second is the lane's call between lobby and corridor).
6. Whether the software ceiling is asserted on Firefox as well as Chromium,
   or Chromium only with Firefox review-read — the engines have different
   software rasterisers and one number may not fit both.
