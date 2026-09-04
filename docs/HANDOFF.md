# ClaudeEngine / GRAND FOYER — park handoff

Written 2026-09-04 by the park session (Opus-tier lead, no feature work).
Records **verified state**: everything below was run by this session, in
this tree, not taken from a subagent's or a branch's own report. The
per-app narrative handoff lives at `apps/hotel/docs/HANDOFF.md` (H2b's,
refreshed 2026-09-02) and is still accurate for how the sim works; this
file is the repo-level index of what is on `main` today and how to resume.

## How to resume (one paragraph)

`main` now carries H2a + H2b + the grand-foyer alpha loop (cycles 1–5)
in one tree, commit `3ee51c6`, plus the docs commit and the low-token
assessment merge after it (`main` = `5171469`). Open a fresh
worktree off `main`, run `npm ci`, `npm run check:workspace`, `npm run build`,
`npm test`, `npm run check:goldens` (12/12 expected), and
`npm run assets:fetch -w apps/hotel` (the CC0 pack is not in git; without it
the hotel renders in flat fallback colours). Start the app with
`.claude/launch.json` (`hotel`, port 5199) and drive it — pointer lock only
works in a real headed browser, not the in-app pane or headless Playwright;
`node apps/hotel/dev/playtest.mjs http://localhost:5199 artifacts/playtest`
drives the running build through the command hook and screenshots each
beat. The first H2b item is to make the flagship path (door → desk → take
papers → RESERVA accept/deny → night audit) a **repeatable browser gate**
on both engines with a constant command count, replacing the four
H2b browser gates that went red at the merge (below). The second is to
re-open the H2b review at `docs/reviews/phase-H2b.md` against the merged
renderer: it was written against the PS1 atlas look, which the merge took
off the level mesh.

## What is on `main` (verified 2026-09-04)

- `28e554a` H2a merged (unchanged).
- `hotel-phase-2b` (`7205a56`) merged, plus origin's CI fix `6056b9f`.
- `claude/grand-foyer-game-alpha-50b07d` (`2703e36`) merged on top:
  `3ee51c6`. Seven conflicts, one rule: **the alpha branch's renderer wins
  every rendering hunk** (architecture/exterior/fixtures/decor modules, the
  tiered scenery swap, the lighting rig with `defaultLights: false`, the
  CRT rig, mess/prop rigs, door leaves). H2b's additive pieces stay:
  three-host `ambientIntensity`/`keyLightIntensity` next to alpha's
  `defaultLights`/`onRendererCreated`; `listGames`/`deleteGame` boot
  recovery with live `gameId` **and** alpha's `memoryStore` fallback (which
  gained the two methods); the RESERVA relayout (ACCEPT/DENY on the action
  bar at y=434, not alpha's y=104); the persistence `./recover` subpath.
- **H2b's PS1 atlas/vertex-bake pipeline is still in the tree**
  (`packages/interiors/src/atlas.ts`, `mesh-gen.ts` UVs + light bake,
  `createRetroMaterial`, `apps/hotel/src/render/atlas.ts`, `look-lock.ts`)
  but is **no longer applied to the level mesh** — alpha's
  `buildArchitecture` replaced the `floor-mesh` scenery. Re-wiring it is a
  design call for the next look pass, not a regression to fix blind.
- `claude/fable-low-token-game-builds-b69bfc` (`6887eea`) merged as
  `5171469`, docs only: `docs/ASSESSMENT-low-token-game-builds.md`. No
  code moved, so the verification table below still stands.
- Alpha's `derive-walk.mjs` (a different tool with the same name as H2b's)
  is kept as `apps/hotel/scripts/derive-walk-c3.mjs`.
- Goldens re-pinned to the alpha values in `scripts/golden-sweep.mjs`:
  measured on the alpha branch alone and on the merged tree, **identical
  for all nine that moved**, so H2b carried zero sim-visible change across
  the merge. Interiors mesh/non-mesh hashes re-pinned for alpha's deeper
  lobby (`layout.ts`).
- `apps/hotel/scripts/test.mjs`: the AUDIT overflow gate paints a fully
  revealed view (tick 1000). It failed on the alpha branch itself because
  the C4 reveal cadence hides objective rows at tick 1.
- `apps/hotel/dev/playtest.mjs`: ACCEPT/DENY rects updated to the merged
  layout.

## Verification results on the merged tree

| Check | Result |
| --- | --- |
| `npm run build` | green |
| `npx eslint .` | green |
| `node scripts/check-purity.mjs` | green, all roots |
| `npm test` (smoke) | green, hash 3849639990 unchanged |
| `npm run test --workspaces` | 609 checks, 0 FAIL |
| `npm run check:goldens` | 12/12 byte-identical (re-pinned, see above) |
| `alpha-loop --verify-replay` (headless) | PASS, 84000 ticks, hash 4145888666 |
| `fps-look-interact --browser --verify-replay` | PASS, 16 commands |
| `reserva-readability --browser --verify-replay` | PASS, 21 commands |
| `save-restore --browser --verify-replay` | PASS, 69 commands |
| `demo-visual --browser --verify-replay` | PASS, 18 commands |
| `art-lock --browser` | **RED** (see below) |
| `save-resume --browser` | **RED** |
| `upkeep-click --browser` | **RED** (infra: walk never drains) |

Browser gates ran on Chromium only; the Firefox second-engine runs were
not executed this session.

Driven by hand (Playwright against the dev server on 5199, and the alpha
playtest driver): title overlay, entry, walking through the entrance door,
the lobby with alpha's architecture/ceiling grid/paintings/desk, the CRT
showing the H2b RESERVA idle screen with the procedures card. Screenshots
are in `artifacts/` (git-ignored). The playtest driver's continuous
service loop hit its known B9 limit (cuts off before the sim day advances)
— that is the driver, not the game, and was already recorded in
`apps/hotel/docs/alpha-loop/C2-W1-blockers.md`.

### The four red browser gates, and why (NOT fixed — park, not build)

All four are H2b gates whose literals were derived against the H2a
layout and the PS1 look; alpha deepened the lobby (20–24 cells) and
replaced the renderer.

1. `art-lock`: every assertion passes; the probe budgets fail.
   `screen-readability.calibContrast` reads **212.09** against the pinned
   241.32 (texelScale 1.38 and pitchErr 0 still exact), and
   `frame-time-p95` reads **183.7 ms** against the 170 ms software ceiling
   — alpha's shadow-casting rig is heavier than the vertex bake. Both
   numbers are the H2b review's to re-rule, not this session's.
2. `save-resume`: 28 of 29 commands; the post-restore guest click misses
   because the guest's spawn/walk pose moved with the lobby.
3. `upkeep-click`: exit 2, 15 tick-gated inputs never drained by tick 55
   — the walk script wedges in the deeper lobby before the queue empties.
4. `alpha-loop` has no browser spec; it is headless-only and is green.

The first H2b item (the flagship browser gate) subsumes 2 and 3: derive
one walk with `apps/hotel/scripts/derive-walk.mjs` against the merged
layout and build the gate on it, then retire or re-derive the two.

## Commands

```
npm ci
npm run check:workspace
npm run build
npx eslint .
node scripts/check-purity.mjs
npm test
npm run test --workspaces --if-present
npm run check:goldens
npm run harness --silent -- <scenario> [--browser] [--browser-engine firefox] --verify-replay
npm run assets:fetch -w apps/hotel
node apps/hotel/dev/playtest.mjs http://localhost:5199 artifacts/playtest <label>
```

Verdict JSON must be written inside the repo (Git Bash `/tmp` does not
round-trip). `--silent` is required or npm's banner pollutes the JSON.

## Enforced rules (CLAUDE.md invariants 1–6, unchanged)

Sim purity and the transcendental ban; 20 Hz determinism through `Rng`;
replay equivalence (seed, input log); hosts render, sims decide; engine
owns netcode/persistence/auth; **write-through via `setComponent()` only**
— `stateHash()` is incremental and the harness cross-checks
`stateHashSlow()` on every run (exit 3 is a P0). Every gate must be
non-vacuous, and browser gates hold a constant command count.

## Traps hit this session

- Two branches added a file with the same name and different contents
  (`derive-walk.mjs`); an add/add conflict resolved by "pick one" silently
  deletes a tool the docs cite. Keep both, rename one, fix the citations.
- A merge can be sim-clean and still move goldens: re-measure the
  *incoming* branch alone before re-pinning, so a re-pin is a comparison
  and not a shrug. Here alpha alone == merged tree for all nine.
- A test can be red on its own branch and only get noticed at merge
  (the AUDIT overflow gate). The alpha branch's reviews reported the
  hotel test suite green; it was not.
- Pointer lock is refused in the in-app Browser pane and in headless
  Playwright; the overlay re-appears on every lock loss. Drive through the
  command hook (playtest driver / harness), or a real headed browser.
- The CC0 asset pack is not in git; a fresh worktree renders flat colours
  and prints a banner. Fetch it before judging the look.

## What is NOT built

- No repeatable browser gate for the flagship path (first H2b item).
- The H2b review (`docs/reviews/phase-H2b.md`, FIX-LIST, 1 blocking
  closed) predates the merge and rules on a look that is no longer on the
  level mesh; no merged-tree review exists.
- The human look-lock sign-off (`LOOK-LOCKED: <commit>`) has never been
  recorded.
- Firefox second-engine runs of the browser gates on the merged tree.
- The H2b retro material on alpha's architecture/prop rigs.
- `Hotel.previousStars` for the AUDIT star delta; the human
  door-to-end-card sitting (alpha C4 item 3).

## Side branches and worktrees (inspected, nothing deleted)

- `.claude/worktrees/optimistic-mahavira-9a3e26` is **not** detached at
  `e17a033` any more: it is checked out on
  `claude/fable-low-token-game-builds-b69bfc` at `6887eea` (the Fable
  Cities one-prompt build assessment, reconciled with the /oneshot
  skill), clean tree, no untracked files. **Now merged into `main`** as
  `5171469`; the branch and worktree hold nothing unique. The branch
  `claude/optimistic-mahavira-9a3e26` itself points at `59bfc18`
  (= `hotel-phase-2`, already in `main`).
- `claude/steam-giveaway-winner-leaderboard-814990` (worktree
  `zealous-villani-6ff919`) is at `28e554a` = old `main`, zero unique
  commits, clean tree, nothing stashed. It holds nothing.
- No stash entries exist. The `hotel-phase-2b` and alpha worktrees are
  clean and fully merged.

## Next actions, in order

1. **Flagship browser gate** (first H2b item): scenario `flagship-path`
   with `--browser --verify-replay` on Chromium and Firefox, constant
   command count, non-vacuity proven by perturbation, walk derived with
   `derive-walk.mjs` against the merged layout. Subsumes the red
   `save-resume`/`upkeep-click` walks.
2. **Re-open the H2b review** against `main` at `3ee51c6`: re-rule the
   art-lock budgets (contrast 212, p95 183.7 ms) and decide whether the
   retro material returns on alpha's rigs; record `LOOK-LOCKED` after
   Chris drives it with the asset pack fetched.
