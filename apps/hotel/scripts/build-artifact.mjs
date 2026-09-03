#!/usr/bin/env node
/**
 * Builds `apps/hotel/dist-artifact/grand-foyer.html` (or the path given
 * via `--out`): a single self-contained HTML file with all JS/CSS
 * inlined and the four Kenney guest characters (glb + textures) embedded
 * as data: URIs behind a `fetch` shim, so the page runs from `file://`
 * with zero network requests -- the shim SEALS `/assets/**`: any request
 * under that prefix is answered from the embedded map or gets a
 * synthetic 404, it never reaches the real `fetch`.
 *
 * PRECONDITION: this script does NOT run `npm run build -w apps/hotel`
 * itself — it requires `apps/hotel/dist/` to already exist (run
 * `npm run build -w apps/hotel` first). If `dist/` is missing it fails
 * loudly rather than silently building a stale or wrong bundle. It also
 * refuses to run if anything under `apps/hotel/src/` is newer than
 * `dist/index.html` — a stale `dist/` from an earlier session must not
 * silently produce a stale artifact.
 *
 * Determinism: no timestamps, no random ids, no Date.now() anywhere in
 * the emitted output. Re-running against an identical `dist/` produces a
 * byte-identical file.
 *
 * Usage: node apps/hotel/scripts/build-artifact.mjs [--out <path>] [--copy-to-dist] [--fragment <path>]
 *   --fragment <path> Also write the artifact as a wrapper-free fragment
 *                    (<title> + head children + body children, no
 *                    doctype/html/head/body/meta) for hosts that supply
 *                    their own document skeleton -- the claude.ai Artifact
 *                    tool. Only the two real <meta> tags are removed;
 *                    script content is never touched (a regex over the
 *                    whole head once ate every "<metalnessmap_pars_fragment>"
 *                    shader include and left only the sky rendering).
 *   --out <path>     Write the artifact to <path> instead of
 *                     apps/hotel/dist-artifact/grand-foyer.html (e.g. so
 *                     the orchestrator can publish the same file
 *                     elsewhere). Parent directories are created as needed.
 *   --copy-to-dist    After the artifact is successfully written (and only
 *                     then), also copy it byte-for-byte to
 *                     apps/hotel/dist/play.html so the Vite output directory
 *                     serves both products. Off by default: a plain artifact
 *                     build must never silently write into dist/, which is
 *                     Vite's output. Runs in the same process, after the
 *                     freshness check above, so a stale dist/ that would
 *                     produce a stale artifact fails before any copy is
 *                     attempted. If the copy itself fails, the script exits
 *                     non-zero naming both paths and does not leave a
 *                     partial file at the destination.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync, unlinkSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOTEL_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(HOTEL_ROOT, "dist");
const SRC_DIR = path.join(HOTEL_ROOT, "src");
const DEFAULT_OUT_FILE = path.join(HOTEL_ROOT, "dist-artifact", "grand-foyer.html");
const DIST_PLAY_FILE = path.join(DIST_DIR, "play.html");

function parseArgs(argv) {
  let out = DEFAULT_OUT_FILE;
  let copyToDist = false;
  let fragment = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const val = argv[i + 1];
      if (!val) fail("--out requires a path argument");
      out = path.resolve(val);
      i++;
    } else if (argv[i] === "--fragment") {
      const val = argv[i + 1];
      if (!val) fail("--fragment requires a path argument");
      fragment = path.resolve(val);
      i++;
    } else if (argv[i] === "--copy-to-dist") {
      copyToDist = true;
    }
  }
  return { out, copyToDist, fragment };
}

const { out: OUT_FILE, copyToDist: COPY_TO_DIST, fragment: FRAGMENT_FILE } = parseArgs(process.argv.slice(2));

/** The wrapper-free fragment described under --fragment. */
function toFragment(html) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html);
  const body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(html);
  if (!head || !body) fail("--fragment: could not find <head> and <body> in the built artifact");
  let h = head[1];
  for (const tag of h.match(/<meta (?:charset|name="viewport")[^>]*>/g) ?? []) h = h.replace(tag, "");
  h = h.replace(/<title>[\s\S]*?<\/title>/, "");
  const frag = "<title>GRAND FOYER</title>
" + h + "
" + body[1];
  if (!frag.includes("<metalnessmap_pars_fragment>")) fail("--fragment: shader includes missing from the fragment (stripping damaged script content)");
  return frag;
}
const OUT_DIR = path.dirname(OUT_FILE);

// Perturbable for the non-vacuity check (§6.2 of the W4 brief).
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

const CHARACTER_NAMES = ["guest-c", "guest-d", "guest-e", "guest-f"];

function fail(msg) {
  console.error(`build-artifact: ${msg}`);
  process.exit(1);
}

/** Newest mtimeMs of any file under `dir`, recursively. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

if (!existsSync(DIST_DIR) || !existsSync(path.join(DIST_DIR, "index.html"))) {
  fail(
    `apps/hotel/dist/ is missing or has no index.html. Run ` +
      `"npm run build -w apps/hotel" first, then re-run this script.`
  );
}

if (existsSync(SRC_DIR)) {
  const srcNewest = newestMtime(SRC_DIR);
  const distIndexMtime = statSync(path.join(DIST_DIR, "index.html")).mtimeMs;
  if (srcNewest > distIndexMtime) {
    fail(
      `apps/hotel/dist/ is stale: a file under apps/hotel/src/ is newer ` +
        `(mtime ${new Date(srcNewest).toISOString()}) than dist/index.html ` +
        `(mtime ${new Date(distIndexMtime).toISOString()}). Run ` +
        `"npm run build -w apps/hotel" again, then re-run this script.`
    );
  }
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".glb":
      return "model/gltf-binary";
    case ".png":
      return "image/png";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function toDataUri(filePath) {
  const buf = readFileSync(filePath);
  return `data:${mimeFor(filePath)};base64,${buf.toString("base64")}`;
}

// -- 1. Read dist/index.html, inline scripts + stylesheets ------------------

const indexPath = path.join(DIST_DIR, "index.html");
let html = readFileSync(indexPath, "utf8");

let inlinedAssetCount = 0;

// Inline <link rel="stylesheet" href="...">
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g,
  (match, href) => {
    if (/^https?:\/\//.test(href)) return match; // leave remote CDN css alone (none expected)
    const filePath = path.join(DIST_DIR, href.replace(/^\//, ""));
    if (!existsSync(filePath)) fail(`stylesheet referenced but not found: ${href}`);
    const css = readFileSync(filePath, "utf8");
    inlinedAssetCount++;
    return `<style>\n${css}\n</style>`;
  }
);

// Inline <script type="module" ... src="...">
html = html.replace(
  /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"\s*><\/script>/g,
  (match, src) => {
    if (/^https?:\/\//.test(src)) return match;
    const filePath = path.join(DIST_DIR, src.replace(/^\//, ""));
    if (!existsSync(filePath)) fail(`script referenced but not found: ${src}`);
    const js = readFileSync(filePath, "utf8");
    inlinedAssetCount++;
    return `<script type="module">\n${js}\n</script>`;
  }
);
// Fallback pattern in case attribute order differs.
html = html.replace(
  /<script\s+([^>]*\bsrc="([^"]+)"[^>]*)><\/script>/g,
  (match, attrs, src) => {
    if (/^https?:\/\//.test(src)) return match;
    if (!/type="module"/.test(attrs)) return match; // already handled or not ours
    const filePath = path.join(DIST_DIR, src.replace(/^\//, ""));
    if (!existsSync(filePath)) return match;
    const js = readFileSync(filePath, "utf8");
    inlinedAssetCount++;
    return `<script type="module">\n${js}\n</script>`;
  }
);

// -- 2. Build the embedded asset map (characters glb + textures + reduced manifest) --

const CHAR_DIR = path.join(HOTEL_ROOT, "public", "assets", "characters");
const TEX_DIR = path.join(CHAR_DIR, "Textures");

/** @type {Record<string,string>} maps "/assets/<...>" -> data: URI */
const assetMap = {};
let embeddedBytes = 0;
let embeddedCount = 0;

function embed(assetPath, absPath) {
  if (!existsSync(absPath)) fail(`expected asset not found: ${absPath}`);
  const uri = toDataUri(absPath);
  assetMap[assetPath] = uri;
  embeddedBytes += statSync(absPath).size;
  embeddedCount++;
}

for (const name of CHARACTER_NAMES) {
  embed(`/assets/characters/${name}.glb`, path.join(CHAR_DIR, `${name}.glb`));
}

if (existsSync(TEX_DIR)) {
  for (const file of readdirSync(TEX_DIR).sort()) {
    if (!file.toLowerCase().endsWith(".png")) continue;
    embed(`/assets/characters/Textures/${file}`, path.join(TEX_DIR, file));
  }
}

// Self-containment check (part of step 5's assertion): every asset that
// exists on disk under the character/texture roots must have made it into
// assetMap. This is what catches an asset being skipped during embedding,
// independent of the outer-HTML src=/href= scan below (textures are never
// referenced by HTML attributes — only from inside the GLB binary and at
// runtime by the fetch shim).
const requiredAssetPaths = CHARACTER_NAMES.map((name) => `/assets/characters/${name}.glb`);
if (existsSync(TEX_DIR)) {
  for (const file of readdirSync(TEX_DIR).sort()) {
    if (!file.toLowerCase().endsWith(".png")) continue;
    requiredAssetPaths.push(`/assets/characters/Textures/${file}`);
  }
}
for (const requiredPath of requiredAssetPaths) {
  if (!Object.prototype.hasOwnProperty.call(assetMap, requiredPath)) {
    fail(`self-containment: required asset was not embedded: ${requiredPath}`);
  }
}

// Reduced manifest: only the `characters` section, empty textures/models, no env.
const fullManifestPath = path.join(HOTEL_ROOT, "assets.manifest.json");
if (!existsSync(fullManifestPath)) fail(`assets.manifest.json not found at ${fullManifestPath}`);
const fullManifest = JSON.parse(readFileSync(fullManifestPath, "utf8"));
const reducedManifest = {
  textures: {},
  models: {},
  characters: fullManifest.characters ?? {},
};
const manifestJson = JSON.stringify(reducedManifest);
assetMap["/assets/manifest.json"] = `data:application/json;base64,${Buffer.from(manifestJson, "utf8").toString("base64")}`;
embeddedBytes += Buffer.byteLength(manifestJson, "utf8");
embeddedCount++;

// -- 3. Inject the fetch shim before the bundled script ----------------------

const shimSource = `
<script>
(function () {
  var ASSET_MAP = ${JSON.stringify(assetMap)};
  var MIME = ${JSON.stringify({
    ".glb": "model/gltf-binary",
    ".png": "image/png",
    ".json": "application/json",
  })};
  function mimeForPath(p) {
    var dot = p.lastIndexOf(".");
    var ext = dot >= 0 ? p.slice(dot) : "";
    return MIME[ext] || "application/octet-stream";
  }
  function dataUriToBytes(uri) {
    var comma = uri.indexOf(",");
    var b64 = uri.slice(comma + 1);
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url;
    if (url) {
      var pathname;
      try {
        pathname = new URL(url, window.location.href).pathname;
      } catch (e) {
        pathname = url;
      }
      // On file:// URLs an absolute "/assets/..." fetch resolves against
      // the drive root (e.g. pathname "/C:/assets/manifest.json" on
      // Windows), not against "/assets/...", so find the "/assets/"
      // segment wherever it lands rather than requiring index 0.
      var assetIdx = pathname.indexOf("/assets/");
      if (assetIdx >= 0) {
        // SEALED: any request under /assets/ is answered from the map or
        // rejected here -- it never reaches the real fetch. Without this,
        // "no external fetches" is an accident of what the current
        // manifest happens to reference rather than something the shim
        // enforces; one added code path or one glTF with an unexpected
        // relative texture reference would otherwise phone home silently.
        var key = pathname.slice(assetIdx);
        if (Object.prototype.hasOwnProperty.call(ASSET_MAP, key)) {
          try {
            var bytes = dataUriToBytes(ASSET_MAP[key]);
            var body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            return Promise.resolve(
              new Response(body, {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": mimeForPath(key) },
              })
            );
          } catch (e) {
            return Promise.resolve(new Response(null, { status: 500, statusText: "shim decode error" }));
          }
        }
        return Promise.resolve(new Response(null, { status: 404, statusText: "Not Found (sealed /assets/ shim)" }));
      }
    }
    return realFetch(input, init);
  };
})();
</script>
`;

html = html.replace(/<script type="module">/, `${shimSource}\n<script type="module">`);

// -- 4. Write output, then assert size + self-containment -------------------

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html, "utf8");

const finalSize = statSync(OUT_FILE).size;
if (finalSize > MAX_BYTES) {
  fail(
    `artifact is ${(finalSize / (1024 * 1024)).toFixed(2)} MB, which exceeds the ` +
      `${(MAX_BYTES / (1024 * 1024)).toFixed(2)} MB limit (actual size: ${finalSize} bytes).`
  );
}

// No remaining src=/href= attribute pointing at a relative local path.
const attrRe = /\b(?:src|href)="([^"]+)"/g;
let m;
const offenders = [];
while ((m = attrRe.exec(html))) {
  const val = m[1];
  if (val.startsWith("data:") || val.startsWith("#") || /^https?:\/\//.test(val) || val.startsWith("mailto:")) {
    continue;
  }
  offenders.push(val);
}
if (offenders.length > 0) {
  fail(
    `artifact still references a relative local path: ${offenders[0]} ` +
      `(${offenders.length} total). Every asset must be inlined or data:-embedded.`
  );
}

console.log(`build-artifact: wrote ${OUT_FILE}`);
console.log(`build-artifact: size = ${(finalSize / (1024 * 1024)).toFixed(2)} MB (${finalSize} bytes)`);
console.log(`build-artifact: embedded assets = ${embeddedCount} (${(embeddedBytes / (1024 * 1024)).toFixed(2)} MB raw)`);
console.log(`build-artifact: inlined script/style tags = ${inlinedAssetCount}`);

// -- 5. Optional: copy the artifact into dist/play.html ----------------------

if (FRAGMENT_FILE) {
  const frag = toFragment(readFileSync(OUT_FILE, "utf8"));
  mkdirSync(path.dirname(FRAGMENT_FILE), { recursive: true });
  writeFileSync(FRAGMENT_FILE, frag);
  console.log(`build-artifact: wrote fragment ${FRAGMENT_FILE} (${Buffer.byteLength(frag)} bytes)`);
}

if (COPY_TO_DIST) {
  try {
    if (!existsSync(DIST_DIR)) {
      fail(`--copy-to-dist: apps/hotel/dist/ does not exist (${DIST_DIR}); cannot copy into it.`);
    }
    copyFileSync(OUT_FILE, DIST_PLAY_FILE);
    const copiedSize = statSync(DIST_PLAY_FILE).size;
    if (copiedSize !== finalSize) {
      // Refuse rather than half-succeed: remove the partial/incorrect copy.
      try {
        unlinkSync(DIST_PLAY_FILE);
      } catch {
        /* best effort */
      }
      fail(
        `--copy-to-dist: copy size mismatch: ${OUT_FILE} is ${finalSize} bytes but ` +
          `${DIST_PLAY_FILE} is ${copiedSize} bytes after copy. Removed the partial copy.`
      );
    }
    console.log(`build-artifact: copied to apps/hotel/dist/play.html (${copiedSize} bytes)`);
  } catch (err) {
    if (err && err.__buildArtifactFailAlreadyReported) throw err;
    fail(
      `--copy-to-dist: failed to copy ${OUT_FILE} to ${DIST_PLAY_FILE}: ${err && err.message ? err.message : err}`
    );
  }
}
