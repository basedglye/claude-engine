// Pure procedural asset generators: deterministic data only, fed exclusively
// from a caller-passed Rng (see @claude-engine/core). Zero DOM / Three.js /
// Node imports here — the web adapter lives at "@claude-engine/assets/web".
export {
  generateTerrain,
  heightAt,
  type TerrainOptions,
  type TerrainData,
} from "./terrain.js";
export {
  generateCreatureMesh,
  generatePropMesh,
  type MeshData,
  type CreatureOptions,
  type PropOptions,
} from "./mesh.js";
export { generateIconSvg, type IconOptions } from "./icon.js";
export {
  generateScore,
  type MusicScore,
  type Track,
  type Note,
  type ScoreOptions,
} from "./music.js";
export { hashAsset } from "./hash.js";
