import { Sim, type Command, type GameEvent, type SimSnapshot } from "@claude-engine/core";

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
  /** Present iff the scenario declared checkpoints. */
  checkpoints?: Checkpoint[];
  /** Present iff run with --browser (see @claude-engine/harness/browser). */
  browser?: unknown;
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

  const tickMs: number[] = [];
  const start = performance.now();
  for (let t = 1; t <= scenario.ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
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
      commands: scenario.commands ?? [],
      ticks: scenario.ticks,
      setupStateHash,
    },
    perf: {
      totalMs,
      avgTickMs: totalMs / scenario.ticks,
      p95TickMs: percentile(tickMs, 0.95),
      maxTickMs: tickMs.reduce((m, v) => Math.max(m, v), 0),
    },
    ...(passed ? {} : { eventsTail: sim.eventsSince(0).slice(-50) }),
    ...(scenario.checkpoints ? { checkpoints } : {}),
  };
}

/** Replay the given (seed, commands) against a fresh sim and compare the final state hash. */
export function verifyReplay(
  scenario: Scenario,
  expectedHash: number
): { verified: boolean; expectedHash: number; actualHash: number } {
  const sim = new Sim(scenario.seed);
  scenario.setup(sim);
  const byTick = new Map<number, Command[]>();
  for (const c of scenario.commands ?? []) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  for (let t = 1; t <= scenario.ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
  }
  const actualHash = sim.stateHash();
  return { verified: actualHash === expectedHash, expectedHash, actualHash };
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
