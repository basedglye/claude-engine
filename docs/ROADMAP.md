# Roadmap

## Phase 0 — Foundation (now)
- [x] Research sweep (Claudecraft, Fable showcase, tooling ecosystem)
- [x] Repo, design docs, monorepo scaffold, plugin skeleton
- [ ] CI: build + lint + sim-purity check (no host imports in core)

## Phase 1 — Deterministic kernel + harness v0
- ECS-lite store, 20 Hz fixed-tick loop, seeded forkable Rng
- Command queue / event log / per-tick state hash / replay runner
- Harness v0: run scenario → JSON verdict (assertions, perf, replay bundle)
- Minimal `renderer-three` host: render a sim world, offline play in browser
- Exit criteria: an agent can build a toy game, run a scenario, read a
  verdict, and reproduce a failure from seed+log — no human eyes needed.

## Phase 2 — Skill v0.1 + procedural assets
- `worldforge` skill: scaffold command, invariants, harness workflow,
  references/ API docs; starter templates (3D world, top-down 2D)
- Procedural asset layer v0: terrain, primitive creature/prop meshes, icon
  generator, WebAudio music synth
- Browser-mode harness (Playwright screenshots), game-feel probes v0
- Exit criteria: a fresh Claude Code session with the plugin installed can
  produce a playable, verified 3D scene in one sitting.

## Phase 3 — Multiplayer + persistence (the Claudecraft critique, answered)
- Authoritative server host: prediction/reconciliation, interest management,
  input validation, rate limiting
- Event-sourced persistence (SQLite dev / Postgres prod); auth/session
- Bot players as load-test traffic; soak scenarios in the harness

## Phase 4 — Flagship: the living world
- `apps/living-world`: zones, quests, multiplayer on the engine
- Claude-driven NPCs & world events (Agent SDK) behind a governance layer
- Autonomous improvement loop: feedback intake → harness-verified PRs
- Public plugin release + marketplace listing; announce

## Later / stretch
- Godot host bridge (WASM sim or sidecar protocol), native (Tauri) host
- Game-feel analyzer maturity; visual asset quality scoring (Claude Vision)
- Community template gallery
