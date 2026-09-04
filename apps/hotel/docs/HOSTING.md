# Hosting GRAND FOYER on Netlify (the fallback)

**This is the fallback.** The primary deliverable is the single-file
artifact (`apps/hotel/scripts/build-artifact.mjs` -> ~1.8 MB self-contained
HTML that runs from `file://` with zero network requests). Netlify hosting
exists so someone without a way to run a local file can still see the game
in a browser.

**The hosted build is the procedural (flat-colour) look, not the real-hotel
look**, unless the ~90 MB CC0 PBR/HDRI asset payload
(`apps/hotel/public/assets/{textures,models,env}`) is present at build time.
That payload is gitignored and is **not** in the repo — see
`apps/hotel/netlify.toml`'s header comment, which already states this. See
§7 below for the option (not adopted) of fetching it during the Netlify
build.

---

## 1. What is hosted, and the two URLs

A single Netlify site serves two products out of one `apps/hotel/dist/`:

| URL          | What it is                                              | Reach for it when...                                              |
|--------------|----------------------------------------------------------|---------------------------------------------------------------------|
| `/`          | The streaming Vite build (`npm run build -w apps/hotel`)| you want the smallest initial payload and are fine with several small requests (JS chunk, manifest, textures, models) |
| `/play.html` | The self-contained artifact, copied byte-for-byte into `dist/` | you want the "it just works, one file, no network" guarantee even over a flaky connection, or you want to hand someone a URL that behaves identically to the local artifact |

`/play.html` makes exactly **one** non-data network request (the document
itself) — verified below. `/` makes the document plus its JS chunk plus
whatever `apps/hotel/public/assets/` happens to contain at build time
(16 requests observed locally — see §6).

---

## 2. Preconditions

| Precondition | Command | Observed on this machine |
|---|---|---|
| Netlify CLI installed | `netlify --version` | **Yes** — `netlify-cli/26.2.0 win32-x64 node-v24.12.0` |
| Authenticated account | `netlify status` (not run — would touch Netlify's API; orchestrator-only, see §5) | not checked by this lane |
| A site to deploy to | `netlify sites:list` / `netlify link` / `netlify sites:create` (not run — orchestrator-only) | not created by this lane |

---

## 3. The exact command sequence (numbered, copy-pasteable)

Run everything from the **repo root**
(`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`
in this worktree; the repo root in general).

**Steps 1-5 were run by this lane and their real output is in this lane's
report. Steps 6-8 talk to Netlify's API and were deliberately NOT run by
this lane** — see §0.2 of this lane's brief: publishing is the
orchestrator's action and needs the user's go-ahead.

1. Clean rebuild (discipline this project enforces after four prior
   staleness bugs):
   ```
   rm -f apps/hotel/tsconfig.game.tsbuildinfo
   rm -rf apps/hotel/dist-game
   ```
2. Build the Vite workspace output (from the repo root — `npm run build
   -w apps/hotel` is a workspaces invocation and only resolves from the
   root):
   ```
   npm run build -w apps/hotel
   ```
   Produces `apps/hotel/dist/index.html` + `apps/hotel/dist/assets/**`.
   This is exactly what Netlify's own `[build] command` runs — see
   `apps/hotel/netlify.toml`.
3. Build the self-contained artifact **and copy it into the same `dist/`**
   in one step (this must run after step 2, in this order — the artifact
   build refuses if `dist/` is stale relative to `apps/hotel/src/`):
   ```
   node apps/hotel/scripts/build-artifact.mjs --copy-to-dist
   ```
   Produces `apps/hotel/dist-artifact/grand-foyer.html` and, because of the
   flag, a byte-identical copy at `apps/hotel/dist/play.html`.
4. Sanity-check the directory that is about to be published:
   ```
   ls -la apps/hotel/dist/
   cmp apps/hotel/dist/play.html apps/hotel/dist-artifact/grand-foyer.html
   ```
   Expect `index.html`, `assets/`, and `play.html`; `cmp` prints nothing
   (identical).
5. (Optional, recommended before the first real deploy) Serve `apps/hotel/dist/`
   locally and load both URLs — see §6 for exactly how this lane did it and
   what to check.
6. **[NOT RUN BY THIS LANE — orchestrator]** Draft deploy (does not go
   live, gives you a preview URL to sanity-check first):
   ```
   netlify deploy --dir apps/hotel/dist --site <SITE_ID>
   ```
   - `--dir apps/hotel/dist` — the directory to upload; must match
     `netlify.toml`'s `publish` (repo-root-relative: `apps/hotel/dist`) if
     you rely on a linked site's config, or must be given explicitly (as
     here) when deploying by directory without a full `netlify.toml`
     build.
   - `--site <SITE_ID>` — which Netlify site/project to deploy to; the
     orchestrator supplies this (see §5).
7. **[NOT RUN BY THIS LANE — orchestrator]** Inspect the draft URL Netlify
   prints, confirm both `/` and `/play.html` load correctly (§6's checks).
8. **[NOT RUN BY THIS LANE — orchestrator]** Promote to production:
   ```
   netlify deploy --dir apps/hotel/dist --site <SITE_ID> --prod
   ```
   - `--prod` — publishes to the site's primary production URL/custom
     domain instead of a draft/preview URL. Without it, `netlify deploy`
     always creates a new draft.

Alternative to steps 6-8: if the repo is **linked** to a Netlify site
(`netlify link`, run once, orchestrator-only) and Netlify's own
`[build] command` in `netlify.toml` is trusted to do the whole job, a plain
`netlify deploy --prod` triggers Netlify's hosted build using
`apps/hotel/netlify.toml`'s `command`/`publish` directly, with no local
`--dir`. That currently only produces `/` (see §4 for why `/play.html`
needs a manual step or a TOML change) — so if this path is used, step 3
above must run against Netlify's build environment too, which is exactly
the `[build] command` chaining option discussed in §4.

---

## 4. The `netlify.toml` decision: left alone, not chained

`npm run build -w apps/hotel` (what `apps/hotel/netlify.toml`'s
`[build] command` runs today) does **not** invoke
`build-artifact.mjs`, so a bare `netlify deploy --prod` against the linked
repo would publish `/` only — no `/play.html`.

The brief asks for either: chain the artifact build into `[build] command`
and prove it exits 0 from the repo root, or leave the TOML alone and say
why.

**Decision: leave `apps/hotel/netlify.toml` alone.** Reasons:

1. **Attribution.** A single chained command
   (`npm run build -w apps/hotel && node apps/hotel/scripts/build-artifact.mjs --copy-to-dist`)
   means a Netlify build failure in either half looks identical in
   Netlify's UI — you'd have to read the log to tell "Vite build broke"
   from "artifact build refused a stale/oversized output" apart. Two
   explicit steps run by whoever deploys keeps that distinction obvious at
   the point of failure, which matters more on a fallback path that is
   rarely exercised than on a path exercised every commit.
2. **This lane could not prove the chained command exits 0 from the repo
   root at the time of writing.** `apps/hotel/src/sim/game.ts` currently
   fails to compile on this machine (`error TS2591: Cannot find name
   'process'` / `TS2584: Cannot find name 'console'` at lines 783/787,
   inside another lane's in-progress instrumentation comment-tagged
   "C2-W2 carry-3 report" — that file is outside this lane's declared
   globs, read-only for this lane, and is being actively edited by a
   concurrent lane). `npm run build -w apps/hotel` failed on retries at
   ~0s, ~5s, ~20s, ~45s after the first failure — this is not a flake this
   lane could wait out; it was still broken at the time this report was
   written. That failure is orthogonal to this lane's own change (only
   `build-artifact.mjs` was touched) — the working, cmp-verified proof in
   §6 was captured **before** that concurrent edit landed, using a build
   this lane produced itself — but it does mean this lane cannot honestly
   claim a chained `[build] command` was proven green from a clean repo
   root right now. Chaining a command into a config file on an unproven
   build is exactly the kind of unverified change this project's
   conventions warn against.
3. The two-step manual sequence (§3 steps 2-3) is fully documented,
   copy-pasteable, and was proven to work end-to-end by this lane before
   the concurrent breakage (see §6). It is the safer default until someone
   re-proves the chained command green.

If a future session wants to chain it, the change is small — replace
`command = "npm run build -w apps/hotel"` with
`command = "npm run build -w apps/hotel && node apps/hotel/scripts/build-artifact.mjs --copy-to-dist"`
in `apps/hotel/netlify.toml` — but prove it exits 0 from a clean repo root
first, once `apps/hotel/src/sim/game.ts` compiles again.

---

## 5. What the orchestrator must decide or supply

- **Site name/ID** — whether to create a new Netlify site or reuse an
  existing one; `--site <SITE_ID>` in §3 steps 6/8.
- **Team** — which Netlify team/account owns the site.
- **Linked repo vs. manual CLI deploys** — `netlify link` for
  continuous deploy on every push (uses `netlify.toml`'s `command`/
  `publish` directly, subject to the §4 caveat about `/play.html`), or
  manual `netlify deploy --dir apps/hotel/dist` runs as in §3 (full
  control over exactly what's in `dist/` before it ships, including
  `play.html`).
- **Custom domain**, if any — Netlify's own domain-management flow, not
  covered here since it's an account-level, API-touching action.
- **Whether to adopt the `--copy-to-dist` step in `apps/hotel/package.json`**
  as a named script — see §8.

---

## 6. Verification after deploy — and what this lane actually observed locally

**After a real deploy, the orchestrator should:**
1. Load `<site-url>/` and `<site-url>/play.html` in a browser.
2. Check the browser console is clean (no errors) on both.
3. Check the Network panel: `/play.html` should show **no requests beyond
   the document itself**; `/` will show the document, its JS chunk, and
   whatever `apps/hotel/public/assets` contains.
4. Confirm the scene is actually running, not just loaded — e.g.
   `window.__WORLDFORGE__.world.tick` increasing over time in the console.

**What this lane observed locally**, serving `apps/hotel/dist/` with a bare
`node:http` server on port 5205 (this lane's assigned port) and driving both
URLs with Playwright/real Chrome
(`chromium.launch({ headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"] })`),
waiting ~12s after `window.__WORLDFORGE__` appeared:

### `/play.html`
- Page errors: none
- Console errors: none
- `world.tick` after ~12s: **248** (non-zero — sim is running)
- Screenshot: captured (this lane's scratchpad;
  `C:\Users\chris\AppData\Local\Temp\claude\...\scratchpad\shots\play.png`)
- Non-data requests: **1** — `http://localhost:5205/play.html` (the
  document only, as required)

### `/`
- Page errors: none
- Console errors: 2 (from `build-artifact.mjs`'s own sealed-shim 404s
  showing up in an earlier, unrelated probe against a stale `dist/`
  mid-session — **not present** in the final clean run reported here; the
  final `/` run's console was clean apart from the browser's own resource
  logging, see the raw command output in this lane's final report)
- `world.tick` after ~12s: **237** (non-zero — sim is running)
- Screenshot: captured (`.../scratchpad/shots/root.png`)
- Non-data requests: **16** — the document, one JS chunk
  (`assets/index-*.js`), `assets/manifest.json`, and the local
  `public/assets` payload that happens to be present on this machine
  (`env/lobby.hdr`, 2 models, 2 texture sets x4 maps each, 1 character
  model, 1 character texture). The exact count depends on what
  `apps/hotel/public/assets` contains at build time — see §7.

---

## 7. The asset-payload question (recommendation only — orchestrator decides)

**Option: run `npm run assets:fetch -w apps/hotel` as part of the Netlify
build**, e.g.
`command = "npm run assets:fetch -w apps/hotel && npm run build -w apps/hotel"`.

Trade-offs:
- **Build time.** The payload is ~90 MB from upstream CC0 hosts; on a slow
  or throttled connection this could push a Netlify build well past
  typical free-tier build minutes, and Netlify builds have hard time
  limits.
- **Reliability.** The deploy becomes dependent on third-party CC0 hosts
  being up and unthrottled *at deploy time*, for a fallback path that
  exists precisely because the primary artifact doesn't need any network
  at all. A flaky upstream host would turn "hosting fell over" into a
  routine occurrence rather than a rare one.
- **Determinism.** Unlike the artifact build (byte-identical on every
  run), a build-time fetch from external hosts is not reproducible or
  cacheable across deploys without Netlify-side build caching, which adds
  its own configuration surface.
- **Not proven by this lane.** This lane did not run `assets:fetch` or
  attempt this — it is read-only territory (`package.json` scripts) and
  out of scope for this brief.

**Recommendation: do not adopt this for now.** The hosted build is
explicitly documented (both here and in `netlify.toml`'s header) as the
*fallback*, not a second full-fidelity product — the artifact already
carries the real payload where it matters (the four Kenney guest
characters are embedded in the artifact itself, independent of the ~90 MB
PBR/HDRI set). Paying build-time cost and reliability risk to make the
fallback look better contradicts why it's a fallback. If the orchestrator
disagrees, this is a one-line `netlify.toml` change, not an architectural
one.

---

## 8. Known gaps and gotchas actually hit

- **`apps/hotel/dist/` is a shared, actively-rebuilt directory across
  concurrent lanes in this alpha cycle.** Mid-session, `apps/hotel/dist/play.html`
  disappeared between two verification steps with no action by this lane —
  because Vite's `build` step empties `outDir` by default, and another
  lane's `npm run build -w apps/hotel` (or an attempt at one) ran
  concurrently against the same `dist/`. **Anyone deploying manually must
  re-run step 3 of §3 immediately before `netlify deploy`, not minutes
  before** — do not trust a `dist/play.html` that was produced earlier in
  the session if anything else may have rebuilt `apps/hotel/` since.
- **`apps/hotel/src/sim/game.ts` was mid-edit and non-compiling for part of
  this session** (see §4 point 2) — a concurrent lane's WIP, outside this
  lane's globs. If `npm run build -w apps/hotel` fails with
  `TS2591`/`TS2584` referencing `process`/`console` around that file's
  instrumentation block, that is not this lane's `build-artifact.mjs`
  change; wait for that lane to finish or re-run once it lands.
- **Windows path quoting**: `netlify deploy --dir apps/hotel/dist` should
  be run from the repo root with forward slashes; this lane did not test
  the Netlify CLI's own path handling since no `netlify deploy` was run
  (see §0.2 of the brief).
- The freshness check in `build-artifact.mjs` compares `apps/hotel/src/`
  mtimes against `dist/index.html`'s mtime — proven correct by this lane's
  perturbation test (see this lane's final report), but it means a bare
  `touch` under `src/` (even with no content change) is enough to trip it,
  by design.

---

## 9. Wiring needed from the orchestrator

`apps/hotel/package.json` is orchestrator-only this cycle. This lane
suggests, but does not add, a script such as:

```json
"build:hosted": "npm run build && node scripts/build-artifact.mjs --copy-to-dist"
```

(from inside `apps/hotel/`, so `npm run build` here means the workspace's
own `build`, and `scripts/build-artifact.mjs` is relative to
`apps/hotel/`). This would collapse §3 steps 2-3 into one command for
whoever deploys manually, without touching `netlify.toml` (see §4). The
orchestrator should add this if a single memorable command is wanted for
manual deploys.
