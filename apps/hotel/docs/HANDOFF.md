# GRAND FOYER — session handoff

Refreshed 2026-09-02 at the H2b implementation → review boundary. This
records **verified state**, not plans. Anything described as working here
was run by the session that wrote it, not taken from a subagent's report.

## Where the project is

Phases **H0**, **H1a**, **H1b** and **H2a** are merged to `main`, each PASS
after a review gate. **H2b's implementation is complete on branch
`hotel-phase-2b`** (7 commits ahead of `main` at `28e554a`) with all four of
its gates green — but it is NOT merged, and two things stand between it and
merge: the human look-lock sign-off, and the H2b review gate itself.

What the game does today, on the branch: everything H2a shipped (see the
H2a section below), now wearing a PS1 look — one dithered ≤32-colour
1024px atlas per hotel at 64 px/m, planar UVs, a baked vertex-colour
lighting bake with corridor/window/lamp falloffs AND a per-face directional
term, vertex jitter and affine UV warp on every surface except the screen
quad and the held document. It has procedural audio driven purely by the
sim's event stream, frame-time and draw-call probes, a third-person camera
that no longer clips walls, and it reloads your hotel on boot.

### H2b's measured exit criteria

- `art-lock` — exit 0 **both engines**, `--verify-replay`, **72 commands**
  each. `screen-readability` reads texelScale **1.38** / calibContrast
  **241.32** / calibPitchErr **0** with the shader live on everything else:
  byte-for-byte H1b's numbers, which is the B6 exemption proven under the
  shader rather than asserted. Non-vacuity: un-exempting the quad reds
  exactly that target (pitchErr 0 → 0.258, contrast 241 → 179) and nothing
  else.
- `save-resume` — exit 0 both engines, **29 commands**. Non-vacuity:
  disabling the guest `registerInteractable` reds exactly the click
  assertion and leaves the five recovery assertions green.
- `audio-coverage` — zero uncovered, zero unknown, both controls proven.
- `upkeep-click` — exit 0 both engines, **47 commands**. The H2a review's
  blocking carry, closed.
- `npm run check:goldens` — **12/12 byte-identical** after the whole
  art/audio diff. This is gate 10, and it is now one command.

### What is NOT done in H2b

1. **The human look-lock sign-off.** Four screenshots are committed at
   `apps/hotel/docs/evidence/h2b-look-*.png`. §11 requires Chris to view
   them AND drive the build himself, after which the review records
   `LOOK-LOCKED: <commit>`. No agent can do this step.

   These four were RE-CAPTURED after the H2b review's blocking item 1 (see
   `docs/reviews/phase-H2b.md`). They are now **reproducible**: every shot
   sits inside a long stationary hold, and two consecutive runs produced
   four byte-identical PNGs even though one shot's capture drifted a tick.
   Before the fix only the terminal shot reproduced.

   **What is still true, and is the sign-off's actual subject:** only two of
   the four frames read as architecture — shot 1 (the lobby looking through
   the corridor doorway) and shot 4 (the terminal). Shots 2 and 3 are
   legible as geometry but not as a corridor or a bedroom. That was chased
   to ground and is NOT a pose problem: with no surface detail at gameplay
   distance, a frame only reads when it contains an opening and layered
   depth, and the legible band around such a pose is a few hundred
   millimetres wide (measured: moving 600mm from shot 1's pose destroys it).
   The mess in shot 3 IS in frame — confirmed by pitch-tracking it across
   three pitches — but renders as a dark brown box indistinguishable from
   the architecture around it. The fixes are art-side (atlas contrast,
   surface/edge definition, mess colour), which is exactly what the
   look-lock sign-off is for and what the ungated `surface-contrast` probe
   (PHASE-H2C §3.3) would measure.
2. **The H2b review gate.** No verdict exists at `docs/reviews/phase-H2b.md`.
3. **Two deviations the review must rule on, not inherit:**
   - The frame-time budget is **scoped to software rendering** (ceiling 170
     ms) because the harness renders through headless SwiftShader where the
     spec's hardware 16.7 ms is unreachable. Five measured runs: 86.5 / 96.3
     / 106.2 / 108.1 / 114.7 ms. The gate now claims "software render cost
     has not regressed" and says so; the hardware number is assigned to the
     sign-off, where a real machine is in the loop.
   - `save-resume` substitutes an F6 key that re-invokes recovery in place
     for a real `location.reload()`, because a reload destroys
     `installTestHook`'s in-memory command log — which is what the harness
     replays for both assertions and `--verify-replay`. Gate 8 therefore
     does NOT prove the boot path survives an actual page load. Closing it
     needs a reload-preserving primitive in the harness.

## Read these before touching anything

- `apps/hotel/docs/DESIGN.md` — the game. Its rulings are binding: the
  terminal loop must **escalate**; every activity declares **pressure or
  zen**; progression is simulation-intrinsic with an explicit list of dark
  patterns not to ship.
- `apps/hotel/docs/ARCHITECTURE.md` — how. Records every rejected
  alternative so they are not re-litigated, and now records **how to
  measure a per-tick number** (B8) — read that before comparing any perf
  figure to a carried one.
- `docs/ROADMAP-HOTEL.md` — phases H0–H7 to multiplayer.
- `docs/PHASE-H2.md` — **H2b's spec is already written.** Its §1 split
  ruling is the load-bearing part: H2b's diff is *forbidden* from changing
  `stateHash`, and the H2b review's first act is asserting every headless
  golden pinned at the H2a merge is byte-identical.
- `docs/reviews/phase-H2a.md` — the verdict, its five items, and the
  implementer addendum recording which four were closed before the merge.
  **Its consolidated H2b deferral list is H2b's input.**

## The development loop (docs/WORKFLOW.md)

Fable 5 plans a phase spec → Sonnet 5 implements → Fable 5 reviews the diff
into `docs/reviews/phase-N.md` → fix until PASS → merge. Invariant or
public-contract changes escalate to a Fable planning turn. This loop has
caught things every build passed; do not shortcut it.

## Commands (all verified green on `main` at handoff)

```
npm run check:workspace                # FIRST, in a fresh worktree
npm run build
npx eslint .
node scripts/check-purity.mjs          # 8 roots; --self-test also passes
npm test                               # smoke, hash 3849639990 — pinned, must not move
npm run test --workspaces --if-present # 491 checks
```

Headless gates, all with `--verify-replay` (exit 3 = replay divergence or a
write-through violation = P0):
`smoke`, `demo-walk`, `bots-headless`, `walk-collide`, `corridor-headon`,
`checkin-rush`, `fraud-catch`, `fraud-catch-b`, `zen-clean`, `first-hire`,
`escalation-stars`, `one-man-week`.

Soaks: `net-walk`, `net-interest`, `net-abuse`, `soak-ci` (all `--soak`).

Browser gates (`--browser --verify-replay`, `--browser-engine firefox` for
the second engine): `fps-look-interact` (both engines),
`reserva-readability` (both engines), `save-restore`, `demo-visual`.

`npm run harness --silent -- <name>` — `--silent` is required or npm's
banner pollutes the verdict JSON. Verdict JSON must be written inside the
repo, not to `/tmp`: on this machine Git Bash `/tmp` paths do not round-trip
to the Node process.

`.claude/launch.json` starts the app on port **5199**, not 5173 — 5173 is
routinely held by another session's dev server, and per the traps below a
live server on it looks exactly like a stale bundle.

## Enforced rules you cannot break

1. **Sim purity + the transcendental ban.** `packages/{core,space,interiors,surface-ui,bots,net}/src`
   and `apps/hotel/src/sim` are purity roots. No `Math.sin/cos/tan/atan2/pow/exp/log/hypot/cbrt`,
   no `Math.random`. Use `@claude-engine/space`'s `sim-math`.
   `check-purity.mjs --self-test` proves the checker bites.
2. **Integers in sim state.** Positions in millimetres, angles in
   millidegrees, ratios in permille with truncating division. **No float
   ever lands in a component** — `reviews.ts` and `economy.ts` are the
   files most exposed to this and say so at the top.
3. **Write-through — CLAUDE.md invariant 6, new in H2a.** Sim code mutates
   components ONLY via `setComponent()`. `stateHash()` caches a
   per-(component, entity) digest that the write path invalidates, so
   `pos.x += dx` is invisible to the hash. `stateHashSlow()` is the
   cross-check, run every 500 ticks and at the end of both the live and
   replay legs. **Read `stateHashSlow()`'s comment before trusting it**: it
   catches a violator that is the entry's LAST writer, and a violator
   followed by a normal write to the same entry heals silently. The window
   is bounded, not closed.
4. **No closure state.** `Sim.restore()` reruns `setup()` fresh. The
   `tickCtx` in game.ts is legal only because `ctxFor` keys it on `s.tick`
   and rebuilds when the tick differs; the clerk's deliberation timer is a
   `staffWork` component for exactly this reason.
5. **Yaw is sim state, pitch is presentation.** The interaction raycast only
   *proposes*; the sim revalidates range and arc. Same posture for screen
   clicks and for every screen effect — each one flows through one validated
   apply function that the command form also reaches.
6. **Hosts render, sims decide.** Anything hashed lives in the sim.
7. **Every gate must be non-vacuous.** Break what it tests, confirm red,
   restore — and say so. Two gates in H2a were vacuous when first written
   and only perturbation showed it.
8. **Constant command counts** on browser gates (currently
   `fps-look-interact` 12, `reserva-readability` 20, `save-restore` 69,
   `demo-visual` 18). A green streak over a varying count is not a pass.

## Traps already hit — each with its lesson

- **`pkill` does not kill the Windows dev server.** Use PowerShell
  `Get-NetTCPConnection -LocalPort <port> | Stop-Process`.
- **`tsc` incremental skips rebuilding when only `dist` was mutated.** A
  perturbation test must `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`
  before rebuilding, or the "restore" is a no-op and you draw the wrong
  conclusion. This bit twice more in H2a.
- **`npm run test -w @claude-engine/hotel` does not rebuild** when sources
  are unchanged, which is *why* a dist perturbation survives it — useful,
  but remember it when you expect a rebuild.
- **Under pointer lock, never move the mouse back to a previous x.** The
  deltas cancel and you silently do not turn.
- **`player-fps.onTick` submits its own `face` every tick**, so a `face` you
  `submit()` yourself is silently overridden.
- **Headless Chromium needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`**
  or Three's shaders fail silently to a blank canvas with no console error.
- **A gate can report a number that is not true.** Measure the artifact
  independently before trusting a probe's own figure.
- **A single-run `perf.avgTickMs` is cold-start JIT, not the sim.** The
  carried `checkin-rush ≤ 0.030` is not reproducible by that method on this
  machine even though the sim got ~35–40% faster. Use a warm in-process
  median and quote the method (ARCHITECTURE B8).
- **A browser scenario's `setup` builds only the REPLAY sim.** The page runs
  the app's own `setup()`. A browser gate can only click what the shipped
  world contains at the tick it runs — this is why H2a has no click gate for
  messes and candidates.
- **Subagents have reported "all green" when it did not reproduce.** Re-run
  gate claims yourself.
- **A fresh worktree resolves `@claude-engine/*` to the MAIN checkout.** No
  `node_modules` means Node walks up and finds the other tree's compiled
  `dist`. H2b opened with `TypeError: sim.stateHashSlow is not a function`
  for a function sitting compiled in this worktree's own dist. `npm run
  check:workspace` now catches it; the fix is `npm install` in the worktree.
- **Never hand-derive a browser gate's walk again.**
  `apps/hotel/scripts/derive-walk.mjs` emits the tick-gated script AND
  proves it by replaying it into a fresh sim, reporting the achieved pose
  and whether `interactSystem` would accept an interact from there. It does
  NOT verify the reticle raycast — pitch still has to be confirmed in the
  browser, and that is where every remaining hour goes.
- **`space`'s `findPathCells` is not clearance-aware.** The standing rule
  from the H1a review is real: routing a 300mm-radius agent through it
  returns a path down a column the agent cannot occupy, and the symptom is a
  follower that wedges at a doorway looking like a follower bug. Use the
  hotel's `findJitteredPath`.
- **A gate aimed along a queue is aimed at the wrong person.** `save-resume`
  spent a full tuning pass on pitch because the player stood INSIDE the
  queue line, 89mm from the guest in slot 4; the reticle hit that guest and
  `interactSystem` correctly refused it (presenting needs queueIndex 0).
  Approach a queue from the side, never down its length.
- **People wander into art shots.** `art-lock` failed for hours because
  first a guest and then a candidate stood between the camera and the
  monitor, and the reticle resolved to a PERSON. The symptom was only
  "screenRect() returned undefined"; the cause was visible nowhere but in
  the screenshot. The `look-lock` config exists to clear the set.
- **Colour space is not a detail.** Tagging the synthesized atlas
  `SRGBColorSpace` made Three decode every sample to linear with no matching
  re-encode and the hotel rendered three times too dark. Caught by comparing
  against a committed screenshot, not by any gate.
- **Baked lighting needs a per-face term.** Positional falloffs alone vary
  across the floor plan and not with orientation, so opposite walls render
  identically and a room reads as noise. The pre-H2b build hid this behind a
  strong runtime DirectionalLight.

## What is NOT built

No textures or UVs (untextured vertex-colour only), no PS1 shader, **no
audio at all**, no `@claude-engine/audio` package, no `frame-time-p95` /
`draw-calls` probes, no load-on-boot persistence (F5/F9 only), no camera
boom clip. No multi-floor, stairs or elevators. No PURCHASE / CCTV /
BLUEPRINT / STREETVIEW (the registry stops at six apps). No housekeeper or
maintenance NPCs — the player is still the zen loop. No role XP, mastery,
prestige, contracts, inspections, loans. No guest archetype behaviours. No
forgery visuals. No multiplayer wiring.

## Open items carried into H2b (full list in `docs/reviews/phase-H2a.md`)

1. **The upkeep-click browser gate.** Messes, props, candidates and printed
   résumés render and are clickable — verified by driving the running build
   (evidence: `apps/hotel/docs/evidence/h2a-upkeep-objects.png`) — but there
   is **no repeatable gate** for those clicks, because of the browser-setup
   trap above. The reviewer's ruling: acceptable for H2a, and **if H2b
   arrives without it, H2b's review should treat it as blocking.** The
   suggested route is a scenario config that pre-dirties a lobby-adjacent
   room at setup.
2. **The H1b carries, all H2b-scheduled by the spec's own ledger:**
   quick-load id-switch + `listGames`/`deleteGame` + the `"./recover"`
   exports subpath + the `save-resume` gate (which must not inherit
   `save-restore`'s pinned-pose no-op dependency); `resetEntityKeyedHostState()`
   exercised for real — it now also clears the upkeep interactable guard;
   `player-fps`'s `objectToEntity` reverse-map prune; the boom clip.
3. **Phase 3+ carries, triggers unchanged:** `space` clearance-aware A*
   extraction (second consumer or crowd scale); guests never close doors;
   `debug.*` rejection in server validation (Phase 5, before any remote
   actor exists).

## Verified starting facts for H2b

- **Byte-identical goldens are H2b's first review check.** As pinned at this
  merge: smoke **3849639990**, `checkin-rush` **1978775531**,
  `one-man-week` **3423109909**. The interiors mesh golden re-pins in H2b
  (that is expected and named in the spec); nothing else may move.
- `one-man-week` runs 42,000 ticks at **0.445 ms/tick** against a 1.0
  budget, at ~195 entities.
- The incremental hash is **6.6×** cheaper than the full walk at a
  300-entity fixture — below the ≥10× the spec expected, recorded as
  measured.
- `reserva-readability` reads texelScale **1.38**, calibContrast **241.3**,
  pitchErr **0**. H2b's `art-lock` must hold ≥1.0 / ≥60 / ≤0.1 with the PS1
  shader live on everything else.
- The shell registry is `["reserva","audit","ledger","pricer","mailbox","staff"]`,
  exported as `HOTEL_APPS`; the composed-shell overflow gate derives its
  list from it, so app seven cannot silently skip the gate.
- `ScreenViewData` is at **exactly 9 of its 9-key budget**. A tenth key is
  the moment to ask whether the view should be per-app, not the moment to
  add the key.
- **The remote is stale.** `origin/main` is 48 commits behind local `main`
  and carries one commit local `main` does not (`6056b9f`, a CI build-order
  fix) whose substance the local build script already supersedes. Nothing in
  this project has been pushed; decide deliberately before you do.
