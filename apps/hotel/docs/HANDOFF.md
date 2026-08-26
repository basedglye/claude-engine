# GRAND FOYER — session handoff

Written 2026-08-26 at the Phase H2a → H2b boundary. This records **verified
state**, not plans. Anything described as working here was run, not assumed.

## Where the project is

Phases **H0**, **H1a**, **H1b** and **H2a** are merged to `main`, each PASS
after a review gate. `main` is green on the full battery (see "Commands").
Phase **H2b** is specced (`docs/PHASE-H2.md` §1 and the H2b half of every
section) and not started.

What the game actually does today: you walk a procedurally generated hotel
ground floor in first or third person, collide with walls, and open doors by
looking and clicking. Guests arrive on a **demand curve** shaped by your
prices, per-segment reputation and star tier; they queue at the front desk
and present an ID and a reservation slip. You take their papers, read them
at the in-world CRT, and accept or deny through RESERVA's rule table —
whose **procedures card grows** when your star tier rises. Checkouts leave
2–4 visible messes that **block re-letting** until you walk up and wipe
each one; props break overnight and take three presses to repair. Guests
review the stay at checkout; reviews become per-segment reputation and a
star tier **recomputed from a rolling 7-day window at every night audit**;
tier 2 activates the blacklist rule row, and MAILBOX delivers the bulletins
that fill its list. Three sim-derived objectives post each morning and
settle at the audit, and a missed one costs nothing. When cash crosses a
threshold LEDGER has printed every night since day one, résumés print as
real document entities on the desk, candidates walk in, you interview one in
person at the STAFF screen, and the clerk you hire then works the desk as
its own actor while you stand in your own lobby with nothing to do. Money
moves through paired double-entry ledger entries; F5/F9 save and reload
through IndexedDB to an identical `stateHash`.

## Read these before touching anything

- `apps/hotel/docs/DESIGN.md` — the game. Its rulings are binding: the
  terminal loop must **escalate**; every activity declares **pressure or
  zen**; progression is simulation-intrinsic with an explicit list of dark
  patterns not to ship.
- `apps/hotel/docs/ARCHITECTURE.md` — how. Records every rejected
  alternative so they are not re-litigated, and now records **how to
  measure a per-tick number** (B8) — read that before comparing any perf
  figure to a carried one.
- `docs/ROADMAP-HOTEL.md` — phases H0–H7 to multiplayer.
- `docs/PHASE-H2.md` — **H2b's spec is already written.** Its §1 split
  ruling is the load-bearing part: H2b's diff is *forbidden* from changing
  `stateHash`, and the H2b review's first act is asserting every headless
  golden pinned at the H2a merge is byte-identical.
- `docs/reviews/phase-H2a.md` — the verdict, its five items, and the
  implementer addendum recording which four were closed before the merge.
  **Its consolidated H2b deferral list is H2b's input.**

## The development loop (docs/WORKFLOW.md)

Fable 5 plans a phase spec → Sonnet 5 implements → Fable 5 reviews the diff
into `docs/reviews/phase-N.md` → fix until PASS → merge. Invariant or
public-contract changes escalate to a Fable planning turn. This loop has
caught things every build passed; do not shortcut it.

## Commands (all verified green on `main` at handoff)

```
npm run build
npx eslint .
node scripts/check-purity.mjs          # 8 roots; --self-test also passes
npm test                               # smoke, hash 3849639990 — pinned, must not move
npm run test --workspaces --if-present # 491 checks
```

Headless gates, all with `--verify-replay` (exit 3 = replay divergence or a
write-through violation = P0):
`smoke`, `demo-walk`, `bots-headless`, `walk-collide`, `corridor-headon`,
`checkin-rush`, `fraud-catch`, `fraud-catch-b`, `zen-clean`, `first-hire`,
`escalation-stars`, `one-man-week`.

Soaks: `net-walk`, `net-interest`, `net-abuse`, `soak-ci` (all `--soak`).

Browser gates (`--browser --verify-replay`, `--browser-engine firefox` for
the second engine): `fps-look-interact` (both engines),
`reserva-readability` (both engines), `save-restore`, `demo-visual`.

`npm run harness --silent -- <name>` — `--silent` is required or npm's
banner pollutes the verdict JSON. Verdict JSON must be written inside the
repo, not to `/tmp`: on this machine Git Bash `/tmp` paths do not round-trip
to the Node process.

`.claude/launch.json` starts the app on port **5199**, not 5173 — 5173 is
routinely held by another session's dev server, and per the traps below a
live server on it looks exactly like a stale bundle.

## Enforced rules you cannot break

1. **Sim purity + the transcendental ban.** `packages/{core,space,interiors,surface-ui,bots,net}/src`
   and `apps/hotel/src/sim` are purity roots. No `Math.sin/cos/tan/atan2/pow/exp/log/hypot/cbrt`,
   no `Math.random`. Use `@claude-engine/space`'s `sim-math`.
   `check-purity.mjs --self-test` proves the checker bites.
2. **Integers in sim state.** Positions in millimetres, angles in
   millidegrees, ratios in permille with truncating division. **No float
   ever lands in a component** — `reviews.ts` and `economy.ts` are the
   files most exposed to this and say so at the top.
3. **Write-through — CLAUDE.md invariant 6, new in H2a.** Sim code mutates
   components ONLY via `setComponent()`. `stateHash()` caches a
   per-(component, entity) digest that the write path invalidates, so
   `pos.x += dx` is invisible to the hash. `stateHashSlow()` is the
   cross-check, run every 500 ticks and at the end of both the live and
   replay legs. **Read `stateHashSlow()`'s comment before trusting it**: it
   catches a violator that is the entry's LAST writer, and a violator
   followed by a normal write to the same entry heals silently. The window
   is bounded, not closed.
4. **No closure state.** `Sim.restore()` reruns `setup()` fresh. The
   `tickCtx` in game.ts is legal only because `ctxFor` keys it on `s.tick`
   and rebuilds when the tick differs; the clerk's deliberation timer is a
   `staffWork` component for exactly this reason.
5. **Yaw is sim state, pitch is presentation.** The interaction raycast only
   *proposes*; the sim revalidates range and arc. Same posture for screen
   clicks and for every screen effect — each one flows through one validated
   apply function that the command form also reaches.
6. **Hosts render, sims decide.** Anything hashed lives in the sim.
7. **Every gate must be non-vacuous.** Break what it tests, confirm red,
   restore — and say so. Two gates in H2a were vacuous when first written
   and only perturbation showed it.
8. **Constant command counts** on browser gates (currently
   `fps-look-interact` 12, `reserva-readability` 20, `save-restore` 69,
   `demo-visual` 18). A green streak over a varying count is not a pass.

## Traps already hit — each with its lesson

- **`pkill` does not kill the Windows dev server.** Use PowerShell
  `Get-NetTCPConnection -LocalPort <port> | Stop-Process`.
- **`tsc` incremental skips rebuilding when only `dist` was mutated.** A
  perturbation test must `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game`
  before rebuilding, or the "restore" is a no-op and you draw the wrong
  conclusion. This bit twice more in H2a.
- **`npm run test -w @claude-engine/hotel` does not rebuild** when sources
  are unchanged, which is *why* a dist perturbation survives it — useful,
  but remember it when you expect a rebuild.
- **Under pointer lock, never move the mouse back to a previous x.** The
  deltas cancel and you silently do not turn.
- **`player-fps.onTick` submits its own `face` every tick**, so a `face` you
  `submit()` yourself is silently overridden.
- **Headless Chromium needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`**
  or Three's shaders fail silently to a blank canvas with no console error.
- **A gate can report a number that is not true.** Measure the artifact
  independently before trusting a probe's own figure.
- **A single-run `perf.avgTickMs` is cold-start JIT, not the sim.** The
  carried `checkin-rush ≤ 0.030` is not reproducible by that method on this
  machine even though the sim got ~35–40% faster. Use a warm in-process
  median and quote the method (ARCHITECTURE B8).
- **A browser scenario's `setup` builds only the REPLAY sim.** The page runs
  the app's own `setup()`. A browser gate can only click what the shipped
  world contains at the tick it runs — this is why H2a has no click gate for
  messes and candidates.
- **Subagents have reported "all green" when it did not reproduce.** Re-run
  gate claims yourself.

## What is NOT built

No textures or UVs (untextured vertex-colour only), no PS1 shader, **no
audio at all**, no `@claude-engine/audio` package, no `frame-time-p95` /
`draw-calls` probes, no load-on-boot persistence (F5/F9 only), no camera
boom clip. No multi-floor, stairs or elevators. No PURCHASE / CCTV /
BLUEPRINT / STREETVIEW (the registry stops at six apps). No housekeeper or
maintenance NPCs — the player is still the zen loop. No role XP, mastery,
prestige, contracts, inspections, loans. No guest archetype behaviours. No
forgery visuals. No multiplayer wiring.

## Open items carried into H2b (full list in `docs/reviews/phase-H2a.md`)

1. **The upkeep-click browser gate.** Messes, props, candidates and printed
   résumés render and are clickable — verified by driving the running build
   (evidence: `apps/hotel/docs/evidence/h2a-upkeep-objects.png`) — but there
   is **no repeatable gate** for those clicks, because of the browser-setup
   trap above. The reviewer's ruling: acceptable for H2a, and **if H2b
   arrives without it, H2b's review should treat it as blocking.** The
   suggested route is a scenario config that pre-dirties a lobby-adjacent
   room at setup.
2. **The H1b carries, all H2b-scheduled by the spec's own ledger:**
   quick-load id-switch + `listGames`/`deleteGame` + the `"./recover"`
   exports subpath + the `save-resume` gate (which must not inherit
   `save-restore`'s pinned-pose no-op dependency); `resetEntityKeyedHostState()`
   exercised for real — it now also clears the upkeep interactable guard;
   `player-fps`'s `objectToEntity` reverse-map prune; the boom clip.
3. **Phase 3+ carries, triggers unchanged:** `space` clearance-aware A*
   extraction (second consumer or crowd scale); guests never close doors;
   `debug.*` rejection in server validation (Phase 5, before any remote
   actor exists).

## Verified starting facts for H2b

- **Byte-identical goldens are H2b's first review check.** As pinned at this
  merge: smoke **3849639990**, `checkin-rush` **1978775531**,
  `one-man-week` **3423109909**. The interiors mesh golden re-pins in H2b
  (that is expected and named in the spec); nothing else may move.
- `one-man-week` runs 42,000 ticks at **0.445 ms/tick** against a 1.0
  budget, at ~195 entities.
- The incremental hash is **6.6×** cheaper than the full walk at a
  300-entity fixture — below the ≥10× the spec expected, recorded as
  measured.
- `reserva-readability` reads texelScale **1.38**, calibContrast **241.3**,
  pitchErr **0**. H2b's `art-lock` must hold ≥1.0 / ≥60 / ≤0.1 with the PS1
  shader live on everything else.
- The shell registry is `["reserva","audit","ledger","pricer","mailbox","staff"]`,
  exported as `HOTEL_APPS`; the composed-shell overflow gate derives its
  list from it, so app seven cannot silently skip the gate.
- `ScreenViewData` is at **exactly 9 of its 9-key budget**. A tenth key is
  the moment to ask whether the view should be per-app, not the moment to
  add the key.
- **The remote is stale.** `origin/main` is 48 commits behind local `main`
  and carries one commit local `main` does not (`6056b9f`, a CI build-order
  fix) whose substance the local build script already supersedes. Nothing in
  this project has been pushed; decide deliberately before you do.
