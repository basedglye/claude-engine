# C4-W1 — Night-audit ritual + desk feedback (compulsion core)

You are lane C4-W1 of two concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained.

---

## 0. Orchestration rules (verbatim, non-negotiable)

1. **Do this work yourself. Do not spawn subagents.**
2. **Do not run any `git` command.** No commit, no add, no stash. The
   orchestrator commits.
3. **You may only edit the files listed in §2.** If you need to touch
   anything else, stop and report the exact file and why, instead of
   widening scope yourself.
4. **Rebuild discipline, verbatim, before ANY perturbation claim:**
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`
   then rebuild. A "restore" claim without this is a no-op and will be
   rejected at review.
5. **Verdict JSON is written inside the repo**, not `/tmp` (Git Bash
   `/tmp` paths do not round-trip to the Node process on this machine).
6. **`npm run harness --silent -- <scenario>`** — the `--silent` flag is
   required or npm's own banner pollutes the verdict JSON.
7. **Report format, fixed:** files touched; every command run with its
   exit code; the perturbation performed and the exact assertion that
   went red; goldens moved and why their meaning is unchanged; what you
   did NOT do. Say so unprompted if you skipped a step or could not
   finish.
8. **When done, stop.** Do not pick up C4-W2's work.

## 0.1 Dev-server rule

`npm run dev -w apps/hotel -- --port 5202 --strictPort`. **Port 5202 is
yours.** Never 5199 (`.claude/launch.json`'s port), never 5173, never
5203/5204/5205 (other/prior lanes). Kill it when done:
`Get-NetTCPConnection -LocalPort 5202 | Stop-Process`.

---

## 1. Goal

Read first (do not edit): root `CLAUDE.md` (invariants — sim purity,
determinism, replayability, write-through), `apps/hotel/docs/DESIGN.md`
§2 and §4 if present (audit as "session's ritual close"; RESERVA's
procedures-card ruling), `apps/hotel/docs/alpha-loop/DECISIONS.md` (item
1, the exact scope), `apps/hotel/docs/alpha-loop/SPARK-1.md` (the
what-ifs this concretizes — do not build everything in it, only what's
specified below), `apps/hotel/docs/alpha-loop/BALLAST-1.md` (grounding —
confirms no `packages/audio` exists on this branch; this lane is
visual-only, do not add or import an audio package).

The DECISIONS.md scope: ACCEPT/DENY and fraud catch/miss get an immediate
readable on-screen reaction on RESERVA; AUDIT becomes a proper end-of-day
ritual with real hierarchy and a deterministic reveal cadence, not a flat
list. This is the loop's current weakest beat per Ballast's grounding —
spend the most detail here of anything in this cycle.

**Non-negotiables carried from root CLAUDE.md, restated because they bite
here specifically:**
- No `Math.random()` anywhere in `apps/hotel/src/sim/**`. Any "which line
  reveals next" counter must be a deterministic function of `view.tick`
  (or a tick-count-since-open you derive from it), never wall-clock,
  never `Date.now()`, never `performance.now()`.
- `Sim.stateHash()` is incremental per-(component,entity) and invalidated
  only by `setComponent()` — if you add fields to `ReservaState` /
  `AuditState` (the `screenApp` component's `S`), they must be written
  back through the normal `reduce()` return path (already how this
  component works — `reduce` returns the next state, the shell's own
  system calls `setComponent`; you are not calling `setComponent`
  yourself in these two app files today, and you must not start).
- `PaintNode` (packages/surface-ui/src/types.ts) has exactly six kinds:
  `panel, text, button, table, hline, calib`. No image/sprite kind exists.
  A "stamp" is a colored `panel` plus large/bold-reading `text`, not an
  image asset. Do not add a new `PaintNode` kind — that file is read-only
  for you (`packages/surface-ui/src/**` is out of scope).

---

## 2. Files you may touch (nothing else)

```
apps/hotel/src/sim/audit-app.ts
apps/hotel/src/sim/reserva-app.ts
apps/hotel/src/sim/screen-data.ts
apps/hotel/src/sim/screen.ts
apps/hotel/src/sim/game.ts               (additive only — see §4)
scenarios/fraud-catch.scenario.mjs       (only to add/strengthen an
                                           assertion on your new paint
                                           nodes — do not change its
                                           setup/seed)
scenarios/fraud-catch-b.scenario.mjs     (same condition)
scenarios/reserva-readability.scenario.mjs  (read fully before touching;
                                           only if your new nodes need a
                                           readability-gate exemption or
                                           update — report if so)
apps/hotel/docs/alpha-loop/C4-W1-shots/**   (new directory, yours)
```

**Read-only for you, specifically:** `apps/hotel/src/render/**` (all of
it, including `screens.ts` — you emit `PaintNode`s, you never touch how
they're rasterized), `packages/surface-ui/src/**`, `main.ts`,
`package.json`, `apps/hotel/src/sim/rules.ts`, `apps/hotel/src/sim/
economy.ts`, `apps/hotel/src/sim/components.ts` (you may READ this to see
`Hotel`'s current shape; if you need a new field on it, propose the exact
field in your report rather than editing it — components.ts is not in
your glob), every other scenario, every doc except your own shots.

**Contested — orchestrator-only:** anything under `apps/hotel/docs/`
other than your shots directory, `CLAUDE.md`, `apps/hotel/package.json`.

If you find `Hotel` (in `components.ts`) needs a new field and you cannot
express the ritual reveal or stamp state without it, **stop and report
exactly what field and why** rather than editing a file outside your glob.

---

## 3. What to build

### 3a. RESERVA desk feedback (stamp reaction)

`apps/hotel/src/sim/reserva-app.ts` currently paints ACCEPT/DENY buttons
and the procedures card but has no reaction to a decision's outcome. The
four outcomes already exist as events `game.ts`'s `applyDeskDecision`
emits (read `game.ts` lines ~1900-1945 to confirm the exact emit sites
before writing anything):
- plain accept, no fraud → `guest.checkedIn` (no `desk.fraudMissed`
  alongside it)
- plain deny, no fraud (a false deny) → `guest.denied` +
  `desk.falseDeny`
- accept a planted-fraud guest → `guest.checkedIn` + `desk.fraudMissed`
- deny a planted-fraud guest (correctly) → `guest.denied` +
  `desk.fraudCaught`

`ReservaState` today is `{ selectedRoomEntity: number }`. Add a field that
records the last decision's outcome and the tick it happened, e.g.:
```
interface ReservaState {
  selectedRoomEntity: number;
  /** 0 = none, 1 = accepted (clean), 2 = fraud caught (denied), 3 = fraud
   *  missed (accepted), 4 = false deny. Set by reduce() when it observes
   *  the outcome; painted as a decaying stamp keyed off view.tick. */
  lastOutcome: number;
  lastOutcomeTick: number;
}
```
You cannot see the emitted events directly inside `reduce()` (apps only
see `ScreenWorldView`, never the Sim/event log) — so the outcome has to
arrive through `ScreenViewData`, same as everything else this screen
reads. Add it to the EXISTING `queue`/`stars` keys' view types in
`screen-data.ts` (RESERVA already reads `queue, rooms, stars` — 3 keys,
at budget; do not add a 4th top-level key). The cleanest fit: a
`lastDecision: { outcome: string; tick: number } | null` field nested
inside `ScreenViewData` is a NEW top-level key and is NOT allowed. Instead
extend `stars` handling: since `stars` is just a number today, you cannot
nest into it either. The actually-available slot is `queue` — but `queue`
is null between guests, which is exactly when the reaction needs to still
paint (the guest who was just decided is no longer presenting). Read
`screen.ts`'s `buildScreenWorldView` and `ScreenViewData` fully before
deciding; if no existing key can honestly carry this without lying about
its own shape, that is the "stop and report the exact field" case in the
Hotel-component note above — propose adding `lastDeskOutcome: number` and
`lastDeskOutcomeTick: number` to the `Hotel` component (small, integer,
determinism-safe, day-independent) as the source of truth, populated by
`applyDeskDecision` in `game.ts` at each of the four emit sites via
ordinary `setComponent<Hotel>`, then surfaced through the EXISTING
`ledger` key (which already carries `Hotel`-derived fields) rather than a
new top-level key. This keeps `RESERVA` at 3 keys IF it starts reading
`ledger` too — check whether that exceeds its budget; if it does, report
this exact tension rather than silently blowing the budget.

Paint side (`reserva-app.ts` `paintSpec`): while `tick - lastOutcomeTick`
is under a fixed integer window (e.g. 40 ticks at 20 Hz = 2 seconds — pick
a constant, name it, put it near the top of the file), push a `panel`
covering a clear region (e.g. top banner strip, not overlapping the
procedures card or room list) with a color keyed to outcome (use existing
palette indices already used elsewhere in this file, e.g. 9/10 for
accept/deny-adjacent), plus large `text` reading "ACCEPTED" / "FRAUD
CAUGHT" / "FRAUD MISSED — LATE" / "DENIED". Let it decay by removing the
nodes once outside the window — a plain `if` on the tick delta, computed
fresh every `paintSpec` call, is deterministic and screenshot-stable at
any fixed tick offset.

### 3b. AUDIT reveal cadence

`audit-app.ts`'s `AuditState` today is `{ opened: number }` (unused).
Use it: set it to `view.tick` the first time `reduce` sees this app
opened (there should be an `{ kind: "open" }` `ScreenInput` case — check
`screen.ts`/the shell for how "app opened" is signaled to `reduce`; if
`opened` is never actually set today, wire it). `paintSpec` then computes
`elapsed = view.tick - state.opened` and reveals lines in the order
DECISIONS.md/this brief's summary specifies: day header (always) → after
N1 ticks: revenue/expenses/fraud loss → after N2: star change (compute
this from `hotel.stars` today vs. a prior-day value — if no such prior
value is currently plumbed, read `ledgerDays` for yesterday's closing
figures as a proxy, or propose the `Hotel` field the same way as §3a if
none exists — report which you did) → after N3: closing cash → after N4:
tomorrow's forecast line (a short deterministic string built from
tomorrow's known state — e.g. next day's arrival quota / boiler-style
flavor if such a field exists; if it doesn't, a minimal honest forecast
like "Day N+1 begins." is acceptable — do not invent new simulated
forecast data, that is out of scope) → after N5: objectives (existing
loop, unchanged). Pick N1..N5 as small integer tick counts (e.g. 20 ticks
apart = 1s at 20Hz), name them as constants near the top of the file.
Lines not yet revealed simply are not pushed to the `nodes` array — this
is the entire "reveal," no animation, no interpolation, no floats.

---

## 4. `game.ts` scope (bounded)

Only touch `game.ts` if §3a's proposed `Hotel` fields are the path you
take (report explicitly if you took a different path that needed no
`game.ts` change at all — that's fine and preferred if it fits). If you
do add fields:
- Add them to the `Hotel` interface... no — `Hotel` lives in
  `components.ts`, which is OUT of your glob. If the proposed fields are
  needed, this is exactly the "stop and report" case: you cannot add them
  yourself. Do the rest of the work assuming you CAN read but not set
  these fields, and clearly flag in your report "blocked on: `Hotel`
  needs field X, I could not add it, here is where `applyDeskDecision`
  would call `setComponent` once it exists." A well-specified blocker
  report is a valid, complete lane outcome.
- If your chosen design needs no new `Hotel` field (e.g. you find you
  CAN honestly carry outcome/tick through the existing `queue`/`ledger`
  shapes without lying about their meaning), then `game.ts` edits are
  limited to: at each of the four `applyDeskDecision` emit sites, add
  no new logic — you are only reading existing emitted events' triggering
  conditions to mirror the same outcome into whatever existing field you
  chose. Keep this diff minimal and additive; do not touch anything else
  in `game.ts`'s 3000+ lines.

---

## 5. Goldens this lane may move

- `fraud-catch.scenario.mjs`, `fraud-catch-b.scenario.mjs`: these assert
  on emitted events (`desk.fraudCaught`/`desk.fraudMissed`) and ledger
  state. If either scenario ALSO asserts a full `screenApp` component
  hash or `stateHash`/`stateHashSlow` across a desk-decision tick, adding
  fields to `ReservaState`/`AuditState` changes that hash. Re-record the
  golden using whatever mechanism the scenario file already uses (read it
  first — do not invent a new recording mechanism). The assertion's
  MEANING is unchanged (fraud was still caught/missed, ledger still moved
  correctly) — only the incidental hash value moves. State this
  explicitly in your report, scenario by scenario.
- `reserva-readability.scenario.mjs`: run it BEFORE writing paint code to
  see what it currently gates (likely an overflow/`calib` check from
  `packages/surface-ui/src/overflow.ts`). Your new stamp panel/text must
  not push existing content off-surface or violate this gate. If it does,
  fix your layout (smaller banner region, or reposition) rather than
  weakening the gate.
- `alpha-loop.scenario.mjs`: the full-loop headless bot. Read it first —
  if it only asserts economic/event outcomes (not screen state), it
  should be untouched by this work; confirm and say so.
- Nothing outside `screenApp` component state and the two named fraud
  scenarios should move. If any other scenario's verdict changes, you
  have touched something outside scope — stop and report, do not "fix"
  it by widening files touched.

---

## 6. Verification commands (expected outcomes)

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                          # exit 0
node scripts/check-purity.mjs                           # exit 0, no new violations
npm run harness --silent -- fraud-catch                 # PASS verdict JSON
npm run harness --silent -- fraud-catch-b                # PASS verdict JSON
npm run harness --silent -- reserva-readability           # PASS verdict JSON
npm run harness --silent -- alpha-loop                    # PASS verdict JSON (or unchanged, if untouched)
```

Visual confirmation: `npm run dev -w apps/hotel -- --port 5202
--strictPort` (port 5202 is yours). Drive a fraud-catch and a clean-accept
through the desk (or use the harness's browser mode if it supports
capturing a live scenario run) and capture screenshots of the RESERVA
stamp and the AUDIT reveal at a couple of fixed ticks, saved under
`apps/hotel/docs/alpha-loop/C4-W1-shots/`. Kill the dev server when done.

---

## 7. The perturbation (exact assertion that must go red)

Add (or confirm/strengthen) an assertion in `fraud-catch.scenario.mjs`
that specifically checks for your new RESERVA stamp behavior — e.g. that
after a `desk.fraudCaught` decision tick, the `screenApp` component's
`ReservaState.lastOutcome` (or whatever field you landed on) equals the
"fraud caught" value within the decay window. A scenario/gate that cannot
ever fail is not verification — you must add a real assertion if none
exists.

After the clean rebuild (§6, first two lines), comment out the branch in
`reserva-app.ts`'s `reduce`/`paintSpec` that sets/paints the stamp outcome
(leave everything else intact). Rebuild again. Run `npm run harness
--silent -- fraud-catch` and confirm the assertion you added goes red,
quoting its failure message. Restore the branch, rebuild, confirm green,
report all exit codes for both passes.

---

## 8. Report format (fixed)

Files touched; every command run with its exit code; the exact perturbation
and the exact assertion that went red (quote the failure message); which
goldens moved and why their meaning is unchanged; **what you did NOT do**
— including, if you hit the `Hotel`-field blocker in §4, a precise
statement of the blocker and the minimal `components.ts`/`game.ts` change
the orchestrator would need to unblock you next cycle. Stop when done —
do not pick up C4-W2's work.
