# Roadmap

## Phase 0 — Foundation (now)
- [x] Research sweep (Claudecraft, Fable showcase, tooling ecosystem)
- [x] Repo, design docs, monorepo scaffold, plugin skeleton
- [ ] CI: build + lint + sim-purity check (no host imports in core)

## Phase 1 — Enforcement + render host + runnable harness (spec: [PHASE-1.md](PHASE-1.md))
Phase 0 over-delivered on this phase's original kernel/harness bullets; they
landed early and are checked off below. Phase 1 is the rest, plus the CI gap
carried from Phase 0.
- [x] ECS-lite store, 20 Hz fixed-tick loop, seeded forkable Rng *(landed in Phase 0)*
- [x] Command queue / event log / per-tick state hash / replay runner *(landed in Phase 0)*
- [x] Harness v0: run scenario → JSON verdict (assertions, perf, replay bundle) *(landed in Phase 0)*
- [x] CI + lint + sim-purity enforcement (workflow, ESLint, `check:purity`
  self-testing script, DOM/Node-free core tsconfig) — carried from Phase 0
- [x] Harness CLI: `npm run harness --silent -- <scenario>` real (JSON
  verdict on stdout, exit codes, `--verify-replay`); committed `scenarios/`
  incl. a deliberately failing reproduce-a-failure fixture
- [x] Verdict enrichment: tick-time p95/max, entity count, event-log tail on
  failure (checkpoint state snapshots deferred to Phase 2 — see PHASE-1.md)
- [x] Actual Three.js `renderer-three` host: scene/camera/loop/resize, input
  → Commands via keymap, game-supplied scene sync — zero game knowledge
- [x] `apps/demo`: browser-playable toy game (WASD on a plane) whose exact
  sim module also passes a headless harness scenario
- Exit criteria: an agent can build a toy game, run a scenario, read a
  verdict, and reproduce a failure from seed+log — no human eyes needed;
  CI enforces build/lint/purity/smoke on every push. Full testable list in
  [PHASE-1.md](PHASE-1.md). **Status: PASS — see
  [docs/reviews/phase-1.md](reviews/phase-1.md).**

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
