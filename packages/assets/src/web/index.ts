// Web adapter for @claude-engine/assets: may import three and DOM/WebAudio
// globals. Consumers reach this via the "@claude-engine/assets/web" subpath
// export; the pure root ("@claude-engine/assets") never imports this file.
export { terrainToGeometry, toBufferGeometry } from "./geometry.js";
export { svgToTexture } from "./texture.js";
export { playScore } from "./audio.js";
