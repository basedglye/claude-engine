#!/usr/bin/env node
/**
 * Asset import pipeline CLI (docs/PHASE-2.md, Scope C).
 *
 * Contract:
 *   npm run assets:import --silent -- <file> --type <texture|icon|mesh|audio>
 *                                     --into <appDir> [--validate-only]
 *
 * stdout carries exactly one JSON document (an ImportReport) and nothing
 * else — this mirrors the harness CLI's stdout-purity discipline. All
 * human-readable diagnostics go to stderr. Exit codes:
 *   0 — all gates passed (asset copied into <appDir>/assets/ + a manifest
 *       entry appended, unless --validate-only)
 *   1 — one or more gates failed (the ImportReport is still printed on
 *       stdout; gates[] names the failure(s))
 *   2 — unreadable file or bad arguments (no ImportReport can be produced)
 */
import { resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import type { AssetType, ImportReport } from "./index.js";
import { validateAsset, importAsset } from "./index.js";

const ASSET_TYPES: readonly AssetType[] = ["texture", "icon", "mesh", "audio"];

function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

function usage(): string {
  return (
    "Usage: npm run assets:import --silent -- <file> --type <texture|icon|mesh|audio> " +
    "--into <appDir> [--validate-only]"
  );
}

function parseArgs(argv: readonly string[]): {
  file: string;
  type: AssetType;
  into: string;
  validateOnly: boolean;
} {
  let file: string | undefined;
  let type: string | undefined;
  let into: string | undefined;
  let validateOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--type") {
      type = argv[++i];
      if (!type) {
        console.error("--type requires a value");
        process.exit(2);
      }
    } else if (arg === "--into") {
      into = argv[++i];
      if (!into) {
        console.error("--into requires a directory path argument");
        process.exit(2);
      }
    } else if (arg === "--validate-only") {
      validateOnly = true;
    } else if (!file && arg !== undefined && !arg.startsWith("--")) {
      file = arg;
    } else {
      console.error(`Unrecognized argument: ${arg}`);
      console.error(usage());
      process.exit(2);
    }
  }

  if (!file) {
    console.error(usage());
    process.exit(2);
  }
  if (!type || !isAssetType(type)) {
    console.error(`--type is required and must be one of: ${ASSET_TYPES.join(", ")}`);
    process.exit(2);
  }
  if (!into) {
    console.error("--into is required (target app directory)");
    process.exit(2);
  }

  return { file, type, into, validateOnly };
}

function resolvePath(spec: string): string {
  // Mirrors the harness CLI: npm workspace delegation runs with a cwd that
  // isn't the caller's original directory; INIT_CWD is npm's fallback for
  // the caller's real cwd, with process.cwd() as a direct-invoke fallback.
  return isAbsolute(spec) ? spec : resolve(process.env.INIT_CWD ?? process.cwd(), spec);
}

async function main(): Promise<void> {
  const { file, type, into, validateOnly } = parseArgs(process.argv.slice(2));
  const filePath = resolvePath(file);
  const intoPath = resolvePath(into);

  if (!existsSync(filePath)) {
    console.error(`File not found: ${file} (resolved: ${filePath})`);
    process.exit(2);
    return;
  }

  let report: ImportReport;
  try {
    report = validateOnly
      ? await validateAsset(filePath, type)
      : await importAsset(filePath, { type, into: intoPath });
  } catch (err) {
    console.error(`Failed to process "${file}":`);
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(2);
    return;
  }

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected asset-pipeline CLI error:");
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(2);
});
