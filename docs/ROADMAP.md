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

## Phase 2 — Skill v0.1 + procedural assets (spec: [PHASE-2.md](PHASE-2.md))
- [x] `worldforge` skill: scaffold command, invariants, harness workflow,
  references/ API docs; starter templates (3D world, top-down 2D)
- [x] Procedural asset layer v0: terrain, primitive creature/prop meshes, icon
  generator, WebAudio music synth (`@claude-engine/assets`)
- [x] Asset tooling (see docs/DESIGN.md "Procedural asset layer"):
  `@claude-engine/asset-pipeline` import gate; Codex for image/texture/icon
  generation feeding it. Blender remains an unbuilt *stretch* mesh backend
  (not required for Phase 2 exit criteria — hand-rolled generators sufficed).
  Grok/other non-Anthropic LLMs stay deferred — no identified capability gap.
- [x] Browser-mode harness (Playwright, real Chromium screenshots + console/
  page-error capture), game-feel probes v0 (fps, input-latency)
- [x] Checkpoint state snapshots in verdicts + replay-from-verdict-JSON
  (both carried over from Phase 1 — see [PHASE-1.md](PHASE-1.md) and
  [docs/reviews/phase-1.md](reviews/phase-1.md))
- Exit criteria: a fresh Claude Code session with the plugin installed can
  produce a playable, verified 3D scene in one sitting. Full 12-item
  testable list in [PHASE-2.md](PHASE-2.md). **Status: PASS — see
  [docs/reviews/phase-2.md](reviews/phase-2.md).**

## Phase 3 — Multiplayer + persistence (the Claudecraft critique, answered) (spec: [PHASE-3.md](PHASE-3.md))
- [x] `Sim.restore()` + tracked Rng forks (`Sim.forkRng`), snapshot v2,
  `--replay --from-checkpoint` (the carryover deferred from Phases 1–2,
  co-designed with persistence per PHASE-2.md Scope D)
- [x] `@claude-engine/net`: versioned wire protocol (pure root, the
  portability boundary) + client session with prediction/reconciliation
  and remote-entity interpolation data; browser WebSocket adapter
- [x] `@claude-engine/server`: authoritative Node host — pluggable
  auth/session (HMAC tickets v0), input validation + rate limiting at the
  boundary, interest management, join/leave as replayable commands
- [x] `@claude-engine/persistence`: event-sourced GameStore (write-ahead
  command log + snapshots), SQLite dev / Postgres prod, hash-equivalent
  crash recovery via `recoverSim`
- [x] `@claude-engine/bots` + harness `Scenario.bots`; soak mode (`--soak`)
  with structured `SoakReport` verdicts; committed net-walk / net-interest /
  net-abuse / soak scenarios
- [x] apps/demo net mode (server entry + `?net=` client); skill
  `references/net-api.md`; purity/CI coverage extended to the new packages
- Exit criteria: a persisted multiplayer session survives a server restart
  with replay-equivalent state, abusive clients are rejected at the boundary
  without perturbing the sim, and a 50-bot soak passes its perf targets —
  all machine-verdicted. Full 13-item testable list in
  [PHASE-3.md](PHASE-3.md). **Status: PASS — see
  [docs/reviews/phase-3.md](reviews/phase-3.md).**

## Phase 4 — Flagship: the living world
- `apps/living-world`: zones, quests, multiplayer on the engine
- Claude-driven NPCs & world events (Agent SDK) behind a governance layer
- Autonomous improvement loop: feedback intake → harness-verified PRs
- Public plugin release + marketplace listing; announce

## Active application track: `apps/hotel` (GRAND FOYER)
A first-person hotel simulation, alongside the unstarted `apps/living-world`
Phase 4 flagship above. Runs its own phased roadmap in
[docs/ROADMAP-HOTEL.md](ROADMAP-HOTEL.md); design bible and architecture
live in `apps/hotel/docs/DESIGN.md` and `apps/hotel/docs/ARCHITECTURE.md`.

## Later / stretch
- Godot host bridge (WASM sim or sidecar protocol), native (Tauri) host
- Game-feel analyzer maturity; visual asset quality scoring (Claude Vision)
- Community template gallery
