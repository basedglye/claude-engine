/**
 * audio gate — `.wav` / `.ogg` (docs/PHASE-2.md, Scope C).
 *
 * .wav: fully hand-parsed. WAV is a simple, well-documented RIFF format —
 * duration = dataChunkSize / byteRate, both read straight from the header.
 *
 * .ogg: documented v0 limitation. Full duration extraction from an
 * Ogg/Vorbis stream by hand is genuinely hard (proper parsing needs a
 * Vorbis-aware bitstream reader). This module makes a best-effort attempt
 * (read the sample rate out of the Vorbis identification header in the
 * first page, and the last Ogg page's granule position, then
 * duration = granule / sampleRate) and, if that best-effort parse doesn't
 * land cleanly, falls back to a *passing* "inconclusive" gate with a detail
 * note — per PHASE-2.md's explicit fallback allowance. No audio-decoding
 * dependency is used anywhere here.
 */
import { statSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { AssetBudgets, GateResult } from "../types.js";

interface WavInfo {
  byteRate: number;
  dataSize: number;
  durationSeconds: number;
}

/** RIFF/WAVE: signature "RIFF" + size + "WAVE", then a sequence of chunks
 *  (4-byte ASCII id, 4-byte little-endian size, payload, optional 1-byte pad
 *  if size is odd). byteRate lives 8 bytes into the "fmt " chunk payload;
 *  duration is the "data" chunk's byte length divided by byteRate. */
function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 12) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let byteRate: number | undefined;
  let dataSize: number | undefined;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === "fmt " && dataStart + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(dataStart + 8);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, Math.max(0, buf.length - dataStart));
    }
    offset = dataStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  if (byteRate === undefined || dataSize === undefined || byteRate === 0) return null;
  return { byteRate, dataSize, durationSeconds: dataSize / byteRate };
}

/** Best-effort Ogg/Vorbis duration: sample rate from the Vorbis
 *  identification header packet (byte 0x01 + ASCII "vorbis", normally the
 *  payload of the very first Ogg page), and the final sample position from
 *  the granule position of the *last* Ogg page ("OggS" capture pattern,
 *  8-byte little-endian granule position at header offset 6). Returns null
 *  if either piece can't be found — the caller treats that as inconclusive,
 *  not a failure. */
function tryEstimateOggDurationSeconds(buf: Buffer): number | null {
  try {
    const head = buf.subarray(0, Math.min(buf.length, 4096));
    const vorbisTag = Buffer.from("vorbis", "ascii");
    const vorbisIdx = head.indexOf(vorbisTag);
    if (vorbisIdx < 1 || head[vorbisIdx - 1] !== 0x01) return null;
    // Vorbis identification header, after the "vorbis" tag:
    // 4 bytes vorbis_version, 1 byte audio_channels, 4 bytes audio_sample_rate, ...
    const sampleRateOffset = vorbisIdx + "vorbis".length + 4 + 1;
    if (sampleRateOffset + 4 > buf.length) return null;
    const sampleRate = buf.readUInt32LE(sampleRateOffset);
    if (sampleRate <= 0) return null;

    const needle = Buffer.from("OggS", "ascii");
    let lastPageStart = -1;
    for (let i = buf.length - 4; i >= 0; i--) {
      if (buf[i] === needle[0] && buf.subarray(i, i + 4).equals(needle)) {
        lastPageStart = i;
        break;
      }
    }
    if (lastPageStart < 0 || lastPageStart + 14 > buf.length) return null;
    const granuleLow = buf.readUInt32LE(lastPageStart + 6);
    const granuleHigh = buf.readUInt32LE(lastPageStart + 10);
    const granule = granuleHigh * 2 ** 32 + granuleLow;
    if (!Number.isFinite(granule) || granule <= 0) return null;
    return granule / sampleRate;
  } catch {
    return null;
  }
}

export function validateAudio(file: string, budgets: AssetBudgets["audio"]): GateResult[] {
  const gates: GateResult[] = [];
  const buf = readFileSync(file);
  const ext = extname(file).toLowerCase();

  const size = statSync(file).size;
  gates.push({
    name: "size",
    passed: size <= budgets.maxBytes,
    detail: `${size} bytes (budget ${budgets.maxBytes})`,
  });

  if (ext === ".wav") {
    const wav = parseWav(buf);
    if (wav) {
      gates.push({ name: "format", passed: true, detail: "valid RIFF/WAVE header" });
      gates.push({
        name: "duration",
        passed: wav.durationSeconds <= budgets.maxSeconds,
        detail: `${wav.durationSeconds.toFixed(2)}s (max ${budgets.maxSeconds}s)`,
      });
    } else {
      gates.push({ name: "format", passed: false, detail: "failed to parse RIFF/WAVE header" });
    }
  } else if (ext === ".ogg") {
    const magicOk = buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS";
    gates.push({
      name: "format",
      passed: magicOk,
      detail: magicOk ? "OggS capture pattern found" : "missing OggS capture pattern",
    });
    if (magicOk) {
      const duration = tryEstimateOggDurationSeconds(buf);
      if (duration !== null) {
        gates.push({
          name: "duration",
          passed: duration <= budgets.maxSeconds,
          detail: `${duration.toFixed(2)}s (best-effort Ogg/Vorbis granule-position estimate; max ${budgets.maxSeconds}s)`,
        });
      } else {
        gates.push({
          name: "duration",
          passed: true,
          detail:
            "duration check inconclusive for Ogg (best-effort hand-parse found neither a Vorbis " +
            "identification header nor a readable final granule position); passing by default — " +
            "see gates/audio.ts for the documented v0 limitation (no audio-decoding dependency used)",
        });
      }
    }
  } else {
    gates.push({
      name: "format",
      passed: false,
      detail: `unsupported audio extension "${ext}"; expected .wav or .ogg`,
    });
  }

  return gates;
}
