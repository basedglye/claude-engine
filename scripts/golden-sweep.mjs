#!/usr/bin/env node
/**
 * Golden sweep — Phase H2b review gate 10 (docs/PHASE-H2.md §13).
 *
 * docs/PHASE-H2.md's §1 split ruling: H2b's diff is FORBIDDEN from moving
 * any headless scenario's final `stateHash`. The H2b review's first act is
 * asserting every headless golden pinned at the H2a merge (commit
 * `28e554a`, "Merge Phase H2a: The Living Hotel") is byte-identical. This
 * script makes that a single command instead of a manual per-scenario
 * chore.
 *
 * A mismatch here is a P0 to be DIAGNOSED, never "fixed" by editing the
 * PINS table below to match whatever the tree now produces. The pins are
 * the contract; the sim is what must agree with them.
 *
 * Where each pin comes from:
 *   - smoke, checkin-rush, one-man-week: CARRIED. These are the three
 *     values recorded in docs/reviews/phase-H2a.md's own verdict table and
 *     restated in apps/hotel/docs/HANDOFF.md's "Verified starting facts for
 *     H2b": smoke 3849639990, checkin-rush 1978775531, one-man-week
 *     3423109909. They were not re-derived by this script — they are typed
 *     in from the review record.
 *   - demo-walk, bots-headless, walk-collide, corridor-headon, fraud-catch,
 *     fraud-catch-b, zen-clean, first-hire, escalation-stars: MEASURED.
 *     Neither the H2a review nor the handoff pins a value for these, so
 *     each was run once, at the start of H2b, against an unmodified sim
 *     (branch `hotel-phase-2b`, freshly built from the merged H2a tree,
 *     nothing in packages/ or apps/ touched yet), and the `finalStateHash`
 *     it printed under `--verify-replay` was copied in below. They are
 *     "first H2b measurement", not "H2a-committed truth" — if a future
 *     review finds an official pin for one of these that disagrees, the
 *     review record wins and this comment is wrong, not the other way
 *     around.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const cliPath = resolve(repoRoot, "packages", "harness", "dist", "cli.js");

// Re-pinned 2026-09-04 at the hotel-phase-2b + grand-foyer-alpha merge: the
// nine that moved are the alpha branch's sim changes (lobby depth 20-24 cells,
// fraud rate 200 permille, missed-fraud chargeback). Measured on the alpha
// branch alone AND on the merged tree -- identical, so H2b carried zero
// sim-visible change across the merge.
// name -> { hash, source }. source is "carried" (from the H2a review /
// handoff record) or "measured" (run by this script's author at the H2b
// boundary, see file header).
const PINS = {
  smoke: { hash: 3849639990, source: "carried" },
  "checkin-rush": { hash: 2196558366, source: "measured" },
  "one-man-week": { hash: 4021919040, source: "measured" },
  "demo-walk": { hash: 1289360534, source: "measured" },
  "bots-headless": { hash: 4146301557, source: "measured" },
  "walk-collide": { hash: 540994947, source: "measured" },
  "corridor-headon": { hash: 1136126795, source: "measured" },
  "fraud-catch": { hash: 1810283670, source: "measured" },
  "fraud-catch-b": { hash: 1850687857, source: "measured" },
  "zen-clean": { hash: 3816275859, source: "measured" },
  "first-hire": { hash: 3189570860, source: "measured" },
  "escalation-stars": { hash: 2469499419, source: "measured" },
};

// one-man-week is 42,000 ticks and genuinely slow — tell the reader we
// haven't hung, per HANDOFF's warning that a gate can otherwise look dead.
const SLOW = new Set(["one-man-week"]);

function usage() {
  console.error(
    "Usage: node scripts/golden-sweep.mjs [--only <scenario>] [--list]\n" +
      "  --only <scenario>   run a single pinned scenario\n" +
      "  --list              print the pin table and exit"
  );
}

function parseArgs(argv) {
  let only;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      only = argv[++i];
      if (!only) {
        usage();
        process.exit(2);
      }
    } else if (arg === "--list") {
      list = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unrecognized argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }
  return { only, list };
}

function pad(s, n) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/**
 * Run one scenario headless through the harness CLI directly (not via
 * `npm run harness --`) — invoking dist/cli.js skips npm's own banner
 * entirely, which is simpler than piping through `--silent` and keeps
 * stdout guaranteed to be nothing but the verdict JSON (see cli.ts's own
 * contract comment: "stdout carries exactly one JSON document ... and
 * nothing else"). Returns { ok, hash, exitCode, rawStdout, error }.
 */
function runScenario(name) {
  const proc = spawnSync(
    process.execPath,
    [cliPath, name, "--verify-replay"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );

  if (proc.error) {
    return { ok: false, error: `failed to spawn harness CLI: ${proc.error.message}` };
  }

  const stdout = proc.stdout ?? "";
  let verdict;
  try {
    verdict = JSON.parse(stdout);
  } catch {
    // Do NOT report this as a hash mismatch — an unparseable stdout means
    // the harness didn't even get to produce a verdict (crash, wrong
    // scenario name, stray console output ahead of the JSON). Reporting it
    // as a golden drift would send the next reader chasing a phantom
    // regression instead of the actual infra failure — exactly the
    // mistake CLAUDE.md's verification-honesty section warns about.
    const snippet = stdout.slice(0, 400);
    return {
      ok: false,
      exitCode: proc.status,
      error:
        `stdout did not parse as JSON (exit ${proc.status}). ` +
        `First 400 chars of stdout:\n${snippet || "(empty)"}\n` +
        (proc.stderr ? `stderr:\n${proc.stderr.slice(0, 400)}` : ""),
    };
  }

  return {
    ok: true,
    exitCode: proc.status,
    hash: verdict.finalStateHash,
    replayVerified: verdict.replayCheck?.verified,
  };
}

function main() {
  const { only, list } = parseArgs(process.argv.slice(2));
  const names = Object.keys(PINS);

  if (list) {
    for (const name of names) {
      const p = PINS[name];
      console.log(`${pad(name, 20)} ${String(p.hash).padStart(12)}  (${p.source})`);
    }
    process.exit(0);
  }

  const toRun = only ? [only] : names;
  if (only && !PINS[only]) {
    console.error(`Unknown scenario "${only}". Known: ${names.join(", ")}`);
    process.exit(2);
  }

  console.error(`golden-sweep: running ${toRun.length} scenario(s) with --verify-replay\n`);

  let anyFailed = false;
  const results = [];

  for (const name of toRun) {
    const pin = PINS[name];
    if (SLOW.has(name)) {
      console.error(`${name}: this scenario is ~42,000 ticks, expect it to take a while...`);
    } else {
      console.error(`${name}: running...`);
    }

    const r = runScenario(name);

    if (!r.ok) {
      anyFailed = true;
      console.log(`ERR  ${pad(name, 20)} ${r.error}`);
      results.push({ name, status: "error" });
      continue;
    }

    if (r.exitCode !== 0) {
      anyFailed = true;
      console.log(
        `FAIL ${pad(name, 20)} exit ${r.exitCode} (expected 0) — hash was ${r.hash}, ` +
          `replayVerified=${r.replayVerified}`
      );
      results.push({ name, status: "fail" });
      continue;
    }

    if (r.hash !== pin.hash) {
      anyFailed = true;
      console.log(`DIFF ${pad(name, 20)} expected ${pin.hash} got ${r.hash}`);
      results.push({ name, status: "diff" });
      continue;
    }

    console.log(`OK   ${pad(name, 20)} ${r.hash}`);
    results.push({ name, status: "ok" });
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  console.error(`\ngolden-sweep: ${okCount}/${results.length} OK`);

  if (anyFailed) {
    const bad = results.filter((r) => r.status !== "ok").map((r) => r.name);
    console.error(`golden-sweep: MISMATCH/FAILURE in: ${bad.join(", ")}`);
    process.exit(1);
  }

  console.error("golden-sweep: all pinned goldens byte-identical.");
  process.exit(0);
}

main();
