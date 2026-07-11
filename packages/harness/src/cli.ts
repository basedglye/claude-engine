#!/usr/bin/env node
/**
 * Harness CLI — makes `npm run harness -- <scenario>` real.
 *
 * Contract (docs/PHASE-1.md, section C):
 *   npm run harness -- <scenario> [--verify-replay] [--out <file>]
 *
 * stdout carries exactly one JSON document (the Verdict) and nothing else.
 * All human-readable diagnostics go to stderr. Exit codes:
 *   0 — all assertions passed (and replay verified, if requested)
 *   1 — one or more assertions failed
 *   2 — scenario failed to load or threw mid-run
 *   3 — replay divergence under --verify-replay
 */
import { writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Scenario } from "./index.js";
import { runScenario, verifyReplay } from "./index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// dist/cli.js -> packages/harness/dist -> packages/harness -> packages -> repo root
const repoRoot = resolve(__dirname, "..", "..", "..");

function parseArgs(argv: readonly string[]): {
  scenario: string;
  verifyReplay: boolean;
  out: string | undefined;
} {
  let scenario: string | undefined;
  let verifyReplayFlag = false;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify-replay") {
      verifyReplayFlag = true;
    } else if (arg === "--out") {
      out = argv[++i];
      if (!out) {
        console.error("--out requires a file path argument");
        process.exit(2);
      }
    } else if (!scenario && !arg?.startsWith("--")) {
      scenario = arg;
    } else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(2);
    }
  }

  if (!scenario) {
    console.error("Usage: npm run harness -- <scenario> [--verify-replay] [--out <file>]");
    process.exit(2);
  }

  return { scenario, verifyReplay: verifyReplayFlag, out };
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

async function main(): Promise<void> {
  const { scenario: spec, verifyReplay: shouldVerifyReplay, out } = parseArgs(
    process.argv.slice(2)
  );
  const scenarioPath = resolveScenarioPath(spec);

  let scenario: Scenario;
  try {
    scenario = await loadScenario(scenarioPath);
  } catch (err) {
    console.error(`Failed to load scenario "${spec}" (resolved: ${scenarioPath}):`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
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

  if (shouldVerifyReplay) {
    verdict.replayCheck = verifyReplay(scenario, verdict.finalStateHash);
  }

  const json = JSON.stringify(verdict, null, 2);
  console.log(json);
  if (out) {
    writeFileSync(out, json, "utf8");
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
