# Phase 3 review — step-3 gate verdict

Reviewer: Fable 5 (review gate per [docs/WORKFLOW.md](../WORKFLOW.md))
Branch reviewed: `phase-3` at `38c74c8` ("Phase 3 Scope G: demo net mode,
skill docs, CI wiring"), diffed against `main` (8 commits: one CI
build-order fix + one commit per scope A–G).
Spec: [docs/PHASE-3.md](../PHASE-3.md). All verification below was re-run by
the reviewer on Windows 10 / Node 24.12.0; no implementer claims were taken
on trust. (`npm ci` fails on this Windows checkout with EPERM unlinking
`esbuild.exe` — a sandbox/file-lock artifact, not a branch defect; `npm
install` per the gate's stated fallback, then everything else as specified.)

## Verdict: FIX-LIST (7 items)

The build surface is in genuinely good shape — all five packages exist and
are well-designed, purity/lint/plugin gates are green, the smoke hash
919868270 survives the `forkRng` migration, `CLAUDE.md`, `types.ts`, and
`renderer-three` are all zero-diff, every committed soak scenario passes
over real sockets and replays headlessly with matching hashes, and the
Scope A restore machinery (including the flagged snapshot deep-clone bug
fix) is correct as verified by reviewer-written repros. But the phase's own
grounding criterion — *"a persisted multiplayer session survives a server
restart with replay-equivalent state"* — is **false as shipped**, twice
over (items 1 and 2, both confirmed by executable repros committed to this
review's evidence), and the shipped test suites are green anyway because
neither path is exercised: the persistence golden has no commands, the
server suite never configures a store, and soak runs storeless. That gap
between green checks and a false flagship claim is precisely what this gate
exists to catch.

1. **[Grounding criterion + invariant #3 — blocking] A persisted
   multiplayer session does NOT survive a server restart with
   replay-equivalent state: the reference game pattern keeps sim state in a
   setup closure that `Sim.restore()` cannot rebuild.**
   `scenarios/lib/net-game.mjs:11` (and identically
   `apps/demo/src/game.ts:42`) tracks `entityByActor` in a `Map` captured
   by the setup closure, populated on `@net/join`. `Sim.restore()` replaces
   *component* data only (correctly — systems are code); it cannot
   reconstruct closure state accumulated from pre-snapshot commands. So
   after `recoverSim` (fresh `setup()` → empty map → restore snapshot), any
   actor who joined *before* the latest snapshot has an entity in the
   restored components but no map entry, and every replayed tail command
   for that actor is silently dropped (`entity === undefined → continue`).
   Reviewer repro (scratchpad `reviewer-restart-repro.mjs`): join at tick
   1, moves at 2/4/8/12, snapshot at 6, crash at 15, `recoverSim`, run to
   30 — recovered pos `{x:1,z:1}` vs continuous `{x:1,z:2}`, hashes
   198819683 vs 194278080. **Not replay-equivalent.** No shipped test
   catches this because none composes join → snapshot → tail (see items 2
   and 6).
   **Fix**: the engine contract is fine; the *taught pattern* violates it.
   Rewrite the join/leave/move handling in `scenarios/lib/net-game.mjs` and
   `apps/demo/src/game.ts` to derive the actor→entity lookup from the
   `owner` component (e.g. scan `withComponent("owner")`, or rebuild a
   local index lazily by comparing against component state) instead of a
   closure map; state the constraint explicitly in
   `plugin/skills/worldforge/references/core-api.md` (restore section) and
   `references/net-api.md` (workflow step 1): *all cross-tick sim state
   must live in components; setup closures may capture setup-spawned
   entities but must never accumulate command-derived state*. Add a test
   (persistence or server suite) that runs join → mid-run snapshot →
   post-snapshot commands → crash → `recoverSim` → hash-equal
   continuation. Re-verify with the repro timeline above.

2. **[Scope C write-ahead contract + invariant #3 — blocking] Commands
   accepted during `await store.appendCommands(...)` execute in the
   imminent tick but appear in neither `commandLog()` nor the persisted
   log — state gets ahead of the log, the exact failure the write-ahead
   design exists to prevent.**
   `packages/server/src/server.ts:344-354` (`doTick`): the tick's commands
   are copied (`[...sim.commands()]`, line 351), then the append is
   `await`ed (line 354), then `sim.step()` runs. During that await, ws
   `message` handlers keep calling `sim.submit()` directly (line 291), and
   the `hello`/`close` handlers keep submitting `@net/join`/`@net/leave`
   (lines 233, 299) — all stamped `sim.tick + 1`, all landing in
   `pendingCommands`, all executed by the imminent `step()` (core's
   `commands()` returns the whole pending queue; `step()` clears it), and
   none ever recorded. Invisible with `better-sqlite3` (its wrapped-sync
   promises resolve in microtasks; socket macrotasks cannot interleave) —
   which is why the sqlite tests pass — but real for `pg` or any genuinely
   async `GameStore`. Reviewer repro (scratchpad
   `reviewer-writeahead-race.mjs`, sqlite wrapped with one `setTimeout` to
   emulate pg's macrotask boundary, one client pumping moves for 3 s):
   **266 commands accepted, 196 logged; server final hash 1687944674,
   replay of its own authoritative log 2080956090.** The Postgres
   service-container job never catches this because the persistence suite
   tests the store in isolation, never under a live server.
   **Fix**: never `sim.submit()` from socket handlers. Buffer validated
   intents (and join/leave) in a host-side queue; at the top of `doTick`,
   drain the queue synchronously → submit → copy → append (write-ahead) →
   step. That makes the copied set provably identical to what `step()`
   consumes regardless of store latency. Add a server test with a
   deliberately macrotask-async store asserting
   `commandsAccepted === logged` and log-replay hash equality (the repro
   above is a ready-made shape).

3. **[Exit criterion 10 — blocking, small] The server test suite is flaky:
   `onceMessage` races the 20 Hz state broadcasts.**
   `packages/server/scripts/test.mjs:45` resolves with whichever frame
   arrives next; once a session is open the server broadcasts `state` every
   50 ms (`stateEveryTicks` default 1), so the awaited `reject`/`close`/
   `welcome` checks (lines 108–129) intermittently read a `state` frame
   instead. Observed live by this gate: first run FAILED ("unregistered
   command type rejects with unknown-type"), five subsequent runs passed
   (~1-in-6). Criterion 10 requires this suite to exit 0; a suite that
   fails on timing is not green.
   **Fix**: replace `onceMessage` with a `messageOfType(ws, t)` helper that
   discards non-matching frames (and a timeout). No product code change
   required for this item.

4. **[Scope C session lifecycle — small] Superseding a duplicate playerId
   submits a second `@net/join` for the same actor with no intervening
   `@net/leave` — both reference games leak the old entity on reconnect.**
   `closeSession` (`packages/server/src/server.ts:217`) deletes the evicted
   session from `sessions` before `ws.close()`, so the later `close` event
   (line 299) finds nothing and never submits `@net/leave`; the new
   connection's `@net/join` (line 233) then arrives for an actor the game
   already tracks. `net-game.mjs` and `apps/demo/src/game.ts` both respond
   by spawning a fresh entity and overwriting their map entry, orphaning
   the old entity's components forever (still replicated, still owned by
   the same actor under `radiusInterest`). Deterministic and replayable, so
   invariant #3 survives — but it's wrong behavior in the engine's own
   "reconnect-friendly" flow, and the spec's promise that lifecycle is
   fully represented in the command log is broken (the log shows two joins,
   zero leaves, one connection).
   **Fix**: in the supersede path, submit `@net/leave` for the evicted
   session before submitting the new `@net/join` (keeping log ↔ lifecycle
   1:1), or explicitly define and document reconnect-continuity semantics
   (no leave AND no second join). Either way, add a server test asserting
   the command log after a supersede, and make the reference games'
   join handlers idempotent per actor.

5. **[Exit criterion 1 — small] The purity self-test has no
   `packages/bots/src/**` fixture.**
   Criterion 1 requires `--self-test` to demonstrate non-zero exit for
   violations planted in `packages/net/src/**` (non-web) **and**
   `packages/bots/src/**`. `scripts/check-purity.mjs:229-230` plants
   fixtures for assets and net only. The *real* gate does cover bots — this
   reviewer planted `Math.random()` in `packages/bots/src/` and
   `check:purity` exited 1 naming it — so enforcement is genuine; the
   self-test's proof-of-coverage is what's missing, and criterion 1 names
   it explicitly.
   **Fix**: plant a bots-root fixture in `runSelfTest` (the
   `testWebExclusion` helper generalizes; bots just has no web dir — a
   plain planted-violation check suffices) and add it to the pass/fail
   summary lines.

6. **[Exit criterion 8 — small] The crash-recovery golden never exercises
   the snapshot → restore → replay-tail composition it exists to prove.**
   `packages/persistence/scripts/test.mjs:61-66`: the flagship golden
   appends an **empty** `commandsSoFar` array and saves its snapshot at the
   crash tick itself — so recovery is restore-only (empty tail), and the
   only command-replay coverage (`gameId2`) has no snapshot (afterTick 0).
   The spec's own golden is "N ticks **appending commands** + a mid-run
   snapshot … recoverSim … continue to 2N". The composed path *is*
   functionally correct for component-state games — this reviewer verified
   it with a repro (snapshot at tick 10, commands at 14/17, hash-equal at
   2N) — so this is a coverage gap, not a code bug; but it is exactly the
   gap that let item 1 ship green.
   **Fix**: strengthen the golden to append real commands both before and
   after a snapshot taken strictly before the crash tick; ideally use a
   join-style setup so it doubles as item 1's regression test.

7. **[Invariant #2 discipline — small] `setupWithLandmarks` hand-rolls an
   inline LCG in committed scenario code.**
   `scenarios/lib/net-game.mjs:52` constructs an ad-hoc
   `s * 1103515245 + 12345` generator instead of the seeded `Rng`.
   Deterministic and fixed-seed, so replayability is not actually harmed —
   but CLAUDE.md invariant #2 says *all* randomness in sim code goes
   through the seeded `Rng`, `core-api.md` explicitly teaches
   `sim.rng.fork(label)` as the sanctioned pattern for exactly this
   (transient setup-local derivation whose outputs land in components), and
   committed scenarios are the reference material agents copy.
   **Fix**: replace the inline LCG with `sim.rng.fork("landmarks")` (or
   `sim.forkRng` — it's setup-time either way) and update the scenario's
   expected values if any assert on positions (none do today; only
   `net-interest`'s bounds consume it, which are distance-band-safe).

No other blocking findings. Everything below is the evidence.

## 1. Verification re-run (all commands executed by the reviewer)

| Command | Result |
|---|---|
| `npm install` (after `npm ci` EPERM, see header) | exit 0 |
| `npm run build` | exit 0 (all workspaces incl. demo tsc + vite; the branch's own commit `7e08231` fixes the clean-checkout build order — see §5) |
| `npm run lint` | exit 0 |
| `npm run check:purity` | exit 0 — core, assets, **net (excl. src/web)**, and **bots** roots all scanned clean |
| `node scripts/check-purity.mjs --self-test` | exit 0 — all prior classes CAUGHT plus net-root Math.random CAUGHT and net/web three-import EXCLUDED; **no bots fixture (fix-list item 5)** |
| Reviewer tamper test: `Math.random()` planted in `packages/bots/src/`, `npm run check:purity` | **exit 1**, violation named — real enforcement confirmed; file removed, re-run exit 0 |
| `npm run check:plugin` | exit 0 |
| `npm test` (root smoke) | exit 0 — replay equivalence PASS, hash **919868270** unchanged through the `forkRng` migration |
| `npm run test -w @claude-engine/core` | exit 0 — all 7 checks: Rng state round-trip, duplicate-label throw, fork-after-step throw, v:1 `RestoreError`, label-mismatch `RestoreError`, v2 snapshot shape, and the golden (continuous N == snapshot-at-N/2 → restore → tail, with root + tracked fork drawn on both sides) |
| `npm run test -w @claude-engine/net` | exit 0 — 19 checks: all criterion-9 items verified (pre-ack visibility, divergent-authority correction increment, latency-with-matching-predict stays 0, ack pruning, reject handling, oversized/malformed/reserved-type `ProtocolError` at decode) |
| `npm run test -w @claude-engine/bots` | exit 0 — 10 checks (seed determinism, memory persistence, scripted, randomWalk) |
| `npm run test -w @claude-engine/server` | **exit 1 on first run** ("unregistered command type rejects with unknown-type"), exit 0 on five re-runs — **flaky, fix-list item 3** |
| `npm run test -w @claude-engine/persistence` | exit 0 (sqlite suite) + `SKIP: postgres conformance suite (DATABASE_URL not set)` — the expected local behavior |
| `smoke --out v.json` → `--replay v.json` → `--replay v.json --from-checkpoint 50` | exit 0 / 0 / 0, `verified: true`; verdict checkpoints at 10/50/100 all `v: 2` |
| Reviewer scenario with a command at tick 60, `--from-checkpoint 50` after tampering that command | **exit 3**, `verified: false` (smoke itself has no commands past tick 20, so the criterion-3 tamper was exercised on an ad-hoc scenario honoring its letter) |
| smoke verdict, checkpoint-100 `stateHash` tampered, `--from-checkpoint 50` | **exit 3** |
| `--from-checkpoint 51` (no checkpoint) | **exit 2**, stderr "No checkpoint at tick 51 in this verdict" |
| checkpoint-50 snapshot edited to `v: 1`, `--from-checkpoint 50` | **exit 2**, stderr names it evidence-only, not restorable |
| `bots-headless --verify-replay --out b.json` | exit 0; `replayCheck.verified: true`; `replay.commands` contains 50 commands from `bot:wanderer` |
| `--replay b.json` (no bot code runs) | exit 0 |
| `net-walk --soak` | exit 0 — connected 2, rejected 0, avgReplicatedEntities 2, corrections 0 |
| feed net-walk soak verdict to `--replay` | **exit 0, `verified: true`, hashes 2597782750/2597782750** — a live two-client socket session reproduced headlessly |
| `net-interest --soak` | exit 0 — avgReplicatedEntities 2 vs server.entities 42 (interest measurably filters, max-bound 10 honored with room) |
| `net-abuse --soak` | exit 0 — rejectionsByReason `{unknown-type: 15, invalid-payload: 17, rate-limited: 144}`, 61 ticks completed, 16 accepted — the boundary holds and the loop never stalled |
| `soak-ci --soak` (10 clients, 10 s) + `--replay` of its verdict | exit 0 / exit 0 — 203 ticks, 0 disconnects, p95 0 ms |
| `soak-50 --soak` (50 clients, 60 s) | **exit 0** — connected 50, disconnected 0, tickP95Ms 1, tickMaxMs 5, 1216 ticks — criterion 11's local load test passes with 50× headroom on the 50 ms budget |
| `@net/join` from a client | rejected at decode (`ProtocolError`, net unit test) before any server/game code — criterion 6's reserved-prefix check; `startGameServer` additionally throws if a game registers an `@`-type rule |
| `npm run build:server -w @claude-engine/demo`; boot `dist-server/server.js`; raw-WebSocket handshake | exit 0; `welcome` with server-assigned `actor: "player:reviewer"`, tick advancing, initial replica delivered — criterion 12 wiring live-verified (see §3.12 for the two-tab proxy note) |
| `demo-walk` / `failing-example` / `smoke --verify-replay` / `node scripts/smoke.mjs` | exit 0 / exit 1 (as designed) / exit 0 / exit 0 — all pre-existing consumers pass unmodified |
| `git diff main..phase-3 -- CLAUDE.md` | **empty** |
| `git diff main..phase-3 -- packages/core/src/types.ts` | **empty** |
| `git diff main..phase-3 -- packages/renderer-three` | **empty** |
| Reviewer repro: snapshot deep-clone | snapshot taken, live component mutated, snapshot value unchanged — the claimed Phase-1/2 aliasing bug was real (old `[...store.entries()]` shared live refs; in-place `pos.x += dx` mutation would have back-written every serialized checkpoint) and the JSON-round-trip fix is correct |
| Reviewer repro: recoverSim with a real post-snapshot command tail (component-state game) | hash-equal with continuous run — the engine path works; the shipped golden just never runs it (fix-list item 6) |
| Reviewer repro: persisted restart with `@net/join` before the snapshot | **hash-divergent** — fix-list item 1 |
| Reviewer repro: macrotask-async store under a live server | **266 accepted / 196 logged, log replay diverges from server hash** — fix-list item 2 |
| `git status --short` after all runs | clean |

## 2. Fix-list evidence repros

The three decisive repro scripts are in the reviewer's session scratchpad
(`reviewer-restart-repro.mjs`, `reviewer-writeahead-race.mjs`,
`reviewer-repro.mjs`); their timelines and observed numbers are recorded
verbatim in fix-list items 1, 2, and 6 above so the fix stage can
reconstruct them without the scratchpad. Each uses only shipped public
surfaces (`Sim`, `replay`, `sqliteStore`, `recoverSim`, `startGameServer`,
`scenarios/lib/net-game.mjs`).

## 3. Exit criteria checklist

1. **Build/lint/purity + coverage — PARTIALLY MET (item 5).** All gates
   exit 0; net root/web self-test fixtures present and passing; bots
   enforcement real (reviewer tamper test) but not self-test-demonstrated
   as the criterion requires.
2. **Restore equivalence — MET.** All six named tests present and passing
   in `npm test -w @claude-engine/core`, golden includes a tracked fork
   drawn on both sides of the snapshot.
3. **Replay-from-checkpoint — MET.** All four paths verified live (0/3/2,
   plus v:1 → 2 with a clear message). Note: the criterion's literal
   "tamper a command with tick > 50 in [smoke's] v.json" is unexecutable —
   smoke's commands end at tick 20 — so the tamper was performed on an
   ad-hoc late-command scenario plus a checkpoint-hash tamper on smoke
   itself; both exit 3. Spec wording bug, not an implementation gap.
4. **Bots deterministic harness citizens — MET.** Verified live including
   replay-without-bot-code.
5. **Two clients over real sockets — MET.** net-walk green; verdict
   replays headlessly, hashes match exactly.
6. **The boundary holds — MET.** All three reject reasons nonzero against
   targets, ticks complete, reserved-prefix rejection confirmed at decode
   and at rule registration.
7. **Interest management filters — MET.** 2 avg replicated vs 42 server
   entities.
8. **Crash recovery hash-equivalent — PARTIALLY MET (items 1, 6).** The
   sqlite suite passes and Postgres skips cleanly without `DATABASE_URL`
   (CI has the service job), but the golden proves restore-only recovery;
   the composed snapshot+tail path is untested, and with the in-repo
   multiplayer game pattern it is genuinely broken (item 1).
9. **Prediction/reconciliation pure-headless — MET.** Every listed case
   has a passing fake-transport test; the `corrections` gating logic
   (only judged when no pending intent survives past the new ack) was
   read and its reasoning verified sound — while an intent is unacked,
   authority-lag is expected latency, and the test suite pins both the
   latency-not-a-correction and divergence-is-a-correction sides.
10. **Auth boring and enforced — PARTIALLY MET (item 3).** Every named
    behavior has a test and the behaviors themselves were verified live
    (auth-failed close precedes any sim interaction in code — the join is
    only submitted after `authenticate` returns non-null); but the suite
    is flaky, so "exits 0" is not reliably true. Expired-ticket rejection
    is unit-level (provider) rather than live-connection — acceptable
    composition, noting it.
11. **Soak at load — MET.** soak-50 local: 50/0/p95 1 ms; soak-ci in CI
    wiring as a required step of the main job.
12. **Demo multiplayer humanly playable — MET BY PROXY (per the
    criterion's own fallback and the Phase 2 precedent).** This gate
    cannot drive two interactive browser tabs; verified instead: the demo
    server builds and serves, a raw WebSocket handshake yields a correct
    `welcome`, `main.ts`'s `?net=` client wiring renders `session.world`
    entities colored by `owner`-vs-`session.actor` (code-reviewed), and
    net-walk proves two real clients replicate each other over the same
    machinery. The live two-tab check falls to the session owner at merge.
13. **Contracts untouched / changes exactly as declared — MET.**
    CLAUDE.md, `types.ts`, `renderer-three` zero-diff; smoke hash
    919868270 survives; all pre-existing scenarios/flags/exit codes/stdout
    discipline unchanged (verified live); `runScenario` signature
    unchanged; `verifyReplay` extended only by the optional third
    parameter; the only core format change is the flagged v1→v2 bump, and
    v1 remains readable (`SimSnapshotV1`) with `--replay` still accepting
    old verdicts (only `--from-checkpoint` requires v2, exit 2 says why).

## 4. Invariant / contract check

- **Invariant #1 (sim purity)**: enforcement extended by config exactly as
  specified — `check-purity.mjs` PURITY_ROOTS and the ESLint blocks now
  cover `packages/net/src/**` (minus `src/web/**`) and
  `packages/bots/src/**`; CLAUDE.md text untouched. Net's pure root
  imports only core + its own protocol; the sole environment touchpoints
  are `setInterval`/`Date.now` in the client session (host-side
  presentation machinery, not sim state — same standing as the render
  host's timers; auto-ping is disableable for tests).
- **Invariant #2 (determinism)**: the authoritative sim never sees
  wall-clock (the server's drift-corrected timer is host machinery,
  `startHostLoop`-style); bots draw from seeded `Rng`. One discipline
  violation in committed scenario code (fix-list item 7).
- **Invariant #3 (replayability)**: holds for every storeless session this
  gate ran (soak verdicts replay hash-exact). **Violated for persisted
  sessions** by items 1 and 2 — both must be fixed for the phase's central
  claim to be true.
- **Invariant #4 (hosts render, sims decide) — both new audit points
  pass**: (a) `server.ts`'s only sim-mutation paths are `sim.submit(...)`
  for validated intents and the reserved join/leave submissions — state
  broadcast is built from `snapshot()`/`stateHash()`/`eventsSince()` reads,
  and `snapshotByEntity`'s reuse of the deep-cloning `snapshot()` means
  replicated state never aliases live sim objects (the stated rationale
  holds; it also keeps `types.ts` zero-diff, at the cost of a full
  snapshot per broadcast — see §6 perf note); (b) `BotDriver.act` receives
  `IWorld` and returns intents; `createBot` closes over no sim. The
  `GameServer.world` property returns the concrete `Sim` typed as
  `IWorld` — same exposure pattern as the harness; acceptable, noted.
- **Invariant #5**: netcode/persistence/auth/validation live in the four
  new engine packages; games declare `CommandRule`s and handle
  join/leave; no game or template touches a socket, SQL, or token.
  `devAuth` is opt-in-only with no default (`auth` is required);
  `ticketAuth` is HMAC-SHA256 with `timingSafeEqual` + length check and
  expiry — boring and standard as specified.
- **New dependencies confined as declared**: `ws` in server only,
  `better-sqlite3`/`pg` in persistence only. Harness gained
  net/bots/server as dependencies but `soak.ts` is dynamically imported
  only under `--soak` (the `--browser` pattern), and the static
  `BotDriver` import in `index.ts` is type-only (erased) — verified that
  headless runs never load server/ws code.
- **Protocol as portability boundary**: versioned JSON envelope with
  server-assigned `actor`/`tick`, `ProtocolLimits` enforced in
  `decodeClientMessage` before any game code, reserved `@` prefix rejected
  at decode; matches the contract signatures. `decodeServerMessage` is a
  trusted-origin shape check, documented as such.
- **Implementation latitude accepted under the spec's "parameter details"
  clause** (all additive, none capability-changing): `Rng.restoreState`
  (in-place restore so game-held fork references stay live — necessary
  for the restore contract and a sound design), `ClientSession.actor`,
  `ClientSessionOptions.pingIntervalMs`, `isReservedIntentType`,
  `SoakSpec` living in `soak.ts`, and `Scenario.net`/`Scenario.soak`
  typed `unknown` in `index.ts` (the Phase 2 `browser?: unknown` pattern,
  for the same static-dependency reason; the typed shapes live in
  `soak.ts` as `NetSpec`/`SoakSpec`).
- **The unplanned 8th commit** (`7e08231`, root `package.json` build
  order): a one-line fix for a real pre-existing clean-checkout failure
  (workspace sweep builds alphabetically; assets precedes core), with the
  root cause, reproduction, and verification documented in the commit
  message. No new scripts, no surface change. Accepted as an honest
  drive-by with a recorded reason — the Phase 2 bar is "documented, not
  silent", and this one is documented.
- **Skill docs**: `references/net-api.md` spot-checked
  signature-by-signature against `protocol.ts`/`client.ts`/`server.ts`/
  `store.ts`/`bot.ts` — accurate, including honest documentation of
  no-predict demo behavior and the corrections semantics.
  `core-api.md`'s restore section and `harness-api.md`'s
  `--soak`/`--from-checkpoint` sections match as-built behavior verified
  live. (Item 1's fix adds one constraint paragraph to two of these.)

## 5. Scope-by-scope notes

- **A (restore/forkRng/snapshot v2)** — clean. The deep-clone fix in
  `snapshot()` corrects a genuine pre-existing aliasing bug (verified by
  repro) and is correctly re-applied on `restore()` so multiple restores
  from one snapshot object can't alias. `restore` validates labels before
  mutating anything (failed restore leaves the sim untouched), clears
  commands/events per contract, and marks the sim stepped.
- **B (net)** — clean; prediction/reconciliation logic sound (§3.9); the
  `/web` transport queues sends until open (correct, since `hello` is sent
  at session construction).
- **C (server)** — items 2 and 4; otherwise sound: validation order
  (unknown → invalid → per-tick → token bucket) matches spec, protocol
  strikes escalate to `close(protocol-error)`, `eventsSince(lastTick + 1)`
  aligns exactly with core's `>=` semantics (no event loss or
  duplication), the ephemeral-port and stop paths behave.
- **D (persistence)** — item 6; drivers share one conformance suite;
  schema matches spec on both drivers; append is transactional with
  per-tick idx resume.
- **E (bots)** — clean; harness integration records bots' commands into
  the replay bundle in submission order exactly as specified, and the
  bot-free path provably leaves `replay.commands` byte-identical to
  `scenario.commands`.
- **F (soak)** — clean; the teardown sequence captures client snapshots,
  stats, hash, and command log in one synchronous block before any yield,
  so the replay bundle is provably consistent with the final hash (the
  reviewer specifically checked this for tick-timer interleaving and found
  it airtight).
- **G (demo/docs/CI)** — items 1/4 touch `apps/demo/src/game.ts` via the
  shared pattern; wiring otherwise verified live. CI gains exactly the
  declared steps; the Phase 2 browser job is untouched.

## 6. Non-blocking observations

- **Per-broadcast `sim.snapshot()` cost**: `snapshotByEntity` deep-clones
  the entire world 20×/s regardless of interest sets. Fine at soak-50
  scale (p95 1 ms proves it); will matter for Phase 4's living world —
  revisit when `bytesOut`/tick timing say so, per the spec's own
  measure-first stance.
- **Trailing command-free ticks are lost on crash**: `recoverSim` recovers
  to the last *command's* tick, not the crash tick (empty ticks aren't in
  the log). Consistent with "a crash can lose an unexecuted tail" and
  `stop()` snapshots on graceful shutdown — but worth one sentence in
  `net-api.md`'s persistence section when item 1's docs are edited.
- **Command payload `undefined` round-trips as `null`** through both
  stores (`JSON.stringify(c.payload ?? null)`). No in-repo consumer
  distinguishes them; noting for schema-versioning memory.
- **A second `hello` on an authenticated connection** re-runs auth and
  re-submits `@net/join` (then self-supersedes). Cheap to reach, related
  to item 4's lifecycle accounting; consider making a repeat `hello` a
  protocol strike while fixing item 4.
- **`stats().ticks` reports `sim.tick`**, which includes pre-restart ticks
  after recovery — mildly misleading for a "this process" stat; harmless
  today (soak runs storeless).
- **Postgres `ready` promise** (`postgres-store.ts`) is created in the
  factory; if the connection fails before the first store call, that's an
  unhandled-rejection window. One `ready.catch(() => {})`-style guard (or
  lazy init) when next touching the file.
- **`npm audit`**: 2 vulnerabilities (1 moderate, 1 high) in dev tooling —
  pre-existing on `main` (noted in Phase 2 too); triage with the next
  dependency bump.
- **ROADMAP.md Phase 3 checkboxes**: tick at merge time (standing
  reminder, third phase running).

## 7. Resubmission

Address items 1–7 (1 and 6 can share a regression test; 4's game-side
idempotency lands naturally with 1's rewrite of the join handlers). Re-run:
`npm run build && npm run lint && npm run check:purity && node
scripts/check-purity.mjs --self-test && npm run check:plugin && npm test`,
all five workspace test suites (server's at least 5× consecutively for item
3), the repro timelines in items 1 and 2 (both must come out
hash-equivalent), `smoke --out` → `--replay --from-checkpoint 50`,
`bots-headless --verify-replay`, and the four committed soak scenarios;
confirm `git diff main..phase-3 -- CLAUDE.md packages/core/src/types.ts`
is still empty; then return to this gate.

## Resubmission verdict

Reviewer: Fable 5, resubmission of the step-3 gate against commit `5a39a41`
("Phase 3 fix-list: address review gate items 1-7"). All verification below
re-run by the reviewer on Windows 10 / Node 24.12.0; nothing taken on trust.

### Verdict: FIX-LIST (1 item)

All seven original items are addressed — items 1, 3, 4, 5, 6, and 7 are
**confirmed fixed** by re-executed repros and re-run suites (evidence below).
But item 2's fix, while it genuinely closes the dropped-command hole it was
aimed at, **introduces a new defect in the same blocking class**: the
`intake` queue stamps a command's tick at *arrival* time, so any command
arriving while the write-ahead `await store.appendCommands(...)` is in
flight is persisted with a tick one lower than the tick it actually executes
in. The persisted log then no longer describes the run (invariant #3), and
the shipped regression test passes anyway only because its game is a
position accumulator — commutative across ticks — so the mis-placed replay
happens to converge to the same final hash. Confirmed by reviewer repro
(scratchpad `resub-new-misstamp.mjs`), same server/mock-store/live-socket
shape as the shipped test but with a non-commutative per-tick rule
(`acc = acc*3 + sum(dx)`): **117 of 194 accepted commands executed one tick
later than their persisted stamp** (first: stamped 1, executed 2), and the
persisted log replays to hash **46960636 vs the server's own 3552430466**.
The phase's grounding criterion is therefore still not met for genuinely
async stores — one step closer (nothing is *lost from the log* anymore),
but not yet true.

1. **[Grounding criterion + invariant #3 — blocking] Commands arriving
   during the write-ahead `await` are persisted with a stale tick stamp:
   logged at tick T, executed at tick T+1.**
   `packages/server/src/server.ts`: both `queueReserved` and the intent
   handler stamp `tick: sim.tick + 1` when *pushing to `intake`*. For a
   message arriving between ticks that's correct — the next `doTick` drains
   it before `step()` advances the tick. But for a message arriving during
   `doTick`'s `await store.appendCommands(...)` (the only yield point before
   `step()`; ws handlers run freely there), `sim.tick` has not advanced yet,
   so the command is stamped T+1 — and it is *not* drained by the in-flight
   tick (drain already ran); it waits for the next `doTick`, by which time
   `step()` has advanced the sim to T+1, and it executes in the step that
   produces T+2. Consequences, in increasing severity: (a) `replay()` and
   `recoverSim` execute it at its stamped tick — one tick earlier than the
   live server did — so per-tick hashes diverge and final-state equality
   holds only for games whose command effects commute across ticks (the
   reviewer's non-commutative repro diverges: 46960636 vs 3552430466);
   (b) if `saveSnapshot` lands on tick T+1 (it runs right after `step()`
   whenever `sim.tick % snapshotEveryTicks === 0`), the mis-stamped command
   is excluded from recovery entirely — `commandsSince(gameId, afterTick)`
   is `tick > afterTick` on both drivers, the command's stamp T+1 equals the
   snapshot tick, and its effect is not in the snapshot (it executed after)
   — state ahead of the effective log, the exact failure class item 2's fix
   was meant to end. Storeless servers are immune (`doTick` has no `await`
   before `step()` without a store, so handlers cannot interleave) — which
   is why every soak and its headless replay stay green.
   **Fix**: stamp at drain time, not arrival time — the drain loop in
   `doTick` becomes `for (const command of intake) sim.submit({ ...command,
   tick: sim.tick + 1 });` (drain runs synchronously immediately before the
   copy and `step()`, so `sim.tick + 1` is provably the executing tick;
   intake order is preserved, so supersede's leave-before-join ordering is
   unaffected). The queue-time stamp then carries no meaning — drop it or
   stamp 0 to make that explicit. Strengthen the shipped write-ahead
   regression test so commutativity can never mask this again: either give
   its game a non-commutative per-tick rule (the repro's `acc*3 + dx` shape
   is ready-made) or assert from inside a system that `c.tick === s.tick`
   for every consumed command. Re-verify with the repro above (expect 0
   mis-stamps and hash-equal replay).

### Original items 1–7: re-verification evidence

| # | Status | Evidence (re-run by this reviewer) |
|---|---|---|
| 1 | **FIXED** | Original timeline re-run against the real `scenarios/lib/net-game.mjs` `setup` + `sqliteStore` + `recoverSim` (join@1, moves@2/4/8/12, snapshot@6, crash@15, continue to 30): recovered hash **194278080 == continuous 194278080**, pos `{x:1,z:2}` both sides (previously 198819683 vs 194278080). `recoverSim` lands on tick 12 (last command's tick) exactly as documented. Both reference games now derive the actor→entity lookup from the `owner` component; constraint documented in `core-api.md` (restore section) and `net-api.md` (workflow step 1), including the honest trailing-ticks caveat this review asked for. |
| 2 | **FIXED as scoped, but see new item 1** | Original repro shape re-run (real `startGameServer`, setTimeout-based macrotask store, live socket pumping moves for 3 s): **194 accepted == 194 logged** (plus the `@net/join`), server hash == log-replay hash **3594635481** (previously 266 vs 196, hashes divergent). No command is dropped from the log anymore. The residual defect is the stamp skew above — a different mechanism in the same path. |
| 3 | **FIXED** | `npm run test -w @claude-engine/server`: **8/8 consecutive runs exit 0**, 18/18 checks each (original flake was ~1-in-6). `messageOfType` discards non-matching frames with a timeout. |
| 4 | **FIXED** | New lifecycle test passes live: after a supersede the log shows `@net/join`, `@net/leave`, `@net/join` for the actor — correct 1:1 accounting (two real connections occurred, so two joins; the intervening leave is the eviction). `closeSession` queues the leave before the new join enters intake (FIFO preserves order), the later ws `close` event correctly no-ops, and both reference games' join handlers are idempotent per actor. |
| 5 | **FIXED** | `node scripts/check-purity.mjs --self-test` exit 0, output includes "Math.random planted in packages/bots/src: CAUGHT". |
| 6 | **FIXED** | Golden rewritten as a join-based scenario: join@1, move@5 (pre-snapshot@10), move@15, move@20 (= crash tick), crash, `recoverSim` (asserts tick == 20), fresh moves @25/@35 to 40 — hash-equal with the uninterrupted run. Passes (`npm run test -w @claude-engine/persistence` exit 0; Postgres skips cleanly without `DATABASE_URL`, as expected locally). Doubles as item 1's regression test as requested. |
| 7 | **FIXED** | `setupWithLandmarks` uses `sim.forkRng("landmarks")`; the LCG constant `1103515245` no longer appears anywhere under `scenarios/`, `apps/`, or `packages/`. |

### Verification battery (all re-run)

`npm run build` / `lint` / `check:purity` / `--self-test` / `check:plugin` /
`npm test` — all exit 0, smoke hash **919868270** unchanged. Core (7),
net (19), bots (10), persistence (9 + pg SKIP), server (18 × 8 runs) — all
green. `smoke --out` → `--replay` → `--replay --from-checkpoint 50`: exit
0/0/0, `verified: true` both. `bots-headless --verify-replay`: passed,
`replayCheck.verified: true` (2434575262 == 2434575262), 50 `bot:wanderer`
commands in the bundle. All four committed soaks exit 0 — net-walk's and
soak-ci's verdicts replay headlessly `verified: true`; net-interest still
filters (avgReplicatedEntities 2 vs 42 server entities); net-abuse still
rejects on all three reasons (unknown-type 17, invalid-payload 17,
rate-limited 126). `demo-walk` passes (the shared-pattern rewrite of
`apps/demo/src/game.ts` regressed nothing). `git diff main..phase-3 --
CLAUDE.md packages/core/src/types.ts` — **empty**.

### Non-blocking observations (carry forward, no action required this loop)

- `packages/server/scripts/test.mjs`'s `setupGame` still caches
  `playerId -> entity` in a closure `Map` — harmless here (test-only, never
  restored), but it is now the documented anti-pattern; align it with the
  component-derived lookup next time the file is touched so no in-repo
  example contradicts `net-api.md`.
- `findEntityByOwner` is a linear scan over `withComponent("owner")` per
  command (and the demo's prevPos system iterates it per tick). O(players)
  per command is nothing at soak-50 scale — all soaks re-ran green with the
  new pattern — but it compounds with Phase 4's entity counts; revisit
  alongside the existing per-broadcast `snapshot()` note under the spec's
  measure-first stance.

### Resubmission instructions

Address the single item above (a two-line product change plus a hardened
regression test), re-run `npm run test -w @claude-engine/server` (5×+), the
mis-stamp repro shape (non-commutative game under the macrotask store —
expect 0 mis-stamps, hash-equal replay), and the unchanged-surface spot
checks (`npm test` smoke hash, one soak + headless replay); then return to
this gate. Everything else in this phase is verified and holding.
