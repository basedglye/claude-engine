# `@claude-engine/assets` and `@claude-engine/asset-pipeline` reference

## `@claude-engine/assets` — procedural generators

Two entry points. The pure root (`.`) has zero DOM/Three.js/Node imports —
same purity rules as `packages/core`, enforced the same way (ESLint +
`check-purity.mjs`, on `packages/assets/src/**` excluding `src/web/**`) —
and is safe to import from sim code. The `/web` subpath adapts pure data for
the browser and may import `three`/DOM/WebAudio.

```ts
// Pure root — "@claude-engine/assets"
function generateTerrain(rng: Rng, opts: TerrainOptions): TerrainData;
function heightAt(terrain: TerrainData, x: number, z: number): number;   // bilinear sample, clamped

function generateCreatureMesh(rng: Rng, opts?: CreatureOptions): MeshData;
function generatePropMesh(rng: Rng, kind: "rock" | "tree" | "crystal", opts?: PropOptions): MeshData;
// MeshData: { positions, normals, indices, colors?: Float32Array, triCount } — plain typed arrays, low-poly

function generateIconSvg(rng: Rng, opts?: IconOptions): string;          // deterministic, self-contained SVG

function generateScore(rng: Rng, opts?: ScoreOptions): MusicScore;       // bpm/tracks/notes — plain data

function hashAsset(data: TerrainData | MeshData | MusicScore | string): number;  // content hash for determinism tests
```

```ts
// Web adapter — "@claude-engine/assets/web"
function terrainToGeometry(terrain: TerrainData): THREE.BufferGeometry;
function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry;
function svgToTexture(svg: string, sizePx?: number): Promise<THREE.Texture>;
function playScore(score: MusicScore, ctx: AudioContext, destination?: AudioNode): { stop(): void };
```

Determinism is the whole point: same `Rng` seed + same options → byte-
identical output (checked via `hashAsset`). All generators fork internally
with fixed labels — never pass the same `Rng` instance to two different
generators expecting independent results; fork first.

**Don't store generated data as sim components.** Store the seed/params;
regenerate with the pure function wherever the data is needed. See
`templates.md` for the exact pattern (`generateWorldTerrain(seed)`,
`generateWorldProps(seed)`, `generateWorldItems(seed)` in the two starter
templates) — it keeps `stateHash()` and checkpoint snapshots cheap.

## `@claude-engine/asset-pipeline` — the import gate

Every externally-produced asset (Codex-generated images, eventually
Blender-exported meshes) passes through this before entering a game.

```bash
npm run assets:import --silent -- <file> --type <texture|icon|mesh|audio> --into <appDir> [--validate-only]
```

stdout is exactly one JSON `ImportReport`; exit `0` all gates passed (asset
copied to `<appDir>/assets/` + a `manifest.json` entry appended, unless
`--validate-only`), `1` a gate failed (named in `gates[]`), `2` unreadable
file or bad arguments.

```ts
type AssetType = "texture" | "icon" | "mesh" | "audio";
interface AssetBudgets {
  texture: { maxBytes: number; maxDim: number; requirePow2: boolean };
  icon:    { maxBytes: number; maxDim: number };
  mesh:    { maxBytes: number; maxTris: number; maxMaterials: number };
  audio:   { maxBytes: number; maxSeconds: number };
}
const DEFAULT_BUDGETS: AssetBudgets;

function validateAsset(file: string, type: AssetType, budgets?: Partial<AssetBudgets>): Promise<ImportReport>;
function importAsset(file: string, opts: { type: AssetType; into: string; budgets?: Partial<AssetBudgets> }): Promise<ImportReport>;
```

Gates by type: `texture`/`icon` — format (PNG magic bytes, or a light SVG
well-formedness check), byte size, dimensions, power-of-two (texture only,
hard-required when `requirePow2` is true); `mesh` (`.glb`/`.gltf`) — a
hand-rolled glTF JSON-chunk reader checks triangle count and material
count, no glTF-parsing dependency; `audio` (`.wav`/`.ogg`) — hand-parsed
RIFF header duration for `.wav`; best-effort Ogg/Vorbis granule-position
duration for `.ogg`, falling back to an inconclusive-but-passing gate with
a `detail` note if the stream can't be parsed (no audio-decoding
dependency — a documented v0 limitation, not a bug).

## Asset tooling policy (decided, not revisited casually)

- **Codex** generates 2D image assets interactively (icons, textures) — the
  project's existing image-generation policy. No Codex API integration code
  lives in this engine; the pipeline above is the gate every such asset
  passes through.
- **Blender** (headless/scripted `bpy` + CLI only, never manual editing) is
  an unbuilt *stretch* mesh backend — add only if hand-rolled Three.js
  geometry generation proves insufficient for a specific need.
- **Grok / other non-Anthropic LLMs**: out of scope; no identified
  capability gap Claude/Codex don't already cover in this workflow.
