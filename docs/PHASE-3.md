# Phase 3 spec — multiplayer + persistence (the Claudecraft critique, answered)

Status: **planned** (this document is the step-1 output of the
[docs/WORKFLOW.md](WORKFLOW.md) loop; the step-3 review gate verdicts against
it, verbatim).

## Context: what Phase 2 delivered, and what this phase owes

Phase 2 passed the gate ([docs/reviews/phase-2.md](reviews/phase-2.md)) and is
merged. The engine now has: triple-enforced sim purity (extended to the assets
pure root), a real render host + two scaffold templates, the `worldforge`
skill v0.1, procedural assets with golden-tested determinism, checkpoint
snapshots in verdicts, `--replay <verdict.json>` with drift detection, and a
Playwright browser mode whose nondeterministic sessions are reproducible
headlessly via their captured command logs.

What is genuinely missing, and therefore is Phase 3:

1. **CLAUDE.md invariant #5 is still aspirational.** "Netcode, persistence,
   auth, and input validation live in engine packages" — none of those
   packages exist. `packages/` contains core, harness, renderer-three,
   assets, asset-pipeline; there is no server, no persistence, no auth, no
   wire protocol. This phase is DESIGN.md's "Infrastructure packages
   (engine-owned hard parts)" section, built: it directly targets every
   category of Claudecraft criticism.
2. **Three explicit carryovers, all deferred *to this phase by name*:**
   - **`Sim.restore()` / replay-from-snapshot** — deferred from Phase 1,
     deferred again in Phase 2 Scope D with the recorded reason: game code
     holds *forked* `Rng` streams the `Sim` does not track, so a faithful
     restore needs Rng-stream-tracking machinery, "co-designed with
     persistence". Persistence is now; the design is Scope A.
   - **Engine-owned render interpolation / snapshot history on `IWorld`** —
     deferred from Phase 1 ("likely alongside Phase 3 netcode, which needs
     snapshot buffers anyway"), restated in Phase 2. Resolved in Scope B
     (see Invariant/contract impact: it lands as an additive capability on
     the net client's world view, *not* as an `IWorld` change).
   - **Deterministic in-browser replay** — Phase 2 said it "can ride along
     with Phase 3 prediction work if needed". Decided: it is *not* needed
     (see Non-goals) — the browser/soak pattern of "nondeterministic live
     session, headlessly reproducible from the captured authoritative
     command log" already covers the verification need, and this phase
     extends that same pattern to multiplayer sessions.
3. **No multiplayer verification story.** DESIGN.md promises bot players as
   "load-test traffic for the server host" and the roadmap promises soak
   scenarios; the harness has neither a bot vocabulary nor any way to
   exercise a server.

## The determinism model under multiplayer (cross-cutting, read first)

Multiplayer introduces real nondeterminism: network jitter, wall-clock
client input, prediction. This phase draws the line explicitly, because
invariants #2 and #3 depend on where it sits:

- **The authoritative sim is the deterministic artifact.** The server host
  runs the one true `Sim` at 20 Hz. Every state change enters as a `Command`
  stamped by the *server* with the tick it executes on — including player
  joins and leaves, which are reserved `@net/join` / `@net/leave` commands
  submitted by the server, so that session lifecycle is part of the replayable
  log rather than an out-of-band mutation. Invariant #3's contract —
  (seed, command log) → identical hashes — holds for every server session,
  and the persisted command log (Scope D) is exactly that log.
- **Client prediction is presentation, not simulation.** The net client does
  not run the sim. It holds a replicated, interest-filtered copy of
  authoritative state and overlays game-supplied *prediction patches* for the
  local player's unacknowledged inputs (Scope B). Predictions are corrected
  by authority on every state message and never feed back into it except as
  ordinary commands. Predicted views are explicitly outside invariants #2/#3
  — the same standing the Phase 2 browser verdicts established with
  `deterministic: false` — and no invariant wording changes (the invariants
  say "the sim"; the predicted view is not the sim).
- **Live sessions are reproducible headlessly, not re-runnable live.** A
  soak/multiplayer run's verdict carries the server's authoritative command
  log as its replay bundle, so `--replay` reproduces it exactly, the same
  bridge Phase 2 built for browser mode. `--verify-replay` and `--replay`
  semantics, exit codes, and stdout discipline are unchanged.

## Scope

Dependency order: A (restore + tracked Rng) is the foundation for D
(persistence) and is independent of everything else; B (protocol + client)
and E (bots) are independent of each other; C (server) depends on A, B, and
D's interface; F (soak) depends on C, B, E; G (demo/docs/CI wiring) lands
last.

### A. `Sim.restore()` + tracked Rng forks + snapshot v2 (the Phase 1/2 carryover, finally designed)

Targets: `packages/core/src/rng.ts`, `packages/core/src/sim.ts`,
`packages/core/src/snapshot.ts` (all additive except the versioned snapshot
format — see Invariant/contract impact), core unit tests (new
`npm test -w @claude-engine/core`), `packages/harness/src/cli.ts` +
`packages/harness/src/index.ts` (`--from-checkpoint`),
`scenarios/smoke.scenario.mjs`, `apps/demo/src/game.ts`, both templates'
`game.ts` (1:1 `forkRng` migration).

The deferred design problem, answered:

- **Rng state becomes capturable.** `Rng` gains `getState(): RngState`
  (its four sfc32 words) and `static fromState(state): Rng`. Additive; the
  generator algorithm and all existing seed-derived sequences are untouched.
- **Tracked forks: `Sim.forkRng(label)`.** The `Sim` keeps a registry
  `Map<label, Rng>`. `forkRng(label)` delegates to exactly
  `this.rng.fork(label)` and registers the result — *identical draw
  sequence* to the current `sim.rng.fork(label)` pattern, so migrating call
  sites 1:1 changes no hashes (the smoke hash 919868270 must survive; the
  gate checks). Duplicate labels throw. `forkRng` is legal only during setup
  (before the first `step()`); afterwards it throws — long-lived streams must
  be declared up front so a snapshot can capture them all.
- **Snapshot v2.** `SimSnapshot` becomes `v: 2` and adds
  `rng: { root: RngState; forks: [label, RngState][] }` (fork entries in
  registration order). Everything else (tick, nextEntity, stateHash,
  components) is unchanged. The v1 shape remains exported as `SimSnapshotV1`
  for reading old evidence. This is the versioned-format extension Phase 2's
  snapshot design explicitly planned for.
- **`Sim.restore(snapshot)`.** Contract: construct `new Sim(seed)`, run the
  same `setup()` that produced the original run (systems are code and are
  never serialized — that part of the Phase 2 decision stands), then
  `restore(snapshot)`, which: replaces all component stores with the
  snapshot's, restores `tick`/`nextEntity`, restores the root Rng's state,
  and restores each registered fork's state by label. Label mismatch in
  either direction (setup registered a fork the snapshot lacks, or vice
  versa) throws a `RestoreError` naming the labels — the restore-side
  equivalent of `--replay`'s setup-drift diagnostic. `restore` rejects `v: 1`
  snapshots (evidence-only; clear error). Pending commands and the event log
  are cleared: **events are not restored** — they are derivable outputs, the
  persisted source of truth is the command log (Scope D), and
  `eventsSince()` after a restore covers post-restore ticks only (documented
  limitation; `stateHash()` never included events, so equivalence checks are
  unaffected).
- **The documented residual limitation + mitigation.** Untracked forks —
  `sim.rng.fork(...)` called directly and held across ticks — remain
  invisible to snapshots. Mitigation: (1) all in-repo sim code (smoke, demo,
  templates) migrates to `forkRng`; (2) the skill and `references/` teach
  `sim.forkRng` as the only sanctioned pattern for sim-held streams
  (`rng.fork` remains correct for transient setup-local derivation whose
  outputs land in components, and for host/asset code, which is not sim
  state); (3) the restore-equivalence tests below are the executable proof
  that the tracked pattern is faithful. A lint rule for `sim.rng.fork` in
  sim code is nice-to-have, not gating.
- **`stateHash()` is unchanged** — it intentionally does *not* mix Rng state
  (that would break every committed hash and golden for zero detection
  benefit: a mis-restored Rng diverges the hash on the next Rng-dependent
  tick anyway). Rng faithfulness is verified by the equivalence tests, not
  the hash.
- **Core unit tests** (new test script, wired into CI): Rng state
  round-trip (`fromState(getState())` continues identically); **the golden
  equivalence test** — run a scenario with tracked forks continuously to
  tick N vs. snapshot at N/2 → fresh sim → setup → restore → replay
  remaining commands → byte-equal `stateHash()` at N; duplicate-label throw;
  fork-after-step throw; label-mismatch `RestoreError`; v1 rejection.
- **Harness: `--replay <verdict.json> --from-checkpoint <tick>`** (additive
  CLI flag): requires the verdict to carry a checkpoint at `<tick>` with a
  v2 snapshot; loads the scenario module, runs `setup`, `restore`s the
  checkpoint snapshot, injects the verdict's commands with tick >
  `<tick>`, steps to `replay.ticks`, compares later checkpoints + final
  hash. Exit codes unchanged (0 match / 2 unreadable, module drift, or
  v1-snapshot / 3 divergence). This is the honest resolution of the
  "module-free replay" carryover: restore removes the need to re-execute the
  *prefix*, but systems are code, so the module itself can never be
  optional — module-free replay is now declared permanently out of scope
  rather than re-deferred (see Non-goals).

### B. `@claude-engine/net` — wire protocol + client session (prediction/reconciliation)

Targets: new package `packages/net` with a **pure root** (same purity rules
as core: zero DOM/Three/Node imports — enforced by extending
`scripts/check-purity.mjs` + the ESLint restricted-import block, with a new
self-test fixture, exactly the Phase 2 assets pattern) and a **web adapter**
subpath `@claude-engine/net/web` (`packages/net/src/web/**`, may use browser
WebSocket); package unit tests.

**The protocol is the portability boundary** (DESIGN.md): a versioned,
JSON-text message vocabulary that any future host (Godot sidecar, native)
can speak without sharing TypeScript. Decision: the wire format **wraps**
command data in a network envelope rather than reusing `Command` as-is,
because `Command.actor` and `Command.tick` are *server-assigned* fields a
client must never choose (that is what "input validation at the boundary"
means). Clients send bare **intents** (`type` + `payload`); the server
validates, stamps `actor` and the executing `tick`, and only then does a
`Command` exist. Signatures in "API contracts".

- **Envelope**: `hello`/`welcome` handshake (protocol version check, auth
  token, seed + initial replica), client `input` batches carrying a `seq`
  number, server `state` messages carrying an interest-filtered
  `ReplicaState` + `ackSeq` + filtered events, `reject` (per-intent, with
  machine-readable reason), `ping`/`pong` (RTT), `close` (coded reasons:
  `auth-failed`, `protocol-error`, `superseded`, `server-shutdown`).
- **Boundary limits live in the protocol package**: `decodeClientMessage`
  enforces `ProtocolLimits` (max message bytes, max intents per message) and
  throws a typed `ProtocolError` — malformed or oversized input is rejected
  before any game code sees it. Intent types beginning with `@` are reserved
  for the engine (`@net/join`, `@net/leave`) and always rejected from
  clients.
- **Client session (pure — this is deliberate)**: `createClientSession`
  takes an injected `ClientTransport` interface, so the entire
  prediction/reconciliation state machine is environment-free and unit-
  testable headlessly with a scripted fake transport (latency, reorder,
  divergent authority — no sockets, no flakiness). The `/web` subpath ships
  the one-liner real transport, `webSocketTransport(url)`.
- **Replication + prediction model**: the session maintains a replica store
  from `ReplicaState` messages (v0 sends the full interest set each state
  message; no delta compression — Non-goals) and exposes it as
  `ClientWorld implements IWorld`: `tick` = latest authoritative tick,
  `seed` from `welcome`, `entities()`/`getComponent()` over the replica
  with prediction patches overlaid, `eventsSince()` over the replicated
  event buffer, `stateHash()` = the server-computed hash carried by the
  last state message (the replica alone cannot reproduce a full-world hash
  under interest management — the doc comment says so). Prediction: the
  game supplies an optional `predict(view, intents)` function; on every
  local intent and every authoritative state message the session rebuilds
  the overlay by re-applying all *unacknowledged* intents (those with
  `seq > ackSeq`) on top of fresh authority — standard reconciliation.
  Acked intents are pruned. A `corrections` counter increments whenever
  fresh authority disagrees with what the overlay predicted, so
  reconciliation quality is a measurable, not an adjective.
- **Interpolation data — the Phase 1/2 deferral, resolved.**
  `ClientWorld.getPrevComponent<T>(entity, component)` exposes the previous
  authoritative value for each replicated component (one state-message of
  history), giving `syncScene` callbacks exactly the two states they need to
  interpolate remote entities. Decided placement: on the net client's world,
  **not** on `IWorld` — putting history on `IWorld` would obligate the Sim,
  the harness, and every future host to buffer state for a consumer only
  networked rendering has (the same pressure Phase 1 and Phase 2 both named
  and declined). `IWorld` and `renderer-three` are untouched; a networked
  game's `syncScene` narrows its `world` to `ClientWorld` when it wants
  history. Revisit only if a second, non-networked consumer materializes.

### C. `@claude-engine/server` — the authoritative host

Targets: new package `packages/server` (Node-targeted; dependency: `ws`);
package unit tests. Depends on core, `@claude-engine/net` (pure root), and
Scope D's `GameStore` interface.

- **Authoritative loop**: `startGameServer(opts)` constructs the one true
  `Sim(seed)`, runs the game's `setup` (same game-module contract as
  scenarios — the identical `game.ts` a browser or harness runs), and drives
  `step()` at 20 Hz from a drift-corrected Node timer. The sim never sees
  wall-clock time (invariant #2); the timer is host machinery, exactly like
  `startHostLoop`'s accumulator.
- **Sessions + auth (boring, standard, pluggable — DESIGN.md)**: the
  `AuthProvider` interface is one async method,
  `authenticate(token) → { playerId } | null`. Two providers ship:
  `ticketAuth(secret)` — HMAC-signed, expiring tickets minted by
  `issueTicket(secret, playerId, { ttlMs })` (Node `crypto`, no new
  dependency) — and `devAuth()` — accepts `dev:<name>` tokens; it is an
  explicit constructor a caller must opt into, is used by the demo server
  entry and the harness soak runner, and per CLAUDE.md's no-dev-in-prod
  convention must never be a default (there is no default: `auth` is a
  required option). Session identity: the server assigns
  `actor = "player:" + playerId`; a second connection for the same playerId
  evicts the first with `close(superseded)` (reconnect-friendly). On
  session open the server submits `@net/join` (payload `{ playerId }`), on
  close `@net/leave` — game systems handle spawn/despawn, so lifecycle is
  in the command log and replays faithfully.
- **Input validation + rate limiting at the boundary (invariant #5, made
  real)**: the server config declares
  `commands: Record<string, CommandRule>` — per-type payload `validate`
  predicate plus `maxPerTick` and token-bucket `maxPerSecond`. Unknown
  types, `@`-prefixed types, failed validation, and over-rate intents are
  rejected with a per-intent `reject` message (reason: `unknown-type` /
  `invalid-payload` / `rate-limited`) and never reach the sim. Protocol-
  level violations (oversized message, unparseable JSON, `hello` proto
  mismatch) escalate: strikes, then `close(protocol-error)`. Accepted
  intents become Commands (server-stamped actor + next tick), are submitted,
  and are appended to the authoritative log.
- **Interest management**: an `InterestPolicy` —
  `entitiesFor(world, actor)` — computes each session's visible entity set
  per state broadcast. Built-ins: `allEntities()` (default) and
  `radiusInterest({ positionComponent, ownerComponent, radius })` (each
  actor sees entities within `radius` of any entity it owns). State
  messages carry only the interest set's components, plus `removed` ids
  (left interest *or* destroyed — v0 does not distinguish). Events are
  filtered per-session by an optional `filterEvent(event, actor, world)`
  (default: broadcast) — game payloads are opaque to the engine, so event
  privacy is the game's policy hook, not engine magic.
- **Broadcast cadence**: `stateEveryTicks` (default 1) controls state
  message frequency; every state message carries the server `stateHash()`
  so clients (and soak stats) can anchor to authority.
- **Persistence wiring**: with `store` + `gameId` configured, the server
  appends each tick's accepted commands *before* stepping that tick
  (write-ahead: a crash can lose an unexecuted tail, never produce state
  ahead of the log) and saves a v2 snapshot every `snapshotEveryTicks`
  (default 600 = 30 s). On start with an existing `gameId` it recovers via
  Scope D's `recoverSim` (snapshot → restore → replay tail) and resumes.
- **Observability for soak**: `GameServer.stats()` exposes tick timing
  (p95/max), connection counts, accepted/rejected command counts by reason,
  and bytes sent — the numbers Scope F's verdicts are built from.

### D. `@claude-engine/persistence` — event-sourced saves (SQLite dev / Postgres prod)

Targets: new package `packages/persistence` (Node-targeted; dependencies:
`better-sqlite3` (dev driver — synchronous, no experimental Node flags),
`pg` (prod driver)); package tests incl. the crash-recovery golden;
`.github/workflows/ci.yml` (Postgres service-container job).

- **What is persisted is the command log + snapshots** — the honest reading
  of "event-sourced" for this engine: per invariant #3 the sim's source of
  truth *is* (seed, command log); emitted `GameEvent`s are derivable outputs
  and are deliberately not stored in v0 (recorded decision; an events table
  can be added later for offline consumers without touching this contract).
- **Schema (owned by this package — "no hand-rolled SQL in game code" means
  all SQL lives here, behind `GameStore`)**: `games` (id, name, seed,
  proto_version, created_at), `commands` (game_id, tick, idx, actor, type,
  payload JSON; PK (game_id, tick, idx)), `snapshots` (game_id, tick,
  state_hash, snapshot JSON; PK (game_id, tick)). Identical logical schema
  on both drivers; driver-specific DDL is an implementation detail behind
  the interface.
- **`GameStore` interface** (signatures in API contracts): create/get game,
  `appendCommands` (atomic per call), `commandsSince(afterTick)`,
  `saveSnapshot`, `latestSnapshot`, `close`. Both drivers pass one shared
  conformance test suite.
- **`recoverSim(store, gameId, setup)`** — the co-designed payoff of Scope
  A: new `Sim(record.seed)` → `setup` → `restore(latestSnapshot)` if one
  exists → replay `commandsSince(snapshot.tick)` → a live sim whose
  `stateHash()` equals what an uninterrupted run would show. **The
  crash-recovery golden test** (the package's flagship test, on both
  drivers): run a game N ticks appending commands + a mid-run snapshot;
  discard the sim ("crash"); `recoverSim`; continue to 2N; hash equals a
  continuous 2N-tick run's. Postgres runs the same suite iff `DATABASE_URL`
  is set (skipped locally without one; CI provides a service container so
  the prod driver is actually exercised, not aspirational).

### E. `@claude-engine/bots` + harness bot support

Targets: new package `packages/bots` (**pure** — same purity rules and
enforcement extension as the net root; depends on core + net's pure root for
`CommandIntent`); `packages/harness/src/index.ts` (additive `Scenario.bots`,
recorded-log replay); `scenarios/bots-headless.scenario.mjs` (new).

- **Bot vocabulary** (DESIGN.md: "simple goal-driven agents… reusable as
  load-test traffic"): a `BotDriver` is `{ actor, act(world, tick) →
  CommandIntent[] }` — it *reads* `IWorld` and *returns intents*; it never
  touches a sim (invariant #4 by construction). `createBot({ actor, seed,
  behavior })` wraps a `BotBehavior` closure with its own seeded `Rng` and a
  scratch memory object. Built-in behaviors v0: `scripted(steps)` and
  `randomWalk({ commandType, payloadFor, every })` — behaviors are
  parameterized by game command factories because command types are game
  vocabulary the engine does not know. Goal-driven fight/quest behaviors
  are game/template content, not engine scope.
- **Harness integration**: `Scenario.bots?: readonly BotDriver[]`
  (additive). `runScenario` calls each driver once per tick *before*
  stepping, stamps returned intents into Commands
  (`{ tick, actor: driver.actor, type, payload }`), submits them, and
  records **all** submitted commands (scripted + bot) in submission order as
  `verdict.replay.commands`. Replay therefore needs no bot code:
  `--verify-replay` and `--replay` inject the recorded log with bots
  disabled. `verifyReplay` gains an optional third parameter
  `commands?: readonly Command[]` (defaults to `scenario.commands` —
  additive, existing callers unchanged) so the CLI can hand it the recorded
  log. Bots in the headless harness are fully deterministic (seeded Rng,
  deterministic world reads), so bot scenarios pass `--verify-replay` like
  any other — exit criterion 4 proves it.

### F. Soak mode — `--soak`, SoakReport, committed net scenarios

Targets: `packages/harness/src/soak.ts` (new; imported dynamically by the
CLI like `browser.ts`, so `ws`/server deps never load for headless runs —
`@claude-engine/server`, `net`, `bots` become harness dependencies but only
the soak path touches server/net-web machinery),
`packages/harness/src/cli.ts` (`--soak`), `packages/harness/src/index.ts`
(additive `Scenario.net`, `Scenario.soak`, `Scenario.soakTargets`,
`Verdict.soak`), new scenarios `net-walk`, `net-interest`, `net-abuse`,
`soak-ci`, `soak-50` (all `scenarios/*.scenario.mjs`),
`.github/workflows/ci.yml` (soak-ci step).

- **Scenario shape**: a net-capable scenario adds `net` (the server-side
  config the engine cannot infer: `commands` rules, optional `interest`,
  `filterEvent`) and `soak` (client count, wall-clock duration, per-client
  bot factory, pump cadence). `soakTargets` maps SoakReport keys to
  `{ min?, max? }` bounds, exactly the `feelTargets` pattern (which remains
  browser-only; the two evaluate in their own modes).
- **Run contract**: `npm run harness --silent -- <scenario> --soak` boots
  a real `GameServer` in-process on an ephemeral port (scenario's seed +
  `setup` + `net` config, `devAuth`, no store by default), spawns
  `soak.clients` real `ClientSession`s over real WebSockets to localhost,
  each driven by its `BotDriver` on a wall-clock pump, runs for
  `durationMs`, shuts down cleanly, and emits one JSON verdict (stdout
  discipline unchanged) whose `soak` block carries the `SoakReport`: server
  tick p95/max, ticks processed, final tick + hash, commands
  accepted/rejected (by reason), bytes out, entity count, client-side
  connect/disconnect counts, mean RTT, mean replicated-entity count, and
  total prediction corrections. `soakTargets` bounds are evaluated as
  checks; exit 0 all pass / 1 a target missed / 2 infra failure — the
  browser-mode code exactly.
- **Reproducibility**: the verdict's replay bundle is the server's
  authoritative command log (including `@net/join`/`@net/leave`) +
  `scenarioModule`, and the soak report carries `deterministic: false` —
  so a live multiplayer session replays headlessly via `--replay`, hash-
  checked against the server's final hash. Verdict size for large soaks is
  the scenario author's responsibility (same stance as Phase 2 checkpoint
  snapshots); the gating `--replay` round-trip criterion targets `net-walk`,
  not `soak-50`.
- **Committed scenarios**: `net-walk` (2 clients walk; targets prove both
  connected, zero rejects, each replicates the other:
  `clients.avgReplicatedEntities ≥ 2`); `net-interest` (radius interest
  with far-flung setup entities; targets prove
  `clients.avgReplicatedEntities` is max-bounded strictly below
  `server.entities`); `net-abuse` (one hostile bot sends unknown types,
  invalid payloads, and floods; targets prove rejects ≥ bound across all
  three reasons and the server completed its ticks); `soak-ci` (10 bots,
  10 s — cheap enough for CI); `soak-50` (50 bots, 60 s, perf targets —
  the local/exit-criterion load test).

### G. Demo net mode, skill reference, enforcement + CI wiring

Targets: `apps/demo/src/server.ts` + `tsconfig.server.json` + a `serve`
script (new), `apps/demo/src/game.ts` (adds an `@net/join`/`@net/leave`
handling system — stays core-pure), `apps/demo/src/main.ts` (`?net=<url>`
client mode via `@claude-engine/net/web`; offline mode remains the
default and is unchanged), `plugin/skills/worldforge/SKILL.md` (short
multiplayer section) + `plugin/skills/worldforge/references/net-api.md`
(new, as-built surfaces only, gate-spot-checked against source like every
Phase 2 reference), `scripts/check-purity.mjs` + `eslint.config.mjs`
(coverage extension to `packages/net/src/**` minus `src/web/**` and
`packages/bots/src/**`, plus self-test fixtures — enforcement-scope
extension by config, CLAUDE.md text untouched, the established Phase 2
mechanism), `.github/workflows/ci.yml` (core/net/server/persistence/bots
test steps, Postgres service job, soak-ci step; the Phase 2 browser job is
untouched).

The demo server entry uses `devAuth()` and a permissive move rule —
`apps/demo` has no production build (the standing Phase 2 note), and the
skill documents `ticketAuth` as the non-dev shape. Templates stay
single-player (Non-goals); their only diff is the mechanical
`forkRng` migration from Scope A.

### Out of scope for A–G

Anything not listed above; see Non-goals.

## API contracts

**No changes to `IWorld` or `HostPort`** — `packages/core/src/types.ts`
must be zero-diff (see Invariant/contract impact). All `Scenario`/`Verdict`
changes are additive; Phase 0/1/2 consumers (`scripts/smoke.mjs`, all
committed scenarios, `--verify-replay`, `--replay`, `--browser`) must pass
unmodified. As in Phases 1–2: signatures below are the contract;
implementers may adjust parameter details where the spec is silent, but
listed capabilities, names, and behaviors are what the review gate checks.
Renames or capability changes require a spec addendum (a planning turn).

### `@claude-engine/core` — Rng state, tracked forks, restore (Scope A)

```ts
// rng.ts (additive)
export type RngState = readonly [number, number, number, number];
export class Rng {
  // ...existing members unchanged...
  getState(): RngState;
  static fromState(state: RngState): Rng;
}

// snapshot.ts (versioned format bump — the one non-additive core change,
// planned by Phase 2's versioning note; flagged in Invariant/contract impact)
export interface SimSnapshot {
  v: 2;
  tick: number;
  nextEntity: EntityId;
  stateHash: number;
  components: Record<string, [EntityId, unknown][]>;
  /** Root stream + every Sim.forkRng-registered stream, registration order. */
  rng: { root: RngState; forks: [string, RngState][] };
}
/** The Phase 2 evidence-only shape; readable, never emitted, never restorable. */
export interface SimSnapshotV1 { /* the exact Phase 2 shape */ }

// sim.ts (additive)
export class RestoreError extends Error {}
export class Sim implements IWorld {
  // ...existing members unchanged; snapshot() now returns v: 2...
  /** Fork + register a sim-held Rng stream. Draw-sequence-identical to
   *  this.rng.fork(label). Setup-time only (throws after the first step());
   *  duplicate labels throw. */
  forkRng(label: string): Rng;
  /** Requires setup() already run on this sim (systems are code and are not
   *  serialized). Replaces components/tick/nextEntity, restores root +
   *  registered fork Rng states by label, clears pending commands and the
   *  event log (events are derivable outputs; eventsSince() covers
   *  post-restore ticks only). Throws RestoreError on fork-label mismatch
   *  or a v:1 snapshot. */
  restore(snapshot: SimSnapshot): void;
}
```

### `@claude-engine/net` — protocol (pure root, Scope B)

```ts
export const PROTOCOL_VERSION = 1;

/** What a client may send: bare intent. actor and tick are SERVER-assigned. */
export interface CommandIntent { type: string; payload?: unknown }

export type ClientMessage =
  | { t: "hello"; proto: number; token: string }
  | { t: "input"; seq: number; intents: readonly CommandIntent[] }
  | { t: "ping"; sentAt: number };

export type RejectReason = "unknown-type" | "invalid-payload" | "rate-limited";
export type CloseCode = "auth-failed" | "protocol-error" | "superseded" | "server-shutdown";

export type ServerMessage =
  | { t: "welcome"; proto: number; playerId: string; actor: string; seed: string;
      tick: number; tickRateHz: number; state: ReplicaState }
  | { t: "state"; state: ReplicaState; ackSeq: number; events: readonly GameEvent[] }
  | { t: "reject"; seq: number; type: string; reason: RejectReason }
  | { t: "pong"; sentAt: number; serverTick: number }
  | { t: "close"; code: CloseCode; message: string };

/** Interest-filtered authoritative state. v0 sends the full interest set
 *  each time (no deltas). removed = left interest OR destroyed. */
export interface ReplicaState {
  tick: number;
  /** Server-computed full-world stateHash() — the client's authority anchor. */
  stateHash: number;
  entities: readonly [EntityId, readonly [string, unknown][]][];
  removed: readonly EntityId[];
}

export interface ProtocolLimits { maxMessageBytes: number; maxIntentsPerMessage: number }
export const DEFAULT_LIMITS: ProtocolLimits;
export class ProtocolError extends Error {}
export function encodeMessage(m: ClientMessage | ServerMessage): string;
/** Boundary validation: size/shape/limits enforced here; "@"-prefixed intent
 *  types are engine-reserved and always rejected. Throws ProtocolError. */
export function decodeClientMessage(raw: string, limits?: ProtocolLimits): ClientMessage;
export function decodeServerMessage(raw: string): ServerMessage;
```

### `@claude-engine/net` — client session (pure root) + web adapter (Scope B)

```ts
export interface ClientTransport {
  send(raw: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: (info?: { code?: string; message?: string }) => void): void;
  close(): void;
}

/** Game-supplied prediction: re-applied over fresh authority for every
 *  unacked intent. Patches are a presentation overlay — never sim state. */
export interface PredictView {
  readonly selfActor: string;
  getComponent<T>(entity: EntityId, component: string): T | undefined;
  patch<T>(entity: EntityId, component: string, value: T): void;
}
export type PredictFn = (view: PredictView, intents: readonly CommandIntent[]) => void;

/** IWorld over the replica + prediction overlay. stateHash() returns the
 *  server-reported hash from the latest state message (the interest-filtered
 *  replica cannot reproduce a full-world hash locally). */
export interface ClientWorld extends IWorld {
  /** Previous authoritative value (one state message of history) — the
   *  engine-owned interpolation data deferred from Phases 1–2, resolved
   *  here rather than on IWorld. */
  getPrevComponent<T>(entity: EntityId, component: string): T | undefined;
}

export interface ClientNetStats {
  rttMs: number | null;
  pendingIntents: number;
  replicatedEntities: number;
  /** Times fresh authority disagreed with the prediction overlay. */
  corrections: number;
  rejects: Record<string, number>;
}

export interface ClientSessionOptions {
  transport: ClientTransport;
  token: string;
  predict?: PredictFn;
  onEvent?: (event: GameEvent) => void;
  onClose?: (info: { code?: string; message?: string }) => void;
}
export interface ClientSession {
  readonly world: ClientWorld;
  readonly status: "connecting" | "open" | "closed";
  submitIntent(intent: CommandIntent): void;
  stats(): ClientNetStats;
  close(): void;
}
export function createClientSession(opts: ClientSessionOptions): ClientSession;
```

```ts
// @claude-engine/net/web (browser only)
export function webSocketTransport(url: string): ClientTransport;
```

### `@claude-engine/server` (Scope C)

```ts
export interface AuthProvider {
  authenticate(token: string): Promise<{ playerId: string } | null>;
}
/** HMAC-signed expiring tickets (Node crypto). The boring, standard v0. */
export function ticketAuth(secret: string): AuthProvider;
export function issueTicket(secret: string, playerId: string, opts?: { ttlMs?: number }): string;
/** Accepts "dev:<name>". Explicit opt-in only; never a default; dev/demo/harness use. */
export function devAuth(): AuthProvider;

export interface CommandRule {
  validate(payload: unknown): boolean;
  maxPerTick?: number;    // per session; over-limit intents reject "rate-limited"
  maxPerSecond?: number;  // token bucket, per session
}
export interface InterestPolicy {
  entitiesFor(world: IWorld, actor: string): Iterable<EntityId>;
}
export function allEntities(): InterestPolicy;
export function radiusInterest(opts: {
  positionComponent: string;  // component with { x, z }-shaped position
  ownerComponent: string;     // component whose value === the owning actor
  radius: number;
}): InterestPolicy;

export interface GameServerOptions {
  seed: string;
  /** Same game-module contract as scenarios: registers systems (including
   *  handlers for the reserved "@net/join" / "@net/leave" commands). */
  setup: (sim: Sim) => void;
  auth: AuthProvider;
  /** The validation boundary: unknown/invalid/over-rate intents never reach
   *  the sim. "@"-prefixed types are engine-reserved and unregisterable. */
  commands: Record<string, CommandRule>;
  interest?: InterestPolicy;              // default allEntities()
  filterEvent?: (event: GameEvent, actor: string, world: IWorld) => boolean;
  port?: number;                          // default 0 = ephemeral
  stateEveryTicks?: number;               // default 1
  limits?: Partial<ProtocolLimits>;
  /** Persistence (Scope D). Both present => write-ahead command log +
   *  periodic snapshots; existing gameId => recover and resume. */
  store?: GameStore;
  gameId?: string;
  snapshotEveryTicks?: number;            // default 600
}
export interface ServerStats {
  connected: number; ticks: number; tickP95Ms: number; tickMaxMs: number;
  commandsAccepted: number; commandsRejected: number;
  rejectionsByReason: Record<RejectReason, number>;
  bytesOut: number; entities: number;
}
export interface GameServer {
  readonly port: number;
  readonly world: IWorld;                 // read-only view of the live sim
  stats(): ServerStats;
  /** The authoritative command log (incl. @net/join/leave) — soak verdicts'
   *  replay bundle. */
  commandLog(): readonly Command[];
  stop(): Promise<void>;
}
export function startGameServer(opts: GameServerOptions): Promise<GameServer>;
```

### `@claude-engine/persistence` (Scope D)

```ts
export interface GameRecord {
  id: string; name: string; seed: string; protoVersion: number; createdAt: string;
}
export interface GameStore {
  createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord>;
  getGame(id: string): Promise<GameRecord | null>;
  /** Atomic append; called write-ahead (before the consuming tick steps). */
  appendCommands(gameId: string, commands: readonly Command[]): Promise<void>;
  commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]>;
  saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void>;
  latestSnapshot(gameId: string): Promise<SimSnapshot | null>;
  close(): Promise<void>;
}
export function sqliteStore(path: string): GameStore;       // better-sqlite3 (dev)
export function postgresStore(url: string): GameStore;      // pg (prod)
/** Snapshot -> restore -> replay tail. The Scope A co-design payoff. */
export function recoverSim(
  store: GameStore, gameId: string, setup: (sim: Sim) => void
): Promise<{ sim: Sim; record: GameRecord }>;
```

### `@claude-engine/bots` (Scope E)

```ts
export interface BotDriver {
  readonly actor: string;
  /** Reads IWorld, returns intents. Never touches a Sim. */
  act(world: IWorld, tick: number): readonly CommandIntent[];
}
export interface BotContext { rng: Rng; memory: Record<string, unknown>; actor: string }
export type BotBehavior =
  (world: IWorld, tick: number, ctx: BotContext) => readonly CommandIntent[];
export function createBot(opts: { actor: string; seed: string; behavior: BotBehavior }): BotDriver;
export function scripted(
  steps: readonly { atTick: number; intents: readonly CommandIntent[] }[]): BotBehavior;
export function randomWalk(opts: {
  commandType: string;
  payloadFor: (dx: number, dz: number) => unknown;
  every?: number;   // ticks between moves, default 1
}): BotBehavior;
```

### `@claude-engine/harness` — `Scenario` / `Verdict` extensions (additive only)

```ts
export interface Scenario {
  // ...all existing fields unchanged...
  /** Headless bot drivers; their emitted commands are recorded into the
   *  verdict's replay bundle, so replay needs no bot code. */
  bots?: readonly BotDriver[];
  /** Server-side config for --soak (the game vocabulary the engine can't infer). */
  net?: {
    commands: Record<string, CommandRule>;
    interest?: InterestPolicy;
    filterEvent?: (event: GameEvent, actor: string, world: IWorld) => boolean;
  };
  /** Present iff this scenario supports --soak runs. */
  soak?: SoakSpec;
  /** Bounds on SoakReport keys, e.g. { "server.tickP95Ms": { max: 50 } }.
   *  Evaluated only in --soak runs (feelTargets stays browser-only). */
  soakTargets?: Record<string, { min?: number; max?: number }>;
}

export interface SoakSpec {
  clients: number;
  durationMs: number;
  bot: (clientIndex: number) => BotDriver;
  intentEveryMs?: number;   // client pump cadence, default TICK_MS
  timeoutMs?: number;       // infra abort (exit 2), default durationMs + 30_000
}

export interface SoakReport {
  /** Named clientCount (not clients) — the client-side stats block below
   *  owns the `clients` key. */
  clientCount: number;
  durationMs: number;
  /** Wall-clock + real sockets. Reproduce headlessly via the verdict's
   *  replay bundle (the server's authoritative command log) + --replay. */
  deterministic: false;
  server: {
    ticks: number; finalTick: number; finalStateHash: number;
    tickP95Ms: number; tickMaxMs: number;
    commandsAccepted: number; commandsRejected: number;
    rejectionsByReason: Record<string, number>;
    bytesOut: number; entities: number;
  };
  clients: {
    connected: number; disconnected: number; avgRttMs: number;
    avgReplicatedEntities: number; corrections: number;
  };
  soakChecks: { target: string; value: number; passed: boolean }[];
}

export interface Verdict {
  // ...all existing fields unchanged...
  /** Present iff run with --soak. */
  soak?: SoakReport;
}

/** Additive third parameter; defaults preserve every existing call site. */
export function verifyReplay(
  scenario: Scenario, expectedHash: number, commands?: readonly Command[]
): { verified: boolean; expectedHash: number; actualHash: number };
```

### `@claude-engine/harness` — CLI extensions

```
npm run harness --silent -- <scenario> [--verify-replay] [--out <file>]
                             [--browser] [--screenshot-dir <dir>] [--soak]
npm run harness --silent -- --replay <verdict.json> [--out <file>]
                             [--from-checkpoint <tick>]
```

- `--soak`: requires `scenario.soak` (and `scenario.net`); boots the server
  in-process (ephemeral port, `devAuth`), runs the soak, emits one JSON
  verdict with the `soak` block; the replay bundle is the server's
  authoritative command log + `scenarioModule`. Exit `0` all soakTargets
  pass; `1` a target missed; `2` infra failure (port/serve/connect/timeout).
  Headless (non-`--soak`) invocations never import server/ws code (dynamic
  import, the `--browser` pattern).
- `--from-checkpoint <tick>` (only with `--replay`): restore from the
  verdict's checkpoint snapshot at `<tick>` (must exist and be `v: 2`),
  inject only commands with tick > `<tick>`, compare later checkpoints +
  final hash. Exit `0` match; `2` missing/`v:1` checkpoint, unreadable
  verdict, missing module, or setup drift; `3` divergence.
- Existing invocations, flags, exit codes, and stdout purity are unchanged.

## Exit criteria (review gate verdicts against these)

Grounding criterion, from ROADMAP.md Phase 3: *the Claudecraft critique,
answered* — a persisted multiplayer session survives a server restart with
replay-equivalent state; abusive clients are rejected at the boundary
without perturbing the sim; a 50-bot soak passes stated perf targets — all
machine-verdicted. Concretely:

1. **Build/lint/purity green, coverage extended**: `npm run build`,
   `npm run lint`, `npm run check:purity` all exit 0;
   `node scripts/check-purity.mjs --self-test` demonstrates non-zero exit
   for violations planted in `packages/net/src/**` (non-web) and
   `packages/bots/src/**`; a `three`/DOM import in `packages/net/src/web/**`
   is correctly excluded.
2. **Restore equivalence proven**: `npm test -w @claude-engine/core` exits 0
   and includes: Rng `fromState(getState())` continuation equality; the
   golden — continuous N-tick run vs. snapshot-at-N/2 → fresh sim → setup →
   `restore` → replay remaining commands → equal `stateHash()` at N, with at
   least one tracked fork drawn from on both sides of the snapshot;
   duplicate-label throw; fork-after-step throw; label-mismatch
   `RestoreError`; `v: 1` rejection.
3. **Replay-from-checkpoint works**: `npm run harness --silent -- smoke
   --out v.json` then `npm run harness --silent -- --replay v.json
   --from-checkpoint 50` exits 0 with `verified: true`; tampering a
   command with tick > 50 in `v.json` → exit 3; `--from-checkpoint 51`
   (no checkpoint there) → exit 2 with clear stderr.
4. **Bots are deterministic harness citizens**: `npm run harness --silent --
   bots-headless --verify-replay` exits 0; the verdict's `replay.commands`
   contains commands from the bot actor(s); `--out b.json` then
   `--replay b.json` exits 0 (replay without bot code).
5. **Two clients over real sockets**: `npm run harness --silent -- net-walk
   --soak` exits 0; `soak.clients.connected` = 2, zero rejects,
   `clients.avgReplicatedEntities ≥ 2` (each sees the other); feeding that
   verdict to `--replay` exits 0 with `verified: true` against the server's
   final hash — a live multiplayer session, reproduced headlessly.
6. **The boundary holds**: `npm run harness --silent -- net-abuse --soak`
   exits 0 with `rejectionsByReason` showing nonzero `unknown-type`,
   `invalid-payload`, and `rate-limited` counts meeting the scenario's
   targets, and `server.ticks` complete (the hostile client never stalled or
   perturbed the sim). The reviewer additionally confirms an `@net/join`
   intent sent from a client is rejected (reserved prefix).
7. **Interest management measurably filters**: `npm run harness --silent --
   net-interest --soak` exits 0 with `clients.avgReplicatedEntities`
   max-bounded strictly below `server.entities` per the scenario's targets.
8. **Crash recovery is hash-equivalent**: `npm test -w
   @claude-engine/persistence` exits 0 (SQLite), including the golden:
   N ticks + mid-run snapshot → discard sim → `recoverSim` → continue to
   2N → hash equals an uninterrupted 2N run. The Postgres conformance +
   golden suite passes in CI's service-container job (and locally iff
   `DATABASE_URL` is set; cleanly skipped otherwise).
9. **Prediction/reconciliation proven pure-headless**: `npm test -w
   @claude-engine/net` exits 0, including (fake transport): a local intent
   is visible in `ClientWorld` before any server ack; after a divergent
   authoritative state, the world converges to authority and `corrections`
   increments; with a predict function matching server logic under injected
   latency, `corrections` stays 0; acked intents are pruned; oversized/
   malformed frames throw `ProtocolError` at decode.
10. **Auth is boring and enforced**: `npm test -w @claude-engine/server`
    exits 0, including: invalid and expired tickets → `close(auth-failed)`
    before any sim interaction; valid ticket → `welcome` with
    server-assigned actor; duplicate playerId → first connection
    `close(superseded)`; `devAuth` accepts only `dev:`-prefixed tokens.
11. **Soak at load**: `npm run harness --silent -- soak-50 --soak` exits 0
    locally (50 clients, 60 s, targets at minimum
    `server.tickP95Ms ≤ 50` — the full tick budget — and zero unexpected
    disconnects). CI runs `soak-ci --soak` (10 clients, 10 s) green as a
    required step.
12. **Demo multiplayer, humanly playable** (acceptance-shaped, like Phase 2
    criterion 11): `npm run serve -w @claude-engine/demo` starts the demo
    server; two browser tabs at `?net=ws://localhost:<port>` each see and
    move their own cube and see the other's move. If the gate agent cannot
    drive two live tabs, it verifies the wiring in code + `net-walk`'s
    evidence and defers the live check to the session owner at merge, per
    the Phase 2 precedent.
13. **Contracts untouched / changes exactly as declared**:
    `git diff main..phase-3 -- CLAUDE.md` is empty;
    `git diff main..phase-3 -- packages/core/src/types.ts` is empty
    (`IWorld`/`HostPort` byte-identical); all `Scenario`/`Verdict`/CLI
    changes additive — `scripts/smoke.mjs` and every pre-existing scenario
    pass unmodified, existing flags/exit codes/stdout discipline unchanged,
    `runScenario` signature unchanged, `verifyReplay` extended only by the
    optional third parameter; the smoke final hash 919868270 survives the
    `forkRng` migration; the only core format change is the flagged
    `SimSnapshot` v1→v2 bump; `renderer-three` has zero diff this phase.

## Non-goals for this phase (explicitly deferred or declared out)

- **Module-free replay — declared permanently out, not re-deferred.**
  Systems are code; no serialization of a scenario/game module will ever be
  faithful. The honest contract (Phase 2's `scenarioModule` + this phase's
  `--from-checkpoint` restore) is the end state. This closes the carryover
  chain rather than kicking it to Phase 4.
- **Deterministic in-browser replay** (fixed-seed tick-aligned input
  injection in the page) — not needed: live sessions (browser and soak)
  reproduce headlessly via authoritative command logs. Revisit only if a
  concrete debugging need emerges that headless replay cannot serve.
- **Snapshot history / interpolation on `IWorld` itself** — resolved as
  `ClientWorld.getPrevComponent` (Scope B); no `IWorld` change now or
  pending. `renderer-three` untouched.
- **Delta/binary wire compression, protocol v2** — v0 is JSON text frames,
  full interest set per state message. Measured first (soak `bytesOut`),
  optimized later.
- **Lag compensation (server-side rewind), cheat inference beyond
  validation/rate limits, anti-cheat heuristics** — out; the boundary this
  phase builds is validation, not adjudication.
- **Matchmaking, lobbies, rooms, multiple sims per server process,
  horizontal scaling** — one authoritative sim per `GameServer`. The
  living world's zone topology is Phase 4 design.
- **Accounts, OAuth, password anything** — `AuthProvider` is the pluggable
  seam; only `ticketAuth` + `devAuth` ship. TLS termination and deployment
  topology are ops concerns, out of engine scope.
- **Full client-side sim rollback prediction** (running the real sim
  speculatively on the client) — v0 prediction is component-patch overlay;
  rollback prediction would require the full state interest management
  deliberately withholds. Revisit with Phase 4's flagship if its feel
  demands it.
- **Multiplayer starter templates / template net migration** — templates
  stay single-player (only the mechanical `forkRng` rename lands there);
  a multiplayer template belongs with the Phase 4 flagship learnings.
- **`apps/living-world`, Claude-driven NPCs, governance layer, autonomous
  improvement loop, public plugin release** — Phase 4, unchanged.
- **Persisting emitted `GameEvent`s** — commands + snapshots are the v0
  source of truth (events are derivable); an events table is a compatible
  later addition.
- **Bot fight/quest goal libraries** — engine ships the driver vocabulary +
  move-shaped behaviors; richer goals are game/template content.
- **Godot/native hosts, WebRTC/UDP transports** — Later/stretch per
  ROADMAP.md; the protocol package is where they would plug in.

## Invariant / contract impact

- **CLAUDE.md: zero diff permitted this phase.** Invariant #5 ("Netcode,
  persistence, auth, and input validation live in engine packages and are
  human-reviewed") stops being aspirational and becomes literally true —
  the same transition Phase 2 made for the browser-mode sentence.
  Invariants #2/#3 need no wording change: they govern "the sim", and the
  one true sim is the server's/harness's deterministic `Sim`; predicted
  client views are presentation-layer and are documented as such
  (`deterministic: false` in soak reports, `corrections` as a measured
  quantity). The review gate should confirm an empty
  `git diff main..phase-3 -- CLAUDE.md`.
- **`IWorld` / `HostPort`: no changes; `types.ts` zero-diff.** This was the
  phase both prior specs pointed at for contract pressure; each pressure
  point was taken up deliberately and resolved *without* touching the
  interfaces:
  1. *Interpolation/snapshot history on `IWorld`* (deferred Phase 1 §Non-
     goals, reaffirmed Phase 2) — resolved as
     `ClientWorld.getPrevComponent` on `@claude-engine/net`'s world view.
     Rationale: history's only consumer is networked rendering; putting it
     on `IWorld` would obligate `Sim`, the harness, and every future host
     to buffer state. `ClientWorld extends IWorld` is additive capability,
     the same pattern as `Sim` exposing more than `IWorld` requires.
  2. *`snapshot()`/`restore()` on `IWorld`* ("any host could checkpoint",
     named in Phase 2's impact section with "revisit deliberately at
     Phase 3 persistence") — revisited, decision reaffirmed: they stay on
     the concrete `Sim`. Both real consumers (harness, server host) hold
     the concrete `Sim`; no `IWorld`-only consumer needs restore.
  3. *`HostPort` persistence/clock hooks* (DESIGN.md's aspirational text) —
     not needed: the server host, like the harness, constructs its own
     `Sim` and needs no new protocol surface. `HostPort` remains as-built.
  Any implementer discovering they "need" an `IWorld`/`HostPort` change
  must stop and escalate to a planning turn per WORKFLOW.md.
- **`@claude-engine/core` — additive except one flagged format bump.**
  Additive: `Rng.getState`/`Rng.fromState`/`RngState`, `Sim.forkRng`,
  `Sim.restore`, `RestoreError`. **Flagged, non-additive:** `SimSnapshot`
  moves `v: 1` → `v: 2` (adds the `rng` block); `Sim.snapshot()` emits v2.
  This is the compatible extension Phase 2's snapshot design was explicitly
  versioned for; the old shape stays exported as `SimSnapshotV1`; no
  consumer in-repo inspects `v` except `restore`/`--from-checkpoint`
  (which require v2) — checkpoint hash comparison in `--replay` is
  unaffected. Phase 2 verdict JSONs on disk remain valid evidence and
  remain `--replay`-able (not `--from-checkpoint`-able; exit 2 says why).
  `stateHash()` is byte-for-byte unchanged (hash continuity: smoke stays
  919868270 through the `forkRng` migration, which delegates to the
  identical `rng.fork` draw).
- **Invariant #1 (sim purity) enforcement scope extends by config, not by
  text** — third application of the Phase 2 mechanism: purity gates
  additionally cover `packages/net/src/**` (excluding `src/web/**`) and
  `packages/bots/src/**`; CLAUDE.md's wording is not edited; the gate
  checks the config and the self-test fixtures.
- **Invariant #4 (hosts render, sims decide) — two new audit points, same
  shape as `createThreeHost`/`installTestHook` before them**: (a) the
  server host's only sim-mutation paths are `submit(Command)` for validated
  client intents and the reserved `@net/join`/`@net/leave` commands — join/
  leave deliberately enter *through the command queue* so session lifecycle
  is replayable, not a host-side mutation; (b) `BotDriver.act` receives
  `IWorld` and returns intents — bots cannot mutate anything. The gate
  audits both the way it audited the test hook.
- **Invariant #5 — new obligations created**: `@claude-engine/net`,
  `server`, `persistence`, and `bots` become the human-reviewed engine
  homes for netcode/persistence/auth/validation. Generated game code must
  not roll its own: games declare `CommandRule`s and handle `@net/join`;
  they never see a socket, a SQL string, or a token. The skill's new
  `references/net-api.md` teaches exactly this split.
- **`@claude-engine/harness`**: `Scenario`/`Verdict` extended additively
  (`bots`, `net`, `soak`, `soakTargets`; `Verdict.soak`); CLI gains
  `--soak` and `--from-checkpoint`; `verifyReplay` gains one optional
  parameter; everything existing — flags, exit codes 0/1/2/3, stdout-is-
  one-JSON-document, `runScenario` signature, `--browser` behavior —
  unchanged. Server/ws code loads only under `--soak` (dynamic import, the
  established `--browser` pattern), so headless harness runs gain no new
  runtime dependencies.
- **New public surface on merge** (treated as contract by the gate, as in
  Phases 1–2): the wire protocol itself (message shapes + `PROTOCOL_VERSION`
  + reserved `@net/` command types — this one is *extra* load-bearing, since
  DESIGN.md names the protocol as the portability boundary future non-TS
  hosts will speak), `@claude-engine/net` (root + `/web`),
  `@claude-engine/server`, `@claude-engine/persistence` (including the
  SQL schema, which is versioned with the package), `@claude-engine/bots`.
- **New third-party dependencies (engine packages only, human-reviewed per
  invariant #5)**: `ws` (server), `better-sqlite3` (persistence dev
  driver — chosen over experimental `node:sqlite` to avoid Node version
  flags in CI), `pg` (persistence prod driver). None are reachable from
  core, renderer, assets, or headless harness paths.
- **In-repo migrations (mechanical, hash-preserving)**: `smoke` scenario,
  `apps/demo/src/game.ts`, and both templates move `sim.rng.fork("…")` →
  `sim.forkRng("…")`. The gate verifies hash continuity (criterion 13).
- **Root `package.json` / CI**: root gains no new scripts (soak rides the
  existing `harness` script); `apps/demo` gains `serve`;
  `.github/workflows/ci.yml` gains unit-test steps for the new packages, a
  Postgres service-container job for the persistence suite, and a required
  `soak-ci --soak` step; the Phase 2 browser job is untouched.
