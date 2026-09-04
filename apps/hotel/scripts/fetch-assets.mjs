#!/usr/bin/env node
/**
 * Fetches the CC0 "real hotel" asset payload into apps/hotel/public/assets/.
 *
 * The manifest at apps/hotel/assets.manifest.json is the SERVED CONTRACT
 * (what `packages`/render code consumes: canonical names -> dir/path,
 * tileM, license). This script holds the DOWNLOAD side: where each item
 * actually comes from and how to unpack/rename it into the canonical
 * layout the manifest promises. Re-running is safe: anything already
 * present on disk is skipped.
 *
 * No npm dependencies. Zip extraction shells out to `unzip` (Git Bash /
 * PATH on this machine) with a PowerShell Expand-Archive fallback.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOTEL_ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(HOTEL_ROOT, "public", "assets");
const CACHE_DIR = path.join(ASSETS_DIR, ".cache");
const MANIFEST_SRC = path.join(HOTEL_ROOT, "assets.manifest.json");
const MANIFEST_OUT = path.join(ASSETS_DIR, "manifest.json");
const LICENSES_OUT = path.join(ASSETS_DIR, "LICENSES.md");

const manifest = JSON.parse(readFileSync(MANIFEST_SRC, "utf8"));

// -- download source table ---------------------------------------------------
// ambientCG texture sets: id -> zip at https://ambientcg.com/get?file=<id>_1K-JPG.zip
const AMBIENTCG = {
  "lobby-floor": "Marble014",
  "lobby-floor-border": "Marble006",
  "corridor-carpet": "Carpet012",
  "room-carpet": "Carpet016",
  "wall-lobby": "PaintedPlaster017",
  "wall-paper": "Wallpaper001A",
  "wall-corridor": "Plaster002",
  "ceiling": "Plaster001",
  "wood-trim": "Wood051",
  "wood-door": "Wood094",
  "desk-top": "Granite002A",
  "street": "PavingStones150",
  "facade": "Bricks100",
  "fabric": "Fabric030",
  "leather": "Leather037",
  "metal-brass": "Metal042A",
};

// Poly Haven models: canonical name -> Poly Haven asset id (1k gltf)
const POLYHAVEN_MODELS = {
  "bed-double": "GothicBed_01",
  "nightstand": "ClassicNightstand_01",
  "lamp-table": "desk_lamp_arm_01",
  "sofa": "Sofa_01",
  "armchair": "ArmChair_01",
  "coffee-table": "CoffeeTable_01",
  "side-table": "side_table_01",
  "plant": "potted_plant_01",
  "desk": "metal_office_desk",
  "chair": "WoodenChair_01",
  "wardrobe": "painted_wooden_cabinet",
  "painting": "fancy_picture_frame_01",
  "luggage": "vintage_suitcase",
  "chandelier": "Chandelier_01",
  "wall-sconce": "industrial_wall_sconce",
  "phone": "vintage_telephone_wall_clock",
  "cart": "industrial_storage_cart",
  "bin": "metal_trash_can",
};

const POLYHAVEN_HDRI = { name: "lobby", id: "hotel_room" };

// Kenney Furniture Kit fallbacks: canonical name -> glb inside the kit zip
const KENNEY_ZIP_URL =
  "https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip";
const KENNEY_MODELS = {
  "lamp-floor": "lampRoundFloor.glb",
  "tv": "televisionModern.glb",
  "minifridge": "kitchenFridgeSmall.glb",
};

// Characters: three.js example glbs (skinned, CC0/Mixamo-derived, redistributed
// under three.js's MIT-licensed examples tree).
const CHARACTERS = {
  "guest-a": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb",
  "guest-b": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb",
};

// Ordinary-human civilian fallback: Kenney Blocky Characters 2.0 (CC0), a single
// zip containing many rigged variants with idle/walk (and more) clips baked in.
// guest-c..guest-f each pull one variant GLB straight out of the zip.
const KENNEY_CHARACTERS_ZIP_URL =
  "https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip";
const KENNEY_CHARACTERS = {
  "guest-c": "character-a.glb",
  "guest-d": "character-f.glb",
  "guest-e": "character-j.glb",
  "guest-f": "character-p.glb",
};

const REQUIRED_MODELS = ["bed-double", "sofa", "armchair", "plant", "lamp-table"];

// -- helpers ------------------------------------------------------------------

function log(...args) {
  console.log(...args);
}

async function fetchWithRetry(url, { retries = 3, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: "follow", signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      clearTimeout(t);
      if (attempt < retries) {
        log(`  retry ${attempt}/${retries} for ${url} (${err.message})`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw new Error(`Failed after ${retries} attempts: ${url} — ${lastErr?.message}`);
}

async function downloadFile(url, destPath) {
  mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetchWithRetry(url);
  const body = Readable.fromWeb(res.body);
  await pipeline(body, createWriteStream(destPath));
  return statSync(destPath).size;
}

function unzip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const unzipTry = spawnSync("unzip", ["-o", "-q", zipPath, "-d", destDir], { stdio: "pipe" });
  if (unzipTry.status === 0) return;
  log("  unzip not available/failed, falling back to PowerShell Expand-Archive");
  const ps = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`],
    { stdio: "pipe" }
  );
  if (ps.status !== 0) {
    throw new Error(`Failed to extract ${zipPath}: ${ps.stderr?.toString() || unzipTry.stderr?.toString()}`);
  }
}

function fileExists(p) {
  return existsSync(p) && statSync(p).isFile();
}

const licenseEntries = [];

function recordLicense(name, sourceUrl, license, author) {
  licenseEntries.push({ name, sourceUrl, license, author: author || "" });
}

// -- textures -------------------------------------------------------------

async function fetchTexture(name, entry) {
  const dir = path.join(ASSETS_DIR, "textures", entry.dir);
  const colorPath = path.join(dir, "color.jpg");
  recordLicense(`texture: ${name}`, entry.source, entry.license, "ambientCG");
  if (fileExists(colorPath)) {
    log(`  [skip] texture ${name} already present`);
    return;
  }
  const id = AMBIENTCG[name];
  if (!id) throw new Error(`No ambientCG source configured for texture "${name}"`);
  const zipUrl = `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;
  const zipPath = path.join(CACHE_DIR, `${id}_1K-JPG.zip`);
  if (!fileExists(zipPath)) {
    log(`  downloading ${id} ...`);
    const bytes = await downloadFile(zipUrl, zipPath);
    log(`  downloaded ${id} (${bytes} bytes)`);
  }
  const extractDir = path.join(CACHE_DIR, `${id}_extract`);
  if (!existsSync(extractDir)) unzip(zipPath, extractDir);

  mkdirSync(dir, { recursive: true });
  const rename = {
    color: `${id}_1K-JPG_Color.jpg`,
    normal: `${id}_1K-JPG_NormalGL.jpg`,
    roughness: `${id}_1K-JPG_Roughness.jpg`,
    ao: `${id}_1K-JPG_AmbientOcclusion.jpg`,
  };
  for (const [canonical, srcName] of Object.entries(rename)) {
    const srcPath = path.join(extractDir, srcName);
    if (fileExists(srcPath)) {
      const { copyFileSync } = await import("node:fs");
      copyFileSync(srcPath, path.join(dir, `${canonical}.jpg`));
    } else if (canonical === "color") {
      throw new Error(`Missing required Color map for ${id} at ${srcPath}`);
    }
  }
  log(`  [ok] texture ${name} (${id})`);
}

// -- poly haven models ------------------------------------------------------

async function fetchPolyHavenModel(name, entry) {
  recordLicense(`model: ${name}`, entry.source, entry.license, "Poly Haven");
  const destDir = path.join(ASSETS_DIR, path.dirname(entry.path));
  const destGltf = path.join(ASSETS_DIR, entry.path);
  if (fileExists(destGltf)) {
    log(`  [skip] model ${name} already present`);
    return;
  }
  const id = POLYHAVEN_MODELS[name];
  const filesUrl = `https://api.polyhaven.com/files/${id}`;
  const res = await fetchWithRetry(filesUrl);
  const files = await res.json();
  // Poly Haven /files/<id> response: files.gltf is keyed by resolution
  // ("1k"/"2k"/"4k"), and each resolution entry is itself { gltf: {include,url} }.
  // Prefer 1k; fall back to whatever resolution exists.
  const resEntry = files.gltf?.["1k"] || files.gltf?.["2k"] || files.gltf?.["4k"] || files.gltf;
  const gltfInfo = resEntry?.gltf || resEntry;
  if (!gltfInfo?.url) throw new Error(`No gltf available for Poly Haven model ${id}`);

  mkdirSync(destDir, { recursive: true });
  const gltfDest = path.join(destDir, path.basename(entry.path));
  await downloadFile(gltfInfo.url, gltfDest);

  const includes = gltfInfo.include || {};
  for (const [relPath, info] of Object.entries(includes)) {
    const dest = path.join(destDir, relPath);
    await downloadFile(info.url, dest);
  }
  log(`  [ok] model ${name} (${id}, ${1 + Object.keys(includes).length} files)`);
}

// -- kenney fallback models ---------------------------------------------------

let kenneyZipPath = null;
let kenneyExtractDir = null;

async function ensureKenneyZip() {
  if (kenneyExtractDir) return kenneyExtractDir;
  kenneyZipPath = path.join(CACHE_DIR, "kenney_furniture-kit.zip");
  if (!fileExists(kenneyZipPath)) {
    log("  downloading Kenney Furniture Kit ...");
    const bytes = await downloadFile(KENNEY_ZIP_URL, kenneyZipPath);
    log(`  downloaded Kenney kit (${bytes} bytes)`);
  }
  kenneyExtractDir = path.join(CACHE_DIR, "kenney_extract");
  if (!existsSync(kenneyExtractDir)) unzip(kenneyZipPath, kenneyExtractDir);
  return kenneyExtractDir;
}

async function fetchKenneyModel(name, entry) {
  recordLicense(`model: ${name}`, entry.source, entry.license, "Kenney");
  const destPath = path.join(ASSETS_DIR, entry.path);
  if (fileExists(destPath)) {
    log(`  [skip] model ${name} already present`);
    return;
  }
  const extractDir = await ensureKenneyZip();
  const glbName = KENNEY_MODELS[name];
  const srcPath = path.join(extractDir, "Models", "GLTF format", glbName);
  if (!fileExists(srcPath)) throw new Error(`Kenney asset not found: ${srcPath}`);
  const { copyFileSync } = await import("node:fs");
  mkdirSync(path.dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
  log(`  [ok] model ${name} (Kenney: ${glbName})`);
}

// -- characters ---------------------------------------------------------------

let kenneyCharactersExtractDir = null;

async function ensureKenneyCharactersZip() {
  if (kenneyCharactersExtractDir) return kenneyCharactersExtractDir;
  const zipPath = path.join(CACHE_DIR, "kenney_blocky-characters.zip");
  if (!fileExists(zipPath)) {
    log("  downloading Kenney Blocky Characters ...");
    const bytes = await downloadFile(KENNEY_CHARACTERS_ZIP_URL, zipPath);
    log(`  downloaded Kenney Blocky Characters (${bytes} bytes)`);
  }
  kenneyCharactersExtractDir = path.join(CACHE_DIR, "kenney_characters_extract");
  if (!existsSync(kenneyCharactersExtractDir)) unzip(zipPath, kenneyCharactersExtractDir);
  return kenneyCharactersExtractDir;
}

async function fetchCharacter(name, entry) {
  const authorTag = KENNEY_CHARACTERS[name] ? "Kenney" : "three.js examples";
  recordLicense(`character: ${name}`, entry.source, entry.license, authorTag);
  const destPath = path.join(ASSETS_DIR, entry.path);
  if (fileExists(destPath)) {
    log(`  [skip] character ${name} already present`);
    return;
  }
  if (KENNEY_CHARACTERS[name]) {
    const extractDir = await ensureKenneyCharactersZip();
    const glbName = KENNEY_CHARACTERS[name];
    const srcPath = path.join(extractDir, "Models", "GLB format", glbName);
    if (!fileExists(srcPath)) throw new Error(`Kenney character asset not found: ${srcPath}`);
    const { copyFileSync } = await import("node:fs");
    mkdirSync(path.dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    // The Kenney GLBs reference their palette PNGs by relative path
    // ("Textures/texture-x.png"), so the folder must sit next to the glb.
    const texSrc = path.join(extractDir, "Models", "GLB format", "Textures");
    const texDest = path.join(path.dirname(destPath), "Textures");
    mkdirSync(texDest, { recursive: true });
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync(texSrc)) {
      if (!fileExists(path.join(texDest, f))) copyFileSync(path.join(texSrc, f), path.join(texDest, f));
    }
    log(`  [ok] character ${name} (Kenney: ${glbName}, +Textures/)`);
    return;
  }
  const url = CHARACTERS[name];
  if (!url) throw new Error(`No source configured for character "${name}"`);
  const bytes = await downloadFile(url, destPath);
  log(`  [ok] character ${name} (${bytes} bytes)`);
}

// -- env ------------------------------------------------------------------

async function fetchEnv(entry) {
  recordLicense("env: lobby", entry.source, entry.license, "Poly Haven");
  const destPath = path.join(ASSETS_DIR, entry.path);
  if (fileExists(destPath)) {
    log(`  [skip] env already present`);
    return;
  }
  const filesUrl = `https://api.polyhaven.com/files/${POLYHAVEN_HDRI.id}`;
  const res = await fetchWithRetry(filesUrl);
  const files = await res.json();
  const hdrInfo = files.hdri?.["1k"]?.hdr;
  if (!hdrInfo) throw new Error(`No 1k HDR for Poly Haven asset ${POLYHAVEN_HDRI.id}`);
  const bytes = await downloadFile(hdrInfo.url, destPath);
  log(`  [ok] env lobby.hdr (${bytes} bytes)`);
}

// -- glb clip inspection (sanity aid, not required for the fetch itself) -----

function readGlbClipNames(glbPath) {
  const buf = readFileSync(glbPath);
  if (buf.readUInt32LE(0) !== 0x46546c67) return null; // "glTF" magic
  const chunkLength = buf.readUInt32LE(12);
  const jsonChunk = buf.subarray(20, 20 + chunkLength);
  const json = JSON.parse(jsonChunk.toString("utf8"));
  return (json.animations || []).map((a) => a.name);
}

// -- main -----------------------------------------------------------------

async function main() {
  mkdirSync(ASSETS_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });

  log(`\n== Textures (${Object.keys(manifest.textures).length}) ==`);
  for (const [name, entry] of Object.entries(manifest.textures)) {
    await fetchTexture(name, entry);
  }

  log(`\n== Models (${Object.keys(manifest.models).length}) ==`);
  for (const [name, entry] of Object.entries(manifest.models)) {
    if (POLYHAVEN_MODELS[name]) {
      await fetchPolyHavenModel(name, entry);
    } else if (KENNEY_MODELS[name]) {
      await fetchKenneyModel(name, entry);
    } else {
      log(`  [warn] no source configured for model "${name}", skipping`);
    }
  }

  log(`\n== Characters (${Object.keys(manifest.characters).length}) ==`);
  for (const [name, entry] of Object.entries(manifest.characters)) {
    await fetchCharacter(name, entry);
  }
  // Report actual clip names found, so a mismatch against the manifest is visible.
  for (const [name, entry] of Object.entries(manifest.characters)) {
    const p = path.join(ASSETS_DIR, entry.path);
    if (fileExists(p)) {
      const clips = readGlbClipNames(p);
      log(`  clip names in ${name}: ${clips ? clips.join(", ") : "(unreadable)"}`);
    }
  }

  if (manifest.env) {
    log(`\n== Environment ==`);
    await fetchEnv(manifest.env);
  }

  // Clean up cache to keep payload lean (keep zips out of the served tree;
  // .cache/ lives under public/assets/ but is not referenced by the manifest).
  // Left in place intentionally so re-runs are fast; delete manually to reclaim space.

  log(`\n== Verifying manifest entries on disk ==`);
  let missing = 0;
  const requiredMissing = [];
  for (const [name, entry] of Object.entries(manifest.textures)) {
    const p = path.join(ASSETS_DIR, "textures", entry.dir, "color.jpg");
    if (!fileExists(p)) {
      missing++;
      requiredMissing.push(`texture:${name}`);
      log(`  MISSING texture ${name}: ${p}`);
    }
  }
  for (const [name, entry] of Object.entries(manifest.models)) {
    const p = path.join(ASSETS_DIR, entry.path);
    if (!fileExists(p)) {
      missing++;
      if (REQUIRED_MODELS.includes(name)) requiredMissing.push(`model:${name}`);
      log(`  MISSING model ${name}: ${p}`);
    }
  }
  let charactersOk = 0;
  for (const [name, entry] of Object.entries(manifest.characters)) {
    const p = path.join(ASSETS_DIR, entry.path);
    if (!fileExists(p)) {
      missing++;
      log(`  MISSING character ${name}: ${p}`);
    } else {
      charactersOk++;
    }
  }
  if (charactersOk === 0) requiredMissing.push("characters:*");
  if (manifest.env) {
    const p = path.join(ASSETS_DIR, manifest.env.path);
    if (!fileExists(p)) {
      missing++;
      requiredMissing.push("env");
      log(`  MISSING env: ${p}`);
    }
  }

  // Write the served manifest (copy of the committed source of truth).
  writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  log(`\nWrote ${MANIFEST_OUT}`);

  // Write LICENSES.md
  const lines = ["# Asset licenses\n", "All assets below are CC0 (public domain) unless noted otherwise.\n"];
  for (const e of licenseEntries) {
    lines.push(`- **${e.name}** — [source](${e.sourceUrl}) — ${e.license}${e.author ? ` — author/publisher: ${e.author}` : ""}`);
  }
  writeFileSync(LICENSES_OUT, lines.join("\n") + "\n");
  log(`Wrote ${LICENSES_OUT}`);

  const textureCount = Object.keys(manifest.textures).length;
  const modelCount = Object.keys(manifest.models).length;
  const charCount = Object.keys(manifest.characters).length;
  log(`\n== Summary ==`);
  log(`Textures: ${textureCount - requiredMissing.filter((s) => s.startsWith("texture:")).length}/${textureCount}`);
  log(`Models: ${modelCount - requiredMissing.filter((s) => s.startsWith("model:")).length}/${modelCount}`);
  log(`Characters: ${charactersOk}/${charCount}`);
  log(`Env: ${manifest.env && fileExists(path.join(ASSETS_DIR, manifest.env.path)) ? "ok" : "missing"}`);
  log(`Total missing entries: ${missing}`);

  if (requiredMissing.length > 0) {
    console.error(`\nFATAL: required assets missing: ${requiredMissing.join(", ")}`);
    process.exit(1);
  }
  log("\nAll required assets present.");
}

main().catch((err) => {
  console.error("FATAL:", err.stack || err.message);
  process.exit(1);
});
