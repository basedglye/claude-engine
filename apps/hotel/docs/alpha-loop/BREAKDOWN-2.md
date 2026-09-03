# GRAND FOYER alpha loop — cycle 2 work breakdown (COO)

Written 2026-09-02 by the integrating COO for branch
`claude/grand-foyer-game-alpha-50b07d`, resuming from files after cycle 1
landed at `a3ef444`. Binding inputs, in precedence order:
[VISION-ALPHA.md](../VISION-ALPHA.md) (CEO, binding) → `CLAUDE.md` at the
repo root (invariants) → [DESIGN.md](../DESIGN.md) →
[ALPHA-LOOK.md](../ALPHA-LOOK.md) → [BREAKDOWN.md](BREAKDOWN.md) (cycle 1,
still the reference for every constant) → `docs/PLAN-ALPHA.md` §6
(orchestration constitution — copied verbatim onto this branch as part of
this cycle's setup; see §7.1).

This file is the plan. The brief files under `briefs/C2-*.md` are what the
workers actually receive; each is self-contained and assumes no knowledge
of this document or of the conversation that produced it.

---

## 0. Where cycle 1 left us (verified state, not plan)

- Commit `a3ef444` on this branch. All **13 headless gates** green with
  `--verify-replay` (including the new `alpha-loop`, which reaches tier 2
  and closes solvent inside 14 in-game days), and all **5 browser gates**
  green (`fps-look-interact` on Chromium and Firefox, `reserva-readability`,
  `save-restore`, `demo-visual`) at their pinned command counts
  12 / 20 / 69 / 18.
- `main.ts` is fully wired: `readHotelTier` → per-tier scenery groups and
  light-rig rebuild, the walkthrough + end card, and
  `installHoverLookFallback`.
- The single-file artifact builds
  (`node apps/hotel/scripts/build-artifact.mjs`, 1.8 MB into
  `apps/hotel/dist-artifact/grand-foyer.html`), the `/assets/` fetch shim
  is **sealed** (unmatched paths get a synthetic 404, proven in a running
  page), and the freshness precondition refuses a stale `dist/`.
- It is published as an artifact at
  `https://claude.ai/code/artifact/96023cbe-3604-4734-9f40-688d888dedb4`.
- `apps/hotel/netlify.toml` exists and is correct (no `base`;
  `command = "npm run build -w apps/hotel"`, `publish = "apps/hotel/dist"`),
  and the command was proven to exit 0 from the repo root and to produce
  that directory. **Nothing has ever been deployed.**

**What has never happened: a human-equivalent playthrough.** Every green
number above was produced by a bot or a probe. No one has walked in the
front door of the shipped artifact and played the loop end to end. That is
what cycle 2 exists to do, and it is why the shape below is what it is.

---

## 1. Shape of the cycle

**THREE concurrent Sonnet lanes, file-disjoint.** Not four. The reserved
fourth slot is discussed and deliberately declined in §6.

| Lane | Name | Owns |
|---|---|---|
| C2-W1 | **PLAYTEST QA** — drive the artifact and the dev app through the whole loop; produce `docs/WALKTHROUGH.md` | `apps/hotel/dev/playtest.mjs` (new), `apps/hotel/docs/WALKTHROUGH.md`, `apps/hotel/docs/walkthrough/**`, `apps/hotel/docs/alpha-loop/C2-W1-blockers.md` |
| C2-W2 | **POLISH** — the cycle-1 non-blocking carries: sun shadow, tier-0 tone, `overflowWaitCells` dedupe, the broke-`renovateCommand` bot beat | `apps/hotel/src/render/{lighting,procedural}.ts`, `apps/hotel/src/sim/game.ts`, `scenarios/alpha-loop.scenario.mjs`, `apps/hotel/dev/tour.ts`, `apps/hotel/docs/alpha-loop/C2-W2-shots/**` |
| C2-W3 | **HOSTING** — the exact, verified Netlify deploy sequence, `dist/play.html`, no deploy | `apps/hotel/scripts/build-artifact.mjs`, `apps/hotel/netlify.toml`, `apps/hotel/docs/HOSTING.md` |

**Disjointness, checked against the tree rather than assumed
(PLAN-ALPHA §6.4):**

- C2-W1 writes **no `src/` file at all**. Its only code artifact is one new
  dev harness script. It is forbidden from fixing anything (§2.1).
- C2-W2 touches two render files (`lighting.ts`, `procedural.ts`), one sim
  file (`game.ts`), one scenario and one dev page. `hud.ts`, `i18n.ts`,
  `walkthrough.ts`, `architecture.ts`, `decor.ts`, `fixtures.ts`,
  `exterior.ts` are **not** in its globs this cycle.
- C2-W3 touches one script, one TOML, one new doc. It touches no `src/`
  file.
- Overlap check on `apps/hotel/dev/`: C2-W1 owns exactly
  `dev/playtest.mjs` (new). C2-W2 owns exactly `dev/tour.ts`. Nothing
  else under `dev/` is opened by anybody. (Cycle 1's W3 review noted the
  `dev/**` glob contradiction; it is resolved here by naming files, never
  directories, under `dev/`.)
- Overlap check on `apps/hotel/docs/`: normally orchestrator-only, and it
  stays so **except** for the three explicitly named, disjoint paths in
  the table above. `WALKTHROUGH.md` and `walkthrough/**` are C2-W1's alone;
  `HOSTING.md` is C2-W3's alone; `C2-W2-shots/**` is C2-W2's alone. No
  lane may touch `HANDOFF.md`, `BREAKDOWN*.md`, `reviews/**`, `briefs/**`,
  `ALPHA-LOOK.md`, `VISION-ALPHA.md`, `DESIGN.md` or `decisions/**`.

**Read-only for everybody this cycle:** `apps/hotel/src/main.ts`,
`apps/hotel/index.html`, `apps/hotel/package.json`, `package.json`,
`package-lock.json`, `apps/hotel/vite.config.ts`,
`apps/hotel/assets.manifest.json`, `CLAUDE.md`, `.claude/launch.json`,
`docs/**`, `docs/reviews/**`, and every `src/render/**` and `src/sim/**`
file not named in a lane's glob. If a lane believes it must edit one, it
stops and reports (PLAN-ALPHA §6 rule 5).

**Ports.** C2-W1 → **5202** (dev app) and **5203** (bare static server for
the artifact-alone test). C2-W2 → **5204**. C2-W3 → **5205**. Never 5199
(`.claude/launch.json`) and never 5173. `pkill` does not kill the Windows
dev server; use `Get-NetTCPConnection -LocalPort <port> | Stop-Process`.

**Model tiering (PLAN-ALPHA §6.3).** All three lanes are **Sonnet**. None
is mechanical: C2-W1 is a browser-driving campaign (§6.3 is explicit that
Haiku must never be spent on a browser gate), C2-W2 is a sim edit plus a
visual taste pass, C2-W3 must reason about what Netlify's build environment
actually does. Fable is spent only on the review gate.

---

## 2. The three lanes in detail

### 2.1 C2-W1 — PLAYTEST QA (the point of the cycle)

Drives **two builds** through the whole loop with Playwright, headed
Chrome, `--ignore-gpu-blocklist`:

1. **The built single-file artifact, served alone.** A bare `node:http`
   server on 5203 whose document root contains the artifact file and
   *nothing else* — the same isolation W4's review used, so a stray fetch
   cannot be answered by a neighbouring file. Requests are logged; the
   expected total is one (the document itself).
2. **The dev app** on 5202, at `worldforgeQuality=high`, for the frames
   that need the real GPU look.

The loop, in order, all of it: enter → walk to the desk → serve guests
including **at least one fraud caught via RESERVA** → clean a mess →
repair a prop → run the night audit at the terminal → wait/earn until
RENOVATE is available in LEDGER → press it → watch the tier change → reach
tier 2 and the end card. Driven with
`window.__WORLDFORGE__.pointer.lock()/look(dx, dy)` and `page.keyboard`,
because the embedded Browser pane refuses pointer lock
(`WrongDocumentError` — ALPHA-LOOK's trap).

**This lane may not fix bugs.** Not a one-line CSS tweak, not a typo. Its
output for every defect is a blocker record: what was expected, what
happened, the exact repro steps (URL, keys, coordinates, tick), and a
screenshot. This is deliberate — a QA lane that patches what it finds
stops being an independent measurement, and its report becomes a claim
about its own work. Blockers land in
`apps/hotel/docs/alpha-loop/C2-W1-blockers.md`; the orchestrator triages
them into the review gate.

Its player-facing deliverable is `apps/hotel/docs/WALKTHROUGH.md` with
screenshots under `apps/hotel/docs/walkthrough/`, written from the frames
it actually captured — a player's walkthrough, not a test log.

Brief: [briefs/C2-W1-playtest-qa.md](briefs/C2-W1-playtest-qa.md).

### 2.2 C2-W2 — POLISH (the non-blocking carries)

Four named carries, each traceable to a cycle-1 review, plus one fresh
look:

| # | Carry | Source |
|---|---|---|
| 1 | Diagonal sun-shadow streaks across tier-0 interior walls | fresh (visible in cycle-1 tier-0 frames) |
| 2 | Tier 0 reads "dated office", not "seedy motel" | reviews/W2.md item 4, round 2 §4 — held open twice, explicitly deferred to cycle 2's playtest |
| 3 | `overflowWaitCells` not deduped against `candidateWaitCells` | reviews/W1.md §6 carry 1 |
| 4 | No bot beat submits a bare `renovateCommand` while broke | reviews/W1.md §6 carry 3 (round 2 §5 / round 3 §3.2 / round 4 §4.6) |
| 5 | Anything obvious from a fresh look at `dev/tour.html` at tiers 0/1/2 | this cycle |

Carry 3 is a **sim change** and therefore moves nothing if done right and
moves every hash if done wrong: excluding a cell from a pool changes which
cell a guest is assigned, which changes the command stream. The lane
re-runs the full headless sweep with `--verify-replay` and reports the new
hashes; the orchestrator re-pins. Exit 3 is a P0 and is never answered by
loosening an assertion (CLAUDE.md invariant 6).

Carry 1's shape is decided here so the lane does not invent it: the sun is
an exterior light and its shadow camera has no business reaching interior
geometry. Two acceptable fixes, lane's choice with justification —
(a) tighten `sun.shadow.camera`'s ortho box and `far` so it covers the
street rect only, or (b) put interior architecture on a layer the sun's
shadow map does not sample. Turning shadows off entirely is not
acceptable: `fps-look-interact` and the tier-2 look both depend on them.

**Tier 2 must not regress.** The same discipline that held for two rounds
in cycle 1 holds here: every edit is inside a tier-0/1 branch, or is a
pure `if (hotelTier === 2) return <what it did before>` guard. Evidence is
five tier-2 poses re-shot and compared by eye against
`apps/hotel/docs/evidence/alpha-look-*.jpg`.

Brief: [briefs/C2-W2-polish-carries.md](briefs/C2-W2-polish-carries.md).

### 2.3 C2-W3 — HOSTING (deploy sequence, not deploy)

Produces `apps/hotel/docs/HOSTING.md`: the exact command sequence, in
order, with each command's real observed output, for deploying this
branch's build to Netlify with the Netlify CLI — and **does not run the
deploy**. The orchestrator deploys (VISION's hosted fallback is a
deliverable; a lane pushing to a public URL is not something a lane
decides).

It also makes the hosted site serve both products: `dist/play.html` is the
single-file artifact copied into the Vite output, so the hosted site
offers the streaming build at `/` and the self-contained one at
`/play.html`. That copy belongs to `build-artifact.mjs` (it already knows
where the artifact is and already validates `dist/` freshness), behind an
explicit flag so a plain artifact build does not silently write into
`dist/`.

**The freshness trap applies to the copy too.** `dist/play.html` written
from a stale `dist-artifact/grand-foyer.html` is exactly the class of
failure this project has been bitten by four times; the copy happens in
the same run that writes the artifact, never as a separate `cp` step
documented in prose.

Brief: [briefs/C2-W3-hosting-netlify.md](briefs/C2-W3-hosting-netlify.md).

---

## 3. Integration order

Lanes run concurrently but land in this order, one commit each, gates
re-run by the COO between landings (PLAN-ALPHA §6 rules 3, 4, 12):

1. **C2-W3 first.** It is the smallest, it touches no `src/`, and it
   cannot move a hash. Landing it early gets the deploy sequence in hand
   while the other two are still running.
2. **C2-W2 second**, because it is the only lane that moves `stateHash`.
   On landing, the COO re-runs the full 13-gate headless sweep with
   `--verify-replay` and re-pins the hashes in the handoff, then re-runs
   the 5 browser gates.
3. **C2-W1 last**, because its whole value is measuring what actually
   ships. Its *report* arrives first (it is the longest-running lane and
   reports against `a3ef444`'s build), but its `WALKTHROUGH.md` commit
   lands after C2-W2, and any screenshot invalidated by C2-W2's tier-0
   tone or shadow fix is re-shot by the orchestrator against the merged
   tree before the walkthrough is called done.

That last clause is the one real ordering hazard in this cycle and it is
named in C2-W1's brief: **its screenshots may be re-shot after it
reports.** The lane does not treat its frames as final and records the
exact camera pose, seed, tick and URL for every one of them so any frame
can be reproduced without the lane.

---

## 4. Cycle-2 exit criteria — "playable end to end with a full loop"

Concrete, with the evidence that closes each. The phrase means all nine of
these, and nothing less.

| # | Must demonstrate | By whom | Evidence that closes it |
|---|---|---|---|
| 1 | A person can enter and reach the desk from the front door with no outside help | C2-W1, re-run by COO | Screenshot of the entry overlay, then of the desk from the player's eye, plus the walkthrough line advancing from `walk-to-desk` to `take-papers` (its `data-step` attribute, read from the DOM) |
| 2 | A guest is checked in through RESERVA by reading their documents | C2-W1, re-run by COO | Frame of the RESERVA screen with the document legible, and the `guest.checkedIn` event in `commandLog()`/event stream at a named tick |
| 3 | **A fraud is caught**, by the player noticing it, not by a bot rule | C2-W1 | Frame of the mismatched document, the refusal, and the resulting event; the blocker log says whether the mismatch was *findable* by a first-time reader |
| 4 | A mess is cleaned and a broken prop repaired | C2-W1 | Before/after frames of each, plus `room.messCleaned` and `prop.repaired` |
| 5 | The night audit runs at the terminal and cash + stars visibly change | C2-W1 | Frame of AUDIT before and after, with the two numbers different, plus `econ.audit` |
| 6 | RENOVATE becomes available, is pressed once, and **the hotel visibly changes around the player** — tier 0 → 1 and 1 → 2 | C2-W1 | Four frames from one fixed camera pose: t0, t1 after the first press, t1 again, t2 after the second; plus `hotel.renovated` `{from,to}` for both |
| 7 | The end card appears at tier 2 with a day count and cash, and **play continues after it** | C2-W1 | Frame of the end card, then a frame after dismissal showing the player still walking |
| 8 | All of 1–7 hold in **the single-file artifact served alone**, with **zero** external requests | C2-W1, re-run by COO from `file://` offline | Request log from the isolated 5203 server (total = 1, the document) **and** the COO's own `file://` open with the network panel empty |
| 9 | 13 headless gates + 5 browser gates green at pinned counts on the merged tree, and tier 2 has not regressed | COO only, re-running every command itself | Verdict JSONs under `artifacts/verdicts/`, command counts 12 / 20 / 69 / 18, and the tier-2 poses compared by eye against `docs/evidence/alpha-look-*.jpg` |

**The bar for "with no outside help" is the walkthrough, not the tester.**
C2-W1 plays the loop **with the walkthrough on and its own knowledge of
the codebase set aside**, and records every moment where it needed to know
something the game never told it. Each such moment is a blocker, even if
nothing is broken. A loop that is only completable by someone who has read
`game.ts` is not a playable alpha, and that judgement is the single most
valuable thing this cycle produces.

**Non-goals for cycle 2**, stated so they are not smuggled in: raising
`MAX_STARS` (BREAKDOWN §7's open CEO question), the lobby depth
(ALPHA-LOOK's known limitation, H3a's work), `generateHotel(spec)`, the
turned-away-guest reputation beat (§6), and any new sim feature at all
beyond carries 3 and 4.

---

## 5. COO review checklist, applied to every lane's output

Applied by the COO **re-running every command itself** (PLAN-ALPHA §6 rule
12), not by reading the lane's report. Cycle 1's §5 stands in full; these
are the cycle-2 deltas.

1. **Globs.** `git status --porcelain` shows only paths inside the lane's
   declared globs. Note that C2-W1 is expected to leave **zero** paths
   under `src/` — a single one is a rule-breach and voids its independence.
2. **Build clean from cold**, then `tsc --noEmit`, `eslint .`,
   `check-purity.mjs`.
3. **`npm test`** — smoke hash **3849639990** must not move (engine demo,
   not the hotel), and `npm run test --workspaces --if-present`.
4. **Headless sweep, all 13, all `--verify-replay`.** Any exit 3 is a P0.
   After C2-W2, the hashes are expected to MOVE (carry 3 is a stream
   change) — a moved hash with `passed: true` and incremental/slow
   agreement is a re-pin; a *divergence* is not.
5. **Browser gates** at exactly 12 / 20 / 69 / 18.
6. **Non-vacuity is evidenced, not asserted** — the exact edit, the exact
   assertion string that went red, four exit codes.
7. **Rebuild discipline** — `tsbuildinfo` + `dist-game` removed, or the
   perturbation claim is void.
8. **Invariants** — no `Math.random`, no transcendental `Math.*`, no float
   under `src/sim`; every mutation through `setComponent`; no renderer
   writes sim state; every player-visible string through `t()`.
9. **`ScreenViewData` still has exactly 9 top-level keys.**
10. **Tier 2 did not regress**, verified by the COO on a real GPU
    (`channel: "chrome"`, `--ignore-gpu-blocklist`), never on SwiftShader
    frames.
11. **"What you did NOT do."** Present and specific, unprompted.
12. **The artifact is opened by the COO from `file://`, offline**, network
    panel empty, and the whole loop is spot-checked there — not only in the
    dev app.
13. **New this cycle: C2-W1's blockers are triaged before the review
    gate,** each marked *fix in cycle 2* / *fix later* / *not a bug*, with
    the reason. A blocker silently dropped is treated the same as a
    skipped verification step.

---

## 6. The fourth lane, considered and declined

The reviews leave exactly one real design gap: **reviews/W1.md §4.3 — a
turned-away guest is indistinguishable from a happy one.** Half of it is
already closed on this branch (`game.ts:1110` emits
`guest.left { reason: "turned-away" }`, so the discriminator exists). The
open half is the *felt consequence*: nothing in the audit, MAILBOX or
reputation reflects that the motel was full and lost a booking. The review
itself calls wiring it to reputation "a cycle-2 design call".

It is declined for this cycle, for a reason that is about ordering rather
than value:

- It is a **sim change touching `economy.ts` / `reviews.ts` / the audit** —
  a second stream change on top of C2-W2's carry 3, landing while C2-W1 is
  mid-playthrough against a build that must stay frozen for its evidence
  to mean anything. Cycle 1's rule was "the sim lane lands first, always";
  in cycle 2 the playtest **is** the cycle, and it needs a stable target.
- Every exit criterion in §4 is reachable without it. It makes the economy
  better; it does not make the loop playable.
- It is genuinely a design call (does a lost booking cost stars? a review?
  demand next day?) and design calls belong in a CEO/planning turn, not
  smuggled into a polish lane.

**Recorded as the first candidate lane for cycle 3**, together with
BREAKDOWN §7's `MAX_STARS` question, which it interacts with directly: if
lost bookings cost reputation, a three-star ceiling starts to mean
something.

---

## 7. Housekeeping done by the orchestrator at setup

### 7.1 `docs/PLAN-ALPHA.md`
Copied **verbatim** from the sibling worktree
`.claude/worktrees/relaxed-blackwell-cb30c3/docs/PLAN-ALPHA.md` onto this
branch at `docs/PLAN-ALPHA.md` (25,809 bytes; `cmp` clean). It was listed
in the cycle-2 carries as a lane task; `docs/**` is orchestrator-only and
a byte-for-byte copy requires no judgement, so it was done here instead of
being spent as lane budget. Every cycle-1 brief and BREAKDOWN.md already
cite it by that path; the citations now resolve on this branch.

### 7.2 Still owed from cycle 1, orchestrator's, not a lane's
reviews/W1.md §6 carry 2: the day-by-day table showing `guest.queued`
non-zero on all 14 days of `alpha-loop`, and the round-3 perturbation
cycle's four exit codes. Both are re-derivable from a fresh `alpha-loop`
run plus its verdict JSON and are folded into the COO's §5 rule 4 sweep
after C2-W2 lands.

---

## 8. Risks, each with its early-warning sign

| # | Risk | Early warning | Response |
|---|---|---|---|
| 1 | **The playthrough finds the loop is not completable by a person** — e.g. the fraud is unfindable, or RENOVATE never becomes affordable in a hand-played session. | C2-W1's blocker log filling with "I only knew this from the code". | This is the cycle succeeding, not failing. Triage into a cycle-3 fix lane; do **not** let C2-W1 patch it, and do not soften the exit criteria in §4 to match what shipped. |
| 2 | **C2-W2's tier-0 tone pass overshoots** and the motel becomes unreadably dark, failing the readability probe or making the walkthrough screenshots useless. | `reserva-readability` moving at all; frames where the vending machine is not legible. | Tone is taste and the probe is the floor: any change that moves `reserva-readability`'s verdict is reverted, not argued. Re-shoot the five tier-0 poses. |
| 3 | **Carry 3 (`overflowWaitCells` dedupe) diverges rather than re-pins.** | `--verify-replay` exit 3, or `stateHash` vs `stateHashSlow` disagreeing. | P0. Look for an in-place mutation of a fetched component in the touched path before touching the assertion. Never loosen the check (CLAUDE.md invariant 6). |
| 4 | **C2-W1's screenshots are invalidated by C2-W2.** | Any tier-0 or lighting frame in `WALKTHROUGH.md` after C2-W2 lands. | Anticipated and cheap because the brief requires the exact pose/seed/tick/URL of every frame: the COO re-shoots from the recorded poses on the merged tree. |
| 5 | **The artifact fetches something in the hand-played loop that the bot never triggered.** | Any non-data request in the isolated 5203 server log beyond the document. | The shim is sealed, so this presents as a 404 and a missing asset rather than a leak — still a blocker. Record the exact path; it names the code path that assumed a network. |
| 6 | **`dist/play.html` ships stale.** | The copy existing without the artifact having been rebuilt in the same run. | The copy is inside `build-artifact.mjs` behind a flag, after the freshness check, never a documented `cp`. C2-W3's non-vacuity obligation is exactly this. |
| 7 | **A lane re-delegates instead of working.** | A report with no exit codes and no file diffs, arriving fast. | PLAN-ALPHA §6 rules 1 and 13: brief re-issued to a fresh lane; the token spend is written off. |
| 8 | **C2-W1 fixes something.** | Any `src/` path in its `git status`. | Its report is treated as non-independent for that finding; the finding is re-verified by the COO from scratch. |
