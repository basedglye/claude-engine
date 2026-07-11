/**
 * @claude-engine/asset-pipeline — the gate every externally-produced asset
 * (Codex-generated images, eventually Blender-exported meshes) must pass
 * through before entering a game. (docs/PHASE-2.md, Scope C; see
 * docs/DESIGN.md "Procedural asset layer".)
 *
 * Node-targeted tooling package — unlike packages/core and packages/assets'
 * pure root, this package is free to use Node built-ins (fs, path); none of
 * the sim-purity restrictions apply here.
 */
import { statSync, existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { validateTexture } from "./gates/texture.js";
import { validateMesh } from "./gates/mesh.js";
import { validateAudio } from "./gates/audio.js";
import type { AssetType, AssetBudgets, GateResult, ImportReport } from "./types.js";
import { DEFAULT_BUDGETS } from "./types.js";

export type { AssetType, AssetBudgets, GateResult, ImportReport };
export { DEFAULT_BUDGETS };

function mergeBudgets(base: AssetBudgets, partial?: Partial<AssetBudgets>): AssetBudgets {
  if (!partial) return base;
  return {
    texture: { ...base.texture, ...partial.texture },
    icon: { ...base.icon, ...partial.icon },
    mesh: { ...base.mesh, ...partial.mesh },
    audio: { ...base.audio, ...partial.audio },
  };
}

/**
 * Runs the validation gates for `type` against `file` and returns a report.
 * Never copies or writes anything — pure read-only check.
 *
 * Throws if `file` cannot be read at all (missing / permission error). That
 * is a different failure mode than "gates failed" (which is a normal,
 * fully-reported outcome with `passed: false`) — the CLI maps a thrown error
 * here to exit 2 ("unreadable file"), and a returned report with
 * `passed: false` to exit 1 ("gate failed").
 */
export async function validateAsset(
  file: string,
  type: AssetType,
  budgets?: Partial<AssetBudgets>
): Promise<ImportReport> {
  if (!existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }
  statSync(file); // throws on e.g. permission errors

  const merged = mergeBudgets(DEFAULT_BUDGETS, budgets);
  let gates: GateResult[];
  switch (type) {
    case "texture":
      gates = validateTexture(file, "texture", merged);
      break;
    case "icon":
      gates = validateTexture(file, "icon", merged);
      break;
    case "mesh":
      gates = validateMesh(file, merged.mesh);
      break;
    case "audio":
      gates = validateAudio(file, merged.audio);
      break;
  }

  return { file, assetType: type, passed: gates.every((g) => g.passed), gates };
}

interface ManifestEntry {
  file: string;
  type: AssetType;
  importedAt: string;
}

/**
 * Validates `file`, and if every gate passes, copies it into
 * `<opts.into>/assets/` and appends an entry to
 * `<opts.into>/assets/manifest.json`. Does not copy or touch the manifest
 * if any gate fails — the returned report explains why (see `gates`).
 */
export async function importAsset(
  file: string,
  opts: { type: AssetType; into: string; budgets?: Partial<AssetBudgets> }
): Promise<ImportReport> {
  const report = await validateAsset(file, opts.type, opts.budgets);
  if (!report.passed) return report;

  const assetsDir = join(opts.into, "assets");
  mkdirSync(assetsDir, { recursive: true });
  const destName = basename(file);
  const destPath = join(assetsDir, destName);
  copyFileSync(file, destPath);

  const manifestPath = join(assetsDir, "manifest.json");
  let manifest: ManifestEntry[] = [];
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (Array.isArray(parsed)) manifest = parsed as ManifestEntry[];
    } catch {
      // Corrupt/foreign manifest.json — start a fresh array rather than
      // failing the import; this is tooling bookkeeping, not sim state.
      manifest = [];
    }
  }
  manifest.push({ file: destName, type: opts.type, importedAt: new Date().toISOString() });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { ...report, normalizedPath: destPath };
}
