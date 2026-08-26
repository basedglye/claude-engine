# GRAND FOYER — session handoff

Written 2026-08-25 at the Phase H1 → H2 boundary. This records **verified state**, not plans. Anything described as working here was run, not assumed.

## Where the project is

Phases **H0**, **H1a** and **H1b** are merged to `main`, each PASS after a multi-round review gate. `main` is green on the full battery (see "Commands" below). Phase **H2** is specced and not started.

What the game actually does today, driven and confirmed in a browser: you walk a procedurally generated hotel ground floor in first or third person with mouse look, collide with walls, and open doors by looking and clicking. Guests spawn on the street, walk in, queue at an explicit slot chain at the front desk, and present an ID and a reservation slip. You take their papers and read the real field values held up in front of you. You walk to the desk terminal, focus it, and read RESERVA on an in-world CRT — the guest's documents beside the reservation on file, plus a procedures card listing the active rules. You click a room and click ACCEPT; the guest checks in and walks to their room. Money moves through paired double-entry ledger entries, a four-phase day clock closes on a night audit, and F5/F9 save and reload through IndexedDB to an identical `stateHash`.

## Read these before touching anything

- `apps/hotel/docs/DESIGN.md` — the game. Its rulings are binding: the terminal loop must **escalate**; every activity declares **pressure or zen**; progression is simulation-intrinsic with an explicit list of dark patterns not to ship.
- `apps/hotel/docs/ARCHITECTURE.md` — how. Records every rejected alternative (CSS3D, troika, HTML-in-canvas, a physics engine, GLTF+skinning) so they are not re-litigated.
- `docs/ROADMAP-HOTEL.md` — phases H0–H7 to multiplayer.
- `docs/PHASE-H2.md` — **the next phase's spec, already written.** It splits H2 into H2a (everything that changes `stateHash`, all gates headless) and H2b (everything forbidden from changing it, all gates browser). Start there.
- `docs/reviews/phase-H1b.md` — its **round-2 consolidated deferral list** is H2's input, and `PHASE-H2.md` already carries it as a ledger table with a disposition per item.

## The development loop (docs/WORKFLOW.md)

Fable 5 plans a phase spec → Sonnet 5 implements → Fable 5 reviews the diff into `docs/reviews/phase-N.md` → fix until PASS → merge. Invariant or public-contract changes escalate to a Fable planning turn. This loop has caught things every build passed; do not shortcut it.

## Commands (all verified green on `main` at handoff)

```
npm run build
npx eslint .
node scripts/check-purity.mjs          # 8 roots; --self-test also passes
npm test                               # smoke, hash 919868270 — pinned, must not move
npm run test --workspaces --if-present # 349 checks
```

Headless gates, all with `--verify-replay` (exit 3 = replay divergence = P0):
`corridor-headon`, `checkin-rush`, `fraud-catch`, `fraud-catch-b`, `walk-collide`

Browser gates (`--browser --verify-replay`, `--browser-engine firefox` for the second engine):
`fps-look-interact` (both engines), `reserva-readability` (both engines), `save-restore`, `demo-visual`

`npm run harness --silent -- <name>` — `--silent` is required or npm's banner pollutes the verdict JSON.

## Enforced rules you cannot break

1. **Sim purity + the transcendental ban.** `packages/{core,space,interiors,surface-ui,bots,net}/src` and `apps/hotel/src/sim` are purity roots. Zero `Math.sin/cos/tan/atan2/pow/exp/log/hypot/cbrt`, zero `Math.random`. Use `@claude-engine/space`'s `sim-math` (fixed-point LUT trig over integer millidegrees). `check-purity.mjs` enforces it and its `--self-test` proves it bites.
2. **Integers in sim state.** Positions in millimetres, angles in millidegrees. No float ever lands in a component.
3. **No closure state.** `Sim.restore()` reruns `setup()` fresh before restoring components, so any closure that accumulates command-derived state silently drops replayed data. The queue is derived by scanning each tick; the repath cursor is a `navSchedule` component. This bug class cost Phase 3 two review rounds and is checked every review.
4. **Yaw is sim state, pitch is presentation.** The interaction raycast only *proposes*; the sim revalidates range and arc. Same posture for screen clicks.
5. **Hosts render, sims decide.** Anything hashed lives in the sim; the host reads `IWorld` and submits commands.
6. **Every gate must be non-vacuous.** Break what it tests, confirm red, restore — and say so. Several gates in this repo shipped green while testing nothing.
7. **Constant command counts** on browser gates. A green streak over a varying count is not a pass.

## Traps already hit — each with its lesson

- **`pkill` does not kill the Windows dev server.** A live server looked like a stale bundle and sent me chasing the wrong thing. Use PowerShell `Get-NetTCPConnection -LocalPort 5173 | Stop-Process`.
- **`tsc` incremental skips rebuilding when only `dist` was mutated.** Perturbation tests that edit build output need `rm -rf dist` before restoring, or the "restore" is a no-op and you draw the wrong conclusion.
- **`player-fps.onTick` submits its own `face` every tick**, so a `face` you `submit()` yourself is silently overridden. Turn the player with `window.__WORLDFORGE__.pointer.look(dx, 0)` at 220 mdeg/px.
- **Under pointer lock, never move the mouse back to a previous x.** The deltas cancel and you silently do not turn. This cost a whole measurement run.
- **Headless Chromium needs `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`** or Three's shaders fail silently to a blank canvas with no console error.
- **A rendering symptom that looks like a texture bug may be an occluder.** The screen "losing its right 27%" was the desk occluding it; the tell was that the screen *and* its housing compressed by the same factor while heights stayed correct. Geometry does not do that.
- **A gate can report a number that is not true.** `screenRect` claimed `texelScale` 1.38 while the pixels said 1.005. Measure the artifact independently before trusting a probe's own figure.
- **Subagents have reported "all green, constant across N runs" three times when it did not reproduce.** Re-run gate claims yourself, and for anything intermittent run enough times to see the distribution.

## What is NOT built

No textures or UVs (untextured vertex-colour only), no PS1 shader, no audio at all, no housekeeping or maintenance, no staff or hiring, no reviews/reputation/stars, no demand curve or pricing, no LEDGER/PRICER/MAILBOX/STAFF apps (only RESERVA and AUDIT), no multi-floor, no stairs or elevators, no multiplayer wiring. Guests arrive → queue → present → room → leave; no other needs or behaviours.

## Open items carried into H2 (full list in `docs/reviews/phase-H1b.md` round 2)

- Quick-load persistence semantics: the pump keeps appending to the old game id after a load, so the persisted log is a two-branch chimera. **Latent** — nothing recovers at boot today — but a save UI or load-on-boot is the trigger. Needs `listGames`/`deleteGame` (additive, review turn) and a `"./recover"` exports subpath on `persistence`.
- `resetEntityKeyedHostState()` exists as the seam but has never been exercised for real.
- `debug.saveRestoreRecord` is an unvalidated hash-affecting command in the production sim. **Hard trigger: MP wiring** — server validation must reject `debug.*` before any remote actor exists.
- `space.findPathCells` is unsafe for radius-bearing agents; the hotel's clearance-aware A* is the only safe path. No new callers for collider agents until it is extracted.
- Pattern obligations: every new screen app needs decision-path coverage (clicks at `layout()`-derived coordinates, both branches, the guard) and a composed-shell overflow entry.
- `plantViolation`'s `listed` branch is committed-wrong code; H2 activates the blacklist, so H2 is likely its trigger.

## Verified starting facts for H2

- `checkin-rush` runs **0.030 ms/tick at ~60 entities** — the number the `indexSystem` refactor must beat.
- The `reserva-readability` probe reads texelScale 1.38, calibration contrast 241.3, pitch error 0. Blur drops contrast to ~41 and reds the gate.
- Smoke hash **919868270** is pinned repo-wide. Incremental `stateHash` in H2a re-pins every golden **exactly once**, at the start of that sub-phase.
- The interiors golden for `hotel-h0-look-1` is `0x752bc750`.
- Browser gates currently show byte-constant command streams: `fps-look-interact` 12, `reserva-readability` 20, `save-restore` 69.
