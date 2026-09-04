# C2-W3 — Hosting: the verified Netlify deploy sequence (and `dist/play.html`)

You are lane C2-W3 of three concurrent lanes on branch
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
5. **A lane may not edit a file outside its declared globs.** If it needs
   to, it stops and reports the need.
7. **Every lane brief carries a verification command list and a
   non-vacuity obligation.** The obligation is specific: *break this exact
   thing, confirm the gate reds on this exact assertion, restore by clean
   rebuild, confirm green, report all four exit codes.*
8. **Every lane brief carries the rebuild discipline verbatim:** before
   any perturbation claim, `rm -f apps/hotel/tsconfig.game.tsbuildinfo &&
   rm -rf apps/hotel/dist-game` then rebuild — otherwise the "restore" is
   a no-op. This trap has bitten four times.
9. **Verdict JSON is written inside the repo.** Git Bash `/tmp` paths do
   not round-trip to the Node process on this machine.
10. **`npm run harness --silent -- <scenario>`** — without `--silent`,
    npm's banner pollutes the verdict JSON.
11. **Report format, fixed:** files touched; every command run with its
    exit code; the perturbation performed and the exact assertion that
    went red; **and what you did NOT do**. A lane that could not finish
    says so; a lane that skipped a verification step says so, unprompted.
13. **A finished lane does not pick up new work.** It reports and stops.

## 0.1 Dev-server rule

**Port 5205 is yours** for any static serving you do. Never 5199
(`.claude/launch.json`'s port), never 5173 (routinely held by another
session; a live server there looks exactly like a stale bundle), never
5202/5203/5204 (other live lanes). Kill it when done — `pkill` does not
kill the Windows dev server; use
`Get-NetTCPConnection -LocalPort 5205 | Stop-Process`.

## 0.2 The hard boundary of this lane

**You do not deploy.** You do not run `netlify deploy`, `netlify deploy
--prod`, `netlify link`, `netlify init`, `netlify sites:create`, or
anything else that talks to Netlify's API or publishes to a URL. You do
not authenticate. You do not create a site. Publishing to a public URL is
the orchestrator's action and requires the user's go-ahead.

Your deliverable is **the exact sequence someone else will run**, with
every locally-runnable step actually run and its real output recorded, and
every remote step written down precisely enough to execute without
guessing. `netlify --version` and `netlify --help` / `netlify deploy
--help` are read-only and fine.

---

## 1. Goal

VISION-ALPHA lists two deliverables for shipping: the single-file artifact
(done, 1.8 MB, published) and **"Hosted: the same build on Netlify as the
fallback."** The config exists and was proven correct in cycle 1. Nothing
has ever been deployed.

You produce three things:

1. **`apps/hotel/docs/HOSTING.md`** — the exact deploy command sequence,
   in order, with real observed output for every step you could run and
   precise instructions for the steps you must not.
2. **`dist/play.html`** — the single-file artifact copied into the Vite
   output so the hosted site serves *both* products: the streaming build
   at `/`, the self-contained one at `/play.html`. Implemented inside
   `build-artifact.mjs` behind an explicit flag.
3. **Proof that `npm run build -w apps/hotel` + the artifact build produce
   a directory that actually serves**, by serving it and driving it.

---

## 2. Files you may touch (nothing else)

```
apps/hotel/scripts/build-artifact.mjs   (the --copy-to-dist flag)
apps/hotel/netlify.toml                 (only if the copy needs a config change)
apps/hotel/docs/HOSTING.md              (new file, yours)
```

**Read-only for you:** everything else in the repo. Specifically nothing
under `apps/hotel/src/`, nothing under `packages/`, nothing under
`scenarios/`, no `package.json` (see §5 — you will need a script added and
you ask for it), and nothing else under `apps/hotel/docs/`.

**Contested — orchestrator-only:** `apps/hotel/src/main.ts`,
`apps/hotel/index.html`, `apps/hotel/package.json`, `package.json`,
`package-lock.json`, `apps/hotel/vite.config.ts`, `.claude/launch.json`,
`CLAUDE.md`, `docs/**`, and everything under `apps/hotel/docs/` other than
`HOSTING.md`.

---

## 3. What already exists, verified (do not re-derive from scratch)

**`apps/hotel/netlify.toml`** — correct as of cycle 1's review round 2:

```toml
[build]
  command = "npm run build -w apps/hotel"
  publish = "apps/hotel/dist"
```

No `base` on purpose. Netlify's default base **is** the repo root;
`command` always runs from `base`, and `publish` is resolved relative to
`base`. `npm run build -w apps/hotel` is a workspaces invocation that only
resolves from the repo root (`apps/hotel/package.json` declares no
workspaces) and needs the root `node_modules` plus the built workspace
packages either way. Proven in cycle 1: from the repo root the command
exits 0 (`tsc -p tsconfig.game.json` then `vite build`, 353 modules) and
`apps/hotel/dist/` afterwards contains `index.html` (586 B) and
`assets/index-*.js`.

**`apps/hotel/scripts/build-artifact.mjs`** — writes
`apps/hotel/dist-artifact/grand-foyer.html` (~1.8 MB) or the path given via
`--out <path>`. It already:

- **checks `dist/` freshness**: walks `apps/hotel/src/` for the newest
  mtime and refuses (exit 1, no output written) when it is newer than
  `dist/index.html`, naming both mtimes and the command to run;
- **seals the `/assets/` fetch shim**: any unmatched path under `/assets/`
  gets a synthetic `404 "Not Found (sealed /assets/ shim)"` rather than
  delegating to the real `fetch`; delegation is retained outside
  `/assets/`. Proven in a running page: one request total (the document),
  and a probe fetch for a texture returns the sealed 404 without reaching
  the server;
- is **deterministic**: no timestamp, no random id; two runs against the
  same `dist/` produce the same size and asset count.

**The ~90 MB CC0 PBR/HDRI payload is gitignored and not in the repo.** So
the *hosted* build is the procedural (flat-colour) build, not the
real-hotel look, unless the payload is fetched on Netlify's own checkout.
That is a fact you must state plainly in `HOSTING.md` — the `netlify.toml`
header already says it, and the hosted site is the fallback for the
artifact, not a second product. If you can see a clean way to run
`npm run assets:fetch -w apps/hotel` as part of the Netlify build, write
it up as an **option with its trade-offs** (build time, Netlify's build
limits, whether the upstream CC0 hosts are reliable enough to gate a
deploy on) — do not adopt it unilaterally.

---

## 4. The `dist/play.html` copy

Add a flag to `build-artifact.mjs` — suggested `--copy-to-dist` — that,
after the artifact is successfully written, also copies it to
`apps/hotel/dist/play.html`.

Requirements, each with its reason:

- **Behind a flag, off by default.** A plain artifact build must not
  silently write into `dist/`; `dist/` is Vite's output and something
  appearing in it unbidden is exactly the kind of surprise that gets
  debugged for an hour.
- **After the freshness check, in the same run that writes the artifact.**
  Never a documented `cp` step in prose. A `dist/play.html` written from a
  stale `dist-artifact/grand-foyer.html` is precisely the class of failure
  this project has been bitten by four times, and prose cannot enforce
  ordering.
- **Refuse rather than half-succeed.** If the copy fails, exit non-zero
  with a message naming both paths; do not leave a partial file.
- **Deterministic**: byte-identical to the artifact. Verify with `cmp`.
- Print what it did (`build-artifact: copied to apps/hotel/dist/play.html
  (N bytes)`).

Then confirm the whole thing serves. The Netlify build produces `dist/`
from `npm run build -w apps/hotel` — which does **not** run
`build-artifact.mjs` — so say clearly in `HOSTING.md` that the deploy
sequence must run the artifact build with `--copy-to-dist` *between* the
Vite build and the deploy, and that a `[build] command` that chains both
is the alternative. If you propose changing `netlify.toml`'s `command`
to chain them, do it and prove the chained command exits 0 from the repo
root; if you judge it riskier than the manual sequence, say why and leave
the TOML alone. Either answer is acceptable; an unstated choice is not.

---

## 5. `apps/hotel/docs/HOSTING.md` — what it must contain

1. **What is hosted and what is not.** The artifact is the primary
   deliverable; this is the fallback. The hosted build is the procedural
   look unless the asset payload is fetched at build time. Say it once,
   plainly, near the top.
2. **The two URLs the site will serve**: `/` (streaming Vite build) and
   `/play.html` (the self-contained artifact), and when a person would want
   each.
3. **Preconditions**, with the command that checks each: Netlify CLI
   installed (`netlify --version`, record the actual version you observed
   or state plainly that it is not installed on this machine), an
   authenticated account, and a site to deploy to.
4. **The exact command sequence, numbered, copy-pasteable**, from a clean
   checkout to a live URL — including the clean-rebuild steps, the
   workspace build, the artifact build with `--copy-to-dist`, and the
   `netlify deploy` invocations (draft first, then `--prod`), with the
   exact flags (`--dir`, `--site`, `--prod`) spelled out and each flag's
   value explained. Mark clearly which steps you ran and which you did
   not.
5. **What the orchestrator must decide or supply**: site name/ID, team,
   whether to link the repo for continuous deploys or use manual CLI
   deploys, and the custom-domain question if any.
6. **Verification after deploy** — what the orchestrator should load and
   check to call it done: both URLs, the browser console clean, and (for
   `/play.html`) the network panel showing no external requests beyond the
   document.
7. **Rollback**: how to revert to a previous deploy from the CLI.
8. **Known gaps and gotchas** you actually hit.

Write it for someone who has never touched this repo. Every fact in it
must be one you observed or one you can point at in a file — no
remembered Netlify behaviour.

---

## 6. Verification commands and expected outcomes

You touch no `src/` file and no scenario, so **nothing may move**:

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
npm run test --workspaces --if-present         # exit 0
npm run harness --silent -- alpha-loop --verify-replay    # exit 0, passed: true
npm run harness --silent -- one-man-week --verify-replay  # exit 0, passed: true
```

The build-and-serve proof, which is the substance of this lane:

```
npm run build -w apps/hotel                                   # exit 0, from the repo ROOT
node apps/hotel/scripts/build-artifact.mjs --copy-to-dist     # exit 0
ls -la apps/hotel/dist/                                       # index.html, assets/, play.html
cmp apps/hotel/dist/play.html apps/hotel/dist-artifact/grand-foyer.html   # identical
```

Then serve `apps/hotel/dist/` on **5205** from a bare `node:http` server
that logs every hit, and drive **both** URLs in Playwright with a real
GPU:

```js
const browser = await chromium.launch({
  headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"],
});
```

(`artifacts/shoot.mjs` is a working reference for the launch args, the
`window.__WORLDFORGE__` wait, and screenshots. The embedded Browser pane
refuses pointer lock — drive with
`window.__WORLDFORGE__.pointer.lock()/look()` and `page.keyboard`.)

For each URL report: page errors, console errors, `world.tick` after ~12 s
(non-zero means the sim is running), a screenshot, and the **full list of
non-data requests**. For `/play.html` the expected non-data request count
is **1** — the document itself. For `/` expect the document plus its Vite
chunk, plus whatever `public/assets` happens to contain locally; list
them.

---

## 7. Non-vacuity obligation

The thing most likely to fail silently here is the copy shipping stale, so
that is what you prove is caught.

1. Run `node apps/hotel/scripts/build-artifact.mjs --copy-to-dist` clean.
   Expect exit 0 and `cmp` identical. Record the exit code.
2. **Perturb:** `touch apps/hotel/src/main.ts` (do **not** edit it —
   `main.ts` is orchestrator-only; `touch` only moves the mtime), then
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, and re-run the artifact build with
   `--copy-to-dist` **without** rebuilding `dist/`. Expect the freshness
   check to refuse: exit 1, both mtimes named, **no file written and
   `dist/play.html` not modified**. Quote the exact refusal message,
   record the exit code, and confirm by `stat` that `dist/play.html`'s
   mtime did not change.
3. **Restore:** `npm run build -w apps/hotel`, then re-run with
   `--copy-to-dist`. Expect exit 0 and `cmp` identical again.
4. Report **all four exit codes**.

Second, smaller check, on the flag's default: run
`node apps/hotel/scripts/build-artifact.mjs` **without** `--copy-to-dist`
into a fresh `dist/` and confirm `dist/play.html` is **not** created.
A flag that is on by default is not the flag that was asked for.

---

## 8. Report format (fixed)

1. **Files touched** — every path with a one-line summary.
2. **Every command run, with its exit code**, including the serve-and-drive
   output for both URLs.
3. **The perturbation** — the stale-copy refusal: the exact message, the
   four exit codes, the `stat` evidence that `dist/play.html` was
   untouched; plus the default-off check.
4. **The two URLs** — for each: page errors, console errors, `world.tick`,
   screenshot path, and the full non-data request list with its count.
5. **The deploy sequence** — the file path to `HOSTING.md`, plus an
   explicit list of **which steps you ran and which you did not** (every
   Netlify-API step must be in the second list).
6. **The `netlify.toml` decision** — whether you chained the artifact
   build into `[build] command` or left the TOML alone, and why.
7. **The asset-payload question** — your written-up option for fetching
   the ~90 MB CC0 payload at Netlify build time, with trade-offs, and your
   recommendation. Recommendation only; the orchestrator decides.
8. **What you did NOT do** — anything skipped, unfinished, or only
   partially verified. Say it unprompted. "I did not deploy" belongs here
   and is correct.
9. **Wiring you need from the orchestrator** — at minimum, whether
   `apps/hotel/package.json` should gain a script such as
   `"build:hosted": "npm run build && node scripts/build-artifact.mjs --copy-to-dist"`
   (that file is orchestrator-only this cycle; ask, do not edit).
