# ClaudeEngine — architecture design

## Overview

ClaudeEngine is three things that reinforce each other:

1. **Runtime engine** — TypeScript packages providing a deterministic sim
   kernel, render hosts, and networking/persistence infrastructure.
2. **Verification harness** — a headless runner that lets an agent execute a
   game and receive structured, machine-readable results.
3. **Claude Code plugin** — a skill (plus agents and templates) that teaches
   Claude to build games on the engine and to use the harness reflexively.

```
                 ┌────────────────────────────────────────┐
                 │        packages/core  (the sim)        │
                 │  ECS · 20Hz fixed tick · seeded Rng    │
                 │  command queue · event log · replay    │
                 └───────┬──────────┬──────────┬──────────┘
                     IWorld      IWorld      IWorld
                         │          │          │
              ┌──────────┴──┐  ┌────┴─────┐  ┌─┴──────────────┐
              │ renderer-   │  │ server   │  │ harness        │
              │ three (web) │  │ host     │  │ (headless,     │
              │ offline play│  │ (authori-│  │  agent-facing) │
              └─────────────┘  │  tative) │  └────────────────┘
   later hosts: godot bridge,  └──────────┘
   native (Tauri), unity bridge
```

## The sim kernel (`packages/core`)

- **ECS-lite**: entities are ids; components are plain-data stores; systems
  are pure-ish functions run in a fixed, registered order each tick.
- **Fixed tick**: 20 Hz. Hosts interpolate for rendering; the sim never sees
  wall-clock time.
- **Seeded `Rng`**: the only randomness source. Streams can be forked per
  subsystem (`rng.fork("loot")`) so adding a system doesn't perturb others.
- **Commands in, events out**: hosts submit `Command`s (player input, admin
  ops); the sim emits an append-only `EventLog`. Networking, replays, bot
  players, and harness assertions all consume the same two streams.
- **Replay contract**: `(seed, commandLog) → identical state hash per tick`.
  A `stateHash()` function makes divergence detectable and bisectable.
- **Zero host imports**: enforced by lint rule + CI check, not just
  convention.

### Portability (the answer to "web-first, but portable")

The sim is pure TypeScript with no platform dependencies, so porting means
writing a new **host**, never touching game logic:

- `IWorld` — read-only view of sim state for renderers (snapshot + interpolation data).
- `HostPort` — what a host must provide: clock driver, command ingress, event
  egress, persistence hooks.
- Hosts planned: `renderer-three` (web, first), `server` (Node,
  authoritative), `harness` (headless), later a Godot bridge (sim compiled to
  WASM or run as a sidecar process speaking the same command/event protocol —
  the protocol, not the language, is the portability boundary).

## The harness (`packages/harness`) — the differentiator

Purpose: make "does it work / how does it feel" a machine-readable question.

- **Scenario files**: declarative JSON/TS — seed, scripted or bot-driven
  command streams, tick budget, assertions ("player reaches zone 2 by tick
  4000", "no error events", "entity count stable").
- **Structured verdicts**: JSON out — pass/fail per assertion, event-log
  excerpts, state snapshots at checkpoints, perf stats (tick time p95, entity
  counts), and the exact seed+log needed to replay any failure.
- **Browser mode**: drives the real renderer via Playwright for screenshots
  and visual checks when the sim-only run isn't enough.
- **Bot players**: simple goal-driven agents (move, fight, quest) reusable as
  load-test traffic for the server host — Claudecraft's bots, formalized.
- **Game-feel probes** (later): measured jump arcs, input-to-response
  latency, camera velocity envelopes reported as numbers Claude can tune
  against stated targets.

## Infrastructure packages (engine-owned "hard parts")

Written once, reviewed by humans, never re-generated per game:

- **`server` host**: authoritative sim, client prediction/reconciliation,
  interest management, rate limiting, input validation at the boundary.
- **Persistence**: schema'd snapshot + event-sourced save system (SQLite for
  dev, Postgres for prod) — no hand-rolled SQL in game code.
- **Auth/session**: boring, standard, pluggable.

This directly targets every category of Claudecraft criticism.

## Procedural asset layer

- Deterministic generators (fed from `Rng`): terrain, low-poly creature/prop
  meshes, icon synthesis, TS-authored audio/music (WebAudio).
- Import pipeline with validation gates for external assets (format, tri
  budget, materials) — closes the "generated assets aren't game-ready" gap.

## The plugin (`plugin/`)

Distribution: a Claude Code plugin bundling:

- **Skill `worldforge`** (skill names can't contain "claude", hence not
  "claude-engine"): progressive-disclosure SKILL.md — scaffolding a game,
  the architecture invariants, harness usage, and references/ for deep API
  docs loaded on demand.
- **Templates**: starter game scaffolds (3D world, top-down 2D) wired to the
  harness from commit one.
- **Agents**: playtest-analyst (reads harness verdicts), content-designer
  (quests/NPCs within engine schemas).
- **Hooks** (later): post-edit determinism lint; pre-claim-done harness run.

## Flagship: `apps/living-world`

A persistent 3D living world that goes past Claudecraft: same MMO-style
foundation (zones, quests, multiplayer) plus what the engine uniquely
enables — Claude-driven NPCs/world events via the Agent SDK behind a
governance layer (schema-constrained outputs, approval gates for
world-affecting changes), and an autonomous improvement loop (feedback →
harness-verified PRs) as a first-class engine workflow rather than a bespoke
Discord bot.

## Non-goals (v1)

- Photorealistic/AAA rendering; a visual editor (the "editor" is Claude Code
  + browser preview); mobile-native builds; blockchain anything.
