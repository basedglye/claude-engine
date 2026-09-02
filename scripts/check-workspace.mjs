#!/usr/bin/env node
/**
 * Preflight: is THIS checkout actually the one being built and imported?
 *
 * WHY THIS EXISTS. A fresh `git worktree` starts with no `node_modules`.
 * Node's resolver then walks UP out of the worktree and finds the MAIN
 * checkout's `node_modules`, whose `@claude-engine/*` entries are symlinks
 * into the MAIN checkout's `packages/*`. The result is silent and vicious:
 * `npm run build` compiles the worktree's sources into the worktree's
 * `dist/`, every command exits 0, and then every test, scenario and harness
 * run imports the OTHER checkout's `dist/` — whatever state that happens to
 * be in.
 *
 * It has already cost real time. Opening H2b, `npm test` failed with
 * `TypeError: sim.stateHashSlow is not a function` — a function that had
 * been merged to `main` a week earlier and was sitting, compiled, in this
 * worktree's own `packages/core/dist/sim.js`. The error named a symptom
 * three layers from its cause, and the honest first hypothesis ("the merge
 * is broken") was wrong. The fix was one `npm install`.
 *
 * The check itself is the direct question, asked the same way the failure
 * asks it: resolve `@claude-engine/core` the way every test does, and see
 * whether the file that comes back lives under this repo root.
 *
 * Deliberately NOT part of `npm run build`: build is what you run to FIX
 * this, and a preflight that refuses to let you build your way out of the
 * hole is worse than no preflight. It is wired into `npm test` and
 * `npm run check:goldens`, which are the commands whose results become
 * claims.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO_ROOT, "package.json"));

/** Packages every test path imports by name. One mis-resolution is enough
 *  to invalidate a run, so check the load-bearing few rather than all. */
const PROBES = ["@claude-engine/core", "@claude-engine/space", "@claude-engine/interiors"];

const problems = [];

if (!fs.existsSync(path.join(REPO_ROOT, "node_modules"))) {
  problems.push(
    `No node_modules in ${REPO_ROOT}. Package imports will resolve to a PARENT checkout's ` +
      `packages/*/dist — you would be testing another tree's code.`
  );
}

for (const name of PROBES) {
  let resolved;
  try {
    resolved = require.resolve(name);
  } catch {
    problems.push(`Cannot resolve ${name} from ${REPO_ROOT}.`);
    continue;
  }
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    problems.push(`${name} resolves OUTSIDE this checkout:\n      ${resolved}`);
  }
}

if (problems.length > 0) {
  console.error("\nworkspace preflight FAILED — this checkout is not the one being imported.\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n  Fix:  npm install        (run it in ${REPO_ROOT})\n` +
      `        npm run build\n\n` +
      `  Until then, every green result from this tree is a result about a different tree.\n`
  );
  process.exit(2);
}

console.log(`workspace preflight OK — @claude-engine/* resolve inside ${REPO_ROOT}`);
