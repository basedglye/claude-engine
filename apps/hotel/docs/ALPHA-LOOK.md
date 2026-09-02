# GRAND FOYER — the alpha "real hotel" look

Branch `claude/grand-foyer-game-alpha-50b07d`, written 2026-09-02. This is
the handoff for the host-side look track described in
[decisions/2026-09-02-real-hotel-look.md](decisions/2026-09-02-real-hotel-look.md).
It records **verified state**: everything below was run by the session that
wrote it.

## What it is

The same sim H2a shipped (nothing under `apps/hotel/src/sim` changed; every
headless golden is byte-identical) wearing a real-hotel look built from CC0
assets: PBR textures (ambientCG), glTF furniture and an HDRI (Poly Haven),
Kenney furniture and characters, all fetched on demand. Mouse look is
pointer-lock free-look; a click on the canvas enters, Esc releases.

Evidence, captured on a real GPU from the integrated dev tour page:
`docs/evidence/alpha-look-{lobby,desk,corridor,bedroom,facade}.jpg`.

## Run it

```
npm install
npm run assets:fetch -w apps/hotel      # ~90 MB CC0 payload into apps/hotel/public/assets (gitignored)
npm run build
npm run dev -w apps/hotel -- --port 5199 --strictPort
```

Without the fetch the game still runs on the flat-colour procedural build.
`apps/hotel/assets.manifest.json` is the committed contract; the fetch
script copies it to `public/assets/manifest.json` and writes `LICENSES.md`
next to the payload.

## Quality tiers (`apps/hotel/src/render/quality.ts`)

`?worldforgeQuality=high|low` on the URL wins; otherwise a software GL
renderer (SwiftShader, llvmpipe) selects **low**. Low = no texture/model
fetches, no shadows, no point lights (hemisphere + ambient + sun only).
This is what the harness's headless browser gates see; under SwiftShader
the full look measured 1–3 s per frame, low measures ~200 ms and the
`fps.avg ≥ 5` budget of `fps-look-interact` holds.

## Module map (`apps/hotel/src/render/`)

| File | Owns |
|---|---|
| `floorplan.ts` | room/door/desk rects from the sim's grid — the shared query layer |
| `assets.ts` | manifest, `makePbrMaterial` (flat now, textures later, in place), `loadModel`/`loadCharacter`, env map; never rejects |
| `architecture.ts` | floors, walls, ceilings, coffers, trim, pilasters, desk, fake windows — merged per material |
| `door-leaf.ts` | panelled interior leaves, glass entrance pair; same world-space convention as `generateDoorMesh` |
| `exterior.ts` | sky, pavement, road, skyline, awning, sign, stanchions |
| `lighting.ts` / `fixtures.ts` | renderer config, the light rig (≤ 9 point lights, only the sun casts shadows), emissive fixtures |
| `decor.ts` | static furniture per room, models upgrade procedural fallbacks in place |
| `characters.ts` / `upkeep.ts` / `screens.ts` | guests (glTF + AnimationMixer), messes/props by kind, the CRT terminal — public signatures unchanged |
| `hud.ts` / `i18n.ts` | entry overlay, reticle, prompt; hidden entirely while a screen is focused |

`apps/hotel/dev/*.html` are dev-only pages (vite builds only `index.html`).
`dev/tour.html?tick=N&x=&z=&yaw=&pitch=` is the integrated scene with a
posable camera — the fastest way to look at anything.

## Verified on this branch

- `npm run build`, `npx tsc -p apps/hotel/tsconfig.json --noEmit`, `npx eslint .`, `node scripts/check-purity.mjs`: green.
- `npm test` smoke and `npm run test --workspaces --if-present`: green.
- Headless `--verify-replay`: `checkin-rush` 1978775531, `first-hire` 4132986008, `one-man-week` 3423109909, `escalation-stars` 2672628845 — all `passed: true`.
- Browser `--browser --verify-replay`: `fps-look-interact` (Chromium and Firefox), `reserva-readability`, `save-restore`, `demo-visual` — all exit 0, replay verified, incremental/slow hash agree.

## Traps hit here (each with its lesson)

- **Trim facing sign.** The x-edge wall scan stores `solidOnPlus: !wa`, which is really "walkable on plus"; the z-edge loop computes a true solid-on-plus. Getting one wrong puts the wainscot *inside* the wall and its coplanar face z-fights as a sawtooth. Isolate a rendering artifact by hiding meshes by name in the tour page before touching depth settings.
- **Real mouse X is negated in `player-fps`'s DOM normalizer.** A positive sim yaw is a left turn; `movementX` positive is the mouse moving right. The synthetic `pointer.look(dx)` keeps yaw-space meaning so every hand-derived gate script stays valid.
- **The embedded Browser pane refuses pointer lock** (`WrongDocumentError`). Drive the real app with `window.__WORLDFORGE__.pointer.lock()/look()` and `page.keyboard` from a Playwright script; Playwright's bundled Chromium picks SwiftShader, so use `channel: "chrome"` with `--ignore-gpu-blocklist` for the real look.
- **`MeshPhysicalMaterial.transmission` costs a full extra scene pass**; use opacity for glass.
- **Kenney GLBs reference `Textures/*.png` by relative path**; the fetch script copies the folder next to the characters.

## Known limitations / follow-ups

- **The lobby is 2.25 m deep** (`lobbyDepth` 9–12 cells in `packages/interiors/src/layout.ts`). It cannot look grand at that depth; fixing it moves every golden and belongs to the H3a `generateHotel(spec)` work, not this track.
- Guests are Kenney's blocky characters (CC0, civilian, idle/walk). No CC0 realistic rigged humans with a direct download URL were found; the mannequin/soldier fallbacks were removed from the pick pool.
- No `monitor-crt` or `radiator` models exist in the pack; both use procedural fallbacks.
- `hotel-phase-2b` (the PS1 track) also edits `main.ts`, `three-host.ts` and `player-fps`; expect a merge to need a hand-resolved `main.ts`.
- No blind skeptic pass was run on this branch (the five-subagent cap was spent on the build lanes); the gate verdicts above are the verification.
