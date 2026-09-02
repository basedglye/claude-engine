/**
 * THE LOOK LOCK (docs/PHASE-H2.md §11).
 *
 * These constants are the hotel's art direction reduced to the few numbers
 * a machine can hold. Everything else about "charming, not programmer art"
 * is a human judgement and the spec says so rather than pretending a probe
 * exists for it.
 *
 * WHAT "LOCKED" MEANS. After the H2b review records `LOOK-LOCKED: <commit>`
 * against the contents of this file, **any change to it — or to the atlas
 * synthesis it points at — is a public-contract change requiring a review
 * turn.** That is not ceremony: Phases 3+ author rooms, props and signage
 * against this look, and a jitter grid that quietly moves re-renders every
 * one of them. Roadmap risk 7 is "art fiddling consumes the schedule"; the
 * lock exists to END iteration at adequate-and-charming, not to reach
 * perfect.
 *
 * WHERE EACH NUMBER CAME FROM.
 *
 * `jitterGridPx: 160` — the projected-position quantization grid. The real
 * hardware's wobble came from a 1/16-subpixel raster at 320x240; scaled to
 * a modern viewport the equivalent is a coarse NDC grid, and 160 is the
 * value at which the wobble is legible when you walk (you can see the wall
 * seams crawl) without geometry visibly tearing at doorway edges. 320 was
 * too subtle to read as an effect at all; 80 made the desk edge shear badly
 * enough to look like a bug rather than a style.
 *
 * `affineWarp: true` — the texture swim. Free, and it is the single most
 * recognisable PS1 artefact. The screen quad is exempt (ARCHITECTURE B6,
 * enforced structurally through `createRetroMaterial({ exempt: true })` and
 * measured by the `art-lock` gate's `screen-readability` probe running with
 * the shader live on everything else).
 *
 * THE ATLAS SEED. There is deliberately no separate atlas seed constant.
 * `synthesizeAtlas` is a pure function of the WORLD seed, called with it
 * inside `generateGroundFloor` and again here on the host — so a hotel's
 * textures are part of that hotel's identity, and there is no second seed
 * that can drift out of step with the geometry it paints. The atlas
 * synthesis source (`packages/interiors/src/atlas.ts`) is what the lock
 * covers in place of a seed literal.
 */
import type { RetroLook } from "@claude-engine/renderer-three";

export const LOOK: RetroLook = {
  jitterGridPx: 160,
  affineWarp: true,
};

/** Scene light levels. The mesh carries a baked vertex-colour lighting
 *  multiplier (interiors' `buildFloorMesh`), so the runtime rig only has to
 *  keep unbaked host geometry — characters, messes, props, the monitor
 *  housing — from reading as flat silhouettes. Bright ambient plus one weak
 *  key is the retro-correct answer and costs nothing; real shadows are not
 *  something this engine has. */
export const AMBIENT_INTENSITY = 0.85;
export const KEY_LIGHT_INTENSITY = 0.35;
