# C2-W1 — Playtest QA: play the whole loop, report every blocker, write the walkthrough

You are lane C2-W1 of three concurrent lanes on branch
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

`npm run dev -w apps/hotel -- --port 5202 --strictPort`. **Ports 5202 and
5203 are yours** — 5202 for the dev app, 5203 for the isolated static
server in §3.1. Never 5199 (`.claude/launch.json`'s port), never 5173
(routinely held by another session; a live server there looks exactly like
a stale bundle). Kill both when done — `pkill` does not kill the Windows
dev server; use `Get-NetTCPConnection -LocalPort 5202 | Stop-Process`.

---

## 1. Goal, and the one rule that makes this lane worth running

Cycle 1 shipped GRAND FOYER's whole loop and proved it with 13 headless
gates and 5 browser gates, all green. **Every one of those numbers was
produced by a bot or a probe. No person has ever played this game.** You
are that person.

Play the full loop, twice — once in the built single-file artifact served
alone, once in the dev app — and report what a first-time player would
hit. Then write `apps/hotel/docs/WALKTHROUGH.md`, a player-facing
walkthrough with screenshots, from the frames you actually captured.

**You may not fix anything.** Not a bug, not a typo, not a one-line CSS
tweak. Your output for every defect is a *blocker record*: what you
expected, what happened, exact repro steps, and a screenshot path. This is
deliberate. A QA lane that patches what it finds stops being an
independent measurement and its report becomes a claim about its own work.
If you find something broken and obvious and trivial, **write it down and
move on**. A single modified path under `apps/hotel/src/` voids this
lane's independence and its report will be re-run from scratch by someone
else.

**Play with your codebase knowledge set aside.** The bar is "a person can
complete this in one sitting with no outside help" (VISION-ALPHA §"The
full game loop"). Every moment where you needed to know something the game
never told you — where the fraud was, which key opens the terminal, that
LEDGER is where RENOVATE lives — is a blocker **even if nothing is
broken**. That judgement is the single most valuable thing you produce.

---

## 2. Files you may touch (nothing else)

```
apps/hotel/dev/playtest.mjs                      (new file, yours — the driver)
apps/hotel/docs/WALKTHROUGH.md                   (new file, yours)
apps/hotel/docs/walkthrough/**                   (new directory, yours — screenshots)
apps/hotel/docs/alpha-loop/C2-W1-blockers.md     (new file, yours)
```

You may also write scratch output under `artifacts/` (gitignored working
area) — screenshots you do not keep, request logs, notes. Do not leave
large files at the repo root; a stray 8 MB verdict JSON at the root halted
a commit last cycle.

**Read-only for you: everything else in the repo.** Specifically and
emphatically: nothing under `apps/hotel/src/`, nothing under
`packages/`, nothing under `scenarios/`, no `package.json`, no
`netlify.toml`, no other file under `apps/hotel/dev/` (`tour.ts` belongs
to a live lane), and nothing else under `apps/hotel/docs/` — `HANDOFF.md`,
`BREAKDOWN*.md`, `ALPHA-LOOK.md`, `VISION-ALPHA.md`, `DESIGN.md`,
`reviews/**`, `briefs/**`, `decisions/**` and `evidence/**` are not yours.

Read (do not edit) these before you start: `apps/hotel/docs/VISION-ALPHA.md`
(binding — the loop you are playing is defined there),
`apps/hotel/docs/ALPHA-LOOK.md` (the traps section will save you an hour),
and `apps/hotel/docs/alpha-loop/BREAKDOWN.md` §1.7 (the walkthrough's
fixed step list, so you know what the hint line should say and when).

---

## 3. How to drive it

### 3.0 The pointer-lock trap (read this first)

The embedded Browser pane refuses pointer lock (`WrongDocumentError`). You
must drive the real app from a **Playwright script**, using the game's own
synthetic pointer:

```js
await page.evaluate(() => window.__WORLDFORGE__.pointer.lock());
await page.evaluate(([x, y]) => window.__WORLDFORGE__.pointer.look(x, y), [dx, dy]);
await page.keyboard.down("KeyW"); /* ... */ await page.keyboard.up("KeyW");
```

`window.__WORLDFORGE__` also exposes `world` (read `world.tick`) and
`commandLog()`. **Real mouse X is negated in `player-fps`'s DOM
normalizer**, but the synthetic `pointer.look(dx)` path keeps yaw-space
meaning — so a positive `dx` is a consistent turn direction and every
hand-derived number stays valid. Roughly `look(409)` ≈ 90°, measured last
cycle.

Launch with a real GPU, not SwiftShader — Playwright's bundled Chromium
picks SwiftShader and the look measured 1–3 s per frame:

```js
const browser = await chromium.launch({
  headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text()); });
page.on("request", (r) => { if (!r.url().startsWith("data:")) console.log("[req]", r.url()); });
```

**Working reference implementations, read them before writing your own:**
`artifacts/shoot.mjs` (synthetic lock + look + WASD + screenshots, with
the exact launch args above) and `artifacts/tour.mjs`. Copy their shape.

**How to reach each game state** is already written down twice, and you
should mine both rather than guessing:
`scenarios/lib/hotel-owner.mjs` — the owner bot that plays this exact loop
by producing only the commands a human produces (`face`/`move` to walk,
`interact` to open a door or take papers, `screen.click` at coordinates
derived from `hotelShell.layout()` to work the terminal, including the
RENOVATE click). And `scenarios/alpha-loop.scenario.mjs`, which is the
14-in-game-day arc end to end and names the seed
(`hotel-alpha-loop-1`) whose run reaches tier 2. Use the bot's coordinate
derivation for screen clicks; do **not** hard-code pixel coordinates you
guessed from a screenshot.

Speed: a real-time 14-day play is not the point and you have a budget. It
is legitimate to use `?worldforgeSeed=hotel-alpha-loop-1` and to let the
sim run unattended between the acts you are testing. It is **not**
legitimate to reach a state by writing sim components, teleporting, or
submitting a command a player cannot produce — a state reached that way
proves nothing about playability, and if you do it anywhere, say so
explicitly in §6.5.

### 3.1 Build 1 — the artifact, served ALONE (the one that counts)

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build -w apps/hotel
node apps/hotel/scripts/build-artifact.mjs
```

That writes `apps/hotel/dist-artifact/grand-foyer.html` (~1.8 MB). Copy
**only that file** into a fresh empty scratch directory (e.g.
`artifacts/playtest-serve/`) and serve *that directory* on **5203** from a
bare `node:http` server that logs every hit. The isolation is the point: a
neighbouring file on disk can answer a stray fetch and hide a leak.

`/assets/**` is sealed — unmatched paths get a synthetic
`404 "Not Found (sealed /assets/ shim)"` rather than escaping. So a
missing asset presents as a 404 in the console, not as a network request.
**Watch for both.** Expected request total for the whole session: **one**
(the document). Log it and report the number.

Also open the same file directly from `file://` at least once and confirm
the game runs and pointer lock behaves (the hover-look fallback,
`pointer-fallback.ts`, exists precisely for sandboxes that refuse lock —
confirm it engages and that looking around actually works when it does).

### 3.2 Build 2 — the dev app

`npm run dev -w apps/hotel -- --port 5202 --strictPort`, then
`http://localhost:5202/?worldforgeQuality=high&worldforgeSeed=...`. This is
where the real-hotel look lives (the ~90 MB CC0 payload, if
`npm run assets:fetch -w apps/hotel` has been run; without it the app runs
on the flat-colour procedural build and that is fine — say which you
used). Use it for the frames that need the good look and for anything the
artifact makes awkward.

---

## 4. The loop you must play, in order

All of it, in both builds where noted. For **every** beat: capture a
screenshot, and record the tick (`world.tick`), the camera pose, the seed
and the full URL, so any frame can be re-shot without you. (It will be:
another lane is changing tier-0 lighting and tone this cycle, and your
tier-0 frames may need re-shooting on the merged tree.)

| # | Beat | What to confirm |
|---|---|---|
| 1 | **Enter.** Click the canvas, pointer lock engages (or the fallback does). | The entry overlay's control list is accurate. The one-line objective is visible and readable. |
| 2 | **Walk to the desk.** | The hint line's `data-step` is `walk-to-desk` and flips to `take-papers` on arrival. Read it from the DOM, do not eyeball it. |
| 3 | **Serve guests.** Take papers, read the documents, use RESERVA, check in. | The document is legible at the player's eye height without leaning on a zoom. `guest.checkedIn` fires. |
| 4 | **Catch a fraud via RESERVA.** At least one. | The mismatch is *findable by a first-time reader*. Say explicitly whether you found it by looking or by knowing. This is the beat most likely to be unplayable-but-passing. |
| 5 | **Clean a mess.** | Before/after frames. `room.messCleaned`. |
| 6 | **Repair a prop.** | Before/after frames. `prop.repaired`. |
| 7 | **Run the night audit** at the terminal. | Cash and stars visibly different before vs after. `econ.audit`. |
| 8 | **Wait/earn until RENOVATE is available** in LEDGER. | The hint line surfaces "you can afford to renovate" *when it actually becomes affordable*, not before. Note how long this took and whether it felt like a wait or a wall. |
| 9 | **Press RENOVATE. Watch the tier change.** | Four frames from ONE fixed camera pose: tier 0, tier 1 (after press 1), tier 1 again, tier 2 (after press 2). `hotel.renovated {from,to}` for both. The hotel must visibly change *around the player*. |
| 10 | **Reach tier 2 and the end card.** | The card shows a day count and cash. **Play continues after it** — take a frame after dismissal showing the player still walking. |
| 11 | **Hire the clerk** (any point). | `staff.hired`; you are no longer chained to the desk. |

Also, at any point: press **H** and confirm the walkthrough can be
skipped; open a terminal screen and confirm the HUD is hidden entirely
while focused; confirm nothing the HUD draws ever intercepts a click.

---

## 5. Deliverables

### 5.1 `apps/hotel/dev/playtest.mjs`
Your driver. One file. It should be re-runnable and should print, per
beat, the tick and the screenshot path. Keep it honest: if a beat needed a
manual nudge, the script says so in its output rather than pretending.
Note that `apps/hotel/dev/**` is in the eslint ignore set, so this file is
not linted — do not let that become an excuse for it being unreadable.

### 5.2 `apps/hotel/docs/alpha-loop/C2-W1-blockers.md`
One record per blocker, numbered, each with:

```
### B<n> — <one-line title>
Severity: blocker | rough-edge | note
Build: artifact-5203 | artifact-file:// | dev-5202
Expected: ...
Actual: ...
Repro: <URL, seed, exact keys/clicks in order, tick>
Screenshot: apps/hotel/docs/walkthrough/... (or artifacts/...)
```

Include the "I only knew this from the code" findings. They are the point.
If you find zero blockers, say so plainly and expect to be disbelieved —
list instead the five things you checked hardest.

### 5.3 `apps/hotel/docs/WALKTHROUGH.md`
The VISION's third deliverable: "the playthrough with screenshots, written
by driving the real build". **Player-facing prose, not a test log.** It
walks a new player from the front door to the Grand Foyer: what they see,
what to do, what the game is asking of them, with the screenshots inline
from `apps/hotel/docs/walkthrough/`. It should read like something you
would hand a friend, and it must not contain any fact you did not observe.
Screenshots go in that directory with stable, ordered names
(`01-entry.png`, `02-desk.png`, …). Keep the total under ~15 MB.

At the bottom, a short **"how these frames were made"** section: the
commands, the seed, the pose/tick/URL per frame. That is what makes them
re-shootable by the orchestrator after the polish lane lands.

---

## 6. Verification commands and expected outcomes

You are not changing the sim or the renderer, so **no hash may move and no
gate may change**. Confirm that you did not disturb the tree:

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
npm run test --workspaces --if-present         # exit 0
npm run harness --silent -- alpha-loop --verify-replay   # exit 0, passed: true
npm run harness --silent -- one-man-week --verify-replay # exit 0, passed: true
```

Report each exit code. If any of these is red **before** you touched
anything, that is itself your first blocker record and you say so
immediately rather than debugging it (it is another lane's file).

---

## 7. Non-vacuity obligation

Your deliverable is a report, so the thing that must be proven
falsifiable is **your driver's ability to detect a broken loop** — a
playtest that would have said "green" no matter what is worth nothing.

1. Run `apps/hotel/dev/playtest.mjs` clean against the artifact. Record
   the exit code and the beat-by-beat output.
2. **Perturb the artifact, not the source.** Build the artifact, then in
   the *built* `grand-foyer.html` (a scratch copy under `artifacts/`,
   never `dist-artifact/` itself) break the RENOVATE path — the simplest
   reliable edit is to string-replace the `"hotel.renovate"` command type
   with a nonsense type so the button's effect is never applied. Serve
   that copy on 5203 and re-run the driver. **Expect it to fail at beat 9
   with a named assertion**, quote the failing line, and record the exit
   code.
3. **Restore** (delete the scratch copy, re-serve the real artifact),
   re-run, confirm green.
4. Report **all four exit codes**.

Note why the perturbation is on the built file rather than on `src/`: you
are forbidden from touching `src/`, and this proves the same thing — that
your driver reads the real running game rather than asserting on its own
script. If you cannot make that edit work, say so and substitute a
perturbation you *can* run, naming the substitution explicitly.

Second, smaller check, because it is the property the artifact is *for*:
serve the artifact directory on 5203 with the request logger on, play a
full loop, and report the **exact request count and every non-data URL**.
Then, from inside the page, run
`await fetch("/assets/textures/lobby-floor/color.jpg")` and confirm it
returns `404 "Not Found (sealed /assets/ shim)"` and that **no new hit
reaches your server**.

---

## 8. Report format (fixed)

1. **Files touched** — every path with a one-line summary. Expected:
   exactly the four in §2, plus scratch under `artifacts/`.
2. **Every command run, with its exit code**, including the driver's full
   output.
3. **The perturbation** — what you broke, the exact failing assertion, the
   four exit codes; plus the request-count and sealed-shim numbers.
4. **The loop, beat by beat (§4's eleven rows)** — for each: pass/fail,
   tick, screenshot path, and one sentence on how it *felt* to a first-time
   player. Beat 4 (the fraud) gets a paragraph, not a sentence.
5. **Blocker count and severity split**, with the file path to the blocker
   log.
6. **What you did NOT do** — anything skipped, unfinished, only partially
   verified, or reached by a means a player could not use. Say it
   unprompted.
7. **Wiring you need from the orchestrator** — anything you had to leave
   undone because it was outside your globs.
