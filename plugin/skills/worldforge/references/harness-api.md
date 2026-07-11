# `@claude-engine/harness` API reference

Runs a `Scenario` against a `Sim` (headless or in a real browser) and
returns a structured JSON `Verdict` — everything an agent needs to decide
"did this work, and if not, how do I reproduce it," never only on a screen.

## CLI

```
npm run harness --silent -- <scenario> [--verify-replay] [--out <file>]
                             [--browser] [--screenshot-dir <dir>] [--soak]
npm run harness --silent -- --replay <verdict.json> [--out <file>]
                             [--from-checkpoint <tick>]
```

- `<scenario>`: a bare name (`smoke` → `scenarios/smoke.scenario.mjs` at the
  repo root) or a path to a `.mjs` module whose default (or named
  `scenario`) export is a `Scenario`.
- **`--silent` is required** for the stdout-purity guarantee below — it's an
  `npm run` flag (before `--`), suppressing npm's own banner line.
- **stdout carries exactly one JSON document** (the `Verdict`, or
  `ReplayVerdict` in `--replay` mode) and nothing else. All human
  diagnostics go to stderr. `--out <file>` additionally writes the JSON to
  disk.
- `--verify-replay`: re-runs the scenario's own (seed, commands) against a
  fresh sim and compares final hashes; result in `verdict.replayCheck`. For
  bot scenarios (`scenario.bots`), this replays the *recorded* command log
  (`verdict.replay.commands`, which includes the bots' emitted commands),
  not `scenario.commands` — no bot code runs during replay.
- `--browser`: requires `scenario.browser` (a `BrowserSpec`); drives the app
  in real headless Chromium. See "Browser mode" below.
- `--soak`: requires `scenario.soak` + `scenario.net`; boots a real
  `@claude-engine/server` in-process and drives it with real bot clients
  over real WebSockets. See "Soak mode" below.
- `--replay <verdict.json>`: re-runs a **previously produced verdict**
  (headless, browser, or soak) against its named scenario module and
  compares hashes. See "Replay from a verdict" below.
- `--from-checkpoint <tick>` (only with `--replay`): resumes from a `v: 2`
  checkpoint snapshot via `Sim.restore()` instead of replaying from tick 1 —
  only commands/checkpoints after `<tick>` are considered. Requires the
  named checkpoint to exist and be restorable (`core-api.md`).

Exit codes: `0` all assertions/checks passed (and replay verified, if
requested); `1` an assertion, browser check, or soak check failed; `2`
scenario/module load failure, `--replay` verdict/module unreadable,
scenario-module drift, a missing/unrestorable `--from-checkpoint` target, or
(`--browser`/`--soak`) an infra failure (build/serve/connect/timeout, or
missing Playwright); `3` replay divergence (`--verify-replay` or
`--replay`).

## `Scenario` / `Verdict`

```ts
interface Scenario {
  name: string;
  seed: string;
  ticks: number;
  setup: (sim: Sim) => void;
  commands?: readonly Command[];
  assertions: readonly Assertion[];
  checkpoints?: readonly number[];         // ticks to snapshot
  browser?: BrowserSpec;                   // see renderer-api.md / below
  feelTargets?: Record<string, { min?: number; max?: number }>;
  bots?: readonly BotDriver[];             // see net-api.md — emitted commands recorded into replay
  net?: {                                  // server-side config for --soak
    commands: Record<string, CommandRule>;
    interest?: InterestPolicy;
    filterEvent?: (event: GameEvent, actor: string, world: IWorld) => boolean;
  };
  soak?: SoakSpec;                         // see "Soak mode" below
  soakTargets?: Record<string, { min?: number; max?: number }>;
}

interface Assertion { description: string; check: (sim: Sim) => boolean; }

interface Verdict {
  scenario: string; seed: string; ticks: number; passed: boolean;
  assertions: { description: string; passed: boolean; error?: string }[];
  finalStateHash: number; eventCount: number; entityCount: number;
  replay: {
    seed: string; commands: readonly Command[];
    scenarioModule?: string;               // repo-relative path (CLI-populated)
    ticks?: number;
    setupStateHash?: number;               // stateHash() after setup(), before tick 1
  };
  perf: { totalMs: number; avgTickMs: number; p95TickMs: number; maxTickMs: number };
  eventsTail?: readonly GameEvent[];       // last ~50 events, only when passed === false
  replayCheck?: { verified: boolean; expectedHash: number; actualHash: number };
  checkpoints?: Checkpoint[];              // present iff scenario.checkpoints was set
  browser?: BrowserRunReport;              // present iff run with --browser
  soak?: SoakReport;                       // present iff run with --soak
}

interface Checkpoint {
  tick: number; stateHash: number; entityCount: number; eventCount: number;
  snapshot: SimSnapshot;                   // full state dump — see core-api.md
}
```

`runScenario(scenario): Verdict` and `verifyReplay(scenario, expectedHash,
commands?)` are exported from `@claude-engine/harness` for programmatic use
(e.g. scripting a batch of scenarios); the CLI is a thin wrapper over both.
`verifyReplay`'s third parameter defaults to `scenario.commands` — the CLI
passes `verdict.replay.commands` instead, which is what makes bot-scenario
replay work without bot code.

## Replay from a verdict

A verdict's `replay` bundle is not fully self-contained — `setup()`
registers *systems* (functions), which can't be serialized. What ships:
`--replay <verdict.json>` loads the verdict, imports the named
`scenarioModule`, re-runs its `setup()`, checks the resulting `stateHash()`
against the verdict's recorded `setupStateHash` (if they don't match, the
scenario module has drifted since the verdict was produced — reported as
exit `2`, a diagnosable "stale evidence" condition, distinct from exit `3`'s
genuine hash divergence), then replays the verdict's own `commands` and
compares final (and, if present, checkpoint) hashes.

```ts
function replayVerdict(scenario: Scenario, verdict: Verdict, source: string): ReplayVerdict;
// { source, scenarioModule, verified, expectedFinalHash, actualFinalHash,
//   setupDrift, checkpointResults?: { tick, expected, actual, match }[] }
```

## Browser mode (`@claude-engine/harness/browser`)

Dynamically imported by the CLI only when `--browser` is passed — headless
harness usage never touches Playwright. `playwright` is an optional peer
dependency; the CLI exits `2` with install instructions if it's missing.

```ts
interface BrowserSpec {
  app: string;                             // workspace name, or an http(s):// URL
  input?: readonly { key: string; downMs: number; upMs: number }[];
  screenshotAtTicks?: readonly number[];
  probes?: readonly ProbeSpec[];
  timeoutMs?: number;                      // default 30_000
}
type ProbeSpec =
  | { probe: "fps"; sampleMs?: number }
  | { probe: "input-latency"; key: string; component: string; samples?: number };

interface BrowserRunReport {
  app: string; url: string;
  deterministic: false;                    // wall-clock input is nondeterministic by nature
  finalTick: number; finalStateHash: number;
  screenshots: { requestedTick: number; actualTick: number; path: string }[];
  consoleErrors: string[]; pageErrors: string[];
  probes: Record<string, Record<string, number>>;
  feelChecks: { target: string; value: number; passed: boolean }[];
}
```

What `--browser` actually judges: it does **not** run the scenario's
headless `assertions` (their `check(sim)` closures need a real `Sim`, which
browser mode doesn't hold). It passes (exit 0) iff the page's test hook
appeared and reached `scenario.ticks`, zero console/page errors occurred,
every requested screenshot was captured, and every `feelTargets` bound
held. The app is served from its already-built `dist/` via a minimal static
file server (not `vite preview` — subprocess-readiness detection over
stdout proved flaky across platforms).

The bridge back to determinism: a browser run's `verdict.replay.commands`
is the page's test hook's captured command log (see `renderer-api.md`), so
a nondeterministic browser session reproduces headlessly via `--replay`
against the same verdict — that's how "playable" and "verified" become the
same artifact.

## Game-feel probes

Two ship in v0, both evaluated only during `--browser` runs:

- `fps`: rAF-timestamp sampling over `sampleMs` (default 1000ms) →
  `{ avg, p5, min }`.
- `input-latency`: presses `key`, polls the test hook until the named
  `component` on the first entity that has it changes value →
  `{ avgMs, maxMs, avgTicks }` over `samples` runs (default 5).

Declare bounds in `Scenario.feelTargets` keyed as `"fps.avg"` or
`"inputLatency.avgMs"` (camelCase probe name + dot + result field); each
becomes a pass/fail entry in `verdict.browser.feelChecks`.

## Soak mode (`@claude-engine/harness/soak`)

Dynamically imported by the CLI only when `--soak` is passed — headless
harness usage never touches `ws`/`@claude-engine/server`/`@claude-engine/net`
runtime code. Boots a real `GameServer` in-process on an ephemeral port
(`devAuth()`, no persistence store) and drives it with real bot clients over
real WebSockets — full details on the client/server/bot types in
`net-api.md`.

```ts
interface SoakSpec {
  clients: number;
  durationMs: number;
  bot: (clientIndex: number) => BotDriver;
  intentEveryMs?: number;                  // client pump cadence, default TICK_MS
  timeoutMs?: number;                      // default durationMs + 30_000
}

interface SoakReport {
  clientCount: number;
  durationMs: number;
  deterministic: false;                    // wall-clock + real sockets
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
```

Bounds in `Scenario.soakTargets` are dot-path keys into the report, e.g.
`"server.tickP95Ms"` or `"clients.avgReplicatedEntities"` (note:
`feelTargets` stays browser-only; `soakTargets` is its soak-mode
counterpart, evaluated only in `--soak` runs). Exit `0` all pass, `1` any
target missed, `2` infra failure (port/serve/connect/timeout).

The reproducibility bridge is identical to browser mode: `verdict.replay
.commands` is the server's authoritative command log (including reserved
`@net/join`/`@net/leave` commands), so a live multiplayer soak session
replays headlessly via `--replay` against the server's final hash — no
sockets required the second time.
