# Assessment — GRAND FOYER, original roadmap → 2026-09-02

Written 2026-09-02 as deliverable (a) of the alpha planning turn (input:
[BRIEF-ALPHA-PLAN.md](BRIEF-ALPHA-PLAN.md)). Companion documents:
[PLAN-ALPHA.md](PLAN-ALPHA.md) (the re-scope and the execution design),
[PHASE-H2C.md](PHASE-H2C.md), [PHASE-H3.md](PHASE-H3.md),
[PHASE-H4.md](PHASE-H4.md).

This is a judgement of [ROADMAP-HOTEL.md](ROADMAP-HOTEL.md) against what
five shipped units actually taught. Every number below carries the method
that produced it, or is marked as unmeasured.

---

## 0. What I re-measured myself, and what I did not

Measured on branch `hotel-phase-2b` in the worktree
`.claude/worktrees/relaxed-blackwell-cb30c3`, 2026-09-02:

| Check | Command | Result |
|---|---|---|
| Workspace resolution | `npm run check:workspace` | exit 0 — `@claude-engine/*` resolve inside the worktree |
| Pinned goldens | `npm run check:goldens` | **12/12 byte-identical**, exit 0. `checkin-rush 1978775531`, `one-man-week 3423109909`, `corridor-headon 2843227394` — all matching the values the H2a review pinned |
| Full build | `npm run build` | **exit 2** at the time of measurement (see below) |

**The build failure is a live concurrent edit, not a committed defect, and
that fact is itself a finding.** At the start of this turn `git status` was
clean but for an untracked `scenarios/save-resume.scenario.mjs`. Twenty
minutes later the same worktree showed `packages/interiors/src/mesh-gen.ts`,
`packages/interiors/scripts/test.mjs` and `scenarios/art-lock.scenario.mjs`
modified, and `mesh-gen.ts` failing `TS2552: Cannot find name
'ATLAS_SIZE_PX'` at lines 286–287 — mid-edit state from another session
working the half-texel UV inset (its own comment describes lobby floor quads
sampling the corridor tile and ceiling quads sampling the lobby floor: the
value-separation regression, being fixed while I planned). The goldens
passed because `golden-sweep` runs against already-built `dist`.

Two consequences, both carried into the plan: **a golden sweep is not a
build**, and **a second agent is live in this worktree**, which is exactly
the condition that produced this project's known git failure mode.

I did **not** re-run the browser gates, the workspace test suite, or
`art-lock`. Every browser figure below is quoted from the H2b implementer's
report or the H2a review with its source named; none is re-verified here,
and the plan treats each as a claim to re-verify at the H2b review, not as a
fact.

---

## 1. Estimate accuracy

The roadmap's own numbers for the span that has shipped:

| Roadmap phase | Estimate | Units actually shipped | Merged | Review rounds to PASS |
|---|---|---|---|---|
| Phase 0 "Walk the Lobby" | 3–5 days | 1 (H0) | 2026-08-25 | **3** |
| Phase 1 "Front Desk & Terminal" | 1–2 wk | **2** (H1a, H1b) | 2026-08-25 | 1, then 2 |
| Phase 2 "One-Man Show" | 2–3 wk | **2** (H2a, H2b) | H2a 2026-08-26; **H2b unmerged** | 1 (H2a); H2b's has not run |

Summed, the roadmap budgeted **3.5–5.7 calendar weeks** for Phases 0–2.
(The brief's "6–10 weeks" figure does not reconcile with the roadmap's own
per-phase numbers; 3.5–5.7 is what the document says, and it is the figure I
plan against.) Elapsed: **9 calendar days**, 2026-08-25 → 2026-09-02, for
four merged units and one at roughly 90%.

**Calendar estimates were wrong by roughly 4–6×, in the optimistic
direction for the reader** — but that number is nearly useless, because it
measures the wrong thing. Two figures are worth carrying forward instead:

1. **Phase count ran 1.7× over.** Three roadmap phases became five shipped
   units. Both splits were correct and both were discovered *at spec time*,
   not planned. A roadmap that names N phases should be read as naming
   ~1.7N review gates.
2. **Review rounds are falling: 3 → 1 → 2 → 1.** The trend is real and
   attributable — H0's spec was written before anyone had run this loop;
   H2a's was written with two deferral ledgers and a split ruling in hand.
   Sharper specs cost planning tokens and repay them in review rounds. This
   is the strongest available argument for the planning turn you are
   reading.

**The right estimating unit is not weeks. It is `(lanes × review rounds)`
per verification shape.** H2a was 8 lanes / 1 round. H2b was 6 lanes and its
round has not happened. A phase whose lanes exceed ~8, or whose gates span
two verification shapes, has historically on this project been two phases.

---

## 2. Where the plan was right

- **The engine/game split held completely.** Invariant 5 ("engine owns the
  hard parts") never had to be defended: netcode, persistence, auth and
  input validation stayed in engine packages, and no generated game code
  rolled its own. The `save-web`-over-`GameStore` bet paid — persistence
  arrived as an implementation of an interface that already existed, and the
  SP→MP migration story ("point the store elsewhere") is still intact.
- **"Every phase ends in something walkable, gated by harness verdicts."**
  Held for every merged unit. This is the discipline the whole project rests
  on and it never slipped.
- **`[F]`/`[S]` phase marking was accurate.** Every phase carrying a
  public-contract change did need a planning turn, and no phase marked `[S]`
  turned out to need one mid-flight — H2's `core` and `persistence` contracts
  were pre-decided in the spec, exactly as intended, so implementation never
  decided a contract.
- **The determinism architecture (B2) was the right call and was worth its
  cost.** Integer mm/mdeg, LUT trig, the transcendental ban, seeded `Rng`,
  `--verify-replay` everywhere. Five units in, zero replay divergences have
  shipped, and the two-engine gate has never gone red for a float reason.
- **Risk 4 (NPC nav jank) fired precisely as written and the prescribed
  mitigation worked.** Stable-ID yield + seeded jitter + `corridor-headon`
  is the reason there is no deadlock class in this game.
- **Risk 2 (unusable diegetic UI) never fired**, and its mitigation produced
  the project's best invention: the committed calibration strip plus the
  `screen-readability` probe. "Put a known pattern in the render and measure
  it back out of the pixels" is the one technique here that generalises to
  every future art surface, and the plan spends it again.
- **Aggressive non-goals worked.** H2 §3 is the reason risk 6 (scope
  explosion in roles) did not fire in Phase 2. Where a spec said "the
  registry stops at six apps", it stopped at six apps.

---

## 3. Where the plan was optimistic

- **It costed implementation and forgot verification.** The roadmap's per-
  phase estimates read as feature-build estimates. The measured bottleneck
  across H0, H1b and H2b is **browser-gate authoring**, and H2b's `art-lock`
  is stuck on it as I write. Nothing in the risk register mentions it.
- **It assumed a phase is a set of features.** A phase is a set of
  *assertions a reviewer can re-run in one sitting*. Both splits happened
  because the halves had incompatible verification shapes — hashed vs
  forbidden-to-hash, headless vs browser. Phases 3 and 4 as written are each
  mixed-shape and will split the same way; the plan does it up front.
- **It treated "walkable in a browser" as the proof.** It is not. Four
  interaction verbs (wipe, repair, interview, pick up a résumé) shipped in
  H2a working, visible and clickable — and **ungated**, because a browser
  scenario can only click what the shipped world contains at the tick it
  runs. The gap survived a PASS review as an accepted deferral with a named
  owner. It closes only now, in H2b's `upkeep-click`.
- **It budgeted nothing for the environment.** The trap list in the brief —
  `tsc` incremental skipping rebuilds (four hits), SwiftShader flags, a fresh
  worktree resolving `@claude-engine/*` up into the main checkout,
  `SRGBColorSpace` rendering the hotel three times too dark, pointer-lock
  delta cancellation, background-tab rAF throttling, `/tmp` not
  round-tripping — is hours per entry, and several were paid more than once.
- **It assumed the person and the agents see the same thing.** Several risks
  (3 "the management layer is shallow", 7 "programmer art", 8 "12-hour
  fatigue") have warning signs defined in terms of a human playing. No human
  has played this game for longer than a drive-through. Risk 7 fired anyway
  and was caught by eye; risks 3 and 8 are still unobserved, not absent.

---

## 4. Where the SHAPE of the work differed

1. **The unit of work is the verification shape, not the feature.** Stated
   in [PHASE-H2.md](PHASE-H2.md) §1 and now proven twice. The cut line that
   worked in H2 was invariant 2 itself: H2a's diff is hashed, H2b's is
   forbidden from being hashed, which makes the H2b review's first act
   ("every H2a golden byte-identical") a mechanical check of an entire
   phase's compliance. That is a reusable structural device, not a one-off.
2. **Contracts moved from the spec into the reviews' deferral ledgers.** The
   real spine of this project is not the roadmap; it is the chain
   H1b-deferrals → H2 §4 ledger → H2a review's consolidated H2b list. Each
   review turns "we didn't do X" into a row with a named trigger. The
   roadmap has no such mechanism, which is why it is now the least accurate
   document in `docs/`.
3. **The hardest defects were invisibility defects, not logic defects.**
   Doors too narrow to walk through; a camera pointed backwards; a gate
   evaluating no assertions; a probe reporting a number the pixels
   contradicted; objectives simulated, event-logged, gate-asserted and
   painted on no screen; four verbs clickable and ungated. Every one passed
   `npm run build`. **A no-HUD game maximises this defect class**, because
   there is no fallback surface where a feature can be seen if its physical
   representation is missing or wrong. The plan therefore treats "is it
   visible, and does a gate click it?" as a first-class exit criterion.
4. **Perf never became the story.** `one-man-week` runs 42,000 ticks at
   0.446 ms/tick at ~195 entities against a 1.0 budget (H2a review's
   measurement, harness single-run — unambiguous at that margin by either
   method). B8's fix order was right and its first three items are done. But
   the ceiling is honest: **nothing has been measured above ~195 entities**,
   and Phase 3's target is 3 floors / 30 rooms / 12 staff / 40 guests.
5. **Measurement method became a contract.** `checkin-rush ≤ 0.030` was
   carried for two phases before the H2a review found the number was
   method-ambiguous — single-run harness `avgTickMs` is cold-start JIT; the
   warm in-process median is 0.0107 ms/tick. ARCHITECTURE B8 now records the
   method beside the number. Any figure in the alpha plan without a method
   is a defect in the plan.

---

## 5. The risk register, judged

| # | Risk | Verdict |
|---|---|---|
| 1 | Determinism erosion | **Fired, in a form the register did not anticipate.** Not float/trig creep — the register's mitigations would not have caught it. Incremental `stateHash` created an entirely new violation class (in-place component mutation), which became CLAUDE.md invariant 6 and needed a cross-check invented in-phase. The register assumed the threat was arithmetic; it was a caching contract. |
| 2 | Diegetic UI unusable | **Never fired.** Mitigation over-delivered; the calibration strip is now general-purpose infrastructure. |
| 3 | Management layer shallow | **Unobservable so far.** Mitigation (rule-table RESERVA, per-tier escalation) is in place and the blacklist row demonstrably activates. But the warning sign — "a session where the terminal is opened only to click confirm" — requires a human play session that has never happened. Carried, unretired, into H4b's playtest gate. |
| 4 | NPC nav jank | **Fired as written; mitigation worked; the WARNING SIGN is unreliable.** The H2a review's P2 perturbation proved the un-avoided repath is a *silent* livelock — `stuckTicks` resets each blocked/unblocked cycle, so `nav.stuck` never fires for the worst case. Any future reliance on "zero `nav.stuck`" as the crowd-health signal is misplaced; the plan replaces it with goal-arrival assertions. |
| 5 | Perf collapse at Phase 3 scale | **Not fired, and not tested.** See §4.4. |
| 6 | Scope explosion in roles | **Did not fire, because H2's non-goals forbade it. It is now queued.** Roadmap Phase 3 as written contains five role minigames plus multi-floor plus renovation plus star gates plus 10 archetypes — the register's own trigger ("a phase spec where one role exceeds a third of the phase") is met several times over by the roadmap text itself. This is the risk the re-scope exists to defuse. |
| 7 | Programmer art | **Fired, exactly as written, and was caught by its own stated test.** With albedo moved into the atlas, floor/wall/ceiling collapsed into one warm-brown band and a room reads as noise. It was caught by comparing against a committed screenshot **by eye**, not by any gate. The mitigation ("a look-lock review with screenshots") was right; the *gating* was insufficient — an atlas can satisfy palette-size, dither and texel-density gates and still be mud. |
| 8 | ~12-hour fatigue | **Unobserved.** Same structural gap as risk 3. |
| 9 | MP retrofit pain | **Mitigation got its live test and passed.** H2a's clerk is a second actor kind reaching decisions through the same validated `applyDeskDecision`; the reviewer grepped for singleton-player assumptions and found none in a decision path. |
| 10 | Espionage becomes griefing | Out of alpha scope; untouched. |
| 11 | Home-PC hosting friction | Out of alpha scope; untouched. |

### Risks the register never had, all of which fired

- **R12 — Verification-authoring cost dominates the schedule.** The
  bottleneck in three of five units.
- **R13 — Gates can be vacuous.** Two H2a gates evaluated nothing until
  perturbed. Perturbation is now standing practice; it is unbudgeted work
  that must be budgeted.
- **R14 — "Verified but invisible."** §4.3. The defining defect class of a
  no-HUD game.
- **R15 — A probe can report a number the pixels contradict.** The
  codebase's answer is a convention worth naming and inheriting:
  `frame-time-p95` and `draw-calls` **refuse** to report an unmeasured
  number rather than return a zero that would pass any budget.
- **R16 — Toolchain and environment traps.** §3.
- **R17 — Concurrent agents and shared git state.** One agent's uncommitted
  edits were swept into another lane's commit. I hit the same condition
  passively during this turn (§0). Attribution was wrong; nothing was lost;
  next time something could be.
- **R18 — Budgets written for hardware the harness does not have.**
  `frame-time-p95 ≤ 16.7 ms` measured 108 ms under headless SwiftShader. The
  budget is not wrong and the renderer is not necessarily slow; the
  *pairing* is meaningless, and the tempting fix — relax the budget until it
  passes — is the precise move this project's process exists to prevent.

---

## 6. What this means for the alpha plan, in one paragraph

The process works and should not be loosened; the estimating model should be
replaced wholesale. Plan in units of verification shape, expect ~1.7 gates
per roadmap phase, budget perturbation and gate authoring as first-class
lane work, and treat every human-only step as a named, scheduled step rather
than a footnote. The two things most likely to sink the alpha are not
technical: (i) Phase 3 as written is four phases wearing one name, and (ii)
nobody has yet played this game long enough to find out whether it is fun.
[PLAN-ALPHA.md](PLAN-ALPHA.md) addresses both directly.
