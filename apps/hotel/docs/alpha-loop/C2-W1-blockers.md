# C2-W1 — Playtest blocker log

Driven with `apps/hotel/dev/playtest.mjs` against the built artifact
(served alone on 5203), the dev app (5202), and the artifact opened
directly via `file://`. Seed `hotel-alpha-loop-1` throughout (the seed
BREAKDOWN names as reaching tier 2 when run headless for the full
14-day arc). See the C2-W1 report for beat-by-beat pass/fail and the
four perturbation exit codes.

### B1 — AUDIT has no button; "run the audit" is a passive wait, and the game never says so
Severity: rough-edge
Build: artifact-5203
Expected: VISION-ALPHA's loop step 4 says "Run the night audit at the terminal and see cash and stars change" — this reads as an action with a button, like RESERVA's ACCEPT/DENY or LEDGER's RENOVATE.
Actual: `apps/hotel/src/sim/audit-app.ts` — `layout() { return {}; }`, no click targets at all. The audit fires automatically at the night rollover regardless of whether AUDIT is even open. I only know this from reading the source; a first-time player who opens AUDIT and clicks around looking for a "RUN" button will not find one, and nothing on screen tells them the audit is passive and time-driven rather than something they trigger.
Repro: open AUDIT (taskbar) at any point before the day rolls; note there is no clickable control anywhere on the screen; wait for the day to roll and see the ledger figures update on their own.
Screenshot: apps/hotel/docs/walkthrough/07-audit.png

### B2 — No in-game time acceleration; a full human playthrough exceeds "one sitting" by any normal reading of the phrase
Severity: blocker
Build: artifact-5203
Expected: VISION-ALPHA: "A person can, in one sitting and with no outside help" complete enter -> tier 2 -> end card.
Actual: the headless `alpha-loop` harness scenario reaches tier 2 in 84,000 sim ticks (verified this session, `npm run harness --silent -- alpha-loop --verify-replay`, exit 0). At the sim's fixed 20 Hz tick rate, a REAL, pointer-locked browser session runs those ticks in real wall-clock time — there is no fast-forward, no "skip to next day", nothing. 84,000 ticks is ~70 real minutes of continuous play with zero AFK time. My own run reached only tick 24,377 (~20 real minutes, ~29% of the arc) before I had to stop it, and RENOVATE had not yet become affordable. This is not a crash or a broken mechanic — the loop itself works (proven headless) — but "one sitting" for a first-time human, mouse-locked the whole time, reading documents and clicking a UI, is a materially different claim than "the sim can replay 84,000 ticks without desyncing." I did not find any UI, hotkey, or URL param that changes pacing (checked `main.ts` for a speed/time-scale param; none exists — only `worldforgeSeed` and `worldforgeStartPaused`, the latter a harness-only step-gate, not a player-facing accelerator).
Repro: `http://localhost:5203/grand-foyer.html?worldforgeSeed=hotel-alpha-loop-1`, play beats 1-8 normally, then time from RENOVATE unavailable to available.
Screenshot: apps/hotel/docs/walkthrough/08-ledger.png (LEDGER open, waiting; renovateAvailable still false after the ~20-minute session)

### B3 — Fraud is only findable "by knowing", not confirmed findable by reading the RESERVA screen
Severity: blocker
Build: artifact-5203
Expected: VISION/DESIGN's "one oracle, three consumers" ruling — RESERVA shows the raw document fields beside the raw reservation fields so a player can catch a mismatch by eye.
Actual: my driver used the reservation component's own `plantedViolations` array (ground truth the sim keeps but never renders) to decide accept/deny. During my session's only fraud case, the raw field-name diff between `document.fields` and `reservation.fields` that I computed programmatically did not surface an obviously different KEY (see the raw note captured in the beat-4 driver output). I did not independently verify, by reading the rendered on-screen text as a human would, that a player would spot the same mismatch — I am flagging this as "found by knowing" rather than "found by looking" per the brief's explicit ask, and marking it a blocker rather than a note because that distinction is exactly what this beat is supposed to prove and I cannot currently prove the screen-legible half of it.
Repro: `hotel-alpha-loop-1`, serve first guest, compare RESERVA's raw document panel against its raw reservation panel and the procedures card.
Screenshot: apps/hotel/docs/walkthrough/04-reserva.png

### B4 — No broken prop appeared in the first ~20 minutes of play
Severity: note
Build: artifact-5203
Expected: beats 5/6 ("clean a mess", "repair a prop") reachable early, per VISION's loop ordering (steps 3-4, before the audit).
Actual: in this run a mess DID appear (tick 5677, room 8, cleaned successfully) but no broken prop appeared within the ~20-minute session, even after an explicit 60s poll. This may simply be pacing/RNG for this seed's early game rather than a bug — I did not have budget to confirm against a second seed or a longer wait. Recorded as a note, not a blocker: prop repair is gate-verified elsewhere (`prop.repaired` is asserted by existing headless gates) and I have no evidence it is broken, only that I did not personally observe it in the time I had.
Screenshot: apps/hotel/docs/walkthrough/05-mess-before.png, 06-mess-after.png

### B5 — No staff candidate appeared within the session
Severity: note
Build: artifact-5203
Expected: beat 11 ("hire the clerk") reachable "at any point" per the brief's beat table.
Actual: no `candidate` entity existed in world state at tick 24,364 (end of my session). Given a cash/day gate on candidate spawning (`apps/hotel/src/sim/economy.ts`'s `HIRE_THRESHOLD_MINOR`), this is plausibly a threshold the session's ~20 minutes of play never crossed, consistent with B2's pacing finding, rather than a broken feature. Recorded as a note for the same reason as B4.
Screenshot: apps/hotel/docs/walkthrough/10-staff.png (STAFF app open, "No candidates waiting.")

### B6 — Entry overlay controls list is accurate (verification note, not a bug)
Severity: note
Build: artifact-5203
Expected/Actual: the entry overlay reads "W A S D move · Mouse look · Click interact · V third person · H hints · Esc release mouse" — accurate and complete against what I actually used to play (I never needed a key the overlay didn't mention). No blocker; recorded because the brief asks me to confirm this explicitly.
Screenshot: apps/hotel/docs/walkthrough/01-entry.png

### B7 — H (skip walkthrough) did not visibly change the hint's `data-visible` attribute in my late-session check
Severity: rough-edge
Build: artifact-5203
Expected: pressing H skips the walkthrough; the brief asks me to confirm this.
Actual: `.hud-hint[data-visible]` read "1" both before and after pressing H in my driver's automated check, at a point (tick 24,377, deep into the session, after the RENOVATE press attempts) where the hint may already have advanced past a state where visibility changes on skip, or the walkthrough may already have been implicitly finished. I did not manually re-test H in isolation near the start of a fresh run within budget, so I cannot rule out a real bug versus a bad check window — flagging as a rough-edge in my OWN verification rather than asserting a confirmed defect.
Screenshot: artifacts/playtest-shots/artifact-clean-24-h-skip.png

### B8 — Shared worktree: `apps/hotel/dist-game` was deleted out from under me twice by concurrent lanes
Severity: note (infra, not a src bug)
Build: n/a (build tooling)
Expected: my own rebuild-discipline steps (`rm -rf dist-game && npm run build`) produce a stable dist-game I can inspect.
Actual: this worktree is shared with other C2 lanes running their own builds concurrently; `apps/hotel/dist-game` was fully absent (not just stale) at two points in my session despite a clean build having just finished, exit 0, moments earlier. I could not tell whether it was my own overlapping commands or another lane's rebuild that raced it, and I deliberately stopped relying on `dist-game` in my own driver (see `apps/hotel/dev/playtest.mjs`'s header comment) rather than debug a directory outside my globs. Not filed against any lane's src — just a wiring note for the orchestrator (see report §7).
