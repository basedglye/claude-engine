# ClaudeEngine

**An AI-native game engine designed around how Claude actually builds games — shipped as a runtime library plus a Claude Code plugin, so any power user can build ambitious games with Claude on top of it.**

## Why

In June 2026, [World of Claudecraft](https://worldofclaudecraft.com) proved that Claude can build a playable MMO in a weekend. It also proved what breaks when it does: generated netcode that doesn't scale, ad-hoc database design, thin error handling, and no way for the agent to *feel* the game it just wrote. The lasting value wasn't the generated code — it was the architecture conventions and feedback loops around it.

ClaudeEngine makes those conventions and loops the product:

1. **A deterministic simulation kernel** (`@claude-engine/core`) — fixed-tick, seeded-RNG, host-agnostic. The same sim runs in an offline browser build, an authoritative multiplayer server, and a headless test harness. This is the "one sim, N hosts" pattern Claudecraft pioneered, promoted from a project convention to an engine guarantee.
2. **An agent verification harness** (`@claude-engine/harness`) — headless playtesting that returns structured JSON (state snapshots, event logs, perf metrics, screenshots) so Claude can run the game, read what happened, and fix it without a human in the loop. This is the single biggest gap in the 2026 tooling ecosystem, and it's a first-class citizen here.
3. **A Claude Code plugin + skill** (`plugin/`) — teaches Claude the engine's conventions, scaffolds new games, and wires up the build → run → observe → fix loop automatically.
4. **Solved hard parts, not generated ones** — netcode, persistence, and security are engine code written and reviewed once, not re-generated per game. Agents generate *content and gameplay*; the engine provides the load-bearing infrastructure.

## Repository layout

```
packages/core/            Deterministic sim kernel (ECS, fixed tick, seeded RNG, replay)
packages/renderer-three/  Three.js/WebGPU render host (first of several hosts)
packages/harness/         Headless playtest harness for agents
plugin/                   Claude Code plugin (skill, agents, templates)
apps/living-world/        Flagship game: a persistent 3D living world
docs/                     Design, research, roadmap
```

## Design pillars

- **Deterministic by decree.** All randomness through seeded `Rng`, fixed 20 Hz tick, zero host imports (`DOM`, Three.js, Node APIs) inside the sim. Any run is replayable from a seed + input log — which makes agent verification, multiplayer sync, and bug reproduction the same problem, solved once.
- **The agent is a first-class user.** Every engine feature must answer: *how does an agent observe this working?* Structured output over vibes.
- **Procedural-first assets, with quality gates.** Meshes, icons, and audio are generated at runtime or build time; external assets flow through a validated import pipeline.
- **Portable core.** The sim kernel and its `IWorld` / `HostPort` interfaces have no rendering or platform dependencies. Web (Three.js) is the first host; Godot/Unity/native hosts can be added without touching the sim.

## Status

Early scaffolding (Phase 0). See [docs/ROADMAP.md](docs/ROADMAP.md) for the plan and [docs/DESIGN.md](docs/DESIGN.md) for the architecture.

## License

MIT
