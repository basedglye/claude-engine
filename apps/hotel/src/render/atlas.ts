/**
 * `AtlasData` -> `THREE.DataTexture` (docs/PHASE-H2.md §6, the H2b host
 * side of the retro pipeline).
 *
 * The atlas is synthesized in `@claude-engine/interiors` as plain RGBA
 * bytes — no DOM, no Three, integer hash noise only, so it is a purity-root
 * citizen and byte-identical everywhere. This file is the entire host-side
 * adapter: bytes in, texture out, with the filtering settings that make or
 * break the look.
 *
 * FILTERING IS NOT A DETAIL. `NearestFilter` on both min and mag, and NO
 * mipmaps, is the whole point:
 *   - magnification: bilinear would smooth the 32-colour dithered tiles
 *     into mush and throw away the Bayer pattern that gives the surfaces
 *     their texture at distance;
 *   - minification: mip filtering is precisely what H1b measured collapsing
 *     the screen's calibration contrast from 241 to 41. The screen quad has
 *     its own texture, but the same physics applies to a dithered atlas —
 *     mips average a dither pattern into flat grey, which is the exact
 *     opposite of the intended look.
 * `generateMipmaps: false` also keeps the upload cheap and the memory flat.
 */
import * as THREE from "three";
import { synthesizeAtlas, ATLAS_SIZE_PX, type AtlasData } from "@claude-engine/interiors";

/** Cache keyed by seed: the atlas is a pure function of it, and the host
 *  asks for it from more than one place (the floor mesh, and any future
 *  atlas-textured prop). Re-synthesizing 4 MB of pixels per call would be
 *  wasteful, and re-uploading a second identical texture doubly so. */
const textureBySeed = new Map<string, THREE.DataTexture>();

export function atlasTextureFor(seed: string): THREE.DataTexture {
  const cached = textureBySeed.get(seed);
  if (cached) return cached;
  const atlas: AtlasData = synthesizeAtlas(seed);
  const texture = new THREE.DataTexture(atlas.pixels, atlas.sizePx, atlas.sizePx, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // The mesh's UVs are already wrapped into each material's own atlas
  // region by interiors' UV emission, so nothing should ever sample outside
  // [0,1]; clamping rather than repeating means a UV bug shows up as a
  // smeared edge (visible, diagnosable) instead of as a neighbouring
  // material bleeding in (subtle, and easy to mistake for art).
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // NoColorSpace, deliberately, and this one was measured rather than
  // reasoned: tagging the atlas SRGBColorSpace made Three decode every
  // sample to linear on the way in, and with this host's renderer not
  // re-encoding on the way out the entire hotel rendered as dark olive mud
  // (~0.38 where ~0.7 was intended) — three times darker than the H2a
  // screenshots of the same rooms. The palette here is not photographic
  // art authored in sRGB; it is synthesized bytes whose numbers ARE the
  // intended output values, so "no conversion" is both the correct
  // description and the one that looks right. Caught by driving the build
  // and comparing against the committed H2a evidence shot, not by any
  // gate — which is the whole argument for the look-lock sign-off step.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  textureBySeed.set(seed, texture);
  return texture;
}

export { ATLAS_SIZE_PX };
