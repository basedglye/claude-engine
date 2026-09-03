# BREAKDOWN-4 — cycle 4: the audit ritual + desk feedback, and empty canvases

COO, 2026-09-03, branch `claude/grand-foyer-game-alpha-50b07d`. Inputs:
`docs/alpha-loop/DECISIONS.md` (the two picked items — nothing else is in
scope), `SPARK-1.md`, `BALLAST-1.md`. Two lanes, file-disjoint, at most
three workers (two used).

Root CLAUDE.md invariants that gate both lanes: sim purity (no DOM/Three
imports under `apps/hotel/src/sim/**`), determinism (no `Math.random`, no
wall-clock reads in sim code, transcendental `Math.*` banned in sim —
`scripts/check-purity.mjs` enforces this per root), replayability
((seed, input log) fully describes a run), write-through (`setComponent`
only — never mutate a fetched component object in place), hosts render /
sims decide.

Confirmed by grep: **no `packages/audio` exists on this branch** (only
`ARCHITECTURE.md`/`HANDOFF.md` mention it as a future package). Both
lanes below are visual-only. Do not add an audio package or import one
that doesn't exist.

---

## Lane C4-W1 — Night-audit ritual + desk feedback (Spark ★, item 1)

Owns `apps/hotel/src/sim/audit-app.ts`, `apps/hotel/src/sim/reserva-app.ts`,
`apps/hotel/src/sim/screen-data.ts`, `apps/hotel/src/sim/screen.ts`,
touches `apps/hotel/src/sim/game.ts` (additive fields on `Hotel` /
`ScreenViewData` plumbing only — no new systems, no new event types).

The concrete, buildable form (decided here, not left to the worker):

1. **Desk feedback (RESERVA):** on `desk.fraudCaught` / `desk.fraudMissed`
   / a plain accept / a plain deny, the RESERVA screen shows an immediate
   stamp reaction — a colored `panel` flash plus a large stamped `text`
   ("APPROVED" / "DENIED" / "FRAUD CAUGHT" / "FRAUD MISSED — LATE") that
   decays over a fixed number of ticks, keyed off `view.tick`
   (`ScreenWorldView.tick`, already sim-authoritative, already integer,
   already replay-safe — this is the paintSeq the brief asks for; no wall
   clock). No new event type: the four outcomes already exist as
   `applyDeskDecision`'s emitted events (`guest.checkedIn`+no fraud,
   `guest.denied`+no fraud, `desk.fraudCaught`, `desk.fraudMissed`, all in
   `game.ts` around lines 1917-1942).
2. **Night-audit ritual (AUDIT):** the screen already reads `ledger` +
   `objectives` from `ScreenViewData`; today it prints every line at once.
   Give it a paintSeq-driven reveal cadence (a deterministic integer counter
   that advances lines/values into view based on how many ticks the AUDIT
   app has been open — NOT wall-clock, NOT `Date.now()`), so a screenshot
   taken at a fixed tick after open is always identical (screenshot-stable
   requirement). The reveal order: day header → revenue/expenses/fraud
   loss → star delta → closing cash → tomorrow's forecast line → objectives.
   "Forced full-screen" / unskippable is Spark's boldest-move framing, not
   a requirement — keep it to the paint layer; do not add input gating
   that blocks other apps, that is out of scope and touches the shell.

### Files in / files out

```
IN:  apps/hotel/src/sim/audit-app.ts
     apps/hotel/src/sim/reserva-app.ts
     apps/hotel/src/sim/screen-data.ts
     apps/hotel/src/sim/screen.ts
     apps/hotel/src/sim/game.ts        (additive only — see below)
OUT (read-only): everything else, specifically render/screens.ts,
     packages/surface-ui/src/**, apps/hotel/src/render/**, main.ts,
     package.json, all docs except this brief's own report location.
```

**`game.ts` scope, precisely bounded:** you may add fields to the `Hotel`
component and/or extend `buildScreenWorldView`'s data assembly (already in
`screen.ts`, not `game.ts` — check which file actually needs the edit
before touching `game.ts` at all; the view builder lives in `screen.ts`).
You may NOT add a new system, a new event type, or a new top-level
`ScreenViewData` key — the key budget comment in `screen-data.ts` caps
RESERVA and AUDIT at 3 keys each and they are both already at 3
(`queue, rooms, stars` / `ledger, objectives`, respectively — check the
file, it may have shifted). If the stamp/reveal state needs a field to
survive across ticks, add it INSIDE an existing key's view type (e.g. a
`lastDecision` field nested in `ScreenQueueView` or a `revealTick` field
nested in `ScreenLedgerView`) — never a new top-level key. If you find you
cannot fit it that way, stop and report the exact field and why, rather
than widening the budget yourself.

Player-visible strings ("APPROVED", "DENIED", "FRAUD CAUGHT", the forecast
line, etc.) go through this app's existing string-table convention if one
exists in `audit-app.ts`/`reserva-app.ts` today — check for a `t()` call
or literal-string convention already in these two files and match it;
if these two files currently hardcode English literals directly (they do,
as read at breakdown time), that is the existing pattern for this pair of
apps and you may follow it, but say so explicitly in your report rather
than silently assuming either way.

### Goldens this lane may move

- `scenarios/fraud-catch.scenario.mjs` and `fraud-catch-b.scenario.mjs`:
  these assert on `desk.fraudCaught`/`desk.fraudMissed` EVENTS and ledger
  state, not on `screenApp` component hashes — check whether either
  scenario also asserts a `stateHash`/`stateHashSlow` that includes the
  `screenApp` component's `state` field. If you add fields to
  `ReservaState`/`AuditState` (e.g. `lastDecisionTick`), that component's
  hash changes and any scenario asserting a full-state hash across a
  desk-decision tick will need its golden re-recorded — the assertions
  keep meaning what they meant (fraud was caught / missed, ledger moved
  correctly); only the incidental hash value moves. Re-record via
  whatever mechanism the existing scenario file uses (read the file
  before touching it) and say in your report exactly which goldens moved
  and why the assertion's meaning is unchanged.
- `scenarios/reserva-readability.scenario.mjs`: this is the readability
  probe (`calib` node awareness, per surface-ui's header comment) — your
  new panel/text nodes must not violate whatever overflow/readability gate
  this scenario runs (`packages/surface-ui/src/overflow.ts`'s
  `checkOverflow` or equivalent). Run it and read its assertions before
  writing paint code, not after.
- `scenarios/alpha-loop.scenario.mjs`: the full-loop headless bot. If it
  asserts specific screen state, it may need the same golden treatment as
  fraud-catch above. If it only asserts economic/event outcomes, it should
  be untouched — confirm which by reading it first.
- Nothing outside `screenApp` component state should move. If ANY
  non-screen golden moves, that is a sign you touched something outside
  your files — stop and report.

### Verification commands (expected outcomes)

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                          # exit 0
npm run harness --silent -- fraud-catch                # PASS verdict JSON
npm run harness --silent -- fraud-catch-b               # PASS verdict JSON
npm run harness --silent -- reserva-readability          # PASS verdict JSON
npm run harness --silent -- alpha-loop                   # PASS verdict JSON
node scripts/check-purity.mjs                              # exit 0, no new violations
```

Dev server for visual confirmation: `npm run dev -w apps/hotel -- --port
5202 --strictPort`. **Port 5202 is yours.** Kill it when done
(`Get-NetTCPConnection -LocalPort 5202 | Stop-Process`).

### The perturbation (exact assertion that must go red)

After the clean rebuild above, pick ONE of your new behaviors — e.g. the
stamp reaction's condition on `desk.fraudCaught` in `reserva-app.ts` — and
comment out the branch that pushes the stamp `panel`/`text` nodes (leave
everything else). Rebuild (`rm -f
apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`,
`npm run build`). Run `npm run harness --silent -- fraud-catch` (or
whichever scenario you wired an assertion into — you must add one if none
exists that checks the new paint nodes; a scenario/gate that cannot ever
fail is not verification). Confirm the specific assertion you added goes
red with a message naming the missing stamp behavior. Restore the branch,
rebuild again, confirm green, report all exit codes.

---

## Lane C4-W2 — Empty painting canvases (Ballast KEEP, item 2, W3-3)

Owns `apps/hotel/src/render/decor.ts` only. Host-render-only, no purity or
golden cost — confirmed by Ballast's grounding pass (no RNG, no
`setComponent` path touched).

### The diagnosed bug (read this before touching code)

`buildPainting` (`decor.ts:257-274`) does:
```
g.add(frame);
upgrade(g, wrapChildren(g), "painting", { w: 0.7, d: 0.05, h: 0.5 });
const texture = paintingCanvasTexture(seed);
const canvas = new THREE.Mesh(..., z = 0.025);
g.add(canvas);
```
`wrapChildren(g)` at the `upgrade()` call only wraps `g`'s children AT
THAT POINT (just `frame` — `canvas` doesn't exist yet), so the fallback
group `upgrade()` hides on glTF-load is correctly just the frame, and
`canvas` is added afterward as a direct sibling of `g`, so it should stay
visible regardless of glTF load. Verify this reasoning against the actual
tree before assuming it's wrong.

The live hypothesis (Ballast's, unconfirmed — your job to check first):
`upgrade()` calls `fitToFootprint(loaded.scene, footprint)` with
`footprint = { w: 0.7, d: 0.05, h: 0.5 }`. Read `fitToFootprint` in
`apps/hotel/src/render/assets.ts` (read-only for you — do not edit it) to
see how it positions the loaded glTF's local origin/bounds relative to
`0,0,0`. If the glTF "painting" model's front face ends up positioned at
or in front of `z = 0.025` (the canvas plane's fixed z), the frame's own
front geometry z-fights or fully occludes the canvas — an empty-looking
frame is exactly what a fully-occluded canvas plane looks like. Confirm
by adding a temporary `console.log` of the loaded scene's computed
bounding box in a throwaway local build (not committed) or by reasoning
from `fitToFootprint`'s source, then fix by moving the canvas plane's z
to sit reliably in front of whatever `fitToFootprint` produces (e.g.
compute it from the glTF's actual bounds after load, or simply push the
canvas mesh's z further out, e.g. `z = footprint.d / 2 + 0.01`+margin,
whichever `fitToFootprint`'s behavior actually calls for).

If the bounding-box hypothesis is wrong, fall back to the next most likely
cause and say in your report what you actually found — do not force a fix
onto a diagnosis you disproved.

### Files in / files out

```
IN:  apps/hotel/src/render/decor.ts
OUT (read-only): apps/hotel/src/render/assets.ts, placement.ts,
     architecture.ts, fixtures.ts, everything else.
```

### Goldens this lane may move

None. Host-render-only, no `setComponent` path, no RNG — this cannot move
any headless scenario's hash or event assertions. If any scenario's
verdict changes at all, that is a sign you touched sim state — stop and
report.

### Verification commands (expected outcomes)

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                          # exit 0
npm run harness --silent -- smoke                      # PASS verdict JSON, unchanged
```

Dev server + screenshot for visual confirmation (this is a rendering
change — CLAUDE.md requires a harness browser-mode screenshot):
`npm run dev -w apps/hotel -- --port 5203 --strictPort`. **Port 5203 is
yours.** Capture a tier-2 frame showing a painting with a visible canvas
inside the frame (reuse `dev/tour.ts`'s tier-2 pose if one already frames
a painting; do not add a new pose file — that is orchestrator territory).
Save the shot under `apps/hotel/docs/alpha-loop/C4-W2-shots/` (new
directory, yours). Kill the dev server when done
(`Get-NetTCPConnection -LocalPort 5203 | Stop-Process`).

### The perturbation (exact assertion that must go red)

After the clean rebuild above, temporarily revert your z-fix (or whatever
fix you land on) back to the original `canvas.position.z = 0.025` (or
comment out the fix line). Rebuild. Take the same tier-2 painting
screenshot at the same pose. Confirm by eye (and describe precisely in
your report — pixel region, what you see) that the canvas is empty/frame-
only again, i.e. the fix is doing real work, not a no-op. Restore the fix,
rebuild, confirm the canvas is visible again in the same shot, report
both screenshots' paths.

---

## Report format (both lanes, fixed)

Files touched; every command run with its exit code; the perturbation
performed and the exact assertion/visual check that went red; goldens
moved and why their meaning is unchanged (W1) or confirmation that none
moved (W2); and what you did NOT do. A lane that could not finish says so.
A lane that skipped a verification step says so, unprompted. A finished
lane stops — it does not pick up the other lane's work.
