import type { TerrainData } from "./terrain.js";
import type { MeshData } from "./mesh.js";
import type { MusicScore } from "./music.js";

const FNV_OFFSET = 0x811c9dc5;

function mixInt(h: number, n: number): number {
  h ^= n >>> 0;
  h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

function mixString(h: number, s: string): number {
  let out = h;
  for (let i = 0; i < s.length; i++) out = mixInt(out, s.charCodeAt(i));
  return out;
}

const floatBuf = new DataView(new ArrayBuffer(4));

/** Mix in the bit pattern of a float32 (stable across NaN/precision quirks
 *  in a way plain `mixInt(Math.round(n))` would not be). */
function mixFloat(h: number, n: number): number {
  floatBuf.setFloat32(0, n);
  return mixInt(h, floatBuf.getUint32(0));
}

function mixFloatArray(h: number, arr: Float32Array): number {
  let out = h;
  for (const v of arr) out = mixFloat(out, v);
  return out;
}

function mixUintArray(h: number, arr: Uint32Array): number {
  let out = h;
  for (const v of arr) out = mixInt(out, v);
  return out;
}

function isTerrainData(data: object): data is TerrainData {
  return "heights" in data && "resolution" in data && !("positions" in data);
}

function isMeshData(data: object): data is MeshData {
  return "positions" in data && "indices" in data && "triCount" in data;
}

/**
 * FNV-1a-style content hash over a canonical traversal of the asset's data
 * (mirrors the mixing style used by `@claude-engine/core`'s `hashString` and
 * `Sim.stateHash()`). Same input -> byte-identical output; the basis for the
 * package's determinism tests and CI goldens.
 */
export function hashAsset(data: TerrainData | MeshData | MusicScore | string): number {
  let h = FNV_OFFSET;

  if (typeof data === "string") {
    h = mixString(h, "svg");
    h = mixString(h, data);
    return h >>> 0;
  }

  if (isTerrainData(data)) {
    h = mixString(h, "terrain");
    h = mixInt(h, data.size);
    h = mixInt(h, data.resolution);
    h = mixFloatArray(h, data.heights);
    return h >>> 0;
  }

  if (isMeshData(data)) {
    h = mixString(h, "mesh");
    h = mixInt(h, data.triCount);
    h = mixFloatArray(h, data.positions);
    h = mixFloatArray(h, data.normals);
    h = mixUintArray(h, data.indices);
    if (data.colors) h = mixFloatArray(h, data.colors);
    return h >>> 0;
  }

  // MusicScore
  h = mixString(h, "score");
  h = mixInt(h, data.bpm);
  h = mixInt(h, data.lengthBeats);
  for (const track of data.tracks) {
    h = mixString(h, track.instrument);
    for (const note of track.notes) {
      h = mixFloat(h, note.beat);
      h = mixFloat(h, note.durationBeats);
      h = mixFloat(h, note.pitchHz);
      h = mixFloat(h, note.velocity);
    }
  }
  return h >>> 0;
}
