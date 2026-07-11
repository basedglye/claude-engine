/**
 * Shared types for the asset import pipeline (docs/PHASE-2.md, Scope C).
 *
 * Split out from index.ts so gate modules (gates/*.ts) can import these
 * without a circular dependency on index.ts, which itself imports the gates.
 */

export type AssetType = "texture" | "icon" | "mesh" | "audio";

export interface AssetBudgets {
  texture: { maxBytes: number; maxDim: number; requirePow2: boolean };
  icon: { maxBytes: number; maxDim: number };
  mesh: { maxBytes: number; maxTris: number; maxMaterials: number };
  audio: { maxBytes: number; maxSeconds: number };
}

/** v0 defaults — generous enough for small procedural/Codex-generated
 *  assets, tight enough to catch obviously oversized imports. */
export const DEFAULT_BUDGETS: AssetBudgets = {
  texture: { maxBytes: 2 * 1024 * 1024, maxDim: 2048, requirePow2: true },
  icon: { maxBytes: 256 * 1024, maxDim: 512 },
  mesh: { maxBytes: 5 * 1024 * 1024, maxTris: 20_000, maxMaterials: 8 },
  audio: { maxBytes: 10 * 1024 * 1024, maxSeconds: 120 },
};

export interface GateResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ImportReport {
  file: string;
  assetType: AssetType;
  passed: boolean;
  gates: GateResult[];
  /** Where the validated asset landed (absent on --validate-only or failure). */
  normalizedPath?: string;
}
