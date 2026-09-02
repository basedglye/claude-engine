# Brief: assess GRAND FOYER, then plan the alpha

Written 2026-09-02 by the H2b implementation session, for a **Fable 5.1
planning turn**. This is the input document for that turn; it is not itself
a plan. Its job is to tell you exactly what is true right now, what has been
verified and how, what is open, and what the ask is — so the plan you write
starts from measured state rather than from the roadmap's intentions.

Read it with `docs/ROADMAP-HOTEL.md`, `docs/PHASE-H2.md`,
`docs/reviews/phase-H2a.md`, `apps/hotel/docs/HANDOFF.md`,
`apps/hotel/docs/DESIGN.md` and `apps/hotel/docs/ARCHITECTURE.md`.

---

## 1. The ask

Three deliverables, in order.

**(a) An assessment, original plan → now.** The roadmap (`ROADMAP-HOTEL.md`)
was written before H0. Five phases have shipped against it. Judge honestly:
where the plan was right, where it was optimistic, where the *shape* of the
work turned out different from the shape the plan assumed. Be specific about
estimate accuracy — the roadmap's per-phase week estimates versus what
actually happened — and about which risks fired, which never did, and which
fired in a form the risk register did not anticipate.

**(b) An updated plan to reach ALPHA.** Alpha is defined here as **the end
of roadmap Phase 4 ("The Campaign")**: a real single-player game with
content depth and a progression arc, before any multiplayer. Phases 5–7
(street foundations, multiplayer, the city) are explicitly *out* of alpha.
The plan should re-scope Phases 3 and 4 against what H0–H2 actually taught,
not against what the original roadmap assumed, and it should say plainly if
the right answer is to cut, merge or re-order phases.

**(c) A subagent execution design, capped at five concurrent agents.** The
parallel-lane pattern is proven on this project (see §5) and its failure
modes are known. Specify the lanes, their file boundaries, their
verification obligations, and the orchestration rules — including the two
that were learned the hard way this session.

The user's framing was: **a `/goal` of creating this game in one shot.**
Take that as the ambition to design toward — a plan that could run
end-to-end with minimal human turnaround — while being straight about which
steps genuinely cannot be one-shot (the human look-lock sign-off is a named
example; there may be others, and naming them is part of the job).

---

## 2. Where the code actually is

Branch `hotel-phase-2b`, 3 commits ahead of `main` at `28e554a`.

**Merged to `main` and green:** H0, H1a, H1b, H2a. The game today: you walk
a procedurally generated hotel ground floor in first or third person; guests
arrive on a demand curve shaped by your prices, per-segment reputation and
star tier, queue at the desk and hand you papers; you read them at an
in-world CRT and accept or deny through RESERVA's rule table, which grows
new rows as your star tier rises; checkouts leave visible messes that block
re-letting until you walk up and wipe them; props break and take three
presses to fix; reviews become reputation, reputation becomes stars, stars
activate the blacklist rule and MAILBOX delivers the bulletins that fill it;
three objectives post each morning and settle at the night audit; and when
cash crosses a threshold, résumés print as real document entities, a
candidate walks in, you interview them at the STAFF screen, and the clerk
you hire works the desk as its own actor. Money is double-entry. F5/F9 save
and reload to an identical `stateHash`.

**On the branch, verified by the implementer (not taken on report):**

- The retro pipeline: `synthesizeAtlas` (integer-hash noise → ≤32 colours →
  4×4 Bayer dither → one 1024px atlas), planar UVs at 64 px/m, and a
  corridor/window/lamp vertex-colour lighting bake. Written with **no
  transcendental `Math.*`** — the spec's own comment claiming `sin`/`random`
  were fine there was wrong about which purity root the file lands in.
- The PS1 material (`createRetroMaterial`: vertex jitter + affine UV warp
  through `onBeforeCompile`, `exempt` compiling both out), `instancedScenery`,
  and a `frameStats()` slot through `ThreeHost` → `WorldforgeHook`.
- `frame-time-p95` and `draw-calls` probes. Both **refuse** to report an
  unmeasured number rather than returning a zero that would pass any budget.
- `@claude-engine/audio` (host-only, 44 event types, zero uncovered, both
  non-vacuity controls proven) and the hotel's `SoundRule` table.
- `listGames`/`deleteGame` on all three stores; the `"./recover"` subpath.
- The third-person boom now clamps against an occlusion query (H0 item 1,
  twice deferred), and `registerInteractable` no longer leaks the old object
  into the reverse map (H1b deferral 2).
- `npm run check:goldens` — gate 10 as one command over 12 pinned headless
  hashes, proven to go red on a corrupted pin and green on restore.
- **`upkeep-click`** — the H2a review's blocking deferral item — passes on
  **both engines, exit 0, 47 commands each**, with four real assertions and
  a proven perturbation. A player mouse click provably reaches a mess and a
  candidate through the reticle raycast in the shipped build.

**The headline invariant holds:** `check:goldens` is 12/12 byte-identical
after the entire art/audio diff. `npm run test --workspaces` is 553 PASS / 0
FAIL. Build, eslint, purity and `--self-test` all exit 0.

---

## 3. What is NOT done — read this before planning anything

**H2b is incomplete.** Do not plan Phase 3 as though it starts from a clean
merge.

1. **`art-lock` (gate 7) is committed RED.** What is proven: with the PS1
   shader live on every other surface, `screen-readability` reads texelScale
   **1.38** / calibContrast **241.32** / calibPitchErr **0** — byte-for-byte
   H1b's numbers. That is gate 7's actual subject (the ARCHITECTURE B6
   screen-quad exemption) and it holds. `draw-calls` (5) and `sim-tick-ms`
   (0.22) are inside budget. What is *not* proven: the terminal focus click
   is unreliable at the derived pose — four consecutive runs failed with
   `screenRect()` undefined, and a pitch sweep of dy 40/60/75/90 changed
   nothing, so it is the standing position and not the pitch. The tick-26
   and tick-72 screenshots show the camera buried in near-plane geometry,
   which also means **the four look-lock screenshots are not yet the four
   poses the sign-off is supposed to sign**.
2. **`frame-time-p95` measured 108 ms against the spec's 16.7 ms budget.**
   That budget is written for hardware; the harness renders through headless
   SwiftShader, where 16.7 is unreachable. It needs either a hardware run or
   an explicitly-scoped software ceiling. It must not be quietly relaxed to
   whatever passes — that is the exact move this project's process exists to
   prevent.
3. **A real look defect, found by looking rather than by a gate.** With
   albedo moved into the atlas, floor, wall and ceiling now sit inside a
   narrow warm-brown band, and a room reads as noise rather than as a room.
   Compare `apps/hotel/docs/evidence/h2a-upkeep-objects.png`, which is
   bright and clearly separated. Roadmap risk 7's test — *if a screenshot
   needs a caption to parse, it fails* — currently fails. This must be fixed
   before any sign-off.
4. **`save-resume` (gate 8) was in flight when this brief was written.**
   Check the tree. Its hard problem is stated in its brief and is worth your
   attention when planning any future reload-based gate: `installTestHook`'s
   `commandLog()` is a plain in-memory array scoped to one page load, and
   the harness evaluates browser assertions *and* `--verify-replay` by
   replaying that log headlessly — so a naive "reload the page" gate
   silently truncates its own replay bundle and every assertion then
   evaluates against the wrong world.
5. **The look-lock human sign-off has not happened** and cannot be done by
   an agent. It is a named review step: Chris views the four committed
   screenshots and drives the build himself, and the review records
   `LOOK-LOCKED: <commit>`. After that, `look-lock.ts` and the atlas
   synthesis are frozen behind a review turn.
6. **No H2b review gate has run.** The phase needs a Fable review into
   `docs/reviews/phase-H2b.md`, fixes until PASS, then merge.

**Not built at all** (carried from the H2a handoff, still true): no
multi-floor, stairs or elevators; no PURCHASE / CCTV / BLUEPRINT /
STREETVIEW (the registry stops at six apps); no housekeeper or maintenance
NPCs; no role XP, mastery, prestige, contracts, inspections or loans; no
guest archetype behaviours; no forgery visuals; no multiplayer wiring.

**Deferred with triggers unchanged:** `space` clearance-aware A* extraction
(Phase 3, on a second consumer or crowd scale); guests never close doors
(Phase 3); `debug.*` rejection in server validation (Phase 5, before any
remote actor exists).

---

## 4. Estimate reality — the input to your re-plan

The roadmap's per-phase estimates were written in calendar weeks for a human
pace. Observed: H0 merged 2026-08-25, H2a merged ~2026-08-26, H2b's
implementation ran 2026-09-02. Five phases in roughly a week of sessions,
against a roadmap that budgeted 6–10 weeks for the same span.

The implementation is not the bottleneck. **Browser-gate authoring is** — it
has been the slowest item in H0, H1b and H2b alike, and H2b's own art-lock
is stuck on it right now. Any alpha plan that does not confront this
directly will mis-estimate by the same factor the roadmap did.

One structural mitigation landed this session and should be assumed by your
plan: `apps/hotel/scripts/derive-walk.mjs` (§5).

---

## 5. Process that works, and the two failure modes learned this session

The loop is `docs/WORKFLOW.md`: Fable plans a phase spec → Sonnet implements
with subagents → Fable reviews the diff into `docs/reviews/phase-N.md` →
fix until PASS → merge. It has caught defects no build failure showed: doors
too narrow to walk through, a gate that evaluated no assertions, a camera
pointed backwards, a click path no human had exercised, a probe reporting a
number the pixels contradicted, a control that discriminated nothing, four
verbs invisible and unclickable while every gate was green. **Every one of
them passed `npm run build`.** The user was asked directly whether to loosen
verification to move faster and said: *"Keep it and keep moving."*

**What worked this session.** Five concurrent, file-disjoint lanes (atlas,
audio, persistence, boom clip, golden sweep), each with an explicit
verification command list and an explicit non-vacuity obligation. All five
landed usable work. Lane boundaries were drawn by *file*, and the one shared
file (`package.json`) was flagged as contested in every brief.

**Failure mode 1 — agents that re-delegate.** Two agents spent their entire
budget spawning further agents and returned having done nothing. Roughly
140k tokens for zero output. Every subagent brief must now say, in as many
words, *do this work yourself; do not spawn subagents*.

**Failure mode 2 — concurrent agents and git.** One agent reported that its
uncommitted edits were swept into another lane's commit by the orchestrator.
No work was lost, but the attribution was wrong and it could have been.
Subagents must not commit; the orchestrator commits, and should check
`git status` immediately before doing so.

**Two tools landed this session that your plan should assume:**

- `scripts/check-workspace.mjs` — a fresh `git worktree` has no
  `node_modules`, so Node resolves `@claude-engine/*` *up* into the main
  checkout and every test silently measures a different tree. This session
  opened with exactly that, presenting as `TypeError: sim.stateHashSlow is
  not a function` for a function sitting compiled in this worktree's own
  `dist`. Now wired into `npm test` and `npm run check:goldens`; proven to
  exit 2 when perturbed.
- `apps/hotel/scripts/derive-walk.mjs` — emits a tick-gated browser input
  script from "walk to X and look at it", **and proves it** by replaying the
  emitted steps into a fresh sim, reporting the achieved pose, distance,
  bearing error, and whether `interactSystem` would actually accept an
  interact from there (exit 1 if not). Two findings are baked into its
  comments: `space`'s raw `findPathCells` is not clearance-aware and wedges
  a 300mm collider at doorways (CLAUDE.md's standing rule from the H1a
  review says as much, and the first draft broke it); and 4-connected A*
  through an open room is a staircase that must be string-pulled against a
  radius-aware LOS, keeping door cells, or the script is 25 commands of
  noise. It does **not** verify the reticle raycast — pitch still has to be
  confirmed in the real browser, which is precisely where `art-lock` is
  stuck.

---

## 6. Invariants your plan may not break

From `CLAUDE.md`, all six, unchanged: sim purity; determinism at a fixed 20
Hz through the seeded `Rng` with no `Math.random` and no transcendental
`Math.*` in sim-side code; replayability from (seed, input log); hosts
render and sims decide; the engine owns netcode, persistence, auth and input
validation; and write-through — sim code mutates components ONLY via
`setComponent()`, because `stateHash()` is incremental and an in-place
mutation is invisible to it.

Read `stateHashSlow()`'s comment before trusting the write-through detector:
it catches a violator that is the entry's LAST writer, and a violator
followed by a normal write to the same entry heals silently. The window is
bounded to 500 ticks, not closed.

Also standing, and worth restating in any spec you write: **every gate must
be proven non-vacuous** — break what it tests, confirm it reds on the right
assertion, restore, report the exit codes. Two H2a gates were vacuous when
first written and only perturbation showed it.

---

## 7. Traps that will cost hours if the plan forgets them

- `tsc` incremental skips rebuilding when only `dist` was mutated. A
  perturbation test must `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm
  -rf apps/hotel/dist-game` before rebuilding, or the "restore" is a no-op.
  This has bitten four times.
- Headless Chromium needs `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`, or Three's shaders fail silently to a blank
  canvas with no console error.
- A browser scenario's `setup` builds only the REPLAY sim; the page runs the
  app's own `setup()`. H2b solved this with `SCENARIO_CONFIGS` +
  `setupNamed` + `?worldforgeConfig=`, so both sides build the same world
  from one committed object.
- Under pointer lock, never move the mouse back to a previous x — the deltas
  cancel and you silently do not turn.
- Verdict JSON must be written inside the repo: on this machine Git Bash
  `/tmp` paths do not round-trip to the Node process.
- `npm run harness --silent -- <scenario>` — `--silent` is required or npm's
  banner pollutes the verdict JSON.
- `.claude/launch.json` serves the app on port **5199**, not 5173.
- A background browser tab throttles rAF; the sim stops stepping and
  `frameStats()` reports zeros. Front the tab before driving the build.
- Colour space is not a detail. Tagging the synthesized atlas
  `SRGBColorSpace` made Three decode every sample to linear with no matching
  re-encode, and the whole hotel rendered three times too dark. Caught by
  comparing against a committed screenshot, not by any gate.

---

## 8. What "done" looks like for the plan you produce

A phase spec, or set of specs, in the shape of `docs/PHASE-H2.md`: numbered
scope, explicit non-goals, real exported TypeScript for every public
contract, determinism rules specific to the phase, gates with pass criteria,
an implementation lane order marked for dependency and parallelism, risks
with early warning signs, and open questions left explicitly to implementer
judgement. That document's split ruling (§1) is the model for how to cut a
phase that is too big — by verification shape, not by feature count.

Commit it to `docs/`. If it changes an invariant or a public contract beyond
what an existing spec already covers, say so at the top, loudly.
