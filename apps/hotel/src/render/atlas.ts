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
 * FILTERING IS NOT A DETAIL, AND H2b GOT IT WRONG TWICE.
 *   - magnification stays NearestFilter: up close, bilinear smooths the
 *     32-colour tiles into mush and throws away the hard pixel edges the
 *     look rests on.
 *   - minification MIPMAPS, reversing H2b's original choice. See the
 *     comment on `minFilter` below for the measurement that forced it.
 * Anisotropy was tried and removed: it fixed grazing angles but cost
 * 50-90ms of p95 under the harness's software rasteriser, which is most of
 * the `art-lock` frame-time budget for a case mipmapping already mostly
 * handles.
 */
import * as THREE from "three";
import { synthesizeAtlas, ATLAS_SIZE_PX, type AtlasData, type AtlasRegion } from "@claude-engine/interiors";

/** Cache keyed by seed: the atlas is a pure function of it, and the host
 *  asks for it from more than one place (the floor mesh, and any future
 *  atlas-textured prop). Re-synthesizing 4 MB of pixels per call would be
 *  wasteful, and re-uploading a second identical texture doubly so. */
const textureBySeed = new Map<string, THREE.DataTexture>();
const regionsBySeed = new Map<string, Record<string, AtlasRegion>>();

export function atlasTextureFor(seed: string): THREE.DataTexture {
  const cached = textureBySeed.get(seed);
  if (cached) return cached;
  const atlas: AtlasData = synthesizeAtlas(seed);
  const texture = new THREE.DataTexture(atlas.pixels, atlas.sizePx, atlas.sizePx, THREE.RGBAFormat);
  // MAGNIFICATION stays NearestFilter: up close, bilinear would smooth the
  // 32-colour tiles into mush and throw away the hard pixel edges the whole
  // look rests on.
  texture.magFilter = THREE.NearestFilter;
  // MINIFICATION now mipmaps, and this reverses the original H2b choice on
  // purpose. Nearest minification point-samples one texel per fragment, so a
  // surface seen at distance or at a grazing angle aliases hard -- and the
  // PS1 vertex jitter re-snaps every vertex each frame, which makes that
  // aliasing CRAWL. Driving the build with jitter on and off is what
  // isolated it: the surfaces are legible with the bake alone and dissolve
  // into swimming static the moment jitter is enabled. The two features were
  // fighting, and the texture lost.
  //
  // The original argument for no mips ("mips average a dither pattern into
  // flat grey") was correct about the OLD atlas, whose entire signal was
  // high-frequency 4x4 Bayer noise. It does not hold for this one: the
  // dominant signal is now the seam grid at 0.5m/1m real-world period, which
  // is exactly the low-frequency content mipmapping preserves. What the mips
  // average away is the noise that was never legible at that distance
  // anyway.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
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

/** The atlas sub-rect for one material id, for callers that generate their
 *  own geometry and need to UV into the shared atlas (door panels). Shares
 *  the per-seed cache above, so this never re-synthesizes. */
export function atlasRegionFor(seed: string, materialId: string): AtlasRegion | undefined {
  const cached = regionsBySeed.get(seed);
  if (cached) return cached[materialId];
  const atlas = synthesizeAtlas(seed);
  regionsBySeed.set(seed, atlas.regions);
  return atlas.regions[materialId];
}
