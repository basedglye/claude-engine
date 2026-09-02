# 2026-09-02 — The alpha look is a real hotel, built from CC0 assets, host-side only

**Status:** adopted for the alpha track on branch `claude/grand-foyer-game-alpha-50b07d`.
**Supersedes, for this track:** the PS1 / dithered-atlas art direction in
[ARCHITECTURE.md](../ARCHITECTURE.md) B6 and the H2b look-lock on
`hotel-phase-2b`. It does not delete that work; see "Rejected" below.

## Claim

An alpha that a person will play for hours needs to *read as a hotel* at
gameplay distance. The H2b handoff measured that the dithered vertex-colour
look does not: only two of four look-lock frames read as architecture, and
the legible band around a pose was a few hundred millimetres wide. The
cheapest path to "looks like a real hotel" is not more procedural texture
synthesis; it is borrowing CC0 PBR textures and glTF furniture that already
look like a hotel, and spending the engineering on placement, trim, light and
a proper reception counter.

## What was decided

1. **The look is host-side only.** Every file in this change lives in
   `apps/hotel/src/render/**`, `apps/hotel/dev/**`, `apps/hotel/scripts/**`
   and a small backwards-compatible option on `@claude-engine/renderer-three`.
   Nothing under `apps/hotel/src/sim` or any purity root changes, so every
   headless golden pinned at the H2a merge stays byte-identical — the same
   rule H2b's spec (PHASE-H2.md §1) imposed on itself.
2. **Assets are fetched, not committed.** `apps/hotel/assets.manifest.json`
   (committed) is the contract; `apps/hotel/scripts/fetch-assets.mjs` fetches
   the CC0 payload into `apps/hotel/public/assets/` (gitignored) from
   ambientCG (textures), Poly Haven (models, HDRI) and, as fallback, Kenney.
   A fresh clone without the payload gets the flat-colour build — every
   renderer module degrades gracefully (`assets.ts` never rejects).
3. **Mouse look is pointer-lock free-look, never click-drag.** This was
   already the H0 contract (`three-host` requests pointer lock on canvas
   click; `player-fps` consumes `movementX/Y`); the HUD makes it legible
   with an entry overlay and a reticle, and hides itself completely while a
   terminal is focused so the readability probe is untouched.
4. **`apps/hotel/dev/*.html` are dev-only pages.** Vite builds only
   `index.html`, so none of them reach a production bundle (CLAUDE.md: no
   dev commands reachable from production builds).

## Rejected alternatives

- **Merging `hotel-phase-2b` first and building on the retro pipeline.**
  The branch is mid-review (one blocking item) and moving under a parallel
  session; its atlas/shader would have to be disabled anyway. Conflicts in
  `main.ts` at merge time are expected and cheap; a moving base is not.
- **Committing the asset payload.** 50–150 MB of binaries in git is
  permanent; the manifest + fetch script gives the same reproducibility.
- **Realistic skinned humans.** No CC0 source with a direct URL exists for
  realistic rigged humans; the alpha uses the best rigged CC0 characters
  the fetch can reach and keeps the box rig as the fallback. Revisit when
  a licensed pack is chosen.
- **A post-processing stack (SSAO, bloom).** Costs frame time under the
  harness's SwiftShader and buys less than trim, fixtures and warm light.

## Trigger to revisit

If the parallel PS1 track is chosen for the shipped game, this look stays as
the alpha/playtest look and the two are switched by a host-side flag; the
sim is identical either way, which is the whole point of invariant 4.
