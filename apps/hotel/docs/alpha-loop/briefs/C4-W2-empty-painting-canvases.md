# C4-W2 — Empty painting canvases at tier 2 (W3-3)

You are lane C4-W2 of two concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained.

---

## 0. Orchestration rules (verbatim, non-negotiable)

1. **Do this work yourself. Do not spawn subagents.**
2. **Do not run any `git` command.** No commit, no add, no stash. The
   orchestrator commits.
3. **You may only edit `apps/hotel/src/render/decor.ts`.** Nothing else.
   If a fix genuinely requires touching another file, stop and report the
   exact file and why — do not widen scope yourself.
4. **Rebuild discipline, verbatim, before ANY perturbation claim:**
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`
   then rebuild. A "restore" claim without this is a no-op.
5. **Report format, fixed:** files touched; every command run with its
   exit code; the perturbation performed and the exact visual check that
   went red (screenshot description); confirmation that no golden moved;
   what you did NOT do.
6. **When done, stop.** Do not pick up C4-W1's work.

## 0.1 Dev-server rule

`npm run dev -w apps/hotel -- --port 5203 --strictPort`. **Port 5203 is
yours.** Never 5199 (`.claude/launch.json`'s port), never 5173, never
5202/5204/5205 (other/prior lanes). Kill it when done:
`Get-NetTCPConnection -LocalPort 5203 | Stop-Process`.

---

## 1. Goal

Read first (do not edit): root `CLAUDE.md` invariants — this task is
host-render-only (`apps/hotel/src/render/**`), no sim purity/determinism
concerns apply to `decor.ts` itself (it's outside `apps/hotel/src/sim/**`
and outside `packages/core/src/**`), but it must NOT call `Math.random()`
either — `decor.ts`'s own header comment already establishes the pattern
this file uses: `hashInt()` chaining, never `Math.random`. Also read
`apps/hotel/docs/alpha-loop/BALLAST-1.md` item 6 (R1/W3-3) and
`apps/hotel/docs/alpha-loop/reviews/C3-W3.md` §R1 if present, for the
original finding this closes.

**The bug:** paintings render as bare gilt frames at tier 2 (real Poly
Haven glTF models loaded) — the procedural canvas artwork the frame is
supposed to contain is invisible, even though `paintingCanvasTexture()`
clearly runs and produces a real deterministic gradient+brushstroke
texture.

---

## 2. Files you may touch (nothing else)

```
apps/hotel/src/render/decor.ts
apps/hotel/docs/alpha-loop/C4-W2-shots/**   (new directory, yours)
```

**Read-only for you:** `apps/hotel/src/render/assets.ts` (has
`fitToFootprint`, `loadModel`, `makePbrMaterial` — you need to READ
`fitToFootprint`'s behavior to diagnose this, but do not edit it — if the
real fix requires changing `fitToFootprint`, stop and report exactly why,
that is a shared function other builders use too and an unreviewed change
there is out of scope), `placement.ts`, `architecture.ts`, `fixtures.ts`,
everything else.

---

## 3. Diagnosis (start here, verify before fixing)

`buildPainting` in `decor.ts` (around line 257):
```ts
function buildPainting(seed: number): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.04), mat("wood-trim", 0x5a3d24, 0.5));
  g.add(frame);
  shadowize(g);
  upgrade(g, wrapChildren(g), "painting", { w: 0.7, d: 0.05, h: 0.5 });

  const texture = paintingCanvasTexture(seed);
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
  canvas.position.z = 0.025;
  shadowize(canvas);
  g.add(canvas);
  return g;
}
```
`upgrade()` (around line 54) does:
```ts
function upgrade(parent, fallback, modelName, footprint): void {
  parent.add(fallback);
  const tierAtSchedule = activeTier;
  if (tierAtSchedule !== 2) return;
  void loadModel(modelName).then((loaded) => {
    if (!loaded) return;
    fitToFootprint(loaded.scene, footprint);
    fallback.visible = false;
    parent.add(loaded.scene);
  });
}
```
`wrapChildren(g)` at the call site only wraps `g`'s children AT THAT
INSTANT (just `frame` — `canvas` is created and added to `g` two lines
later, so it is NEVER inside the `fallback` group `upgrade()` hides). So
tracing the code: `canvas` should stay a visible sibling of `g` no matter
what the glTF does. **Confirm this reasoning is actually correct by
reading the real file** (line numbers may have drifted) before assuming
the bug is elsewhere.

The live hypothesis, unconfirmed, yours to check: `fitToFootprint(loaded
.scene, { w: 0.7, d: 0.05, h: 0.5 })` repositions/scales the loaded glTF's
local geometry to fit that footprint box. Read `fitToFootprint` in
`assets.ts` to see exactly how it centers the model along each axis. If
it centers the model's own bounding box at local origin (likely, and
correct for w/h), the model's front face along z could end up anywhere
within roughly `[-d/2, +d/2] = [-0.025, +0.025]` of local origin — i.e.
its front surface could sit AT OR IN FRONT OF `z = 0.025`, the fixed
z-position the canvas plane was given at build time, before the glTF's
actual bounds were known (the canvas is built and positioned
synchronously; the glTF loads asynchronously and its true depth is
unknown until then). A frame's front face at or past the canvas plane's
z either z-fights it or fully occludes it — visually indistinguishable
from "no canvas at all," matching the reported bug exactly.

**Confirm before fixing.** Cheapest confirmation: temporarily push the
canvas plane's z way out (e.g. `z = 0.15`, clearly in front of any
plausible frame depth) in a scratch edit, rebuild, load tier 2 in the dev
server, and see if the canvas suddenly appears clearly in front of (now
floating obviously off) the frame. If yes, the z-depth-vs-glTF-bounds
hypothesis is confirmed and the real fix is picking a z that reliably
clears the glTF's actual front face without floating unnaturally far off
the frame. If the canvas still doesn't appear even at z=0.15, the
hypothesis is wrong — stop, look at whether `loaded.scene`'s material
itself might be opaque and literally covering the frame's full footprint
including where the canvas sits from a different angle, or whether
`fallback.visible = false` is somehow also hiding `canvas` (check if
`canvas` was ever accidentally added to `fallback`/`g`'s wrapped children
in some code path you haven't seen) — and report exactly what you found.

---

## 4. The fix

Once confirmed, pick the most honest fix:
- **Preferred:** don't guess a static z. After the glTF load resolves
  inside `upgrade()`'s `.then()`, you don't have a hook back into
  `buildPainting`'s canvas mesh today — so the practical fix likely stays
  in `buildPainting` itself: pick a z that is safely in front of the
  frame's DECLARED footprint depth regardless of what the glTF turns out
  to look like, e.g. `canvas.position.z = footprint.d / 2 + <margin>`
  computed from the same `{ d: 0.05 }` passed to `upgrade()` (so the two
  numbers can't drift apart silently — define the footprint object once
  and reuse `footprint.d` for both the `upgrade()` call and the canvas
  z-offset, rather than repeating `0.05` as a separate literal).
- Keep the fallback-frame case (tier 0/1, no glTF) working exactly as
  before — verify the canvas is still visible at tier 0/1 pose, not just
  tier 2, after your change (the bug report is tier-2-specific, but don't
  regress the tiers that already worked).
- No RNG, no `Math.random` — you're only allowed `hashInt`-chained
  determinism, matching the rest of this file, and this fix shouldn't need
  any new randomness anyway (it's a fixed geometric offset).

---

## 5. Goldens this lane may move

**None.** This is host-render-only (`apps/hotel/src/render/**`), no
`setComponent` path touched, no sim state, no RNG. If any headless
scenario's verdict or hash changes at all, you have touched something
outside intended scope — stop and report, do not "fix" it by widening
files touched.

---

## 6. Verification commands (expected outcomes)

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                          # exit 0
npm run harness --silent -- smoke                      # PASS verdict JSON, unchanged from before your change
```

Visual confirmation (required — this is a rendering change, CLAUDE.md's
verification loop requires a harness/browser screenshot for rendering
changes): `npm run dev -w apps/hotel -- --port 5203 --strictPort` (port
5203 is yours). Load/advance to tier 2 (reuse whatever `dev/tour.ts` pose
already frames a painting — check `apps/hotel/dev/tour.ts`, read-only,
do not edit it; if no existing pose frames a painting well, navigate
manually in the running dev server instead of adding a new pose file).
Capture a screenshot clearly showing a painting with visible canvas
artwork inside the frame at tier 2. Save it to
`apps/hotel/docs/alpha-loop/C4-W2-shots/tier2-painting-fixed.png`. Kill
the dev server when done.

---

## 7. The perturbation (exact assertion that must go red — visual, not a scenario assertion)

After the clean rebuild (§6), temporarily revert your fix (restore the
original `canvas.position.z = 0.025`, or comment out whatever change you
made, leaving everything else). Rebuild
(`rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`,
`npm run build`). Reload tier 2 in the dev server at the SAME pose. Take
a screenshot. Confirm and describe precisely (region of the frame, what's
missing) that the canvas is empty/occluded again — i.e. your fix is doing
real work, not a no-op. Save this "before" shot too, as
`apps/hotel/docs/alpha-loop/C4-W2-shots/tier2-painting-broken.png`.
Restore your fix, rebuild, confirm the canvas is visible again in the
same shot (reuse or retake `tier2-painting-fixed.png`), report both
screenshot paths and the exact visual difference between them.

---

## 8. Report format (fixed)

Files touched (should be exactly `decor.ts` plus your shots directory);
every command run with its exit code; the diagnosis you confirmed (or the
different one you found, if the z-depth hypothesis was wrong); the fix
made; the perturbation performed with both screenshot paths and the exact
visual difference; confirmation that `npm run harness --silent -- smoke`
is unchanged (no golden moved); what you did NOT do. Stop when done — do
not pick up C4-W1's work.
