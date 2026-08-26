#!/usr/bin/env node
/**
 * Harness CLI — makes `npm run harness -- <scenario>` real.
 *
 * Contract (docs/PHASE-1.md, section C; extended by docs/PHASE-2.md Scope D/E
 * and docs/PHASE-3.md Scope A):
 *   npm run harness -- <scenario> [--verify-replay] [--out <file>]
 *                                 [--browser] [--browser-engine <chromium|firefox>]
 *                                 [--screenshot-dir <dir>] [--soak]
 *   npm run harness -- --replay <verdict.json> [--out <file>]
 *                                 [--from-checkpoint <tick>]
 *
 * stdout carries exactly one JSON document (the Verdict, or ReplayVerdict in
 * --replay mode) and nothing else. All human-readable diagnostics go to
 * stderr. Exit codes:
 *   0 — all assertions passed (and replay verified, if requested)
 *   1 — one or more assertions failed (or, in --browser mode, a browser check failed)
 *   2 — scenario failed to load or threw mid-run; in --replay mode, the
 *       verdict/module was unreadable, the scenario module has drifted since
 *       the verdict was produced (setupStateHash mismatch), or (with
 *       --from-checkpoint) the named tick has no checkpoint / a v:1
 *       (evidence-only) snapshot; in --browser mode, an infra failure
 *       (build/serve/hook timeout/missing Playwright)
 *   3 — replay divergence (under --verify-replay, or in --replay mode)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Sim, RestoreError } from "@claude-engine/core";
import type { Scenario, Verdict } from "./index.js";
import {
  runScenario,
  verifyReplay,
  replayVerdict,
  replayVerdictFromCheckpoint,
  replayToSim,
  evaluateAssertions,
  CheckpointError,
} from "./index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// dist/cli.js -> packages/harness/dist -> packages/harness -> packages -> repo root
const repoRoot = resolve(__dirname, "..", "..", "..");

function parseArgs(argv: readonly string[]): {
  scenario: string | undefined;
  replay: string | undefined;
  verifyReplay: boolean;
  out: string | undefined;
  browser: boolean;
  browserEngine: "chromium" | "firefox";
  soak: boolean;
  screenshotDir: string | undefined;
  fromCheckpoint: number | undefined;
} {
  let scenario: string | undefined;
  let replay: string | undefined;
  let verifyReplayFlag = false;
  let out: string | undefined;
  let browser = false;
  let browserEngine: "chromium" | "firefox" = "chromium";
  let soak = false;
  let screenshotDir: string | undefined;
  let fromCheckpoint: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify-replay") {
      verifyReplayFlag = true;
    } else if (arg === "--browser") {
      browser = true;
    } else if (arg === "--browser-engine") {
      const raw = argv[++i];
      if (raw !== "chromium" && raw !== "firefox") {
        console.error('--browser-engine requires "chromium" or "firefox"');
        process.exit(2);
      }
      browserEngine = raw;
    } else if (arg === "--soak") {
      soak = true;
    } else if (arg === "--out") {
      out = argv[++i];
      if (!out) {
        console.error("--out requires a file path argument");
        process.exit(2);
      }
    } else if (arg === "--screenshot-dir") {
      screenshotDir = argv[++i];
      if (!screenshotDir) {
        console.error("--screenshot-dir requires a directory path argument");
        process.exit(2);
      }
    } else if (arg === "--from-checkpoint") {
      const raw = argv[++i];
      const tick = raw ? Number(raw) : NaN;
      if (!raw || !Number.isInteger(tick)) {
        console.error("--from-checkpoint requires an integer tick argument");
        process.exit(2);
      }
      fromCheckpoint = tick;
    } else if (arg === "--replay") {
      replay = argv[++i];
      if (!replay) {
        console.error("--replay requires a verdict JSON file path argument");
        process.exit(2);
      }
    } else if (!scenario && !replay && !arg?.startsWith("--")) {
      scenario = arg;
    } else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(2);
    }
  }

  if (!scenario && !replay) {
    console.error(
      "Usage: npm run harness -- <scenario> [--verify-replay] [--out <file>] [--browser] [--browser-engine <chromium|firefox>] [--screenshot-dir <dir>] [--soak]\n" +
        "       npm run harness -- --replay <verdict.json> [--out <file>] [--from-checkpoint <tick>]"
    );
    process.exit(2);
  }
  if (fromCheckpoint !== undefined && !replay) {
    console.error("--from-checkpoint is only valid with --replay");
    process.exit(2);
  }

  return { scenario, replay, verifyReplay: verifyReplayFlag, out, browser, browserEngine, soak, screenshotDir, fromCheckpoint };
}

/** Repo-relative path with forward slashes, for portable storage in a verdict. */
function toRepoRelative(absPath: string): string {
  return relative(repoRoot, absPath).split(sep).join("/");
}

/** A bare name like "smoke" resolves to scenarios/smoke.scenario.mjs at the repo root. */
function resolveScenarioPath(spec: string): string {
  const isBareName = /^[A-Za-z0-9_-]+$/.test(spec);
  if (isBareName) {
    return resolve(repoRoot, "scenarios", `${spec}.scenario.mjs`);
  }
  if (isAbsolute(spec)) return spec;
  // The root `harness` script delegates through `npm run start --workspace
  // @claude-engine/harness --`, which runs with cwd=packages/harness, not
  // the caller's original directory. npm sets INIT_CWD to that original
  // directory precisely for this case; fall back to process.cwd() when the
  // CLI is invoked directly (e.g. `node dist/cli.js <path>`).
  return resolve(process.env.INIT_CWD ?? process.cwd(), spec);
}

async function loadScenario(path: string): Promise<Scenario> {
  const mod = (await import(pathToFileURL(path).href)) as {
    default?: Scenario;
    scenario?: Scenario;
  };
  const scenario = mod.default ?? mod.scenario;
  if (!scenario || typeof scenario.setup !== "function") {
    throw new Error(
      `Module at ${path} does not export a Scenario (default export or named "scenario")`
    );
  }
  return scenario;
}

async function runReplayMode(
  replaySpec: string,
  out: string | undefined,
  fromCheckpoint: number | undefined
): Promise<void> {
  const verdictPath = isAbsolute(replaySpec)
    ? replaySpec
    : resolve(process.env.INIT_CWD ?? process.cwd(), replaySpec);

  let verdict: Verdict;
  try {
    verdict = JSON.parse(readFileSync(verdictPath, "utf8")) as Verdict;
  } catch (err) {
    console.error(`Failed to read verdict "${replaySpec}" (resolved: ${verdictPath}):`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }

  const moduleRel = verdict.replay?.scenarioModule;
  if (!moduleRel) {
    console.error(`Verdict "${replaySpec}" has no replay.scenarioModule — cannot replay.`);
    process.exit(2);
    return;
  }
  const modulePath = resolve(repoRoot, moduleRel);

  let scenario: Scenario;
  try {
    scenario = await loadScenario(modulePath);
  } catch (err) {
    console.error(`Failed to load scenario module "${moduleRel}" (resolved: ${modulePath}):`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }

  let result;
  try {
    result =
      fromCheckpoint === undefined
        ? replayVerdict(scenario, verdict, replaySpec)
        : replayVerdictFromCheckpoint(scenario, verdict, fromCheckpoint, replaySpec);
  } catch (err) {
    if (err instanceof CheckpointError || err instanceof RestoreError) {
      console.error(err.message);
      process.exit(2);
      return;
    }
    throw err;
  }
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (out) {
    writeFileSync(out, json, "utf8");
  }

  if (result.setupDrift) {
    console.error(
      `Scenario module "${moduleRel}" has drifted since this verdict was produced ` +
        `(setup() no longer matches setupStateHash) — this is stale evidence, not replay divergence.`
    );
    process.exit(2);
  }
  process.exit(result.verified ? 0 : 3);
}

async function runBrowserMode(
  scenario: Scenario,
  scenarioPath: string,
  screenshotDir: string | undefined,
  browserEngine: "chromium" | "firefox",
  shouldVerifyReplay: boolean,
  out: string | undefined
): Promise<void> {
  const { runBrowserScenario, BrowserInfraError } = await import("./browser.js");

  let result;
  try {
    result = await runBrowserScenario(scenario, repoRoot, {
      ...(screenshotDir === undefined ? {} : { screenshotDir }),
      browserEngine,
    });
  } catch (err) {
    if (err instanceof BrowserInfraError) {
      console.error(`Browser-mode infra failure for "${scenario.name}": ${err.message}`);
      process.exit(2);
      return;
    }
    console.error(`Browser-mode run for "${scenario.name}" threw:`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }

  const sim = new Sim(scenario.seed);
  scenario.setup(sim);
  const setupStateHash = sim.stateHash();

  // Browser mode captures a command log but never runs the sim itself, so
  // scenario.assertions (which check final sim state / events) can only be
  // evaluated against a headlessly-replayed sim built from that log — the
  // same mechanism --verify-replay already uses for its hash check. This
  // replay happens whenever the scenario declares assertions, independent
  // of whether --verify-replay was also passed: an assertion result must
  // never be silently reported as `[]`, and gating it behind an opt-in flag
  // would let a plain `--browser` run pass vacuously exactly like the bug
  // this fixes. (A scenario with an empty `assertions: []` array, e.g.
  // demo-visual, is unaffected — replaySim below is skipped and the verdict
  // keeps an honest empty array, not a "not evaluated" one either way.)
  const assertionResults =
    scenario.assertions.length > 0
      ? evaluateAssertions(scenario, replayToSim(scenario, result.commands, result.browser.finalTick))
      : [];
  const assertionsPassed = assertionResults.every((r) => r.passed);

  const verdict: Verdict = {
    scenario: scenario.name,
    seed: scenario.seed,
    ticks: result.browser.finalTick,
    passed: result.passed && assertionsPassed,
    assertions: assertionResults,
    finalStateHash: result.browser.finalStateHash,
    eventCount: result.eventCount,
    entityCount: result.entityCount,
    replay: {
      seed: scenario.seed,
      commands: result.commands,
      scenarioModule: toRepoRelative(scenarioPath),
      ticks: result.browser.finalTick,
      setupStateHash,
    },
    perf: { totalMs: 0, avgTickMs: 0, p95TickMs: 0, maxTickMs: 0 },
    browser: result.browser,
  };

  if (shouldVerifyReplay) {
    // A page world with no stateHashSlow reports `available: false`
    // honestly, but nothing downstream reads it — so the browser leg of the
    // write-through invariant would evaporate silently the day an app hands
    // the hook a wrapper IWorld instead of its Sim. Infra failure, exit 2:
    // "the check could not run" is not "the check passed".
    if (!result.browser.liveHashCheck.available) {
      console.error(
        `Browser-mode infra failure for "${scenario.name}": the page's world does not expose stateHashSlow(), ` +
          `so the incremental-hash cross-check (CLAUDE.md invariant 6) cannot run there. ` +
          `Hand the test hook the real Sim, or this leg of --verify-replay is vacuous.`
      );
      process.exit(2);
      return;
    }
    const check = verifyReplay(scenario, verdict.finalStateHash, verdict.replay.commands, result.browser.finalTick);
    verdict.replayCheck = { verified: check.verified, expectedHash: check.expectedHash, actualHash: check.actualHash };
    verdict.hashCheck = {
      live: {
        incremental: result.browser.liveHashCheck.incremental,
        slow: result.browser.liveHashCheck.slow,
        agrees: result.browser.liveHashCheck.agrees,
      },
      replay: check.hashCheck,
    };
  }

  const json = JSON.stringify(verdict, null, 2);
  console.log(json);
  if (out) {
    writeFileSync(out, json, "utf8");
  }

  if (hashCheckFailed(verdict)) {
    reportHashDivergence(verdict);
    process.exit(3);
  }
  if (shouldVerifyReplay && !verdict.replayCheck?.verified) {
    process.exit(3);
  }
  process.exit(verdict.passed ? 0 : 1);
}

/**
 * docs/PHASE-H2.md contract A / determinism rule 6: `stateHash()` and
 * `stateHashSlow()` must agree everywhere. They can only disagree if sim
 * code mutated a component object in place instead of writing through
 * `setComponent()` — the incremental hash's cache never sees that write, so
 * the run's whole hash stream (and every replay comparison built on it) is
 * lying. That is a P0 determinism bug, so it exits 3 like any other replay
 * divergence, and it is checked on EVERY run, not only under
 * --verify-replay: a hash that does not describe the state is not a
 * verification opt-in.
 */
function hashCheckFailed(verdict: Verdict): boolean {
  const hc = verdict.hashCheck;
  if (!hc) return false;
  return !hc.live.agrees || hc.replay?.agrees === false;
}

function reportHashDivergence(verdict: Verdict): void {
  const hc = verdict.hashCheck!;
  console.error(
    `stateHash divergence in "${verdict.scenario}": incremental !== slow. ` +
      `A component was mutated in place without setComponent() (see Sim.stateHash()'s contract). ` +
      `live incremental=${hc.live.incremental} slow=${hc.live.slow}` +
      (hc.replay ? `; replay incremental=${hc.replay.incremental} slow=${hc.replay.slow}` : "")
  );
}

async function runSoakMode(scenario: Scenario, scenarioPath: string, out: string | undefined): Promise<void> {
  const { runSoakScenario, SoakInfraError } = await import("./soak.js");

  let result;
  try {
    result = await runSoakScenario(scenario, repoRoot);
  } catch (err) {
    if (err instanceof SoakInfraError) {
      console.error(`Soak-mode infra failure for "${scenario.name}": ${err.message}`);
      process.exit(2);
      return;
    }
    console.error(`Soak-mode run for "${scenario.name}" threw:`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }

  const sim = new Sim(scenario.seed);
  scenario.setup(sim);
  const setupStateHash = sim.stateHash();

  const verdict: Verdict = {
    scenario: scenario.name,
    seed: scenario.seed,
    ticks: result.soak.server.finalTick,
    passed: result.passed,
    assertions: [],
    finalStateHash: result.soak.server.finalStateHash,
    eventCount: result.eventCount,
    entityCount: result.entityCount,
    replay: {
      seed: scenario.seed,
      commands: result.commands,
      scenarioModule: toRepoRelative(scenarioPath),
      ticks: result.soak.server.finalTick,
      setupStateHash,
    },
    perf: { totalMs: 0, avgTickMs: 0, p95TickMs: 0, maxTickMs: 0 },
    soak: result.soak,
  };

  const json = JSON.stringify(verdict, null, 2);
  console.log(json);
  if (out) {
    writeFileSync(out, json, "utf8");
  }
  process.exit(verdict.passed ? 0 : 1);
}

async function main(): Promise<void> {
  const {
    scenario: spec,
    replay: replaySpec,
    verifyReplay: shouldVerifyReplay,
    out,
    browser,
    browserEngine,
    soak,
    screenshotDir,
    fromCheckpoint,
  } = parseArgs(process.argv.slice(2));

  if (replaySpec) {
    await runReplayMode(replaySpec, out, fromCheckpoint);
    return;
  }

  const scenarioPath = resolveScenarioPath(spec!);

  let scenario: Scenario;
  try {
    scenario = await loadScenario(scenarioPath);
  } catch (err) {
    console.error(`Failed to load scenario "${spec}" (resolved: ${scenarioPath}):`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }

  if (browser) {
    await runBrowserMode(scenario, scenarioPath, screenshotDir, browserEngine, shouldVerifyReplay, out);
    return;
  }

  if (soak) {
    await runSoakMode(scenario, scenarioPath, out);
    return;
  }

  let verdict;
  try {
    verdict = runScenario(scenario);
  } catch (err) {
    console.error(`Scenario "${spec}" threw during run:`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }
  verdict.replay.scenarioModule = toRepoRelative(scenarioPath);

  if (shouldVerifyReplay) {
    const check = verifyReplay(scenario, verdict.finalStateHash, verdict.replay.commands);
    verdict.replayCheck = { verified: check.verified, expectedHash: check.expectedHash, actualHash: check.actualHash };
    if (verdict.hashCheck) verdict.hashCheck.replay = check.hashCheck;
  }

  const json = JSON.stringify(verdict, null, 2);
  console.log(json);
  if (out) {
    writeFileSync(out, json, "utf8");
  }

  if (hashCheckFailed(verdict)) {
    reportHashDivergence(verdict);
    process.exit(3);
  }
  if (shouldVerifyReplay && !verdict.replayCheck?.verified) {
    process.exit(3);
  }
  process.exit(verdict.passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected harness CLI error:");
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(2);
});
