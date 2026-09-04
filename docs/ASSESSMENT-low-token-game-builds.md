# Assessment: "low-token" Fable game builds and the code-made-asset pipeline

Date: 2026-09-04. Requested by Christian. Data gathered by Haiku subagents
(Reddit transcription, repo clone, engine inventory), grounded by Spark and
Ballast (Opus), synthesised by Fable 5.1. Source pack and the two Opus
verdicts are in the session scratchpad; the fable-cities clone was read
directly for every number quoted here.

## Sources

| Source | What it is | Where |
|---|---|---|
| r/ClaudeCode 1w4qziv | "build me Cities: Skylines in three.js" — one prompt, Fable 5.1, ~14 agents, wave 1 of 3 | reddit.com/r/ClaudeCode/comments/1w4qziv |
| r/ClaudeCode 1w5ok76 | "Fable Cities" live + source release (locked post, little discussion) | reddit.com/r/ClaudeCode/comments/1w5ok76 |
| rawprogress/fable-cities | The repo: PROMPT.md, ARCHITECTURE.md, docs/STATUS.json, docs/critique/ | github.com/rawprogress/fable-cities |
| Pasted comment | A different builder's code-made-asset pipeline for a hiking game | user paste, no link |

## 1. The token claim — not low, cache-efficient

Numbers the OP posted for the single Reddit run, model `claude-fable-5-1`:

| Bucket | Tokens |
|---|---|
| Input (uncached) | 297.7k |
| Output | 1.9M |
| Cache read | 118.2M |
| Cache write | 6.0M |

What the repo's own PROMPT.md adds, verbatim: "Six runs later the game was
playable. About 20 million output tokens across the agents." So the Reddit
figure is roughly one tenth of the project.

Reading: the input-to-cache-read ratio is about 1:400. Nearly every read was a
cache hit, which means stable prefixes (ARCHITECTURE.md, STATUS.json re-read
constantly) and a well-structured run. Output, the expensive bucket, is 1.9M
for one run and ~20M for the project. Public Fable 5.1 pricing was not
available to any agent in this session, so no dollar figure is asserted; the
OP paid through subscription limits ("hit the 5-hour limit quickly").

Verdict: the honest headline is "97% of reads cached, ~20M output tokens over
six runs, and the game never passed its own quality bar." Do not adopt the word
"cheap" for this pattern. Do adopt the structure that made the cache ratio
possible: long-lived contract documents, many agents, few re-derivations.

## 2. Did it work? By its own scoring, no

From docs/STATUS.json and PROMPT.md, threshold 8.5:

- Terrain scored 6.0 → 6.5 → 7.5 → 7.5 and stalled.
- Best module (UI) reached 8.0. No module ever cleared 8.5.
- Three rounds of blind A/B judging lost 0–4 each. Gap narrowed 3.4 → 2.5.
- First-session critic scored new-player experience 5.5 and failed it.
- Playable, live, ~50k LOC across 165 files, 12 subsystems.

The transferable asset is therefore not "one prompt builds a game". It is the
critic that kept saying no, the rule that a builder must look at its own
screenshot before saying done, and publishing the critique unedited.
Christian has already generalised the six-phase structure into the `/oneshot`
skill (2026-09-04), so that half is captured. The rest of this document is
about what ClaudeEngine still lacks.

## 3. Six-phase pattern vs. ClaudeEngine today

| Element | Present here | Verdict |
|---|---|---|
| Architecture doc first | Exceeded: docs/PHASE-*.md plus `scripts/check-purity.mjs` enforces the contract mechanically | Keep |
| Screenshot harness before features | Present: `packages/harness/src/browser.ts` (Playwright, tick-gated, `screenshotAtTicks`, fps/latency probes), 23 scenarios. Ours is tick-gated; theirs is wall-clock | Keep |
| Per-module showcase scene / camera presets | Absent in `renderer-three/src/test-hook.ts` | Park until an art gate consumes it |
| Builder waves + integrator, folder ownership | Partial: WORKFLOW.md step 2 orchestrator is the integrator; no true parallel waves | Keep shape, do not import 14-way fan-out against a state-hash invariant |
| Non-coding critic scoring 0–10 vs reference | **Absent.** We gate correctness, legibility, bytes/tris and code. Nothing scores how it looks | **Highest-value import** |
| Blind A/B judges | Absent | Park until the critic produces stable scores |
| Resume from weakest module via STATUS.json | **Absent.** No STATUS.json anywhere in the repo, which also breaks the global rule that every HANDOFF.md has one beside it | Overdue regardless |

## 4. Code-made-asset pipeline vs. ClaudeEngine today

Baseline: `packages/assets/src/mesh.ts` has box/cone/cylinder/jitteredPolyhedron
+ rock/tree/crystal, all `Rng`-seeded; `packages/interiors/src/mesh-gen.ts`
builds floors/walls from the nav grid; `packages/asset-pipeline` gates
imported assets on bytes/dims/tris (a budget gate, not a quality gate).

| Tool from the paste | Here today | Tier to build | Verdict |
|---|---|---|---|
| Wiring audit before any screenshot (catalog row, `t()` key, sittable-without-anchor) | Partial (eslint, i18n rule) | Haiku | Keep, cheapest real win |
| 4-angle contact sheet, real lighting, scale figure | Capture half exists in browser.ts | Sonnet | Keep, best cost/benefit |
| 9-specimen scale sheet | Absent; `PropOptions.scale` defaults hide the "no size variation" fault | Haiku | Keep |
| Silhouette metrics (raggedness, porosity, hull fill, flat facet, stray) with 4 shipped assets printed as controls | Absent, but `screen-readability.ts` already hand-rolls a PNG decoder with no new dependency | Sonnet | Keep, controls are what make thresholds non-invented |
| Turntable with sliders + headless bridge | Absent | Sonnet | Trim to headless-only; sliders are the expensive half and Christian is not the one iterating |
| 3-pass sanity / form / charm gate | Pass 1 ≈ gates + lint; 2 and 3 absent | Sonnet | Keep pass 2; pass 3 folds into the critic |
| Micro-kit ops (bend, arc, taper, twist, lump, flattenBase, catenary) | Absent | Sonnet + Fable on the boundary | Keep with a guard: these are sin/cos/cosh, banned sim-side. Safe only in `packages/assets`, which core never imports. Never let output reach sim state |
| Property-triage skill (emits light? degrades? breakable?) | Absent | Sonnet | Park, premature at hotel scale |
| "Fails a shape twice → build a tool, don't retry" | Absent | Doc change | Keep, add to WORKFLOW.md beside the escalate-to-Fable trigger |
| Seeds + tolerances on every asset | Already house rule (`Rng`, `assets/src/hash.ts`) | — | Done |

## 5. The premise: "reserve Fable, cheap agents gather"

WORKFLOW.md states the tiering correctly and the global CLAUDE.md enforces the
ceiling with a hook. Where it does not hold, verified this session:

1. No token or cost accounting exists in the repo. Every "token" grep hit is an
   auth token. The claim that Fable is reserved is unfalsifiable in-repo.
2. No committed `.claude/agents/` with pinned models at repo level.
3. No STATUS.json beside `apps/hotel/docs/HANDOFF.md`.
4. The review gate reviews code, never look. That is the axis models flatter
   themselves on, and the axis Christian has rejected twice (placement,
   aesthetic).

This session itself is the pattern working: 5 Haiku fetch/inventory agents,
2 Opus grounding agents, Fable only for dispatch and this synthesis.

## 6. Recommendation (decided, not proposed)

Build the quality bar as a program, in this order, each one a harness probe
that emits JSON like everything else:

1. **STATUS.json** beside the hotel HANDOFF, with per-module score, round,
   ranked issues. Haiku, one hour. Overdue on house rules alone.
2. **Wiring audit** probe. Haiku.
3. **Contact-sheet** probe: `{probe:"contact-sheet", assetId}` on the existing
   Playwright rig, 4 angles, game lighting, a guest mesh for scale. Sonnet.
4. **Scale-sheet** probe, 9 specimens shortest to tallest. Haiku.
5. **Silhouette-metrics** probe next to `analyzeReadability`, always printing
   4 shipped assets as controls. Sonnet.
6. **Non-coding art critic** (Haiku or Sonnet) scoring the sheets 0–10 against
   a written LOOK_TARGET for GRAND FOYER: "Motel 6 day one, grandeur is the
   upgrade path." Fable adjudicates disagreement only. Operator cost:
   Christian assembles the reference board by hand.
7. **Model-per-stage line** in every `docs/reviews/phase-N.md` so the tiering
   claim becomes checkable.

Declined, logged so they are not re-pitched: 14-way parallel builder fan-out
(replay-break risk against the state hash); slider turntable UI; property
triage skill; blind A/B judging until step 6 produces stable scores.

## 6a. Reconciliation with the `/oneshot` skill (added same day)

`~/.claude/skills/oneshot/SKILL.md` (2026-09-04, skeptic-reviewed twice)
already supplies, domain-agnostically: docs/PROFILE.md with a reference
capture set and never-list, ARCHITECTURE.md with one folder per module and
a sole integrator owning `core/`, capture harness plus per-module showcase
mode before any feature, no-code critic per module per round scoring 0–10
against the reference (pass ≥8.5, ≤4 rounds then `stalled`), blind A/B
judges, STATUS.json with a `modules` block and `weakest_module`, and a
`/loop` ceiling of 3× modules. Tiering is fixed below the parent: Sonnet
builders, Opus integrator and critics from a Fable parent.

So steps 1 and 6 above are delivered by running `/oneshot` against GRAND
FOYER with a hotel profile, not by bespoke work. What stays engine-specific
and is not in the skill:

- The asset-level probes (wiring audit, contact sheet, scale sheet,
  silhouette metrics with shipped controls). `/oneshot` captures scenes; it
  has no per-asset gate. These are the "capture axes" a hotel profile should
  name.
- The transcendental-math guard on any micro-kit ops, and the rule that
  synthesis output never reaches sim state. `/oneshot`'s "units & invariants"
  row must carry CLAUDE.md invariants 1, 2 and 6 verbatim.
- The fan-out caution stands in a narrower form: builders under `/oneshot`
  are file-disjoint and only the integrator touches core, which is the
  mitigation. The harness's stateHash vs stateHashSlow cross-check must run
  at every integrator pass, not only at the final gate.
- The model-per-stage line in review files, so the tiering claim is
  measurable.

## 7. Verification honesty

- Reddit could not be fetched by any subagent (WebFetch, curl, firecrawl and
  the in-app browser all block reddit.com). Threads were read through
  Christian's logged-in Chrome via the accessibility tree, which truncates
  long text at ~100 characters; the post body of 1w4qziv was a video with no
  text. Token figures were complete and untruncated.
- The fable-cities repo was cloned and read directly; the 20M output figure
  and the scores are quoted from PROMPT.md and docs/STATUS.json.
- Fable 5.1 per-token pricing was unavailable; no dollar figure is asserted.
- Nothing in the engine was built or changed by this assessment.
