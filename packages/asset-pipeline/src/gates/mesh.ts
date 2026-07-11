/**
 * mesh gate — glTF `.glb` / `.gltf` (docs/PHASE-2.md, Scope C).
 *
 * A minimal hand-rolled JSON-chunk reader is explicitly stated as sufficient
 * by the spec: no heavy runtime glTF/three.js dependency is pulled in here.
 * Triangle/material counts are read straight from accessor and array
 * metadata — the validator trusts those numbers (does not cross-check them
 * against actual buffer byte lengths), which is also an explicit v0
 * allowance ("free to hand-construct a fixture whose accessor counts report
 * a triangle count over budget").
 */
import { statSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AssetBudgets, GateResult } from "../types.js";

const TRIANGLES_MODE = 4;

interface GltfAccessor {
  count: number;
}

interface GltfPrimitive {
  mode?: number;
  indices?: number;
  attributes?: { POSITION?: number; [key: string]: number | undefined };
}

interface GltfMesh {
  primitives?: GltfPrimitive[];
}

interface GltfDocument {
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  materials?: unknown[];
}

/** glTF binary container: 12-byte header (magic "glTF", uint32 version,
 *  uint32 total length), then a sequence of chunks, each a 4-byte length +
 *  4-byte ASCII type + payload. The JSON chunk (type "JSON") always comes
 *  first per spec; a trailing "BIN\0" chunk (if present) is ignored here —
 *  we only need the JSON to count triangles/materials. */
function parseGlb(buf: Buffer): GltfDocument {
  if (buf.length < 12) {
    throw new Error("file too short for a glTF binary header");
  }
  const magic = buf.toString("ascii", 0, 4);
  if (magic !== "glTF") {
    throw new Error(`bad magic "${magic}", expected "glTF"`);
  }
  const declaredLength = buf.readUInt32LE(8);
  if (declaredLength > buf.length) {
    throw new Error(`declared length ${declaredLength} exceeds file size ${buf.length}`);
  }

  let offset = 12;
  let jsonChunk: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const chunkLength = buf.readUInt32LE(offset);
    const chunkType = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > buf.length) break;
    if (chunkType === "JSON" && !jsonChunk) {
      jsonChunk = buf.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  if (!jsonChunk) {
    throw new Error("no JSON chunk found in glTF binary container");
  }
  return JSON.parse(jsonChunk.toString("utf8")) as GltfDocument;
}

function parseGltf(buf: Buffer): GltfDocument {
  return JSON.parse(buf.toString("utf8")) as GltfDocument;
}

/** Sums triangle counts across all TRIANGLES-mode primitives: prefer the
 *  indices accessor's count / 3, and fall back to POSITION accessor count /
 *  3 for non-indexed primitives. Non-TRIANGLES primitive modes (strips,
 *  fans, points, lines) are best-effort skipped in v0 — see PHASE-2.md
 *  Scope C, which explicitly allows an approximation here. */
function countTriangles(doc: GltfDocument): number {
  const accessors = doc.accessors ?? [];
  let total = 0;
  for (const mesh of doc.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? TRIANGLES_MODE;
      if (mode !== TRIANGLES_MODE) continue;
      if (prim.indices !== undefined && accessors[prim.indices]) {
        total += Math.floor(accessors[prim.indices]!.count / 3);
      } else if (prim.attributes?.POSITION !== undefined && accessors[prim.attributes.POSITION]) {
        total += Math.floor(accessors[prim.attributes.POSITION]!.count / 3);
      }
    }
  }
  return total;
}

export function validateMesh(file: string, budgets: AssetBudgets["mesh"]): GateResult[] {
  const gates: GateResult[] = [];
  const buf = readFileSync(file);
  const ext = extname(file).toLowerCase();

  const size = statSync(file).size;
  gates.push({
    name: "size",
    passed: size <= budgets.maxBytes,
    detail: `${size} bytes (budget ${budgets.maxBytes})`,
  });

  let doc: GltfDocument | undefined;
  let formatDetail: string;
  try {
    if (ext === ".glb") {
      doc = parseGlb(buf);
      formatDetail = "valid glTF binary container (.glb) with a readable JSON chunk";
    } else if (ext === ".gltf") {
      doc = parseGltf(buf);
      formatDetail = "valid glTF JSON (.gltf)";
    } else {
      formatDetail = `unsupported mesh extension "${ext}"; expected .glb or .gltf`;
    }
  } catch (err) {
    formatDetail = `failed to parse as glTF: ${err instanceof Error ? err.message : String(err)}`;
  }
  gates.push({ name: "format", passed: doc !== undefined, detail: formatDetail });

  if (doc) {
    const triCount = countTriangles(doc);
    gates.push({
      name: "triCount",
      passed: triCount <= budgets.maxTris,
      detail: `${triCount} triangles (max ${budgets.maxTris})`,
    });

    const materialCount = (doc.materials ?? []).length;
    gates.push({
      name: "materialCount",
      passed: materialCount <= budgets.maxMaterials,
      detail: `${materialCount} materials (max ${budgets.maxMaterials})`,
    });
  }

  return gates;
}
