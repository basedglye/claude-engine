import { Sim, type Command } from "@claude-engine/core";

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
  assertions: { description: string; passed: boolean }[];
  finalStateHash: number;
  eventCount: number;
  /** Everything needed to reproduce this exact run. */
  replay: { seed: string; commands: readonly Command[] };
  perf: { totalMs: number; avgTickMs: number };
}

export function runScenario(scenario: Scenario): Verdict {
  const sim = new Sim(scenario.seed);
  scenario.setup(sim);

  const byTick = new Map<number, Command[]>();
  for (const c of scenario.commands ?? []) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }

  const start = performance.now();
  for (let t = 1; t <= scenario.ticks; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
  }
  const totalMs = performance.now() - start;

  const results = scenario.assertions.map((a) => ({
    description: a.description,
    passed: safeCheck(a, sim),
  }));

  return {
    scenario: scenario.name,
    seed: scenario.seed,
    ticks: scenario.ticks,
    passed: results.every((r) => r.passed),
    assertions: results,
    finalStateHash: sim.stateHash(),
    eventCount: sim.eventsSince(0).length,
    replay: { seed: scenario.seed, commands: scenario.commands ?? [] },
    perf: { totalMs, avgTickMs: totalMs / scenario.ticks },
  };
}

function safeCheck(a: Assertion, sim: Sim): boolean {
  try {
    return a.check(sim);
  } catch {
    return false;
  }
}
