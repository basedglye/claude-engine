import { Sim, type Command, type GameEvent, type SimSnapshot } from "@claude-engine/core";
import type { BotDriver } from "@claude-engine/bots";

/** Thrown when --from-checkpoint names a tick with no checkpoint, or one
 *  whose snapshot predates Sim.restore() support (v: 1). */
export class CheckpointError extends Error {}

/**
 * Harness v0: run a scenario against a sim and return a structured verdict.
 *
 * The contract that matters: everything an agent needs to decide "did this
 * work, and if not, how do I reproduce it" is in the returned JSON — never
 * only on a screen.
 */

export interface Scenario {
  name: string;
  seed: string;
  ticks: number;
  /** Game wiring: register systems, spawn initial entities. */
  setup: (sim: Sim) => void;
  /** Scripted input: commands to inject, keyed by tick. */
  commands?: readonly Command[];
  assertions: readonly Assertion[];
  /** Ticks at which runScenario captures a Checkpoint. */
  checkpoints?: readonly number[];
  /** Present iff this scenario supports --browser runs (see @claude-engine/harness/browser). */
  browser?: unknown;
  /** Bounds on probe result keys, e.g. { "fps.avg": { min: 30 } }. Evaluated only in --browser runs. */
  feelTargets?: Record<string, { min?: number; max?: number }>;
  /** Headless bot drivers; their emitted commands are recorded into the
   *  verdict's replay bundle, so replay needs no bot code. */
  bots?: readonly BotDriver[];
  /** Server-side config for --soak (the game vocabulary the engine can't
   *  infer): { commands: Record<string, CommandRule>; interest?:
   *  InterestPolicy; filterEvent?: (...) => boolean } — kept as `unknown`
   *  here (cast in soak.ts) the same way `browser` is, to avoid a static
   *  dependency on @claude-engine/server from this module. */
  net?: unknown;
  /** Present iff this scenario supports --soak runs (see
   *  @claude-engine/harness/soak's SoakSpec) — same `unknown`-typed pattern
   *  as `browser` for the same reason. */
  soak?: unknown;
  /** Bounds on SoakReport keys, e.g. { "server.tickP95Ms": { max: 50 } }.
   *  Evaluated only in --soak runs (feelTargets stays browser-only). */
  soakTargets?: Record<string, { min?: number; max?: number }>;
}

export interface Checkpoint {
  tick: number;
  stateHash: number;
  entityCount: number;
  eventCount: number;
  snapshot: SimSnapshot;
}

export interface Assertion {
  description: string;
  /** Evaluated after the final tick. */
  check: (sim: Sim) => boolean;
}

export interface Verdict {
  scenario: string;
  seed: string;
  ticks: number;
  passed: boolean;
  assertions: { description: string; passed: boolean; error?: string }[];
  finalStateHash: number;
  eventCount: number;
  /** Entity count at the final tick. */
  entityCount: number;
  /** Everything needed to reproduce this exact run. */
  replay: {
    seed: string;
    commands: readonly Command[];
    /** Repo-relative path of the scenario module that produced this verdict. */
    scenarioModule?: string;
    ticks?: number;
    /** stateHash() after setup(), before tick 1 — drift detector for --replay. */
    setupStateHash?: number;
  };
  perf: { totalMs: number; avgTickMs: number; p95TickMs: number; maxTickMs: number };
  /** Last ~50 events; included only when passed === false. */
  eventsTail?: readonly GameEvent[];
  /** Present only when the caller requests a replay-equivalence check (e.g. the CLI's --verify-replay). */
  replayCheck?: { verified: boolean; expectedHash: number; actualHash: number };
  /**
   * Incremental-vs-slow `stateHash` cross-check (docs/PHASE-H2.md contract
   * A). `live` is the sim this verdict ran; `replay` is the replayed sim,
   * present only when a replay actually happened (--verify-replay, or
   * browser mode's assertion replay). A disagreement means some sim system
   * mutated a component object in place without a setComponent() call — a
   * P0 determinism bug, exit 3, never something to loosen.
   */
  hashCheck?: {
    live: HashConsistency;
    replay?: HashConsistency;
  };
  /** Present iff the scenario declared checkpoints. */
  checkpoints?: Checkpoint[];
  /** Present iff run with --browser (see @claude-engine/harness/browser). */
  browser?: unknown;
  /** Present iff run with --soak (see @claude-engine/harness/soak). */
  soak?: unknown;
}

/** One incremental-vs-slow comparison. `agrees` is the only field a gate
 *  needs; the two hashes are carried so a failure verdict names the actual
 *  numbers instead of just "they differ". */
export interface HashConsistency {
  incremental: number;
  slow: number;
  agrees: boolean;
}

/**
 * Assert Sim.stateHash() === Sim.stateHashSlow() (docs/PHASE-H2.md contract
 * A / determinism rule 6). Cheap enough to run unconditionally at the end of
 * every scenario run: one full state walk, once, against a hash the run has
 * already been maintaining incrementally.
 */
export function checkHashConsistency(sim: Sim): HashConsistency {
  const incremental = sim.stateHash();
  const slow = sim.stateHashSlow();
  return { incremental, slow, agrees: incremental === slow };
}

export function runScenario(scenario: Scenario): Verdict {
  const sim = new Sim(scenario.seed);
  scenario.setup(sim);
  const setupStateHash = sim.stateHash();

  const byTick = new Map<number, Command[]>();
  for (const c of scenario.commands ?? []) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const checkpointTicks = new Set(scenario.checkpoints ?? []);
  const checkpoints: Checkpoint[] = [];
  // Only built (and only used for verdict.replay.commands) when bots are
  // present — a bot-free scenario's replay bundle stays byte-identical to
  // `scenario.commands ?? []`, unaffected by tick-grouping order.
  const submittedCommands: Command[] | undefined = scenario.bots ? [] : undefined;

  const tickMs: number[] = [];
  const start = performance.now();
  for (let t = 1; t <= scenario.ticks; t++) {
    for (const c of byTick.get(t) ?? []) {
      sim.submit(c);
      submittedCommands?.push(c);
    }
    for (const bot of scenario.bots ?? []) {
      for (const intent of bot.act(sim, t)) {
        const command: Command = { tick: t, actor: bot.actor, type: intent.type, payload: intent.payload };
        sim.submit(command);
        submittedCommands?.push(command);
      }
    }
    const tickStart = performance.now();
    sim.step();
    tickMs.push(performance.now() - tickStart);
    if (checkpointTicks.has(t)) {
      checkpoints.push({
        tick: t,
        stateHash: sim.stateHash(),
        entityCount: countEntities(sim),
        eventCount: sim.eventsSince(0).length,
        snapshot: sim.snapshot(),
      });
    }
  }
  const totalMs = performance.now() - start;

  const results = scenario.assertions.map((a) => {
    const outcome = safeCheck(a, sim);
    return outcome.error === undefined
      ? { description: a.description, passed: outcome.passed }
      : { description: a.description, passed: outcome.passed, error: outcome.error };
  });
  const passed = results.every((r) => r.passed);

  return {
    scenario: scenario.name,
    seed: scenario.seed,
    ticks: scenario.ticks,
    passed,
    assertions: results,
    finalStateHash: sim.stateHash(),
    eventCount: sim.eventsSince(0).length,
    entityCount: countEntities(sim),
    replay: {
      seed: scenario.seed,
      commands: submittedCommands ?? scenario.commands ?? [],
      ticks: scenario.ticks,
      setupStateHash,
    },
    perf: {
      totalMs,
      avgTickMs: totalMs / scenario.ticks,
      p95TickMs: percentile(tickMs, 0.95),
      maxTickMs: tickMs.reduce((m, v) => Math.max(m, v), 0),
    },
    hashCheck: { live: checkHashConsistency(sim) },
    ...(passed ? {} : { eventsTail: sim.eventsSince(0).slice(-50) }),
    ...(scenario.checkpoints ? { checkpoints } : {}),
  };
}

/**
 * Replay the given (seed, commands) against a fresh sim and compare the
 * final state hash. `commands` defaults to `scenario.commands` (existing
 * callers unchanged); the CLI's --verify-replay passes a bot scenario's
 * *recorded* command log instead, so replay never needs to run bot code.
 */
export function verifyReplay(
  scenario: Scenario,
  expectedHash: number,
  commands?: readonly Command[],
  ticks?: number
): { verified: boolean; expectedHash: number; actualHash: number; hashCheck: HashConsistency } {
  // Browser-mode runs land on a wall-clock-determined final tick that can
  // differ from scenario.ticks (the static headless tick count) — the
  // caller passes the run's actual final tick so replay covers exactly the
  // ticks that were live. Headless callers omit `ticks` and keep the
  // original scenario.ticks behaviour unchanged.
  const tickCount = ticks ?? scenario.ticks;
  const sim = replayToSim(scenario, commands ?? scenario.commands ?? [], tickCount);
  const actualHash = sim.stateHash();
  return {
    verified: actualHash === expectedHash,
    expectedHash,
    actualHash,
    hashCheck: checkHashConsistency(sim),
  };
}

/**
 * Replay (seed, commands) against a fresh sim for `ticks` ticks and return
 * the resulting Sim — the shared core behind verifyReplay's hash comparison
 * and browser-mode's assertion evaluation (see cli.ts's runBrowserMode).
 * setup() always runs first, same as every other replay path in this file.
 */
export function replayToSim(scenario: Scenario, commands: readonly Command[], ticks: number): Sim {
  const sim = new Sim(scenario.seed);
  scenario.setup(sim);
  // Prime the incremental-hash cache exactly as the live path does
  // (runScenario computes setupStateHash here). Without this, the replay
  // sim's cache is built for the first time at the FINAL hash, when every
  // entry is recomputed fresh — so its incremental/slow cross-check could
  // never disagree, and the replay leg of the check would be vacuous.
  // Note the honest residual: the cross-check catches an in-place mutation
  // of a component that has been hashed at least once. A component created
  // AND mutated in place between two hash calls is invisible until the next
  // one — which is why per-tick hashing paths (core's replay(), checkpoints)
  // are the sharp end of this detector, and why the house rule is enforced
  // by review and by the core suite's negative control as well as here.
  sim.stateHash();
  const byTick = new Map<number, Command[]>();
  for (const c of commands) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  for (let t = 1; t <= ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
  }
  return sim;
}

/** Evaluate a scenario's declared assertions against a sim's final state —
 *  the same shape runScenario produces, reused by browser mode's replay. */
export function evaluateAssertions(
  scenario: Scenario,
  sim: Sim
): { description: string; passed: boolean; error?: string }[] {
  return scenario.assertions.map((a) => {
    const outcome = safeCheck(a, sim);
    return outcome.error === undefined
      ? { description: a.description, passed: outcome.passed }
      : { description: a.description, passed: outcome.passed, error: outcome.error };
  });
}

export interface ReplayVerdict {
  source: string;
  scenarioModule: string;
  verified: boolean;
  expectedFinalHash: number;
  actualFinalHash: number;
  /** True when the scenario module's setup() no longer matches the verdict
   *  it produced — distinct from true nondeterminism. */
  setupDrift: boolean;
  checkpointResults?: { tick: number; expected: number; actual: number; match: boolean }[];
}

/**
 * Re-run a scenario's setup() against a verdict's own replay bundle
 * (commands, not the scenario module's `commands` field) and compare state
 * hashes. Distinguishes "the scenario module drifted since this verdict was
 * produced" (setupStateHash mismatch) from true replay divergence.
 */
export function replayVerdict(scenario: Scenario, verdict: Verdict, source: string): ReplayVerdict {
  const scenarioModule = verdict.replay.scenarioModule ?? "";
  const sim = new Sim(verdict.replay.seed);
  scenario.setup(sim);
  const setupStateHash = sim.stateHash();

  if (
    verdict.replay.setupStateHash !== undefined &&
    setupStateHash !== verdict.replay.setupStateHash
  ) {
    return {
      source,
      scenarioModule,
      verified: false,
      expectedFinalHash: verdict.finalStateHash,
      actualFinalHash: setupStateHash,
      setupDrift: true,
    };
  }

  const byTick = new Map<number, Command[]>();
  for (const c of verdict.replay.commands) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const checkpointTicks = new Map((verdict.checkpoints ?? []).map((c) => [c.tick, c]));
  const checkpointResults: { tick: number; expected: number; actual: number; match: boolean }[] = [];

  const ticks = verdict.replay.ticks ?? verdict.ticks;
  for (let t = 1; t <= ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
    const expected = checkpointTicks.get(t);
    if (expected) {
      const actual = sim.stateHash();
      checkpointResults.push({ tick: t, expected: expected.stateHash, actual, match: actual === expected.stateHash });
    }
  }

  const actualFinalHash = sim.stateHash();
  return {
    source,
    scenarioModule,
    verified: actualFinalHash === verdict.finalStateHash && checkpointResults.every((c) => c.match),
    expectedFinalHash: verdict.finalStateHash,
    actualFinalHash,
    setupDrift: false,
    ...(checkpointResults.length > 0 ? { checkpointResults } : {}),
  };
}

/**
 * Like replayVerdict, but resumes from a checkpoint's v2 snapshot instead of
 * replaying from tick 1 (Sim.restore(), Scope A). Still runs setup() first —
 * systems are code and are never serialized — and still checks setupStateHash
 * before restoring, so module drift is diagnosed the same way as full replay.
 * Only commands after `fromTick` are injected; only checkpoints after
 * `fromTick` are compared.
 */
export function replayVerdictFromCheckpoint(
  scenario: Scenario,
  verdict: Verdict,
  fromTick: number,
  source: string
): ReplayVerdict {
  const scenarioModule = verdict.replay.scenarioModule ?? "";
  const checkpoint = (verdict.checkpoints ?? []).find((c) => c.tick === fromTick);
  if (!checkpoint) {
    throw new CheckpointError(`No checkpoint at tick ${fromTick} in this verdict`);
  }
  if (checkpoint.snapshot.v !== 2) {
    throw new CheckpointError(
      `Checkpoint at tick ${fromTick} is a v:${checkpoint.snapshot.v} snapshot (evidence-only, not restorable) — re-run without --from-checkpoint`
    );
  }

  const sim = new Sim(verdict.replay.seed);
  scenario.setup(sim);
  const setupStateHash = sim.stateHash();

  if (
    verdict.replay.setupStateHash !== undefined &&
    setupStateHash !== verdict.replay.setupStateHash
  ) {
    return {
      source,
      scenarioModule,
      verified: false,
      expectedFinalHash: verdict.finalStateHash,
      actualFinalHash: setupStateHash,
      setupDrift: true,
    };
  }

  sim.restore(checkpoint.snapshot);

  const byTick = new Map<number, Command[]>();
  for (const c of verdict.replay.commands) {
    if (c.tick <= fromTick) continue;
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const laterCheckpoints = new Map(
    (verdict.checkpoints ?? []).filter((c) => c.tick > fromTick).map((c) => [c.tick, c])
  );
  const checkpointResults: { tick: number; expected: number; actual: number; match: boolean }[] = [];

  const ticks = verdict.replay.ticks ?? verdict.ticks;
  for (let t = fromTick + 1; t <= ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
    const expected = laterCheckpoints.get(t);
    if (expected) {
      const actual = sim.stateHash();
      checkpointResults.push({ tick: t, expected: expected.stateHash, actual, match: actual === expected.stateHash });
    }
  }

  const actualFinalHash = sim.stateHash();
  return {
    source,
    scenarioModule,
    verified: actualFinalHash === verdict.finalStateHash && checkpointResults.every((c) => c.match),
    expectedFinalHash: verdict.finalStateHash,
    actualFinalHash,
    setupDrift: false,
    ...(checkpointResults.length > 0 ? { checkpointResults } : {}),
  };
}

function countEntities(sim: Sim): number {
  return [...sim.entities()].length;
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function safeCheck(a: Assertion, sim: Sim): { passed: boolean; error?: string } {
  try {
    return { passed: a.check(sim) };
  } catch (err) {
    return { passed: false, error: err instanceof Error ? err.message : String(err) };
  }
}
