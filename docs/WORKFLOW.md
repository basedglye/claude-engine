# Development workflow — the tiered phase loop

Every roadmap phase moves through this loop. The models are chosen for what
each stage actually needs: design judgment is expensive and rare; implementation
is high-volume; review is judgment again, but bounded.

```
┌─────────────────────────────────────────────────────────────┐
│  1. PLAN (Fable 5)                                          │
│     Write/refresh the phase spec: scope, API contracts,     │
│     exit criteria. Lives in docs/ (ROADMAP.md + phase spec).│
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. IMPLEMENT (Sonnet 5 orchestrator + Haiku subagents)     │
│     Build against the spec on a phase branch. Haiku handles │
│     fan-out: research sweeps, boilerplate, test scaffolds,  │
│     doc passes. Must pass build + harness scenarios locally │
│     before requesting review.                               │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. REVIEW GATE (Fable 5)                                   │
│     Review the phase diff against the spec, the exit        │
│     criteria in ROADMAP.md, and the invariants in CLAUDE.md.│
│     Verdict is written to docs/reviews/phase-N.md:          │
│     PASS, or a numbered fix-list.                           │
└───────┬──────────────────────────────────────┬──────────────┘
        │ fix-list                             │ PASS
        ▼                                      ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│  4. FIX (Sonnet 5)        │   │  5. MERGE phase branch,     │
│     Address every item,   │   │     tag, return to step 1   │
│     re-run verification,  │   │     for the next phase.     │
│     resubmit to step 3.   │   └─────────────────────────────┘
│     Loop until PASS.      │
└───────────────────────────┘
```

## Mechanics: two ways to run the loop

**A. Single session with subagent overrides (preferred — no manual switching).**
Run the session on Sonnet 5. The orchestrator spawns Haiku subagents for
worker tasks during step 2, then spawns a **Fable-model subagent** for the
step-3 review gate (the Agent tool accepts a `model: "fable"` override).
Fable's usage stays bounded to planning and review turns. Conversely, a
Fable session used for step 1 spawns Sonnet subagents for implementation
spikes.

**B. Manual model switching.** Switch the session model per stage
(Fable → Sonnet → Fable). Use this when a stage deserves full-session
context rather than a subagent's fresh context — typically the Phase 3
netcode design and Phase 4 flagship/governance design.

## Review gate rules

- The reviewer receives: the phase spec, the diff (or branch), CLAUDE.md
  invariants, and the harness verdicts from step 2. It re-runs verification
  rather than trusting the implementer's claim.
- A PASS requires: exit criteria met, no invariant violations, harness
  scenarios green, and no unreviewed changes to `IWorld`/`HostPort`
  contracts or CLAUDE.md itself.
- Any proposal to *change* an invariant or public contract is escalated to
  a Fable planning turn (step 1), never decided inside step 2 or 4.
- Verdicts are committed to `docs/reviews/phase-N.md` so the gate history
  is auditable in-repo.

## Standing escalation triggers (regardless of stage)

Escalate to Fable when: designing netcode/persistence/auth, changing
architecture invariants, designing the NPC governance layer, or when Sonnet
has looped twice on the same fix-list item without converging.
