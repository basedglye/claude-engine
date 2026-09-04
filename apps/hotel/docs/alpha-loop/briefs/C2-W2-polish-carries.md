# C2-W2 — Polish: the cycle-1 non-blocking carries

You are lane C2-W2 of three concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained.

---

## 0. Orchestration rules (verbatim, non-negotiable)

1. **"Do this work yourself. Do not spawn subagents."** Two agents in H2b
   spent their entire budget re-delegating and returned having done
   nothing — roughly 140k tokens for zero output.
2. **"Do not run any `git` command. Do not commit, do not `git add`, do
   not stash."** The orchestrator commits.
5. **A lane may not edit a file outside its declared globs.** If it needs
   to, it stops and reports the need.
7. **Every lane brief carries a verification command list and a
   non-vacuity obligation.** The obligation is specific: *break this exact
   thing, confirm the gate reds on this exact assertion, restore by clean
   rebuild, confirm green, report all four exit codes.*
8. **Every lane brief carries the rebuild discipline verbatim:** before
   any perturbation claim, `rm -f apps/hotel/tsconfig.game.tsbuildinfo &&
   rm -rf apps/hotel/dist-game` then rebuild — otherwise the "restore" is
   a no-op. This trap has bitten four times.
9. **Verdict JSON is written inside the repo.** Git Bash `/tmp` paths do
   not round-trip to the Node process on this machine.
10. **`npm run harness --silent -- <scenario>`** — without `--silent`,
    npm's banner pollutes the verdict JSON.
11. **Report format, fixed:** files touched; every command run with its
    exit code; the perturbation performed and the exact assertion that
    went red; **and what you did NOT do**. A lane that could not finish
    says so; a lane that skipped a verification step says so, unprompted.
13. **A finished lane does not pick up new work.** It reports and stops.

## 0.1 Dev-server rule

`npm run dev -w apps/hotel -- --port 5204 --strictPort`. **Port 5204 is
yours.** Never 5199 (`.claude/launch.json`'s port), never 5173 (routinely
held by another session; a live server there looks exactly like a stale
bundle), never 5202/5203/5205 (other live lanes). Kill it when done —
`pkill` does not kill the Windows dev server; use
`Get-NetTCPConnection -LocalPort 5204 | Stop-Process`.

---

## 1. Goal

Cycle 1 shipped the whole loop and passed its review gates with a short
list of non-blocking items the reviewer deliberately carried rather than
blocking on. You close them. There are four named carries and one fresh
look. **Nothing here is a new feature**; if you find yourself designing,
you have left the brief — stop and report.

Read first (do not edit): `apps/hotel/docs/VISION-ALPHA.md` (binding),
`apps/hotel/docs/ALPHA-LOOK.md` (its traps section, and the tier-2 look you
must not regress), and `apps/hotel/docs/alpha-loop/BREAKDOWN.md` §1 (every
constant is already decided there — a constant you find wrong is reported,
never silently retuned).

---

## 2. Files you may touch (nothing else)

```
apps/hotel/src/render/lighting.ts       (carry 1)
apps/hotel/src/render/procedural.ts     (carry 2)
apps/hotel/src/sim/game.ts              (carry 3)
scenarios/alpha-loop.scenario.mjs       (carry 4)
apps/hotel/dev/tour.ts                  (carry 5, only if a fix needs a pose)
apps/hotel/docs/alpha-loop/C2-W2-shots/**   (new directory, yours — evidence frames)
```

**Read-only for you:** everything else. Specifically:
`architecture.ts`, `decor.ts`, `fixtures.ts`, `exterior.ts`, `hud.ts`,
`i18n.ts`, `walkthrough.ts`, `assets.ts`, `quality.ts`, `floorplan.ts`,
`characters.ts`, `upkeep.ts`, `screens.ts`, `documents.ts`,
`door-leaf.ts`, everything under `src/sim/` except `game.ts`, every other
scenario, every other file under `apps/hotel/dev/`
(`playtest.mjs` belongs to a live lane), and every other file under
`apps/hotel/docs/`.

**Contested — orchestrator-only:** `apps/hotel/src/main.ts`,
`apps/hotel/index.html`, `apps/hotel/package.json`, `package.json`,
`package-lock.json`, `apps/hotel/vite.config.ts`,
`apps/hotel/assets.manifest.json`, `.claude/launch.json`, `CLAUDE.md`,
`docs/**`, and everything under `apps/hotel/docs/` other than your shots
directory.

If a carry cannot be closed inside these globs, **stop and report the
file you need**. Do not widen the glob yourself.

---

## 3. The five carries

### Carry 1 — Diagonal sun-shadow streaks on tier-0 interior walls

**Where:** `apps/hotel/src/render/lighting.ts`, the `sun`
`DirectionalLight` built from the `ROOM.STREET` rect (around line 183).
Its shadow camera is an orthographic box sized
`Math.max(street.widthM, street.depthM) / 2 + 4` with `far = 40` — wide
and deep enough to reach through the building, so exterior geometry casts
diagonal streaks across interior walls where there is no sun.

**The fix, decided here so you do not invent it.** The sun is an exterior
light; its shadow map has no business sampling interior architecture. Two
acceptable approaches — pick one and justify it in your report:

(a) **Clamp the shadow camera to the street.** Size the ortho box and
`near`/`far` so the frustum covers the street rect and its immediate
apron only, and position the light so the box does not intersect the
building's interior volume.

(b) **Layer separation.** Put interior architecture on a Three.js layer
the sun's shadow map does not sample, leaving exterior geometry lit and
shadowed as it is today.

**Not acceptable:** disabling shadows, dropping `castShadow`, or lowering
`shadowMap` quality. `fps-look-interact`'s frame budget and the verified
tier-2 look both depend on the current shadow setup, and turning the
symptom off is not closing the carry.

**Applies at every tier**, not only tier 0 — the streaks are most visible
against tier 0's flat paint but the geometry is the same at tiers 1 and 2.
Which means this is the one carry that can plausibly change tier 2's
appearance, so §5's tier-2 evidence matters most here.

### Carry 2 — Tier 0 reads "dated office", not "seedy motel"

**Source:** `reviews/W2.md` item 4, held open through round 2 §4, with the
reviewer's own note that "if cycle 2's playtest says the opening reads
flat, the levers are tier 0's ambient/hemisphere and dirtying
`scuffedPaintTexture` around the wainscot line, and it is a small pass."

That is your scope, exactly: tier 0's ambient/hemisphere in `lighting.ts`,
and `scuffedPaintTexture` in `procedural.ts` (dirt/grime gradient around
the wainscot line). The intent, from VISION-ALPHA: *tired*. The
fluorescent troughs should be the only bright thing in the room.

**The floor is the readability probe.** `reserva-readability` must not
move — if your tone pass changes its verdict or its command count (exactly
20), the pass is too dark and you revert rather than argue. Taste is
yours; the probe is not negotiable.

**Tier 1 and tier 2 must be untouched by this carry.** Every edit is
inside a `hotelTier === 0` branch or inside a `procedural.ts` generator
that only tier 0 calls.

### Carry 3 — `overflowWaitCells` is not deduped against `candidateWaitCells`

**Source:** `reviews/W1.md` §6 carry 1.

**Where:** `apps/hotel/src/sim/game.ts`, the two IIFE-built pools around
lines 676 (`candidateWaitCells`) and 725 (`overflowWaitCells`). Both sit in
the same street-side region and nothing prevents a cell appearing in both.
A parked STAFF candidate and a parked overflow guest handed the same cell
is the same "two agents, one goal cell" family round 3 closed — merely
rarer.

**The fix the reviewer named:** exclude `candidateWaitCells` from
`overflowWaitCells` at build time. `candidateWaitCells` is built first, so
this is an exclusion set in the second IIFE, in the same shape as the
existing `doorIndexByCell` and `streetCell` clearance exclusions
immediately above it.

**This is a sim change and it is a stream change.** Excluding a cell moves
which cell a guest is assigned, which moves the command stream, which
moves every headless hash. That is expected and allowed — cycle 1 did the
same thing. What is **not** allowed is a `--verify-replay` *divergence*
(exit 3) or `stateHash` disagreeing with `stateHashSlow`; either is a P0,
is a write-through violation until proven otherwise, and is never answered
by loosening an assertion (CLAUDE.md invariant 6).

Constraints, from the same file's existing comments: the pool must stay
**seed-pure** and deterministic (no bare object-key iteration, sorted
order, no `Math.random`, no transcendental `Math.*`, no float in sim
state), and it must not shrink so far that tier-2's dozens of simultaneous
overflow arrivals re-create the jam that round 3 fixed. **Report the pool
size before and after**, and report `nav.stuck` from `alpha-loop`'s event
histogram before and after — it was driven to 0 and must stay there.

### Carry 4 — No bot beat submits a bare `renovateCommand` while broke

**Source:** `reviews/W1.md` §6 carry 3 (round 2 §5 / round 3 §3.2 / round
4 §4.6). The unit half is covered — `test.mjs` drives all four refusal
reasons through `renovateCommand`. The scenario half is not: no *bot*
beat in `alpha-loop` presses RENOVATE when it cannot afford it, so the
`insufficient-cash` refusal is untested through the real command path a
player uses.

**Where:** `scenarios/alpha-loop.scenario.mjs`. Add one beat, early in the
run while the hotel is provably broke, that submits a bare
`renovateCommand(tick)` and asserts the resulting `screen.denied` carries
`reason: "insufficient-cash"` — and that `hotel.tier` is unchanged and no
`ledgerEntry` was spawned. Validation order is fixed (range → max-tier →
stars → cash), so pick a tick where cash is the *first* failing check, or
the reason will be `stars-too-low` and your assertion will be asserting
something else.

`apps/hotel/scripts/test.mjs` is **not yours** this cycle — if you want a
unit assertion added there, ask in your report.

### Carry 5 — A fresh look at `dev/tour.html` at tiers 0/1/2

Open `http://localhost:5204/dev/tour.html?hotelTier=0` (and `1`, and `2`)
and look. `tour.ts` supports `?tick=&x=&z=&yaw=&pitch=&hotelTier=&fly=1`
and `?debugRooms=1` — it is the fastest way to look at anything.

Report anything obviously wrong. **Fix only what is inside your globs and
is unambiguously a defect** (a mis-shaded surface, a z-fighting seam, a
prop through a wall). Anything that is taste, anything in another lane's
file, anything that needs a new asset: **write it down, do not fix it.**
The reviewer's z-fighting lesson from cycle 1 applies — isolate a
rendering artifact by hiding meshes by name in the tour page before
touching depth settings.

---

## 4. Verification commands and expected outcomes

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
npm run test --workspaces --if-present         # exit 0
```

`npm test`'s smoke hash is the **engine demo**, not the hotel — carry 3
must not move it. If it moves, you have changed something outside the
hotel and you stop.

**Full headless sweep, every one with `--verify-replay`.** Carry 3 will
move the hotel hashes; that is a re-pin, and you report the new value for
each:

```
npm run harness --silent -- smoke             --verify-replay
npm run harness --silent -- demo-walk         --verify-replay
npm run harness --silent -- bots-headless     --verify-replay
npm run harness --silent -- walk-collide      --verify-replay
npm run harness --silent -- corridor-headon   --verify-replay
npm run harness --silent -- checkin-rush      --verify-replay
npm run harness --silent -- fraud-catch       --verify-replay
npm run harness --silent -- fraud-catch-b     --verify-replay
npm run harness --silent -- zen-clean         --verify-replay
npm run harness --silent -- first-hire        --verify-replay
npm run harness --silent -- escalation-stars  --verify-replay
npm run harness --silent -- one-man-week      --verify-replay
npm run harness --silent -- alpha-loop        --verify-replay
```

Expected: `passed: true` and `exit 0` on all thirteen, incremental and
slow hash agreeing on every one. **Any exit 3 is a P0** — replay
divergence or a write-through violation — and is never answered by
loosening an assertion. Report the new hash for every scenario whose hash
moved, and confirm `alpha-loop` still reaches tier 2 and closes solvent
inside 14 in-game days.

**Browser gates** (`--browser --verify-replay`):

```
npm run harness --silent -- reserva-readability --browser --verify-replay
npm run harness --silent -- fps-look-interact   --browser --verify-replay
npm run harness --silent -- demo-visual         --browser --verify-replay
npm run harness --silent -- save-restore        --browser --verify-replay
```

Expected: exit 0, replay verified, command counts still exactly **20**
(`reserva-readability`), **12** (`fps-look-interact`), **18**
(`demo-visual`), **69** (`save-restore`). A green streak over a varying
count is not a pass.

**Visual evidence, into `apps/hotel/docs/alpha-loop/C2-W2-shots/`.** Shoot
on a real GPU — Playwright's bundled Chromium picks SwiftShader and the
full look measured 1–3 s per frame, so use
`chromium.launch({ headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"] })`.
`artifacts/shoot.mjs` and `artifacts/tour.mjs` are working references.

- **Five tier-0 poses**, before and after, showing (i) the sun streaks
  gone and (ii) the tone change.
- **Two tier-1 poses**, before and after, confirming tier 1 still reads as
  a real step up from tier 0.
- **Five tier-2 poses**, after, compared **by eye at full size** against
  `apps/hotel/docs/evidence/alpha-look-{lobby,desk,corridor,bedroom,facade}.jpg`.
  Report the triangle counts alongside; the reference facade reads ~1,051k
  and deltas of a few hundred (guests in frame) are expected, an order of
  magnitude is not.

---

## 5. The tier-2 non-regression rule

**Tier 2 is the verified look and it does not move.** The discipline that
held for two review rounds in cycle 1 holds here: every edit is inside a
tier-0/1 branch, or is a pure `if (hotelTier === 2) return <what it did
before>` guard. Carry 1 is the exception that needs the most care —
shadows are shared across tiers — so for carry 1 specifically, state in
your report exactly what tier 2 looked like before and after and why the
change is safe.

Any tier-2 diff that is not provably a no-op is an automatic reject.

---

## 6. Non-vacuity obligation

Two perturbations, both with all four exit codes.

**A — carry 3 (the sim change), against `alpha-loop`.**

1. Run `npm run harness --silent -- alpha-loop --verify-replay` clean.
   Expect exit 0, `passed: true`.
2. **Perturb:** remove your `candidateWaitCells` exclusion from
   `overflowWaitCells` (i.e. restore the pre-fix behaviour) **and** tighten
   the assertion you added for it so the shared cell is detected. Then
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, re-run. Expect a red on a named
   assertion; **quote the exact assertion string** and record the exit
   code. (If the two pools do not actually overlap on this seed's floor,
   say so — that is a real and reportable finding, and you substitute a
   perturbation that *does* red, naming the substitution explicitly. Do
   not manufacture a green.)
3. **Restore**, then `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, re-run. Expect green.
4. Report **all four exit codes**.

**B — carry 4 (the new bot beat).** Same four-step cycle: green → change
the sim's validation order so `insufficient-cash` is not the reason your
new beat gets → confirm the beat reds on its exact assertion → restore by
clean rebuild → green. This proves the beat is asserting on the real
refusal and not on the mere presence of a `screen.denied`.

**C — carry 1, by eye.** Not a gate, so evidence is the frames: the same
tier-0 pose before and after, at full size, with the streak visible in one
and absent in the other. If you cannot produce a "before" frame that shows
the streak, say so — it means you have not reproduced the defect and your
fix is unvalidated.

---

## 7. Report format (fixed)

1. **Files touched** — every path with a one-line summary.
2. **Every command run, with its exit code**, including all thirteen
   headless verdicts and all four browser verdicts with their command
   counts.
3. **Hashes**: the new hash for every scenario whose hash moved, and
   confirmation that `npm test`'s smoke hash 3849639990 did not.
4. **The perturbations** — A and B, each with what you broke, the exact
   assertion string that went red, and all four exit codes; plus C's
   before/after frames.
5. **Per carry (1–5)**: what you did, or why you did not, with evidence.
   Carry 3 additionally reports the pool size before/after and `nav.stuck`
   before/after. Carry 5 reports everything you saw, including what you
   chose not to fix and why.
6. **Tier-2 non-regression** — the five poses, the comparison verdict, the
   triangle counts, and for carry 1 specifically why the shadow change is
   safe at tier 2.
7. **What you did NOT do** — anything skipped, unfinished, or only
   partially verified. Say it unprompted.
8. **Wiring you need from the orchestrator** — at minimum, whether you
   want a unit assertion in `apps/hotel/scripts/test.mjs` for carry 4.
