# CLAUDE.md — ClaudeEngine contributor rules (human and agent alike)

These rules are load-bearing. World of Claudecraft demonstrated that a strict
CLAUDE.md is what keeps agent-generated code coherent at scale — this file is
that idea applied to an entire engine.

## Architecture invariants (never break these)

1. **Sim purity.** `packages/core/src/**` must contain zero imports from the
   DOM, Three.js, Node built-ins, or any host environment. The sim talks to
   the outside world only through the `IWorld` and `HostPort` interfaces.
2. **Determinism.** The sim advances at a fixed 20 Hz tick. All randomness
   goes through the seeded `Rng` class — `Math.random()` is banned in
   `packages/core` and in game sim code. Iteration order over collections
   must be deterministic (no bare object-key iteration in sim logic).
3. **Replayability.** Any sim run is fully described by (seed, input log).
   If a change breaks replay equivalence, it is a bug even if the game looks
   fine.
4. **Hosts render, sims decide.** Renderers and servers may read sim state
   via `IWorld`; they never mutate it except by submitting commands.
5. **Engine owns the hard parts.** Netcode, persistence, auth, and input
   validation live in engine packages and are human-reviewed. Generated game
   code must not roll its own.

## Development loop

This project runs the tiered phase loop in [docs/WORKFLOW.md](docs/WORKFLOW.md):
Fable 5 plans each phase → Sonnet 5 implements with Haiku 4.5 worker
subagents → Fable 5 reviews the phase against the spec and these invariants
(verdict committed to `docs/reviews/phase-N.md`) → Sonnet fixes until the
review passes → merge, next phase. Invariant or public-contract changes are
always escalated to a Fable planning turn.

## Working conventions

- TypeScript strict mode everywhere; npm workspaces monorepo.
- Every feature PR answers: "how does an agent verify this works?" — add or
  extend a harness scenario when the answer is unclear.
- Keep generated code boring: prefer the engine's existing systems over new
  abstractions; small diffs over rewrites.
- Player-visible strings go through the i18n table (`t()` keys), English only
  in source.
- No dev/debug commands reachable from production builds.

## Verification loop

Before claiming a change works: `npm run build`, then run the relevant
harness scenario (`npm run harness --silent -- <scenario>`) and read its JSON
verdict — `--silent` suppresses npm's own banner so stdout is the verdict
JSON alone. For rendering changes, capture a screenshot via the harness
browser mode (Phase 2+).
