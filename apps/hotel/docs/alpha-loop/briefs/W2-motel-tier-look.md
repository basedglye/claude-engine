# W2 — The motel tier: procedural textures and tier plumbing

You are lane W2 of four concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained: you do
not need to read any planning conversation.

---

## 0. Orchestration rules (verbatim, non-negotiable)

1. **"Do this work yourself. Do not spawn subagents."** Two agents in H2b
   spent their entire budget re-delegating and returned having done
   nothing — roughly 140k tokens for zero output.
2. **"Do not run any `git` command. Do not commit, do not `git add`, do
   not stash."** The orchestrator commits.

7. **Every lane brief carries a verification command list and a
   non-vacuity obligation.** The obligation is specific: *break this exact
   thing, confirm the gate reds on this exact assertion, restore by clean
   rebuild, confirm green, report all four exit codes.*
8. **Every lane brief carries the rebuild discipline verbatim:** before
   any perturbation claim, `rm -f apps/hotel/tsconfig.game.tsbuildinfo &&
   rm -rf apps/hotel/dist-game` then rebuild — otherwise the "restore" is
   a no-op. This trap has bitten four times.
11. **Report format, fixed:** files touched; every command run with its
    exit code; the perturbation performed and the exact assertion that
    went red; **and what you did NOT do**. A lane that could not finish
    says so; a lane that skipped a verification step says so, unprompted.

Also: `npm run harness --silent -- <scenario>` (without `--silent`, npm's
banner pollutes the verdict JSON), and verdict JSON is written inside the
repo — Git Bash `/tmp` paths do not round-trip to the Node process on this
machine.

## 0.1 Dev-server rule

`npm run dev -w apps/hotel -- --port 5203 --strictPort`. **Port 5203 is
yours.** Never 5199 (the project's `launch.json` port), never 5173
(routinely held by another session; a live server there looks exactly like
a stale bundle). Kill it when done — `pkill` does not kill the Windows dev
server; use `Get-NetTCPConnection -LocalPort 5203 | Stop-Process`.

The fastest way to look at anything is the dev tour page:
`http://localhost:5203/dev/tour.html?tick=N&x=&z=&yaw=&pitch=` — the
integrated scene with a posable camera. `apps/hotel/dev/*.html` are
dev-only; vite builds only `index.html`, so nothing you add there reaches
a production bundle.

---

## 1. Goal

The hotel currently renders exactly one look: the realistic, marble-and-
chandelier **Grand Foyer** (tier 2), captured and verified in
`apps/hotel/docs/ALPHA-LOOK.md`. The CEO's vision
(`apps/hotel/docs/VISION-ALPHA.md` — read it, it is binding) is that this
is the *upgraded* tier, and the game **starts** as a two-bit roadside
motel that visibly earns its grandeur.

Your job: make every scenery builder a function of the hotel's renovation
tier, author tier 0 (Motel) in full from **procedural** sources only, make
tier 1 (Hotel) an interpolation between 0 and 2, and leave tier 2
**exactly as it renders today**.

| tier | Name | Look |
|---|---|---|
| 0 | Motel | stained beige carpet in every room, flat scuffed paint, drop-ceiling tiles with fluorescent tubes (one flickers), laminate counter with a chipped edge, folding chairs and a vending machine in the lobby, cheap mismatched bedroom furniture, a chain-link and asphalt lot outside, neon VACANCY sign, a dumpster. |
| 1 | Hotel | clean carpet, painted walls with a chair rail, warm can lights, a wooden desk, matching furniture, awning outside. **Interpolate between 0 and 2 — do not author a third full set; swap materials and fixtures.** |
| 2 | Grand Foyer | exactly what renders today. Untouched. |

**Everything tier 0 and tier 1 need must be procedural** — canvas-
generated textures and box/lathe/cylinder geometry. The alpha deliverable
is a single HTML file that cannot fetch anything, so no new entry may be
added to the CC0 asset manifest and no new file may be fetched at runtime.

---

## 2. Files you may touch (nothing else)

```
apps/hotel/src/render/architecture.ts
apps/hotel/src/render/decor.ts
apps/hotel/src/render/lighting.ts
apps/hotel/src/render/fixtures.ts
apps/hotel/src/render/exterior.ts
apps/hotel/src/render/procedural.ts      (new file, yours)
apps/hotel/dev/**                        (the dev tour/arch/light/props pages)
```

**Read-only for you this cycle** (other lanes own them, or they are shared
infrastructure): `assets.ts`, `quality.ts`, `floorplan.ts`,
`characters.ts`, `upkeep.ts`, `screens.ts`, `documents.ts`,
`door-leaf.ts`, `hud.ts`, `i18n.ts`, and everything under
`apps/hotel/src/sim/**`.

**Contested — orchestrator-only:** `apps/hotel/src/main.ts`,
`apps/hotel/package.json`, `package.json`, `apps/hotel/index.html`,
`apps/hotel/vite.config.ts`, `apps/hotel/assets.manifest.json`,
`.claude/launch.json`, anything under `docs/` or `apps/hotel/docs/`,
`CLAUDE.md`.

---

## 3. Wiring the orchestrator will do (do not write it yourself)

`main.ts`'s `syncScene` will read the tier from sim state and call your
functions like this. Build against it:

```ts
const hotelTier = readHotelTier(world);              // 0 | 1 | 2
const group = ctx.scenery(`hotel-t${hotelTier}`, () => {
  const g = new THREE.Group();
  g.add(buildArchitecture(floor, hotelTier));
  g.add(buildExterior(floor, hotelTier));
  g.add(buildFixtures(floor, hotelTier));
  g.add(buildDecor(floor, hotelTier));
  return g;
});
sceneryByTier.set(hotelTier, group);
for (const [t, g] of sceneryByTier) g.visible = t === hotelTier;

if (lightingTier !== hotelTier) {
  lightingRig?.dispose();
  lightingRig = buildLighting(floor, ctx.scene, ctx.renderer, hotelTier);
  lightingTier = hotelTier;
}
lightingRig.update(world, performance.now());
```

Two consequences that are **your** obligations:

- Each `build*` is called **once per tier**, and each call must be a pure
  function of `(floor, hotelTier)`. Any module-level cache keyed on
  material name alone will hand tier 1 the tier-0 material. Key every
  cache by `(name, hotelTier)` or scope it inside the call.
- `LightingRig` grows a `dispose(): void`.

Note the direction of authority (CLAUDE.md invariant 4): **the renderer
READS the tier from sim state and never writes it.** Nothing you write may
import from `apps/hotel/src/sim/**` except as a `type`, and nothing you
write may mutate sim state.

---

## 4. Public contracts

### 4.1 Signatures you must provide

```ts
export type HotelTier = 0 | 1 | 2;

export function buildArchitecture(floor: GroundFloor, hotelTier: HotelTier): THREE.Group;
export function buildDecor(floor: GroundFloor, hotelTier: HotelTier): THREE.Group;
export function buildFixtures(floor: GroundFloor, hotelTier: HotelTier): THREE.Group;
export function buildExterior(floor: GroundFloor, hotelTier: HotelTier): THREE.Group;
export function buildLighting(
  floor: GroundFloor, scene: THREE.Scene,
  renderer: THREE.WebGLRenderer, hotelTier: HotelTier,
): LightingRig;

export interface LightingRig {
  group: THREE.Group;
  lightsByRoomId: Map<number, THREE.Light[]>;
  update(world: IWorld, nowMs: number): void;
  /** NEW: removes the rig's group from the scene and disposes its lights
   *  and any materials it owns. Safe to call twice. */
  dispose(): void;
}
```

`hotelTier` is **required**, not optional with a default. A required
parameter makes every call site a compile error until it is updated, which
is exactly the safety you want; an optional one silently renders the wrong
tier. `configureRenderer`, `DECOR_WALL_HEIGHT_M` and the `ROOM` re-export
keep their current shapes.

### 4.2 `procedural.ts` — the new texture source

One new module, exporting deterministic canvas-generated textures. No
`Math.random` (a texture that differs between two loads of the same build
is a bug, and this repo's whole culture is determinism); use a small
integer hash from a fixed seed, the way `lighting.ts`'s `hash01` already
does. Suggested surface — adjust names if you find better ones, but keep
them descriptive and keep every function pure:

```ts
export function stainedCarpetTexture(seedInt: number): THREE.Texture;
export function scuffedPaintTexture(seedInt: number): THREE.Texture;
export function ceilingTileTexture(): THREE.Texture;
export function laminateTexture(): THREE.Texture;
export function chainLinkTexture(): THREE.Texture;   // transparent PNG-style alpha
export function asphaltTexture(seedInt: number): THREE.Texture;
export function neonSignTexture(text: string): THREE.Texture;  // emissive map
```

Each returns a `THREE.CanvasTexture` with `wrapS`/`wrapT` set to
`RepeatWrapping`, `colorSpace` set to `THREE.SRGBColorSpace` for colour
maps, and `anisotropy` left at the renderer default. Cache each result in
a module-level map keyed by its arguments so a rebuild is cheap.

**Determinism note that is easy to get wrong:** texture synthesis output
must never be hashed into sim state and never used in a sim-side decision
(CLAUDE.md invariant 2). It is host-side pixels only. That is already true
by construction here — just do not add a "seed derived from world state"
shortcut.

### 4.3 How the tier enters each file

- **`architecture.ts`.** The two material-name selectors
  (`wallMaterialForKind`, `floorMaterialForKind`) become tier-aware, and
  `matFor` resolves a tier-0/1 name to a procedural texture instead of
  `makePbrMaterial`'s CC0 set. Tier 0 also swaps the coffered ceiling for
  a drop-ceiling grid, the marble desk for a chipped laminate counter, and
  drops the pilasters and cornice. Keep the merged-per-material accumulator
  structure — do not restructure the file.
  **Watch the trim trap** (ALPHA-LOOK.md): the x-edge wall scan stores
  `solidOnPlus: !wa`, which really means "walkable on plus", while the
  z-edge loop computes a true solid-on-plus. Get one wrong and the
  wainscot lands *inside* the wall and z-fights as a sawtooth. If you see
  a sawtooth, isolate it by hiding meshes by name in the tour page before
  touching any depth setting.
- **`decor.ts`.** Tier 0: folding chairs (box legs + box seat), a vending
  machine (box + emissive front panel from `neonSignTexture`), a plastic
  ficus, mismatched bedroom furniture (vary the fallback proportions and
  colours per room from the room id, not from a random draw). Tier 1: the
  existing procedural fallbacks with clean materials. Tier 2: the model
  upgrades exactly as today. The glTF `upgrade()` path must run **only at
  tier 2** — a marble side table in the motel is the failure everyone will
  spot first.
- **`fixtures.ts`.** Tier 0: fluorescent tube fixtures (two thin emissive
  boxes in a sheet-metal trough) in the lobby and corridor, a bare-bulb
  pendant in the bedrooms. Tier 1: recessed can lights. Tier 2: chandelier
  and sconces, untouched.
- **`lighting.ts`.** Tier 0: cooler, greener, dimmer key light; the lobby
  gets a **flicker** on one fixture. Reuse the existing broken-lamp flicker
  machinery in `update()` rather than adding a second flicker system, and
  keep the light budget (≤ 9 point lights, only the sun casts shadows) and
  the low-quality behaviour (`HIGH_QUALITY === false` → hemisphere +
  ambient + sun only, no point lights) **exactly** as they are — the
  headless browser gates run under SwiftShader and depend on it.
- **`exterior.ts`.** Tier 0: chain-link fence, cracked asphalt lot, a
  dumpster, and a buzzing neon **VACANCY** sign in place of the awning and
  the GRAND FOYER sign. Tier 1: awning plus a plain lit sign. Tier 2:
  untouched. The sign already uses a canvas texture — follow that pattern.

---

## 5. Verification commands and expected outcomes

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
npm run test --workspaces --if-present         # exit 0
```

**Your change must not move a single sim hash.** Run at least these three
headless gates and confirm the hashes are byte-identical to what they were
before you started (capture them first, before you edit anything):

```
npm run harness --silent -- one-man-week --verify-replay
npm run harness --silent -- first-hire --verify-replay
npm run harness --silent -- escalation-stars --verify-replay
```

Browser gates (these are the ones your change can actually break):

```
npm run harness --silent -- fps-look-interact --browser --verify-replay
npm run harness --silent -- fps-look-interact --browser --browser-engine firefox --verify-replay
npm run harness --silent -- demo-visual --browser --verify-replay
npm run harness --silent -- reserva-readability --browser --verify-replay
```

Expected: exit 0, replay verified, `fps.avg >= 5` and
`simTickMs.avgMs <= 10` still met, and the recorded command counts still
exactly **12** (`fps-look-interact`), **20** (`reserva-readability`),
**18** (`demo-visual`). A green streak over a varying command count is not
a pass.

**Look at it.** Capture the tour page at each tier and put the images
where the orchestrator can see them (report the paths). Because the sim
starts at tier 0 once W1 lands, and W1 may not have landed when you run,
add a **dev-page-only** tier override to `apps/hotel/dev/tour.ts` —
`?hotelTier=0|1|2`, defaulting to the sim's value — so you can pose all
three. This is a dev page; it never reaches the production bundle.

---

## 6. Non-vacuity obligation

Your gate is that **tier 2 did not regress** and that the tier actually
changes the scene.

1. Capture tier-2 frames from the tour page (lobby, desk, corridor,
   bedroom, facade) and compare them against the committed evidence in
   `apps/hotel/docs/evidence/alpha-look-{lobby,desk,corridor,bedroom,facade}.jpg`.
   They must be indistinguishable. Report which of the five you compared
   and what you saw.
2. **Perturb:** make `buildArchitecture` ignore its `hotelTier` argument
   (hardcode `const t = 2`). Then `rm -f
   apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`,
   rebuild, and capture the tier-0 tour frame: it must show marble, i.e.
   the tier-0 frame is now identical to the tier-2 frame. Record what you
   saw and the exit codes of the build and the browser gate run.
3. **Restore**, then `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, re-capture, confirm the motel is back.
4. Report **all four** exit codes and the four frame descriptions.

Additionally, prove the light rig's `dispose()` actually disposes: after
two simulated tier changes on the tour page, `renderer.info.memory` must
not grow monotonically. Report the two numbers.

---

## 7. Report format (fixed)

1. **Files touched** — every path with a one-line summary.
2. **Every command run, with its exit code.**
3. **The perturbation** — what you broke, what went visibly wrong, the
   four exit codes, and the frame paths.
4. **Screenshots** — paths for tier 0, 1 and 2 at each of the five
   camera poses, plus the tier-2-vs-evidence comparison verdict.
5. **Numbers** — the three headless hashes (before and after: they must
   be equal), the browser gates' `fps.avg`, and the two
   `renderer.info.memory` readings.
6. **What you did NOT do** — anything skipped, unfinished, or only
   partially verified. Say it unprompted.
7. **Wiring you need from the orchestrator**, if any.
