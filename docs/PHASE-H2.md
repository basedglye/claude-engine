# Phase H2 spec — "One-Man Show" (vertical slice 1)

Status: **planned** (step-1 output of the [WORKFLOW.md](WORKFLOW.md) loop; the step-3 review gate verdicts against it, verbatim). Game context: [apps/hotel/docs/DESIGN.md](../apps/hotel/docs/DESIGN.md), [apps/hotel/docs/ARCHITECTURE.md](../apps/hotel/docs/ARCHITECTURE.md), [docs/ROADMAP-HOTEL.md](ROADMAP-HOTEL.md). Predecessor: [PHASE-H1.md](PHASE-H1.md), H1a PASS ([reviews/phase-H1a.md](reviews/phase-H1a.md)), H1b PASS at round 2 ([reviews/phase-H1b.md](reviews/phase-H1b.md)) — this spec consumes the H1b review's **round-2 final consolidated deferral list** item by item (see "The H1 deferral ledger" below).

This phase creates one engine package (`@claude-engine/audio`), changes `core.stateHash()` (a public contract with pinned goldens repo-wide), and makes additive ⚠ changes to `persistence`, `renderer-three`, `harness`, `assets`, and `interiors`. It is an [S, F review] phase per the roadmap, but the `core` and `persistence` contract changes are Fable-planned **here**, in this spec, so implementation never decides a contract.

## 1. The split ruling, up front

**H2 is split into H2a and H2b, each with its own review gate.** The roadmap scope is again two phases wearing one name, and the halves have incompatible verification shapes:

- **H2a — "The Living Hotel" (everything that changes `stateHash`).** Staff and the first-hire beat; housekeeping and maintenance; complaints → reviews → reputation → stars; demand and pricing; daily objectives; the LEDGER / PRICER / MAILBOX / STAFF apps (screen apps are *sim* content — `reduce`/`layout` run in the purity root and are headless-testable via the H1b decision-path pattern); the blacklist/`listed` activation; incremental `stateHash` in `core`; the `indexSystem` per-tick-scan and A*-allocation refactor. **Every gate is headless with `--verify-replay`.**
- **H2b — "The Look & The Sound" (everything that cannot change `stateHash`).** The retro texture pipeline (atlas synthesis, UVs, instancing, vertex-colour lighting bake, PS1 shader) and its look-lock; `@claude-engine/audio`; the `frame-time-p95` and `draw-calls` probes and budgets; load-on-boot persistence (the deferral-1 bundle: `listGames`/`deleteGame`, the `"./recover"` subpath, quick-load id semantics, `resetEntityKeyedHostState` exercised for real); camera boom clip. **Every gate is browser-mode with screenshots and probe budgets.**

The cut line is the invariant-2 boundary itself: H2a's diff is hashed, H2b's diff is *forbidden* from being hashed. That makes each review round mechanically checkable — the H2b review's first act is asserting that every headless golden pinned at the H2a merge is **byte-identical** after H2b, which is simultaneously the review of invariant 2 for the entire art/audio surface. H1's split proved a review round can re-verify one shape of diff, not two.

Sequencing: H2a merges first (H2b's screenshots should show final screen content, and H2b's budget numbers must be measured against H2a's entity counts), but H2b's texture-pipeline lane (interiors/assets/renderer, zero shared files with H2a's sim lane) **may start in parallel** on its own branch, exactly as H1b lane 8 did.

*Rejected: shipping H2 unsplit* — larger than H1, which was correctly split; the same review-capacity argument applies with more force. *Rejected: putting the four new HOTELSOFT apps in H2b because they are "UI"* — they are not; `reduce`/`layout`/state are purity-root sim code, their decision paths are the H1b-mandated headless pattern, and MAILBOX is load-bearing for the escalation system (sim substance). Only their pixels are H2b's business, covered by the composed-shell overflow gate and one readability re-check. *Rejected: incremental `stateHash` in H2b* — it changes every pinned golden; that re-pin must happen exactly once, at the start of H2a, and everything else in the phase builds on the new numbers.

## 2. Goal

**H2a:** seven in-game days are a real game. Guests arrive per a demand curve shaped by your prices and per-segment reputation; checkouts leave visible messes that block re-letting until you physically wipe them, and props break overnight and need in-person repair; guests review you at checkout, reviews roll into reputation and a star rating recomputed at each night audit, and the star tier activates new RESERVA rule rows — including the first MAILBOX-delivered blacklist, closing the `listed` loop the rule table was designed for; three sim-derived daily objectives post each morning and settle at the audit; and when your cash crosses the hire threshold, résumés print, a candidate walks in, you interview them at the STAFF screen, and a clerk NPC takes over the desk running the same validated `desk.decision` path you did — all deterministic, all replay-verified, with `stateHash` now incremental and cross-checked against the slow hash on every verify.

**H2b:** the hotel looks and sounds like GRAND FOYER. One quantized-and-dithered 1024 px atlas per hotel, planar UVs at ~64 px/m, baked vertex-colour lighting, instanced furniture, merged static walls, and the PS1 vertex-jitter/affine-warp shader — with the focused screen quad provably exempt; procedural SFX and tier-graded muzak driven purely by the sim's event stream; frame-time and draw-call budgets green in gated verdicts; the game reloads your hotel on boot; and the look is **locked**: the style constants are committed, screenshot-signed, and thereafter a review-turn change.

## 3. Non-goals (aggressive — this phase's gravity is toward Phase 3, and it must not fall in)

- **No multi-floor, stairs, elevators, BLUEPRINT, PURCHASE, CCTV, STREETVIEW.** The HOTELSOFT registry grows to six apps (RESERVA, AUDIT, LEDGER, PRICER, MAILBOX, STAFF) and stops.
- **Housekeeping and maintenance are *activities*, not minigames.** One verb each (wipe a mess; repair a prop). Carts, routes, mess-triage depth, diagnose-before-cascade are Phase 3. No incident cascade — a broken prop is a broken prop, it never becomes a flood.
- **One hireable role: front-desk clerk.** No housekeeper/maintenance NPCs (the player *is* the zen loop this phase — that's the "One-Man Show" premise and the reason the first hire lands). No schedules, no morale decay, no quitting, no poaching. `staffed.morale` exists as data, unused by any system.
- **No role XP, mastery, prestige, contracts, inspections, loans, repo manager, seasonal events, weekly seed challenge** (Phase 4).
- **No guest archetype behaviours.** Archetypes stay data flavour; the review score is a function of objective stay facts, not personality.
- **No forgery visuals, no pixel-level document tells** (Phase 3). Fraud remains field mismatches.
- **No save UI.** Load-on-boot resumes the single fixed game id; `listGames`/`deleteGame` land as engine capability (the deferral-1 additive change) but no menu consumes them beyond boot logic. **No save migration:** H2a registers new `forkRng` labels, so H1 saves fail `Sim.restore()`'s label check by design — the boot path treats a `RestoreError` as "no save" and starts fresh. Pre-1.0, this is policy, documented in `main.ts`.
- **No PRICER "sharpening" upgrades.** The demand graph ships at its coarsest fidelity; the upgrade track is Phase 4.
- **No pager, no PA/mischief affordances, no multiplayer wiring** — but every new command remains actor-bound and sim-validated, and the staff NPC decision path is deliberately actor-shaped (B9: nothing may read "the player" as a singleton; this phase adds the second actor kind, which is the live test of that rule).
- **No audio in the sim, ever.** `@claude-engine/audio` is host-only, not a purity root; no sim file may import it; no sound fact may enter a component.
- **No new `check.kind` variants beyond activating the existing `listed`.** `crossRef`/`loyaltyTier`/`billingCode` are Phase 3 rows.

## 4. The H1 deferral ledger (H1b round-2 final list + H1a carries, item by item — the review gate audits this table)

| # | Item | Disposition |
|---|---|---|
| 1 | Quick-load persistence semantics: live-id switch/truncate on quick-load; `listGames()`/`deleteGame()` (⚠ additive); `"./recover"` exports subpath on `persistence` | **Scheduled: H2b.** Load-on-boot is the named trigger and this phase pulls it (a 7-day vertical slice that forgets your hotel on refresh is not a vertical slice). All three land together with the `save-resume` gate. |
| 2 | `resetEntityKeyedHostState()` exercised for real; `player-fps` `objectToEntity` reverse-map leak | **Scheduled: H2b.** `save-resume` reloads the page and continues play through entity spawns — the exact hazard. The reverse-map prune lands in the same pass. |
| 3 | `debug.*` command rejection in server validation | **Re-deferred, trigger unchanged (Phase 5, MP wiring).** H2 has no remote actors; the SP threat model is unchanged from the H1b ruling. |
| 4a | `space` clearance-aware A* extraction | **Re-deferred to Phase 3** — extraction is justified by a second consumer or crowd scale, and H2 adds one clerk and a candidate, not a crowd. The standing rule holds: no new caller uses raw `findPathCells` for a collider-bearing agent (the clerk and candidate use `findJitteredPath`). The A*-allocation refactor (4c) happens *inside* the hotel's copy now, which is more argument for extracting the finished article in Phase 3, not less for doing it twice. |
| 4b | Sidestep-branch assertion before crowd density rises | **Scheduled: H2a.** Density does rise (clerk working the desk head-on against the queue). `corridor-headon` gains one assertion: the mirrored pair's run contains ≥1 `nav.yield` whose blocked agent has the *lower* id of its pair (proving the sidestep-repath branch, not just the wait branch, fired). |
| 4c | `indexSystem` per-tick scan + A*-allocation refactor (`checkin-rush` avgTickMs **0.030 at ~60 entities** — the number to beat) | **Scheduled: H2a.** See "Performance" below for exactly what changes and the measurement gates. |
| 4d | `plantViolation` `listed`/`mustBe:"absent"` branch is committed-wrong; round-trip property cannot cover `listed` rows | **Scheduled: H2a — the hard trigger fires.** MAILBOX ships the first list. Fix per the H1a review's own prescription: `plantViolation` gains `ctx`, plants a `listed`/absent violation by choosing a value already on the list, and `guestSpawnSystem` only selects among *currently plantable* rows (a `listed`/absent row is plantable only when its list is non-empty). Round-trip property extended to `listed` rows against a fixture list. |
| 4e | Guests never close doors | **Re-deferred to Phase 3** (privacy/multi-floor is when it bites; H2's single floor settles fully open, as H1a documented and verified). |
| 4f | Third-person boom clips walls (H0 item 1, twice-deferred "to the art/feel pass") | **Scheduled: H2b.** This *is* the art/feel pass; the debt comes due. Spring-arm clamp via the existing `space` occlusion query, per B4. |
| 5 | Pattern obligations: decision-path coverage per new screen app; composed-tree overflow per registered app (loop hardcodes `["reserva","audit"]`); tick ≤ 5 queue-ordering tripwire | **Adopted as standing rules of this spec.** Each of the four new apps ships its layout()-derived, both-branches, guard-inclusive headless decision test; the overflow loop is rewritten to **derive from the shell registry** (adding app seven can never silently skip it); no H2 scenario gates input at tick ≤ 5, so that tripwire carries with its trigger unchanged. |
| — | H1b review round-1 item 3 residual: `save-restore`'s pinned-pose no-op dependency | **Documented, carried.** The new `save-resume` scenario must not inherit the pattern: it saves at a tick with no in-flight input and asserts through the recovered hash, not through replay of a discarded branch. |

## 5. API contracts

Everything below is real exported TypeScript. **[public-contract ⚠]** marks gate-audited surfaces.

### A. `core` — incremental `stateHash` **[public-contract ⚠ — behaviour change, one-time global golden re-pin]**

Today (`packages/core/src/sim.ts:193`) `stateHash()` FNV-1a's the tick, `nextEntity`, and `JSON.stringify` of **every component of every entity, every call** — O(total state bytes) per tick under `--verify-replay`. B8's fix order puts the incremental version here.

**Design.** Per-entry hash caching with write-through invalidation, combined in store-insertion order:

```ts
// packages/core/src/sim.ts — no signature changes to stateHash(); one new export.

export class Sim implements IWorld {
  /**
   * Deterministic state hash — the replay-divergence detector.
   * INCREMENTAL as of Phase H2: setComponent()/removeComponent()/despawn()
   * invalidate a per-(component,entity) cached entry hash; stateHash()
   * recomputes only invalidated entries (FNV-1a over name+id+JSON, exactly
   * one stringify per WRITE, not per call) and folds the cached entry
   * hashes in component-store insertion order — same order as before, so
   * ordering bugs remain detectable. Cost: O(entities) small mixes +
   * O(dirty bytes), not O(total bytes).
   *
   * CONTRACT (the write-through rule, now load-bearing): sim code MUST
   * mutate components via setComponent(); in-place mutation of a fetched
   * component object without a setComponent() call was always against house
   * style and is now a hash-corrupting bug. stateHashSlow() exists so the
   * harness can catch exactly that.
   */
  stateHash(): number;

  /** The pre-H2 full-walk hash, same combination scheme as the incremental
   *  path (they MUST agree; divergence means a write-through violation).
   *  Kept as the --verify slow path per ARCHITECTURE B8 fix-order item 2. */
  stateHashSlow(): number;
}
```

- The two functions share one combination scheme, so `stateHash() === stateHashSlow()` always, *unless* someone mutated a component in place — which is precisely the bug class to catch. **The harness's `--verify-replay` path additionally asserts `stateHash() === stateHashSlow()` on the final tick of both the live run and the replay** (four cheap full walks per run). Any mismatch is exit 3, P0.
- `restore()` clears the cache wholesale. `snapshot()` is unchanged.
- **The hash values change once.** Folding cached entry hashes cannot reproduce the current byte-stream FNV (a mid-stream change invalidates every downstream byte). Every pinned golden in the repo — the smoke hash `919868270`, scenario hashes, the interiors-consuming gates — is re-pinned **in H2a lane 1, before anything else**, with the property tests passing on unmodified logic, exactly the H1a re-pin discipline. *Rejected: a byte-identical incremental hash* — impossible with a sequential stream hash; *rejected: an order-independent (XOR-fold) combination* — surrenders detection of iteration-order divergence, which invariant 2 explicitly cares about.

### B. `@claude-engine/audio` (new package — host-only; **not** a purity root, never imported by sim code)

Extends the proven `assets` oscillator approach (`packages/assets/src/music.ts` + `src/web/audio.ts`). The sim knows nothing of audio; the host feeds `eventsSince` output in each frame. Verification is event-table correctness, per B8.

```ts
// packages/audio/src/index.ts
import type { GameEvent } from "@claude-engine/core";

/** A procedurally synthesized sound: oscillator recipe, not a sample file.
 *  All parameters are plain data so the SFX bank is diffable content. */
export interface SynthSpec {
  wave: OscillatorType;                 // "square" | "sawtooth" | "sine" | "triangle"
  freqHz: number;
  /** Optional pitch slide target (door creaks, crash whoops). */
  freqEndHz?: number;
  durationMs: number;
  gain: number;                         // 0..1
  /** Simple noise burst mixed in (crashes, printer chatter). */
  noiseMs?: number;
}

/** One row of the event→sound table. `at: "entity"` sounds are positional
 *  (PannerNode at the entity's world position, camera as listener);
 *  `at: "ui"` sounds are non-positional (screen clicks, audit chime). */
export interface SoundRule {
  eventType: string;                    // e.g. "guest.checkedIn", "door"
  spec: SynthSpec | readonly SynthSpec[];  // array = deterministic round-robin variants
  at: "entity" | "ui";
  /** Which payload field names the entity to position at (default "guestEntity"). */
  entityField?: string;
  /** Rate limit: at most one instance per this many ms (crowd protection). */
  minIntervalMs?: number;
}

export interface AudioHost {
  /** Feed the sim's new events each frame; the host schedules WebAudio.
   *  Idempotent per event (tracks the last consumed tick internally). */
  onEvents(events: readonly GameEvent[]): void;
  /** Muzak quality tracks star rating (a joke and a progression signal,
   *  B8) — regenerates the ambient score via assets' generateScore with
   *  tier-dependent scale/tempo/voice count. Deterministic per (seed, tier). */
  setMuzakTier(stars: number): void;
  /** AudioContext lifecycle (autoplay policy: call resume() on first user
   *  gesture; the harness never asserts audible output). */
  suspend(): void;
  resume(): void;
  dispose(): void;
}

export function createAudioHost(opts: {
  rules: readonly SoundRule[];
  /** Camera pose, polled per frame for the PannerNode listener. */
  listener: () => { xM: number; zM: number; yawRad: number };
  /** Resolve an entity id to a world position (metres), or undefined if
   *  gone — despawned entities simply drop their sound's position to "ui". */
  entityPos: (entity: number) => { xM: number; zM: number } | undefined;
  muzakSeed: string;
  ctx?: AudioContext;                   // injectable for tests
}): AudioHost;

/** The completeness check the unit gate runs: every event type in
 *  `gameplayEventTypes` is either covered by `rules` or listed in
 *  `deliberatelySilent` — no event can be silently forgotten. */
export function auditSoundCoverage(
  rules: readonly SoundRule[],
  gameplayEventTypes: readonly string[],
  deliberatelySilent: readonly string[],
): { uncovered: string[]; unknownRules: string[] };
```

The hotel's `SoundRule[]` table and its `deliberatelySilent` list live in `apps/hotel/src/render/sounds.ts` (host side). Round-robin variant selection and any "randomness" in the audio host may use plain `Math.random` — it is presentation, invariant 2 does not reach it, and *that fact is the package's one-line README headline*. *Rejected: sample assets* — off-style and outside the asset-synthesis stance; *rejected: audio state in components* — invariant 1/2 violation with zero gameplay meaning.

### C. `persistence` **[public-contract ⚠ — the deferral-1 additive change, made now]**

```ts
// packages/persistence — GameStore gains two methods; sqliteStore,
// postgresStore, and save-web's webStore all implement them.
export interface GameStore {
  // ...existing methods unchanged...
  /** All stored games (id, name, seed, latest snapshot tick if any). */
  listGames(): Promise<{ id: string; name: string; seed: string; latestSnapshotTick?: number }[]>;
  /** Remove a game and all its commands/snapshots. Resolves when durable. */
  deleteGame(id: string): Promise<void>;
}
```

Plus the `"./recover"` exports subpath (`@claude-engine/persistence/recover`) so browser code stops deep-importing past the sqlite/pg barrel — the H1b review's prescribed spelling. Quick-load semantics fix in `apps/hotel/src/main.ts`: on quick-load (and on the audit save), **the live game id becomes a fresh derived id** (`hotel-sp@<savedTick>-<n>`) seeded by importing the captured save — the abandoned branch's records are never interleaved into the id `recoverSim` will read at boot; boot recovers the most recent id from `listGames()`. *Rejected: truncating the store in place* — destroys the bug-report property of the abandoned branch; id-switching keeps both branches intact and unambiguous.

### D. `interiors` + `assets` — the retro pipeline **[public-contract ⚠ additive; mesh golden re-pinned in H2b]**

```ts
// packages/assets/src/mesh.ts — additive, per ARCHITECTURE B1.
export interface MeshData {
  // ...existing fields...
  /** Planar UVs, 2 floats per vertex. Presentation only — never hashed,
   *  never read by sim code (invariant 2 asset rule). */
  uvs?: Float32Array;
}

// packages/interiors/src/atlas.ts  (new)
/** Deterministic retro texture atlas: per-material procedural synthesis
 *  (noise + pattern + palette) → quantize to <=32 colours → 4x4 Bayer
 *  dither at 64–128 px per material tile → packed 1024x1024 RGBA. Pure
 *  function of the seed; Math.sin/random are fine here (asset synthesis,
 *  outside the purity roots) because the output never enters sim state. */
export interface AtlasData {
  sizePx: 1024;
  pixels: Uint8ClampedArray;            // RGBA
  /** Material id -> UV sub-rect in the atlas. Material ids are the
   *  vocabulary mesh-gen stamps into UVs: "floor:lobby", "floor:room",
   *  "wall", "ceiling", "desk", "door", "mess", "prop:tv", ... */
  regions: Record<string, { u0: number; v0: number; u1: number; v1: number }>;
  /** The palette actually used, for the palette-size unit gate. */
  palette: readonly number[];           // packed 0xRRGGBB, length <= 32
}
export function synthesizeAtlas(seed: string): AtlasData;
```

`buildFloorMesh` gains UV emission (planar per wall/floor/ceiling quad at ~64 px/m texel density, mapped into the material's atlas region) and a **vertex-colour lighting bake** (corridor gradient, window falloff at the street door, warm lamp tint near the desk — multiplied into the existing per-room tints). This changes `mesh` bytes only; `grid`/`portals`/`rooms`/`desk`/`bedrooms` are untouched, so **no sim-visible data changes and no headless golden moves in H2b** — the interiors mesh golden re-pins, the layout properties pass unmodified. That separation is itself an H2b review check.

### E. `renderer-three` **[public-contract ⚠ additive]**

```ts
// packages/renderer-three
/** InstancedMesh helper: one instanced draw per (geometry, material) kind,
 *  positions set once, per-instance matrix updates on demand. */
export function instancedScenery(opts: {
  geometry: THREE.BufferGeometry; material: THREE.Material; capacity: number;
}): { mesh: THREE.InstancedMesh; set(i: number, m: THREE.Matrix4): void; count(n: number): void };

/** The PS1 look: vertex jitter (scale-then-floor to a coarse grid) +
 *  affine UV warp (screen-space interpolation, no perspective divide),
 *  applied via onBeforeCompile to a vertex-coloured, atlas-textured
 *  material. `exempt: true` builds the SAME material with both effects
 *  compiled out — the surface-ui screen quad's path (B6: both effects
 *  MUST exclude screen quads; text dies otherwise). */
export interface RetroLook { jitterGridPx: number; affineWarp: boolean }
export function createRetroMaterial(opts: {
  map?: THREE.Texture; vertexColors: boolean; look: RetroLook; exempt?: boolean;
}): THREE.Material;

/** Per-frame render stats for the draw-calls/frame-time probes, exposed
 *  through installTestHook as an optional `frameStats?()` slot [additive],
 *  reading renderer.info.render.calls and the host loop's rAF deltas. */
export interface FrameStats { drawCalls: number; frameMsSamples: readonly number[] }
```

The committed look constants live in `apps/hotel/src/render/look-lock.ts` (`export const LOOK: RetroLook = { jitterGridPx: ..., affineWarp: true }` plus the atlas seed) — the file the look-lock signs and freezes.

### F. `harness` **[public-contract ⚠ additive: two probes, one hook slot]**

- `{ probe: "frame-time-p95"; sampleMs?: number }` → `{ p95Ms, avgMs, samples }` from `frameStats()` rAF deltas over the sample window (default: the whole run after the barrier).
- `{ probe: "draw-calls" }` → `{ max, atFinalTick }` from `frameStats()`.
- `WorldforgeHook` gains optional `frameStats?(): FrameStats` [additive]. Missing slot with a probe present → `BrowserInfraError`, exit 2, matching the `sim-tick-ms` precedent (`browser.ts:267`).
- Both are gated through the existing `feelTargets` mechanism — no new gating machinery.
- The `--verify-replay` slow-hash cross-check from contract A (a harness-side change in `cli.ts`/`index.ts`: after computing the final hash, assert `sim.stateHashSlow() === sim.stateHash()` on both the live and replay sims).

## 6. The `apps/hotel` additions

File layout (additions to the existing `src/sim` purity root and host side):

```
apps/hotel/src/sim/
  components.ts       extended (below)
  economy.ts          demand curve, pricing bounds, objective generation (pure helpers)
  reviews.ts          review scoring + reputation/star math (pure integer helpers)
  staff.ts            candidate generation, clerk decision cadence/error hash (pure)
  ledger-app.ts       ScreenAppDef  pricer-app.ts  mailbox-app.ts  staff-app.ts
  game.ts             new systems wired into the order below
apps/hotel/src/render/
  sounds.ts           the hotel SoundRule table + deliberatelySilent list
  look-lock.ts        the committed RetroLook + atlas seed  (H2b)
  atlas.ts            AtlasData -> THREE.DataTexture wiring (H2b)
scenarios/lib/
  hotel-owner-bot.mjs the one-man-week driver (BotDriver in scenario space —
                      bots package unchanged; it plays owner: desk via the
                      rule table, cleans, repairs, hires — all through the
                      public command factories)
```

**Component changes/additions (all JSON-plain integers/strings/booleans; absent-entity sentinel 0 per house style):**

| component | shape (abridged) | notes |
|---|---|---|
| `actorId` | `{ actor: string }` | **New.** The actor-identity component `findActorEntity` scans (replacing its scan of `player`). The player entity carries `player` *and* `actorId{actor:"player"}`; a hired clerk carries `actorId{actor:"staff:<entity>"}`. This is the B9 rule made structural: any system resolving "who acted" goes through `actorId`, and nothing may special-case `"player"`. |
| `roomUnit` | + `messCount: number` | Derived-count cache? **No** — it is the truth-adjacent counter kept in sync by the systems that spawn/despawn messes; the review gate checks it against a `mess` scan in the suite. Check-in eligibility = `occupantEntity === 0 && messCount === 0 && no broken prop in room`. |
| `mess` | `{ roomEntity, kind: string }` + `pos`/`interactable{kind:"mess"}` | Spawned (2–4 per checkout, count/kind/placement from fork `"upkeep"`) on room cells from the bedroom's cell list. `interact` on a mess despawns it — one wipe, one visible increment of progress. |
| `prop` | `{ kind: string; roomEntity; broken: boolean; repairProgress: number }` + `pos`/`interactable{kind:"prop"}` | One prop per bedroom at setup (TV/radiator flavor). Breakage rolls at day rollover from fork `"upkeep"`. Repair: each `interact` on a broken prop advances `repairProgress` by a fixed quantum; at max, `broken=false`, `incident.resolved` event. |
| `staffed` | `{ job: "clerk"; wage: number; skillPermille: number; moralePermille: number; quirk: string; hiredDay: number; seed: number }` | On the hired clerk entity (which also has `pos/yaw/collider/navAgent/actorId/person` fields as a guest-like NPC). `seed` feeds the stateless error hash. |
| `candidate` | `{ wageAsk: number; skillPermille: number; quirk: string; state: "arriving"\|"waiting"\|"interviewing"\|"hired"\|"rejected" }` | Candidate NPC. Their résumé is a `document` with `docType: "resume"` (widening `DocType`), physically holdable via the existing held-doc path. |
| `review` | `{ day: number; segment: string; score: number /*1..5*/; factors: string[] }` | Spawned at checkout by `reviewSystem`. |
| `mail` | `{ day: number; kind: "complaint"\|"bulletin"\|"applications"\|"spam"; subjectKey: string; fields: Record<string,string>; read: boolean }` | MAILBOX's content. i18n keys per house style. |
| `noticeList` | `{ listId: string; values: string[] }` | The lists `RuleContext.lists` is built from — MAILBOX bulletins append values. This is the Phase-3-planned seam from `rules.ts:51`, activated. |
| `objective` | `{ day: number; kind: string; target: number; progress: number; done: boolean; rewardMinor: number }` | Three per day from fork `"objectives"` + world state; settled at audit. |
| `hotel` | + `stars: number; repBySegment: Record<string, number> /*permille*/; rateByTier: Record<number, number>; arrivalsToday: number; arrivalsSpawned: number; hireUnlocked: boolean` | `guestsSpawned`/`nextGuestAtTick` semantics move to the per-day quota (`arrivalsToday` computed at rollover). Scenario config can still pin a fixed schedule for the H1 gates — their spawn streams must not change (see determinism rule 8). |

**No-closure-state, applied to the new state:** clerk decision timing, candidate FSM, review windows, reputation, list contents, objective progress, mess/prop state, and per-day arrival quotas all live in the components above. Three sharp edges:

1. **Reputation and stars are recomputed at the audit from `review` components in a rolling 7-day window** — never accumulated in a closure, never incrementally adjusted in place (recompute-from-truth, so `restore()` mid-week is trivially correct).
2. **The clerk's error draw is a stateless hash, not an Rng draw:** `err = hash32(staffed.seed ^ reservationEntity) % 1000 < (1000 - skillPermille)` — same rationale as nav jitter (determinism rule 5): decision *timing* must not perturb any Rng stream. Fork `"staff"` is drawn only at candidate *generation* time.
3. **`RuleContext.lists` is rebuilt per evaluation from a `withComponent("noticeList")` scan** (via the `indexSystem` tick context, below) — never cached across ticks.

**Commands** (all actor-bound, all-integer/string payloads; each new screen-effect command flows through one validated apply function, the H1b `applyDeskDecision` pattern):

- `interact` widens targets: mess (wipe), prop (repair step), candidate (begin interview — sets `interviewing`, hands the résumé to the actor), résumé document (pick up/put down).
- `staff.hire { candidateEntity, accept: boolean }` — emitted as a STAFF-app effect; validated (actor at desk range, candidate `interviewing`, on accept cash ≥ first wage). Applied by `applyStaffDecision`, called from both `staffSystem` (command form) and `screenSystem` (effect form).
- `pricer.setRate { tier, rateMinor }` — PRICER effect; validated (tier exists, rate within `[MIN_RATE, MAX_RATE]`, integer step of 500).
- `mailbox.read { mailEntity }` — MAILBOX effect; sets `read: true`. **Bulletins take effect at delivery, not on read** — reading is how the player *learns*, not how rules activate (*rejected: effect-on-read* — lets a player dodge escalation by ignoring mail, i.e. optimal play would be not engaging with content).
- `desk.decision` — unchanged, now submitted by three callers: player (RESERVA effect), `clerkBot` (harness), and the clerk NPC (`staffBrainSystem`, as actor `staff:<entity>`) — the `first-hire` gate's whole point is that all three are one path.

**System execution order** (registration order in `setup`; H1's twelve, amended):

1. `indexSystem` — **new, first.** Builds the per-tick context (see Performance): open-cell set, occupancy map, queue-ordered guest list, reservation-by-guest, docs-by-owner, lists-by-id, room-eligibility. A closure-held `tickCtx` object **fully rebuilt every tick before any reader runs and dead at tick end** — the H1 "per-tick locals" rule, hoisted so it is built once instead of once per system. Nothing in it survives a tick; `restore()` correctness is untouched because tick N+1 rebuilds from components.
2. `snapshotPrevSystem`, 3. `faceSystem` — as H1.
4. `guestSpawnSystem` — spawns from the per-day quota (`arrivalsToday`), same forks, same document/violation machinery; violation planting now selects among *plantable* rows of `rulesForStars(RULES, hotel.stars)` (deferral 4d).
5. `guestBrainSystem` — as H1, plus: checkout spawns messes (fork `"upkeep"`), records stay facts onto the guest for `reviewSystem` (waited ticks, broken-prop nights — integer fields added to `guest`).
6. `candidateSystem` — the candidate FSM (arrive → walk to a lobby wait cell → interviewing on interact → hired: gain `staffed`+`actorId`, walk to the desk work cell; rejected: leave).
7. `staffBrainSystem` — the hired clerk: if at the desk work cell and no player holds terminal focus, interact with the queue head (begin `presenting`) and, after `decisionDelayTicks(skill)` ticks, evaluate `rulesForStars` via `evaluateRules`, apply the error hash, and submit through `applyDeskDecision` as its own actor. **Player override:** while any actor holds the terminal's focus, the clerk stands down — watching them work (the beat) or taking over is the player's choice, never a race.
8. `pathSystem`, 9. `moveSystem`, 10. `interactSystem` (widened kinds) — as H1.
11. `deskSystem`, 12. `screenSystem` — as H1; `screenSystem` additionally applies `staff.hire`/`pricer.setRate`/`mailbox.read` effects via their validated apply functions.
13. `upkeepSystem` — at day rollover: breakage rolls per prop (fork `"upkeep"`).
14. `reviewSystem` — at each `guest.checkedOut`: compute the 1–5 score from integer stay facts (queue wait, broken-prop nights, price paid vs tier baseline), spawn `review`, emit `guest.reviewed`; spawn complaint `mail` when score ≤ 2.
15. `economySystem` — daily expenses now include Σ`staffed.wage`; objective settlement (progress checks + reward ledger entries) at rollover.
16. `dayPhaseSystem` — as H1, plus at rollover: recompute `repBySegment` and `stars` from the review window; compute tomorrow's `arrivalsToday` per segment (fork `"demand"`, price-vs-willingness × reputation × stars, all integer permille math); generate 3 objectives (fork `"objectives"`); set `hireUnlocked` when closing cash ≥ `HIRE_THRESHOLD_MINOR`; `econ.audit` payload extended with `{ stars, repBySegment, forecastArrivals, objectives }` — the forecast line is the audit ritual's "one more day" hook.
17. `mailSystem` — delivers scheduled mail at rollover: applications + résumé printing when `hireUnlocked` first becomes true; blacklist bulletins (appending to `noticeList`) on seeded days once `stars ≥ 2`; vendor spam as comedy filler.
18. `cleanupSystem`, 19. `saveRestoreDebugSystem` — as H1.

**New events** (assertion vocabulary + audio triggers): `guest.complained|reviewed{score,segment}`, `room.messSpawned|cleaned{roomEntity}`, `prop.broke|repaired{propEntity}`, `staff.candidateArrived|interviewStarted|hired{entity,wage}|rejected|decision{actor,accepted}`, `econ.rateSet{tier,rateMinor}`, `mail.delivered{kind}|read`, `hotel.starsChanged{from,to}`, `objective.posted|completed|failed`, `printer.printed{docType}`.

**Registered forks (setup-time, alongside H1's two):** `"demand"`, `"staff"`, `"objectives"`, `"upkeep"`. This is what breaks H1 saves at `restore()` — see non-goals for the ruling.

## 7. Determinism rules specific to this phase

1. **All H0/H1 rules stand** (integer mm/mdeg, LUT trig, no closure state, integers across the screen boundary, stateless-hash jitter, per-tick locals).
2. **Audio is host-side, full stop.** `packages/audio` is not a purity root, is never imported under `apps/hotel/src/sim` or any purity root (eslint boundary + `check-purity` audit), and no component ever records a sound fact. The event stream is the one-way interface.
3. **Reviews, demand, reputation, stars, objectives are sim-side, integer, and forked-Rng.** Scores 1–5; reputation permille; demand math in permille with truncating division; no floats anywhere in the new sim code. Draw-at-generation, hash-at-decision: Rng streams are drawn only at generation moments (spawn, rollover, candidate creation); anything evaluated per-decision (clerk error) uses stateless hashing so decision *frequency* can never perturb a stream.
4. **The atlas, UVs, vertex-colour bake, and PS1 shader must not move a single headless golden.** All H2a-pinned hashes are byte-identical after H2b — the H2b review's first check, and the mechanical form of invariant 2's asset rule.
5. **PRICER's "fuzzy demand graph" fuzz is deterministic display data**, derived by stateless hash of `(day, tier)` and quantized to coarse buckets in the app's `paintSpec` — never an Rng draw, never state.
6. **`stateHash()`/`stateHashSlow()` agree everywhere**, asserted by the harness on every `--verify-replay` (rule enforced by contract A/F). A disagreement is a write-through violation and P0.
7. **Bulletin/list content is world state**, not rule-table content: `RULES` stays a committed constant; MAILBOX changes *lists*, star tiers change *which rows are active*. Nothing ever mutates the table at runtime (rows stay diffable data, per the H1 keystone).
8. **The H1 gates' spawn streams are sacred.** `checkin-rush`/`fraud-catch`/`corridor-headon` run under scenario configs that pin the H1 fixed-schedule spawn path; the demand-quota path activates only in default/H2 configs. Their goldens re-pin once (contract A) and then must hold through all of H2a — a second drift means a fork-ordering or stream-coupling bug.

## 8. The first-hire beat — a designed experience (and its proof)

**What builds toward it.** From day 1, LEDGER shows a locked line: `STAFF BUDGET — unlocks at $600.00` (the threshold is diegetic, printed, transparent — the anti-dark-pattern stance: the player always knows exactly what earns what). The audit screen repeats it nightly with the gap shrinking. The player has spent days sprinting the triangle — desk, messes, broken radiator — and the game has *made them feel* the one-man-show ceiling: guests queue while you wipe a floor upstairs; the zen loops and the pressure loop interrupt each other by design. The hire is the release valve, and the player has been staring at its price tag all week.

**The night it lands.** The audit where closing cash crosses the threshold prints one extra line: `STAFF BUDGET UNLOCKED — applications requested.` (`hireUnlocked` flips; `mailSystem` queues the beat). Overnight, MAILBOX receives "3 applications received." Next morning the desk printer chatters — a real positional sound (`printer.printed`, one of H2b's signature SFX) — and two or three **résumé documents physically appear in the printer tray**: real `document` entities, picked up and read through the exact held-item inspect path the player has used on IDs all game. Each résumé shows name, wage ask, skill grade, and the quirk in plain text — every hire has a flaw (DESIGN §7), stated up front, not hidden.

**The interview is in person.** At a seeded tick that morning, a candidate walks in the street door — same door, same walk, same rig as a guest, but they wait by the lobby instead of queuing. `interact` starts the interview; the STAFF app shows the candidate beside their résumé, and HIRE / PASS are screen buttons whose effect flows through the validated `staff.hire` path (identical shape to RESERVA's ACCEPT/DENY — by the time the player hires, the gesture is muscle memory, which is the point: *hiring someone is a desk decision about a person and their paperwork*).

**What the player feels next is the phase's payload: redundancy.** The clerk walks behind the desk, and the next guest presents *to them*. The player is standing in their own lobby with nothing to do for the first time in the game. `staffBrainSystem` works visibly — the clerk faces the guest, pauses (skill-scaled `decisionDelayTicks`, long enough to watch), decides. Then the trust loop opens: the clerk's `skillPermille` means occasional `staff.decision` mistakes, which the player discovers not by a HUD alert but through MAILBOX complaints and the review scores days later — day-granularity consequences, exactly like the zen loops. **What changes about play:** the desk becomes optional (walk over and focus the terminal to override at any time — the clerk stands down while you hold focus), wages join the nightly expense line, and the player's day reshapes around the zen loops and the terminal — the first taste of DESIGN pillar 4, delegation as progression.

**Verification — `first-hire` proves "unaided" structurally.** The clerk NPC submits `desk.decision` through `applyDeskDecision` as actor `staff:<entity>` — the *same function* the player's RESERVA effect and `clerkBot` reach, with the same range/vacancy/state validation (the clerk gets no back door; if the validation would deny a player, it denies the clerk). The gate then asserts unaided-ness on the command/event record: after `staff.hired`, **zero** `desk.decision`/`screen.*` commands from actor `"player"` exist in the log, while ≥2 `guest.checkedIn` and ≥1 `desk.fraudCaught` events carry `staff:*` attribution (events gain an `actor` field where decisions are made). Player absence is asserted, not assumed: the scenario walks the player away from the desk and keeps them there.

## 9. Housekeeping and maintenance — the zen ruling, made concrete

DESIGN's ruling: zen completion — **no per-room timer, visible dirt-reveal progress, day-granularity consequences.** The concrete mechanics, chosen to make violating the ruling structurally hard:

- **The verbs.** *Wipe:* a checkout leaves 2–4 discrete, visible mess props in the room (kinds are comedy content — pizza box, mystery stain, towel mountain); `interact` on a mess removes it. *Repair:* a broken prop takes N `interact` presses (`repairProgress` quantum), with visible host-side progress (the prop visually reassembles per quantum in H2b). That's it. No minigame inputs, no failure states, no consumables.
- **"Visible dirt-reveal progress" means the world is the progress bar.** Progress is the literal count of messes remaining in the room in front of you — never a meter, never a HUD. `roomUnit.messCount` exists for the sim; the player sees objects disappear. Partial progress **persists indefinitely**: half-cleaned stays half-cleaned across days, saves, and interruptions.
- **No pressure loop, enforced by construction.** There is no timestamp anywhere in `mess` or `repairProgress` — nothing *can* decay, compound, or expire, because the components cannot express it. Messes never multiply while dirty; a broken prop never worsens (no cascade — a Phase 3 system, deliberately absent). The reviewer's check is the component shapes themselves.
- **Consequences land at day granularity only.** A dirty or broken-prop room is simply not *sellable*: RESERVA's vacancy list excludes it and `applyDeskDecision` refuses it (`desk.denied-room { reason: "not-ready" }`) — a block, not a punishment. The punishment is the room-night you didn't sell, and it lands where all economics land: the night audit. An *occupied* room's broken prop accrues integer broken-nights on the guest, cashed out once, in the checkout review. Nothing dings the player mid-day; nothing beeps.
- **The failure mode this design guards ("the game becomes chores"):** chores are unbounded, repetitive, and consequence-noisy. These loops are bounded (≤4 wipes, N repair presses), physical (you walk, you see it vanish), and settle exactly once per day at the ritual audit. The `zen-clean` gate makes the no-penalty property testable: delaying the cleaning changes *when* revenue returns, never adds any penalty event.

*Rejected: a cleaning meter/timer per room* — the ruling forbids it, and Two Point Hospital's fatigue analysis (DESIGN §6) is the cited reason. *Rejected: dirt as a continuous 0–100 scalar* — invisible, meter-shaped, and invites decay mechanics later; discrete props are self-evidencing progress and a comedy surface.

## 10. Escalation — stars, rule rows, and the MAILBOX blacklist

- **Stars recompute at the audit only** (day granularity — the rule set a shift started with is the rule set it ends with; mid-day rule flips would be unreadable and unfair). Formula (integer): star tier from the 7-day review average and room count thresholds; H2's reachable range is 1–2. `hotel.starsChanged` is a headline audit event.
- **A tier change activates rows mechanically, in all three consumers at once:** everywhere H1 hardcoded `rulesForStars(H1_RULES, 1)` now computes `rulesForStars(RULES, hotel.stars)` — `deskSystem`'s ground truth (planting selects only active-and-plantable rows), `staffBrainSystem`/`clerkBot`'s decide, and RESERVA's procedures card (which requires `stars` to join `ScreenViewData`; RESERVA's module-level `ACTIVE_RULES` constant at `reserva-app.ts:35` is deleted — it is exactly the kind of frozen-at-import state the escalation system cannot tolerate). The card growing a new procedure line *is* the player-facing difficulty curve, per DESIGN's ruling.
- **The H2 row set:** H1's five rows unchanged, plus `{ id: "blacklist", minStars: 2, check: { kind: "listed", listId: "blacklist", docType: "id", docField: "name", mustBe: "absent" }, failFlag: "blacklisted" }`.
- **MAILBOX delivers the bulletins the `listed` kind was designed for:** once `stars ≥ 2`, `mailSystem` delivers a bulletin on seeded days — a `mail{kind:"bulletin"}` the player reads for the names, and an append to the `noticeList{listId:"blacklist"}` component that `RuleContext.lists` is built from (the seam `rules.ts:51` planned). Delivery activates the rule data; reading informs the player (ruling above).
- **The `plantViolation` `listed` fix — this phase is the trigger, and the answer is yes.** The H1a review's item 3 named "the first list ships via MAILBOX" as the hard trigger; MAILBOX ships. `plantViolation` gains `ctx: RuleContext`, the `mustBe:"absent"` branch plants by writing a value drawn from the *actual list* (`rng.pick(ctx.lists[listId])`), a `plantableRules(rules, ctx)` filter excludes list-dependent rows whose lists are empty, and the round-trip property test is extended to `listed` rows against a fixture list — closing the "committed-wrong code" finding with the review's own prescribed shape.

## 11. The art look-lock — a gate, not an opinion

The lock has two layers, and the spec is honest about which is mechanical:

**Mechanical (probe/unit-gated, the calibration-strip precedent applied where it genuinely extends):**
1. Atlas invariants, unit-tested in `interiors`: `palette.length ≤ 32`; dithering present (Bayer-pattern autocorrelation on a known-gradient test tile — the synthesized checkerboard idea applied to the atlas); every mesh material id has an atlas region; deterministic byte-identical regeneration per seed.
2. Texel density, unit-tested from the mesh: UV extent × atlas region size ÷ quad world size ∈ 64 ± 16 px/m for every wall/floor quad.
3. **The exemption, probe-gated:** `art-lock` runs the *existing* `screen-readability` probe at the focused pose **with the PS1 shader live on everything else** — `texelScale ≥ 1.0`, `calibContrast ≥ 60`, `calibPitchErr ≤ 0.1` unchanged. H1b's own perturbation evidence (mip filtering alone collapsed contrast 241→41) shows affine warp or jitter leaking onto the quad fails this mechanically. This is B6's "must exclude screen quads" as a gate.
4. Budgets: `draw-calls ≤ 300`, `frame-time-p95 ≤ 16.7 ms` in `feelTargets`.

**Human (named, scoped, and recorded — because "charming, not programmer art" has no probe, and pretending otherwise would be a fake gate):** the H2b review includes a **look-lock sign-off step**: Chris views the four committed gate screenshots (lobby wide, corridor, bedroom with mess props, focused terminal) in the browser preview *and drives the build himself* (the H0 "a build report is not proof" rule), then the review records `LOOK-LOCKED: <commit>` against the exact contents of `look-lock.ts` (jitter grid, warp flag, atlas seed). Roadmap risk 7's warning sign is the test applied during sign-off: *if a screenshot needs a caption to parse, it fails.* **After sign-off, any change to `look-lock.ts` or the atlas synthesis is a public-contract change requiring a review turn** — that is what "freeze" means here, and it is what protects everything authored in Phases 3+ from a moving target. There is no calibration-strip equivalent for charm; the spec says so and gates what can be gated.

## 12. Performance — what must actually change, and the numbers

The number to beat: `checkin-rush` avgTickMs **0.030 at ~60 entities** (H1b review, carried twice). H2a roughly doubles entity counts (messes, props, mail, reviews, objectives, staff) and `one-man-week` runs 42,000 ticks. The H1b-named targets:

1. **Per-tick O(entities) scans → `indexSystem`.** Today the open-cell set and occupancy are built up to *three times per tick* (`moveSystem` player branch at `game.ts:714`, NPC branch at `:723`, plus `pathSystem`), and `buildScreenWorldView` does two full `entities()` sweeps per `screen.*` command *and* per focused tick. `indexSystem` builds each exactly once into the tick context; `buildScreenWorldView` reads the context sim-side (the host-side caller keeps its own build — it runs per repaint, off the sim's budget).
2. **A* allocation profile.** `findJitteredPath` allocates open/closed structures and path arrays per call. Refactor to module-level scratch typed arrays sized to the grid (generation-counter stamping instead of clearing), fully overwritten each call — deterministic because no content survives a call; documented as such. Path output arrays still fresh (they live in components).
3. **Incremental `stateHash`** (contract A) — this is what makes 42,000-tick `--verify-replay` runs cheap; the hash was the dominant per-tick cost in long verifies.

**Measurement gates:** `one-man-week` verdict `perf.avgTickMs ≤ 1.0` (headless, review-read like H1's) and — the regression guard for the refactor itself — re-run `checkin-rush` post-refactor with avgTickMs **≤ 0.030** (the refactor must not lose to the number it was scheduled to beat, at the old entity count). Browser: `sim-tick-ms ≤ 5`, `frame-time-p95 ≤ 16.7`, `draw-calls ≤ 300` in `feelTargets` on `art-lock`. A `core` unit bench (review-read, not asserted) reports incremental-vs-slow hash µs/call at a 300-entity fixture; the expectation stated in the test comment is ≥10×.

## 13. Exit criteria

All headless scenarios `--verify-replay` (which now includes the slow-hash cross-check), exit 0; exit 3 = P0. All browser scenarios: tick-gated input, start barrier, constant command counts, per H0 round 3's bar. Every new screen app carries the H1b pattern obligations (layout()-derived decision test, both branches, guard; registry-derived composed overflow entry).

**H2a gates:**

1. **`one-man-week`** — seed `hotel-h2-week-1`, ticks 42,000 (7 days), headless. `ownerBot` (scenario-local BotDriver) plays owner end-to-end: desk via the rule table until the hire, wipe/repair rounds each midday, PRICER rate set on day 2, hire on the unlock day, then desk left to the clerk. Assertions: 7 `econ.audit`s; final `hotel.cash > 0` (solvent); ≥1 `staff.hired`; ≥1 `guest.reviewed` and ≥1 `guest.complained`; `repBySegment` non-default for ≥1 segment; 21 `objective.posted` and ≥1 `objective.completed`; ledger balances including wage entries after the hire; `roomUnit.messCount` consistency vs a `mess` scan; zero `nav.stuck`. Verdict `perf.avgTickMs ≤ 1.0` review-read. Pass: exit 0 `--verify-replay`.
2. **`first-hire`** — seed `hotel-h2-hire-1`, ~7,000 ticks, headless. Config pins cash above threshold at day-1 audit. Script: résumés print (assert 2 `printer.printed` + document entities in the tray anchor), candidate arrives, player interacts, STAFF-app HIRE clicked via `screen.click` at `layout()`-derived coordinates (the H1b decision-test pattern, as a scenario), player walks away; 3 guests spawn, one with planted fraud. Assertions: `staff.hired`; thereafter zero `desk.decision`/`screen.*` from actor `"player"`; ≥2 `guest.checkedIn` and 1 `desk.fraudCaught` with `staff:*` attribution; PASS branch covered on a second candidate (`staff.rejected`, candidate leaves). Pass: exit 0 `--verify-replay`.
3. **`zen-clean`** — seed `hotel-h2-zen-1`, ~9,000 ticks, headless. Guest A checks out (messes spawn; assert count 2–4); guest B presents; `desk.decision` accept onto the dirty room → refused with `desk.denied-room{not-ready}` and RESERVA's view excludes it (screen-state assertion); player wipes all messes (assert `room.messCleaned` and mess entities despawned); B accepted onto the now-clean room. A prop is broken by config; repair to completion; assert `prop.repaired`. The zen property: run holds a 2,000-tick idle gap mid-cleaning and asserts the event log contains **zero** penalty-class events attributable to the delay (nothing exists to emit one — the assertion documents the ruling). Pass: exit 0 `--verify-replay`.
4. **`escalation-stars`** — seed `hotel-h2-stars-1`, ~30,000 ticks, headless. Config drives high reviews to reach 2 stars at an audit (assert `hotel.starsChanged{1,2}`); assert the bulletin `mail` and `noticeList.values` non-empty on the seeded day; a post-bulletin guest with a planted `blacklisted` violation is spawned (plantable only now — assert planting selected it) and `clerkBot` at error 0 catches it; a pre-tier control guest shows the row inactive (never planted, never flagged). Unit: the extended plant/evaluate round-trip over `listed` rows with a fixture list, every row exact. Pass: exit 0 `--verify-replay`.
5. **App decision-path suite** (in `apps/hotel/scripts/test.mjs`, per pattern obligation): PRICER rate up/down + bounds guard; MAILBOX open/read + read-flag; STAFF hire/pass + cash guard; LEDGER day paging; RESERVA re-verified against the now-view-derived rule card at stars 1 and 2. Composed-shell overflow gate derives its app list from the registry and covers all six apps at worst-case data.
6. **Standing gates green at re-pinned goldens:** the golden re-pin (contract A) lands as H2a lane 1, one commit, with all property/scenario logic unmodified; every H1 scenario then passes untouched through the rest of H2a except where this spec names a change (`corridor-headon` + sidestep assertion, deferral 4b).

**H2b gates:**

7. **`art-lock`** — seed `hotel-h2-look-1`, browser, Chromium **and** Firefox. Tick-gated walk through lobby → corridor → bedroom → desk focus; screenshots at 4 named ticks; probes `screen-readability` (shader-exemption proof, thresholds unchanged), `frame-time-p95 ≤ 16.7`, `draw-calls ≤ 300`, `sim-tick-ms ≤ 5` — all in `feelTargets`. Plus the atlas/texel unit gates (§11) and the **human look-lock sign-off recorded in the review**. Pass: both engines, `--verify-replay`, exit 0.
8. **`save-resume`** — seed `hotel-h2-resume-1`, browser. Play to the day-1 audit (auto-snapshot), record `stateHash` via the hook at a quiet tick, reload the page, boot path recovers via `listGames()` + `"./recover"`'s `recoverSim`; assert recovered hash equals recorded hash (through the existing `SaveRestoreDebug` machinery), then continue 500+ ticks through fresh guest spawns and one interact on a post-restore-spawned guest (exercising `resetEntityKeyedHostState` for real — the H1b item-6 hazard). No pinned-pose no-op dependency (deferral table, last row). Pass: exit 0 `--verify-replay`.
9. **`audio-coverage`** — headless unit in `packages/audio`: `auditSoundCoverage` over the hotel's rule table and the full gameplay event-type list returns zero uncovered, zero unknown; `createAudioHost` against a mock `AudioContext` consumes a recorded `one-man-week` event stream without error and schedules >0 nodes. Honest scope: no gate asserts audible output.
10. **Byte-identical headless goldens:** every H2a-pinned hash unchanged by the entire H2b diff — the invariant-2 check, run first in the review.

## 14. Implementation order (lanes; → = dependency; ∥ = parallel)

**H2a:**
1. `core` incremental `stateHash` + `stateHashSlow` + harness cross-check + **global golden re-pin** (one commit, first). *(no deps; everything else builds on the new numbers)*
2. `indexSystem` + A*-scratch refactor + `checkin-rush ≤ 0.030` re-verify → after 1.
3. `actorId` migration + component extensions + `rules.ts` `plantViolation(ctx)` fix + round-trip extension → after 1; ∥ 2.
4. Housekeeping/maintenance (mess/prop, interact widening, room eligibility) → after 3.
5. Reviews/reputation/stars/demand/objectives (`reviews.ts`, `economy.ts`, dayPhase extensions) → after 3; ∥ 4.
6. MAILBOX/`noticeList`/bulletins + PRICER + LEDGER apps + effects → after 5.
7. Candidate/staff systems + STAFF app + first-hire wiring → after 3, 6 (STAFF app), ∥ 4.
8. `ownerBot` + scenarios `zen-clean` (after 4), `escalation-stars` (after 6), `first-hire` (after 7), `one-man-week` (after all) + app decision suite. **H2a review gate.**

**H2b (lane 9 may start ∥ H2a from day one — zero shared files):**
9. `interiors` atlas + UVs + vertex-light bake + unit gates; `assets` `MeshData.uvs`. *(no H2a deps)*
10. `renderer-three` retro material + `instancedScenery` + `frameStats` hook; hotel render wiring + `look-lock.ts` + boom clip → after 9.
11. `harness` `frame-time-p95`/`draw-calls` probes → ∥ 10 (contract-only dep).
12. `@claude-engine/audio` + `sounds.ts` + muzak tiers → *(no deps on 9–11; needs H2a's event vocabulary, so branches from the H2a merge)*.
13. `persistence` `listGames`/`deleteGame` + `"./recover"` subpath; `save-web` impl; `main.ts` boot-recover + id-switch + `resetEntityKeyedHostState` hardening → *(independent lane)*.
14. Scenarios `art-lock`, `save-resume`, `audio-coverage`; byte-identical-golden sweep; look-lock sign-off. **H2b review gate.**

## 15. Risks (with early warning signs)

1. **Incremental hash silently diverges from truth** (an in-place component mutation somewhere). *Early sign:* the slow-hash cross-check trips in any `--verify-replay` — which is why it runs on every one; the fix is finding the write-through violation, never loosening the check.
2. **The zen loops play as chores.** *Early sign:* `ownerBot`'s cleaning rounds dominate its schedule (>⅓ of scripted actions), or Chris's drive-through has him sighing at wipe #4 — cut mess counts/repair quanta; the constants are tuning-free by design.
3. **`ScreenViewData` becomes the kitchen sink** with four new apps. *Budget:* ≤ 9 top-level keys total, each app reads ≤ 3; the reviewer counts, as in H1.
4. **The economy misses solvency on the pinned seed** (demand × pricing × wages interact). *Early sign:* `one-man-week` failing only its cash assertion — tune constants (all in `economy.ts`), never the assertion; if tuning loops twice, escalate per WORKFLOW (the standing two-loop trigger).
5. **Singleton-player assumptions surface under the second actor kind** (B9's named warning). *Early sign:* any `PLAYER_ACTOR`/`PLAYER_ENTITY` literal inside a decision/validation path during the `actorId` migration — the reviewer greps for exactly that.
6. **Art fiddling consumes the schedule** (roadmap risk 7 meets a timebox). *Early sign:* lane 9/10 iterating on synthesis parameters past its window — the look-lock exists to *end* iteration; lock adequate-and-charming, not perfect, and record what "later" costs (a review turn).
7. **Day length fights the beat pacing** (5-minute days may compress the hire arc into noise for humans while gates pin their own configs). *Early sign:* the sign-off drive feels rushed between audits — `DAY_TICKS` is a named constant; gates pin per-scenario configs so retuning the shipped value never moves a golden.
8. **The staff decision path forks from the player path** under implementation pressure (a "simpler" clerk shortcut). *Early sign:* any clerk code path reaching room assignment without `applyDeskDecision` — `first-hire`'s attribution assertions plus reviewer grep make it unshippable.

## 16. Open questions (deliberate implementer judgment)

1. All economy constants: `HIRE_THRESHOLD_MINOR`, wage range, demand pool sizes and price-sensitivity curves, review-score weights, objective kinds/rewards, star thresholds — shapes and integer-ness are fixed above; values are tuning against gate 1's solvency.
2. Mess kinds/placement flavour and prop kinds (comedy content; counts bounded 2–4 and one prop per room by spec).
3. Candidate count per unlock (2–3) and quirk table contents (data only — quirks have no system effects this phase).
4. SFX recipes and the muzak tier mapping (which scale/tempo/voices per star) — gated only by coverage, not by taste.
5. Atlas material set granularity (per-room floor variants vs shared) — within the palette/texel gates.
6. `decisionDelayTicks(skill)` curve and clerk work-cell placement (derived from `floor.desk`, committed with a derivation comment per house style).
7. Whether LEDGER's day paging is buttons or key-driven (either; it carries decision coverage regardless).
8. The boot-recover UX when a save exists but `RestoreError` fires (silent fresh start vs a one-line diegetic notice) — document the choice in `main.ts`.
