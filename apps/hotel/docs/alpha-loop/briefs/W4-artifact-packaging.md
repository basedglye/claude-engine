# W4 — Single-file artifact build, pointer-lock fallback, Netlify

You are lane W4 of four concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained.

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
banner pollutes the verdict JSON), and verdict JSON goes inside the repo —
Git Bash `/tmp` paths do not round-trip to the Node process here.

## 0.1 Dev-server rule

`npm run dev -w apps/hotel -- --port 5205 --strictPort`. **Port 5205 is
yours.** Never 5199 (`launch.json`'s port), never 5173 (routinely held by
another session; a live server there looks exactly like a stale bundle).
Kill it when done — `pkill` does not kill the Windows dev server; use
`Get-NetTCPConnection -LocalPort 5205 | Stop-Process`.

---

## 1. Goal

The alpha's deliverable (`apps/hotel/docs/VISION-ALPHA.md`, binding) is:

> **Artifact**: one HTML file (≤ 16 MB, no external fetches except scripts
> from cdnjs/jsdelivr) built from the app by a script, with pointer lock
> requested and a hover-look fallback when the sandbox refuses it. Saves
> in IndexedDB. **Hosted**: the same build on Netlify as the fallback.

Three deliverables, one lane:

1. `apps/hotel/scripts/build-artifact.mjs` — produces
   `apps/hotel/dist-artifact/grand-foyer.html`: a single self-contained
   file with all JS and CSS inlined, the four Kenney character GLBs and
   their textures embedded as data URIs, **zero** network requests at
   runtime, ≤ 16 MB.
2. `apps/hotel/src/render/pointer-fallback.ts` — hover-look when the
   sandbox refuses pointer lock.
3. `apps/hotel/netlify.toml` — publishes the same build.

---

## 2. Files you may touch (nothing else)

```
apps/hotel/scripts/build-artifact.mjs      (new file, yours)
apps/hotel/src/render/pointer-fallback.ts  (new file, yours)
apps/hotel/netlify.toml                    (new file, yours)
```

You add three files and edit **none**. If you believe you must edit an
existing file, stop and report the need — do not do it.

**Contested — orchestrator-only:** `apps/hotel/src/main.ts`,
`apps/hotel/package.json` (the orchestrator adds
`"build:artifact": "node scripts/build-artifact.mjs"`), `package.json`,
`apps/hotel/index.html`, `apps/hotel/vite.config.ts`,
`apps/hotel/assets.manifest.json`, `.claude/launch.json`, anything under
`docs/` or `apps/hotel/docs/`, `CLAUDE.md`.

**Read-only for you:** everything under `apps/hotel/src/render/**` and
`apps/hotel/src/sim/**` — other lanes are live in both.

---

## 3. Wiring the orchestrator will do (do not write it yourself)

In `main.ts`:

```ts
import { installHoverLookFallback } from "./render/pointer-fallback.js";
const canvas = document.getElementById("app") as HTMLCanvasElement;
installHoverLookFallback(canvas, {
  requestLock: () => canvas.requestPointerLock(),
  isLocked: () => document.pointerLockElement === canvas,
  onLook: (dx, dy) => controller.syntheticPointer.look(dx, dy),
  setLocked: (locked) => controller.syntheticPointer.lock(locked),
});
```

and in `apps/hotel/package.json`:

```json
"build:artifact": "node scripts/build-artifact.mjs"
```

Until that lands, invoke your script directly with
`node apps/hotel/scripts/build-artifact.mjs`.

---

## 4. Contracts you must provide

### 4.1 `build-artifact.mjs`

Node ESM, no new npm dependencies (the repo's devDependencies are
`typescript`, `eslint`, `typescript-eslint`, `@types/node`, `playwright`;
`apps/hotel` has `vite`). Steps:

1. Run the normal build first (`npm run build -w apps/hotel`, or require
   that `apps/hotel/dist/` is fresh and fail loudly if it is not — your
   choice, but say which in the header comment).
2. Read `apps/hotel/dist/index.html` and inline every local `<script
   type="module" src>` and `<link rel="stylesheet">` into the document.
   Vite emits hashed asset paths; resolve them relative to `dist/`.
3. Embed the runtime assets. **Only these** — do not embed the ~90 MB CC0
   PBR/HDRI payload:
   - `apps/hotel/public/assets/characters/guest-{c,d,e,f}.glb`
     (~113 KB each)
   - `apps/hotel/public/assets/characters/Textures/*.png` (~336 KB total)
   - a **reduced manifest** JSON containing only the `characters` section
     of `apps/hotel/assets.manifest.json` (with empty `textures` and
     `models` objects, and no `env`) — every renderer module already
     degrades gracefully when a texture or model is absent
     (`assets.ts` never rejects), so this yields the procedural build
     plus real characters.
4. Inject a small `<script>` **before** the bundle that installs a
   `fetch` shim:
   - build a `Map` from asset path → `data:` URI at build time and emit it
     as a JS object literal;
   - wrap `window.fetch` so that any request whose resolved pathname
     starts with `/assets/` is served from the map as a `Response` with
     the right MIME type (`model/gltf-binary`, `image/png`,
     `application/json`), and anything else falls through to the real
     `fetch`;
   - three.js r169's `FileLoader` uses the fetch API and `GLTFLoader`
     resolves a GLB's relative texture references (`Textures/*.png`)
     against the **original path** before the request is made, so keeping
     the paths intact and shimming `fetch` handles both the GLB and its
     textures. Do **not** rewrite the GLB URLs to `data:` URIs directly —
     relative resolution against a `data:` URI fails.
5. Write `apps/hotel/dist-artifact/grand-foyer.html`, then **assert**:
   file size ≤ 16 MB (fail non-zero above it), and no remaining `src=`/
   `href=` attribute in the output points at a relative local path. Print
   the final size in MB and the count of embedded assets.

The output must run from `file://`. That means: no `import` of a bare
specifier at runtime, no service worker, no `crossorigin` requirement, and
nothing that depends on an HTTP origin except IndexedDB (which works on
`file://` in Chrome and is what `@claude-engine/save-web` already uses).

**Determinism:** the script must be re-runnable and produce a
byte-identical file from an identical `dist/`. No timestamps, no random
ids in the output.

### 4.2 `pointer-fallback.ts`

```ts
export interface PointerLockAdapter {
  /** Ask the browser for pointer lock. May throw or reject; the fallback
   *  must survive either. */
  requestLock(): void | Promise<void>;
  /** True when real pointer lock is currently held. */
  isLocked(): boolean;
  /** Feed a look delta in the same units a real mousemove would produce
   *  (movementX / movementY pixels). */
  onLook(dx: number, dy: number): void;
  /** Tell the controller whether it should treat itself as locked. */
  setLocked(locked: boolean): void;
}

/** Installs a hover-look fallback on `canvas`. Returns a teardown fn. */
export function installHoverLookFallback(
  canvas: HTMLElement,
  adapter: PointerLockAdapter,
): () => void;
```

Behaviour:

- On the canvas's first click, call `adapter.requestLock()`. If it throws,
  rejects, or if `pointerlockerror` fires, or if `isLocked()` is still
  false a couple of animation frames later, enter **fallback mode**.
- In fallback mode: on `mousemove` over the canvas, synthesise a look
  delta from the cursor's distance from the canvas centre — a dead zone in
  the middle ~30% of each axis, then a linear ramp to a capped rate at the
  edges — and call `adapter.onLook(dx, dy)` once per animation frame (not
  once per mousemove event). Call `adapter.setLocked(true)` on entry so
  movement is ungated, and `setLocked(false)` when the pointer leaves the
  canvas.
- The instant `adapter.isLocked()` becomes true, **disable fallback mode
  entirely** and stop synthesising. Real lock and the fallback must never
  both be feeding deltas.
- Never call `preventDefault()` on anything but the canvas's own
  `mousemove`, and never install a capture-phase listener on `document` —
  the terminal-screen click path and the harness's synthetic input both
  run through listeners this must not shadow.

**Sign convention — this has bitten before** (`apps/hotel/docs/ALPHA-LOOK.md`):
real mouse X is negated in `player-fps`'s DOM normalizer, so a positive
sim yaw is a left turn while a positive `movementX` is the mouse moving
right. `adapter.onLook` is wired to `syntheticPointer.look`, which keeps
**yaw-space** meaning. Derive your sign empirically by driving the real
app and confirming that moving the cursor right turns the camera right —
do not reason it out on paper and ship it.

No imports from `three`, `@claude-engine/*`, or `./sim/**`. This file is
plain DOM plus the adapter.

### 4.3 `netlify.toml`

Publishes the same build. Base `apps/hotel`, build command
`npm run build -w apps/hotel` from the repo root (Netlify's default base
is the repo root — set `base` explicitly), publish directory
`apps/hotel/dist`. Add a `[[headers]]` block only if something actually
needs it; do not add SPA redirects (this is a single page with no router).
Note in a comment that the CC0 asset payload is **not** in the repo, so
the hosted build is the procedural build plus whatever
`apps/hotel/public/assets` happens to contain at deploy time — the hosted
copy is the fallback for the artifact, not a second product.

---

## 5. Verification commands and expected outcomes

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
node apps/hotel/scripts/build-artifact.mjs     # exit 0, prints size ≤ 16 MB
```

Then **open the artifact and prove it is self-contained**, which is the
whole point of this lane:

- Open `apps/hotel/dist-artifact/grand-foyer.html` from `file://` in real
  Chrome (Playwright with `channel: "chrome"` and
  `--ignore-gpu-blocklist`; Playwright's bundled Chromium picks
  SwiftShader and will render the low-quality path). Record **every**
  network request the page makes. The expected count is **zero**.
- Confirm the guest characters render (not the box-rig fallback), that
  WASD moves, that the terminal focuses and RESERVA paints, and that a
  quick-save/quick-load round-trips (IndexedDB works on `file://`).
- Run the same page a second time from `file://` with the network
  disconnected, to prove it independently of any cache.

Also confirm the app still behaves normally when served over HTTP:

```
npm run harness --silent -- fps-look-interact --browser --verify-replay
npm run harness --silent -- save-restore --browser --verify-replay
```

Expected exit 0, replay verified, command counts still exactly **12** and
**69**. A green streak over a varying command count is not a pass.

Test the fallback specifically: the **embedded Browser pane refuses
pointer lock** with `WrongDocumentError` — that is the exact sandbox
condition the fallback exists for, so it is a free real-world test case.
Open the artifact there and confirm hover-look turns the camera and that
moving the cursor right turns the camera right.

---

## 6. Non-vacuity obligation

Your gate is the build script's own size and self-containment assertions.

1. Run `build-artifact.mjs` clean — exit 0, size printed.
2. **Perturb the size assertion:** temporarily lower the limit constant
   from 16 MB to 1 KB. `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm
   -rf apps/hotel/dist-game`, rebuild, re-run: the script must exit
   non-zero with a message naming the actual size. Record the exit code
   and quote the message.
3. **Perturb the self-containment assertion:** restore the size limit and
   instead skip the inlining of one asset (leave one `/assets/...` path
   unembedded). Clean-rebuild and re-run: the "no remaining local path"
   assertion must fail and name the path. Record the exit code and the
   message.
4. **Restore both**, clean-rebuild, re-run: exit 0.
5. Report **all four** exit codes (plus the extra one from step 3).

And for the fallback: temporarily make `installHoverLookFallback` return
immediately without installing anything, clean-rebuild, open the artifact
in the embedded Browser pane, and confirm the camera **cannot** be turned
at all. Restore, clean-rebuild, confirm it can. Report both observations —
this is the only way to know the fallback is doing the work rather than
real pointer lock quietly succeeding.

---

## 7. Report format (fixed)

1. **Files touched** — every path with a one-line summary.
2. **Every command run, with its exit code**, including the failed and
   perturbed runs.
3. **The perturbations** — what you broke, the exact assertion message
   that fired, and all the exit codes.
4. **The artifact's numbers** — final size in MB, count and total bytes of
   embedded assets, and the **exact network request count** observed on a
   `file://` open (expected 0; if it is not 0, list every request).
5. **Hand-driven confirmation** — characters render / WASD / terminal /
   save-load round-trip / hover-look direction, each with what you saw,
   plus a screenshot path.
6. **What you did NOT do** — anything skipped, unfinished, or only
   partially verified. Say it unprompted. In particular, say plainly
   whether you deployed to Netlify or only wrote the config (**do not
   deploy** — the orchestrator does).
7. **Wiring you need from the orchestrator** — at minimum the `main.ts`
   hookup and the `build:artifact` script entry above.
