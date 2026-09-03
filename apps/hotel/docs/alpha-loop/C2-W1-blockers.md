# C2-W1 / C3-W6 — Playtest blocker log

Driven with `apps/hotel/dev/playtest.mjs` against the built artifact
(served alone on 5203) and spot-checked in the dev app (5202). Seed
`hotel-alpha-loop-1` throughout.

**This file was rewritten for the C3-W6 re-run** after the COO review
(`apps/hotel/docs/alpha-loop/reviews/C2-W1.md`) refuted the original B3
and found the real defect (F1: shipped `fraudRatePermille: 0`, now fixed
upstream to 200/1000). Each record below carries its **original**
severity/text plus a **Status (C3-W6)** line saying what changed. New
findings from this re-run are appended at the end (B9-B11).

---

### B1 — AUDIT has no button; "run the audit" is a passive wait
Severity: rough-edge
Build: artifact-5203
Original text: AUDIT (`apps/hotel/src/sim/audit-app.ts`) has no click
targets; the audit fires automatically at the night rollover. A player
looking for a "RUN" button will not find one.
**Status (C3-W6): NOT A DEFECT, per COO ruling.** The file header cites
the H1 design ruling verbatim ("One screen, no interaction, is
acceptable") — this is a decision on the record, not a regression. The
discoverability point survives as fix-list item F3 (owned by the screen
lane, optional): one `t()` line stating the audit is passive. Re-verified
this session: cash and stars did change visibly across a rollover
(`cash 500->-4000, stars 1->1, day 2->3`, tick 12072).
Screenshot: apps/hotel/docs/walkthrough/11-audit.png

### B2 — No in-game time acceleration; a full human playthrough exceeds "one sitting"
Severity: blocker
Build: artifact-5203
Original text: the headless `alpha-loop` scenario needs 84,000 ticks
(~70 real minutes at 20Hz with no acceleration); my C2-W1 session only
covered ~29% of that in ~20 real minutes.
**Status (C3-W6): RESOLVED AND VERIFIED LIVE.** Hold-T fast-forward (8 sim
steps/host tick, disabled while a screen is focused) landed in `main.ts`.
Confirmed twice this session, live, not just by reading source:
(1) the beat-7 audit wait that previously took real minutes completed in
34 real seconds; (2) a dedicated check held T for 3000ms with no screen
focused and measured a tick delta of 480 (exactly the 8x rate) versus 61
with a screen genuinely focused (exactly the un-accelerated 1x rate) —
`apps/hotel/docs/walkthrough` §7 has the numbers. The pacing wall itself
is gone. What is NOT yet verified: a full door-to-end-card session in one
sitting under T (this session's own economy did not reach tier 1 — see B9
below, a driver limitation, not a re-confirmation of B2).
Screenshot: apps/hotel/docs/walkthrough/12-ledger.png

### B3 — WITHDRAWN, per COO ruling
Severity: (was) blocker — REFUTED
Original text: "fraud is only findable by knowing (`plantedViolations`),
not confirmed findable by reading the RESERVA screen."
**Status (C3-W6): WITHDRAWN.** The COO review found two real bugs in this
file's original driver: it read only the FIRST of a guest's two documents
(a guest carries both an "id" and a "resSlip"), and it compared
same-NAMED keys, so a `name` (ID) vs `guestName` (reservation) mismatch —
the headline fraud — could never be detected by that logic. Separately,
F1 (the shipped game's `fraudRatePermille: 0`) meant no fraud existed in
the build being played at all, so B3's "my session's only fraud case"
sentence described an event that could not have occurred. Both are fixed
this re-run: the driver now reads all of a guest's documents and decides
via the sim's own `evaluateRules` (mirroring `scenarios/lib/hotel-owner.mjs`,
never `plantedViolations`), and `fraudRatePermille` is now 200/1000
upstream. Result: **two real fraud cases were caught this session and
confirmed legible by eye** — see B10 below and
apps/hotel/docs/walkthrough §4 for the exact fields and screenshots.

### B4 — No broken prop appeared during play
Severity: note
Build: artifact-5203
Original text: no broken prop observed in ~20 minutes of C2-W1 play.
**Status (C3-W6): STILL NOT OBSERVED, unchanged verdict (note, not a
blocker).** Also not observed in this re-run's ~10-minute active-play
window before the wait beats took over. Plausibly pacing/RNG for this
seed's early game, consistent with the original assessment — still no
evidence either way that repair itself is broken (`prop.repaired` remains
gate-verified elsewhere).
Screenshot: artifacts/playtest-shots/final2-12-prop-before.png

### B5 — No staff candidate appeared during play
Severity: note
Build: artifact-5203
Original text: no `candidate` entity present at end of C2-W1 session.
**Status (C3-W6): STILL NOT OBSERVED.** Consistent with B9 below — this
session's cash went deeply negative rather than growing, so any
cash/day-gated candidate spawn threshold plausibly was never crossed.
Screenshot: apps/hotel/docs/walkthrough/14-staff.png

### B6 — Entry overlay controls list is accurate
Severity: note (positive finding)
Build: artifact-5203
**Status (C3-W6): RE-CONFIRMED, AND NOW ALSO COVERS T.** The overlay now
reads "W A S D move · Mouse look · Click interact · Hold T to fast-forward
· V third person · H hints · Esc release mouse" — fix-list item F4 (T
discoverability) is closed; the control that fixed B2 is itself
discoverable.
Screenshot: apps/hotel/docs/walkthrough/02-entry.png

### B7 — H-key check was inconclusive in the C2-W1 session
Severity: rough-edge — NOT A CONFIRMED DEFECT
Build: artifact-5203
Original text: `data-visible` did not change in a late-session check
(tick 24,377), timing self-flagged as unreliable.
**Status (C3-W6): RESOLVED — NOT A DEFECT, per COO ruling AND re-verified
fresh this session (R1).** `main.ts:550` gates H on `!focusedScreen`,
which was working correctly all along; the original check's problem was
running it after LEDGER was already focused. This re-run checked H in a
**separate, fresh page/session, before any terminal was ever focused**
(walkthrough.skip() is one-way, so this could not safely run on the same
page as the rest of the beats): `data-visible` "1" -> "0" in one press,
confirmed. See apps/hotel/docs/walkthrough §0.
Screenshot: apps/hotel/docs/walkthrough/01-h-key-isolated.png

### B8 — Shared worktree: `apps/hotel/dist-game` raced by concurrent lanes
Severity: note (infra, not a src bug)
Build: n/a
**Status (C3-W6): N/A this re-run** — the coordinator's brief this cycle
said not to rebuild `dist`, and this lane's own use of `dist-game` (for
the `evaluateRules` import, see B10) read it read-only without rebuilding,
so no race was hit this session. Leaving the original note in place for
the historical record; no new instance to report.

---

## New findings, C3-W6 re-run

### B9 — This session's economy went cash-negative; RENOVATE never became affordable (driver limitation, flagged honestly)
Severity: note (driver limitation — NOT a game defect claim)
Build: artifact-5203
What happened: cash went `500 -> -4000` across the first night rollover
(tick 12072) and never recovered; by tick 128301 (end of session) the
hint step "renovate" had still not surfaced. Root cause, as best I can
tell without further instrumentation: this driver serves guests in ONE
active window (beat 4's ~5000-tick loop, checking in exactly one guest
and denying two frauds) and then switches to blind `holdT()` waiting for
the remaining ~123,000 ticks, during which nightly expenses accrue with
nobody working the desk. A real player — and the headless `alpha-loop`
scenario's bot, which DOES serve continuously — would keep working the
desk through that stretch. I am NOT re-opening B2 (time acceleration is
verified working, see above) or claiming the shipped economy is broken;
I am flagging that THIS DRIVER cannot currently produce a tier-1/tier-2/
end-card frame set, and saying so rather than fabricating one. A future
re-run needs a driver that interleaves guest-serving with the T-held
waits, not one that treats them as separate phases.
Screenshot: apps/hotel/docs/walkthrough/13-tier0.png (the only tier frame
this session has real evidence for)

### B10 — Two real frauds caught and confirmed legible by eye this session
Severity: none — this is the CLOSED version of the old B3/F1 gap
Build: artifact-5203
With `fraudRatePermille` now non-zero upstream and the driver's field
diff fixed (all documents read, `evaluateRules` used for ground truth
instead of `plantedViolations`), this session hit two fraud cases in the
same guest and both are legible on the RESERVA screen without any code
knowledge:
- `res-code-mismatch`: `resSlip.resCode = "RC-4715~803728"` vs
  `reservation.resCode = "RC-4715"`.
- `name-mismatch`: `id.name = "Quinn Baptiste~557147"` vs
  `reservation.guestName = "Quinn Baptiste"`.
Both denied via DENY; a third, legitimate guest in the same session was
checked in cleanly. See apps/hotel/docs/WALKTHROUGH.md §4 for the
screenshots and full narrative.
Screenshot: apps/hotel/docs/walkthrough/06-fraud-rescode.png,
07-fraud-name.png

### B11 — This driver's own bug: submitting a "face" command does nothing in the real browser app (found and fixed, not a game defect)
Severity: none — driver bug, fixed in `apps/hotel/dev/playtest.mjs`
Build: n/a (tooling)
The C2-W1 driver's navigation submitted `{type:"face", payload:{yawMdeg}}`
directly via `window.__WORLDFORGE__.submit`, mirroring
`scenarios/lib/hotel-owner.mjs`. That works for a headless-harness bot
driving a bare `Sim` directly, but NOT for the real browser app:
`packages/player-fps/src/index.ts` (~line 316) maintains its own internal
`camYawMdeg`, driven only by pointer-look deltas, and re-submits a face
command every frame to snap the sim's yaw back toward that internal value
whenever they drift — silently overwriting any directly-submitted face
command on the very next frame. Confirmed live
(`artifacts/diag-guest.mjs`): six submitted face commands with six
different target bearings left the player's actual yaw at exactly 0 every
time. This is very likely why the C2-W1 session's beat 4 loop only ever
served one real guest despite a 4-minute budget — the player was almost
never actually facing the queue head. Fixed by turning via
`window.__WORLDFORGE__.pointer.look(dx)` instead (a small proportional
controller, `turnToBearing()`), exactly as the original brief's §3.0
always specified. Also fixed in the same pass: `walkTo()` had no
door-awareness at all and would walk in place against a closed bedroom
door forever (messes/props live behind doors); it now opens a closed door
in range before continuing to path toward the target.
