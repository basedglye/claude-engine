# Phase H1 spec — "Front Desk & The Terminal"

Status: **planned** (step-1 output of the [WORKFLOW.md](WORKFLOW.md) loop; the step-3 review gate verdicts against it, verbatim). Game context: [apps/hotel/docs/DESIGN.md](../apps/hotel/docs/DESIGN.md), [apps/hotel/docs/ARCHITECTURE.md](../apps/hotel/docs/ARCHITECTURE.md), [docs/ROADMAP-HOTEL.md](ROADMAP-HOTEL.md). Predecessor: [PHASE-H0.md](PHASE-H0.md), reviewed PASS at round 3 in [reviews/phase-H0.md](reviews/phase-H0.md) — this spec consumes that review's **final consolidated H1 deferral list** item by item (see "The H0 deferral ledger" below).

This phase creates two engine packages (`@claude-engine/surface-ui`, `@claude-engine/save-web`) and touches persistence-adjacent surfaces, so it is an [F] phase with a full review gate.

## The split ruling, up front

**H1 is split into two sub-phases, H1a and H1b, each with its own review gate.** The roadmap scope — a diegetic OS framework, a guest AI with deterministic nav, a rule-table check-in system, an economy, a day clock, browser persistence, and character rendering — is two phases wearing one name. H0 proved the review gate works because each round could re-verify everything; a single diff containing IndexedDB persistence *and* symmetry-breaking nav *and* a screen framework cannot be reviewed in one pass with that rigour.

The cut line is chosen so that **H1a is entirely headless-verifiable and H1b is entirely presentation-and-persistence**:

- **H1a — "The Queue" (sim substance).** Guest NPCs with portal+grid nav, yield rule, jitter, explicit queue; document and reservation entities; the RESERVA **rule table as a sim module** (evaluation logic, no UI); the check-in/out state machine driven by a raw `desk.decision` command; basic economy + ledger; day clock + phases + the audit *event*; `clerkBot`; articulated-prop guest rendering with walk pose (host-side, small). Gates: `checkin-rush`, `fraud-catch`, `corridor-headon` — all headless, all `--verify-replay`.
- **H1b — "The Terminal" (surfaces).** `@claude-engine/surface-ui` + the HOTELSOFT shell + the RESERVA and AUDIT apps *painting the state H1a already computes*; screen focus/input routing; `screenClick` implementation in the harness; `@claude-engine/save-web`. Gates: `save-restore`, `reserva-readability` — browser, tick-gated with the start barrier per H0 round 3.

*Rejected: shipping H1 as one phase* — the diff would exceed what one review round can re-verify, which is precisely how H0's four pre-review defects shipped. *Rejected: moving `save-web` to H2* — the night audit is the save ritual (DESIGN §2); shipping the audit without the save ships half a ritual, and the MP preconditions want browser save battle-tested early. The rule table cannot move to H1b: `desk.decision` needs fraud evaluation in-sim on day one, or the escalation system gets retrofitted — the exact thing the roadmap forbids.

The player can play H1a with the desk decisions bound to temporary keys (accept/deny while facing the guest); H1b replaces that with the terminal. Those temp bindings are removed in H1b — recorded here so the reviewer flags them if they survive.

## Goal

**H1a:** guests walk in from the street door, queue at an explicit slot chain in front of a front desk, present a document pair (ID + reservation slip), and are accepted or denied by a `desk.decision` command (player key or `clerkBot`); accepted guests walk to their assigned room; money moves through a double-entry ledger; a day clock runs phases and closes with a night-audit event — all deterministic, all replay-verified.

**H1b:** the player walks to the desk terminal, focuses it, and works RESERVA on a rendered in-world CRT — inspects the reservation against the held ID, clicks ACCEPT/DENY/room assignment on the screen; the night audit is read on the AUDIT screen; the game saves to IndexedDB and reloads to an identical `stateHash`; the focused RESERVA screen passes a mechanical readability check.

## Non-goals (aggressive, per house style)

- **No LEDGER/PRICER/MAILBOX/STAFF/PURCHASE/CCTV/BLUEPRINT apps.** The HOTELSOFT shell exists with exactly two apps: RESERVA and AUDIT. The shell's app-registry contract is the forward surface; the apps are not.
- **No hiring, no staff NPCs, no clerk character.** `clerkBot` is a harness bot, not an in-world NPC. The first-hire beat is Phase 2's flagship.
- **No upsells, complaints, reviews, reputation, demand curve, pricing.** Economy is: room charge on accept, fixed rate by tier; wages/utilities as flat daily expenses at audit. `economySystem` exists; its content is minimal.
- **No housekeeping/dirt/maintenance.** Rooms are always ready.
- **No guest needs beyond the check-in loop.** Guests: arrive → queue → present → walk to room (or leave) → stay until checkout tick → walk out → despawn. No wandering, no archetype *behaviours* — archetypes exist only as data flavouring names and documents.
- **No multi-floor, stairs, elevators.** The generator adds a front desk, a street door, queue cells, and usable bedrooms to the **same single floor**.
- **No textures/UVs/PS1 shader** (Phase 2), with the one B7-mandated exception: the screen texture, which is native-resolution and would be exempt from that pipeline anyway.
- **No audio package.**
- **No multiplayer wiring**, but every new command is actor-bound and validated sim-side (B9's warning: no code may read "the player" as a singleton — `desk.decision` takes the deciding actor from the command).
- **No skinning, no GLTF** (standing rejection, B6). Characters are articulated `Object3D` limb hierarchies, host-side only.
- **No `GameStore` interface change.** See the save-web ruling; `listGames()`/`deleteGame()`/`compact()` are flagged as *future* additive changes, not made now.
- **No document forgery minigame depth.** Fraud is field mismatches per the rule table, not visual artifacts on the document texture. The held-item inspect view shows real field text; pixel-level forgery tells are Phase 3 content.

## The H0 deferral ledger (round-3 list, item by item — the review gate audits this table)

| # | Item | Disposition |
|---|---|---|
| 1 | Third-person boom clips walls | **Re-deferred to Phase 2** (the art/feel pass owns camera polish; nothing in H1 changes the camera rig). |
| 2 | `isOpenAt` O(doors × portal-cells) per probe | **Scheduled: H1a.** Guests run `findPathCells` with `isOpen` every repath; fix before the first NPC pathfinds (see determinism rule 6: the per-tick open-cell set). |
| 3 | Golden hash `0xe96201ca` / fixed topology | **Scheduled: H1a re-pins.** The generator adds desk, street door, queue cells, bedroom specs; the topology-agnostic property tests (quad↔boundary bijection, 100-seed traversal, connectivity) carry the weight and must all pass with unmodified logic. |
| 4 | Zero-thickness walls, 2D grid, rooms-layer `roomAt` | **Kept as-is** (confirmed correctly shaped; H1 builds on them unchanged). |
| 5 | `walk-collide` module-level recording closure | **No action**; H1 scenarios must not copy the pattern. |
| 6 | Wall-clock keyboard scheduling variance | **Carried rule, applied:** every H1b browser scenario uses tick-gated steps and the start barrier exclusively. No new wall-clock steps in this phase. |
| 7 | `pollUntilTick` bounded-late for non-zero gates | **Re-deferred, trigger unchanged** (a command landing one tick after its gate → replace polling with an in-page tick subscription). H1b scenarios inherit the ~3× sampling margin; the gate-constancy bar makes a trip visible, not silent. |
| 8 | Start barrier opt-in per app (`worldforgeStartPaused`) | **No new apps are browser-driven in H1** (both H1b scenarios drive `@claude-engine/hotel`, already wired). The exit-2 guard stands as the tripwire. |

Also carried from round 1: the command-stamp convention is settled (`world.tick + 1` at the pump; stamp == execution tick). H1 rules that read `c.tick` may rely on it.

## API contracts

Everything below is real exported TypeScript. **[public-contract change]** marks gate-audited surfaces.

### A. `@claude-engine/surface-ui` (new package — split into a pure root and a host entry)

The B7 consequence drives the design: `reduce` runs in sim, the painter runs in the host, and **hit-testing must agree between them without sharing floats**. The mechanism is a shared pure integer layout pass.

`packages/surface-ui/src/` is a **pure root** (registered with `banTranscendentals` in `check-purity.mjs` — it computes sim-side layout); `packages/surface-ui/src/host/` (exported as `@claude-engine/surface-ui/host`) may import DOM/canvas types and is excluded from the pure root the same way `net`'s web half is.

```ts
// packages/surface-ui/src/types.ts  (pure)

/** All screen coordinates are integer pixels on the app's fixed logical
 *  surface (SCREEN_W x SCREEN_H). No floats cross the sim boundary. */
export const SCREEN_W = 640;
export const SCREEN_H = 480;
/** Embedded bitmap font metrics — glyphs are 8x8; layout math is integer. */
export const GLYPH_W = 8;
export const GLYPH_H = 8;

/** Input delivered to reduce() by the sim's screenSystem. Already validated:
 *  the submitting actor holds terminal focus and is in range. */
export type ScreenInput =
  | { kind: "key"; code: string }                 // KeyboardEvent.code vocabulary
  | { kind: "click"; px: number; py: number }     // integer surface pixels
  | { kind: "open" }                              // app brought to foreground
  | { kind: "tickPulse" };                        // optional 1 Hz pulse

/** A rectangle in surface pixels. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Retained paint tree — data, not code. The host interprets it; the sim
 *  never sees it. Every node is JSON-plain. Colors are palette indices into
 *  the 16-colour HOTELSOFT palette (the host owns the RGB values; the sim
 *  knows only indices). */
export type PaintNode =
  | { kind: "panel"; rect: Rect; fill: number; border?: number }
  | { kind: "text"; x: number; y: number; text: string; color: number; bg?: number }
  | { kind: "button"; rect: Rect; label: string; color: number; pressed?: boolean }
  | { kind: "table"; rect: Rect; cols: number[]; rows: string[][]; selRow?: number; color: number }
  | { kind: "hline"; x: number; y: number; w: number; color: number }
  /** 1-px checkerboard strip — the readability probe's calibration target.
   *  Painted by the shell chrome on every app. */
  | { kind: "calib"; rect: Rect };
```

```ts
// packages/surface-ui/src/app.ts  (pure)
import type { PaintNode, Rect, ScreenInput } from "./types.js";

/** What an app reads from the world. A narrow, read-only projection built
 *  by the game's screenSystem each time reduce runs — apps never receive
 *  the Sim. Keeps reduce pure and testable with plain objects. */
export interface ScreenWorldView {
  tick: number;
  /** Game-defined query results, prepared by the registering game code. */
  data: Record<string, unknown>;
}

/** A diegetic screen app. `state` must be JSON-plain integers/strings — it
 *  lives verbatim in the `screenApp` component and is hashed. */
export interface ScreenAppDef<S> {
  id: string;
  /** Initial state. Pure; no Rng (apps are UIs, not games). */
  init(): S;
  /** Sim-side. Returns the next state, optionally with an effect the
   *  screenSystem re-submits as a validated command. */
  reduce(state: S, input: ScreenInput, view: ScreenWorldView): S | { state: S; effect?: ScreenEffect };
  /** Pure integer layout: the SAME function reduce uses for hit-testing is
   *  the one paintSpec uses for placement — hit rects cannot drift from
   *  pixels. Exposed so tests can assert click routing headlessly. */
  layout(state: S, view: ScreenWorldView): Record<string, Rect>;
  /** Host-side interpretation input. Pure function of (state, view). */
  paintSpec(state: S, view: ScreenWorldView): PaintNode[];
}

export interface ScreenEffect { type: string; payload: unknown }

/** Hit-test helper shared by app reduce() implementations. */
export function hitRect(rects: Record<string, Rect>, px: number, py: number): string | undefined;
```

```ts
// packages/surface-ui/src/shell.ts  (pure)
/** The HOTELSOFT '95 shell is itself an app that hosts other apps: a
 *  taskbar, an app switcher, and the focused app's surface. Shell state =
 *  { openAppId, appStates } and it delegates reduce/layout/paintSpec to the
 *  registered ScreenAppDefs. App availability (by terminal station / role)
 *  is a filter the game passes at registration — the escalation surface for
 *  later phases. */
export function createShell(apps: readonly ScreenAppDef<unknown>[], opts?: {
  available?: (appId: string, view: ScreenWorldView) => boolean;
}): ScreenAppDef<ShellState>;
export interface ShellState { openAppId: string; appStates: Record<string, unknown> }
```

```ts
// packages/surface-ui/src/host/painter.ts  (host entry — @claude-engine/surface-ui/host)
/** Rasterize a PaintNode tree to a canvas at native SCREEN_W x SCREEN_H
 *  using the embedded 8x8 bitmap font (committed glyph atlas data, same
 *  committed-codegen pattern as space's SIN_LUT — never canvas fillText,
 *  which is platform-nondeterministic in screenshots). Pure function of the
 *  tree; repaints only when told. */
export function paintScreen(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
                            nodes: readonly PaintNode[]): void;

// packages/surface-ui/src/host/screen-quad.ts
import type * as THREE from "three";
/** Creates the screen quad's CanvasTexture (nearest-neighbour, no mips,
 *  flagged for exclusion from any future retro-pipeline pass), plus the
 *  UV->surface-pixel mapping used to turn a raycast hit into integer
 *  {px,py}: px = floor(u * SCREEN_W) clamped, py = floor((1-v) * SCREEN_H)
 *  clamped. The float->int quantization happens HERE, host-side — the sim
 *  only ever sees integers. */
export function createScreenSurface(): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  uvToPixel(u: number, v: number): { px: number; py: number };
  /** Repaint iff paintSeq changed since last call (dirty check). */
  sync(paintSeq: number, nodes: readonly PaintNode[]): void;
};
```

`packages/surface-ui/src/host/font.ts` embeds the glyph atlas as **committed generated data** (`scripts/gen-font.mjs`, byte-identical-regeneration CI check, exactly like `sin-lut.ts`): 96 printable ASCII glyphs, 8 bytes each. *Rejected: any runtime font rasterization* — nondeterministic screenshots. *Rejected: troika / CSS3D / HTML-in-canvas* — per ARCHITECTURE B7, verbatim.

### B. `@claude-engine/save-web` (new package — browser host code, not a pure root)

**Ruling on the `GameStore` question:** the existing interface **needs no change**. It is already fully `Promise`-based; nothing in it is Node-shaped enough to block IndexedDB. What an IDB implementation actually requires, worked out against `sqliteStore`:

- **Intra-tick command order** is the one real gap: `sqliteStore` keys commands `(game_id, tick, idx)`. IDB gets the same explicit `idx` (a per-`(gameId,tick)` counter maintained inside `appendCommands`'s transaction), keyed `[gameId, tick, idx]`. `commandsSince` opens a bound key-range cursor — order is structural.
- **Atomic append**: one readwrite transaction over the `commands` store per `appendCommands` call satisfies the write-ahead contract.
- **`latestSnapshot`**: cursor over `[gameId, tick]`, direction `"prev"`, first hit.
- **Values**: stored via structured clone, but snapshots are stringified anyway so an exported save file and the stored bytes share one canonical JSON form.
- **`close()`**: `IDBDatabase.close()`.
- **What `GameStore` genuinely lacks** for a real save UI — `listGames()`, `deleteGame(id)` — is **flagged as a future additive ⚠ change and deliberately not made**: H1 uses a single fixed game id (`"hotel-sp"`). Adding list/delete is a one-line review-turn escalation when Phase 2 builds a load menu; making it now would change `sqliteStore`/`postgresStore` in a phase that otherwise does not touch them.

```ts
// packages/save-web/src/index.ts
import type { GameStore } from "@claude-engine/persistence";
import type { Command, SimSnapshot } from "@claude-engine/core";

/** IndexedDB GameStore. Schema version 1: stores `games` (key id),
 *  `commands` (key [gameId,tick,idx]), `snapshots` (key [gameId,tick]).
 *  Implements the EXISTING interface — invariant 5: the engine owns
 *  persistence; apps/hotel contains zero IDB calls. */
export function webStore(dbName?: string): GameStore;

/** Host-side save pump wiring a live sim to a store: batches commands
 *  (write-ahead), flushes on visibilitychange/pagehide, snapshots on demand
 *  (the night audit) and every `snapshotEveryTicks`. Returns the submit
 *  wrapper the app routes ALL command submission through. */
export function createSavePump(opts: {
  store: GameStore;
  gameId: string;
  snapshotEveryTicks?: number;              // default 2000
}): {
  submit(c: Command, passthrough: (c: Command) => void): void;
  /** Force a snapshot now (the audit ritual). Resolves when durable. */
  snapshotNow(sim: { snapshot(): SimSnapshot }): Promise<void>;
  flush(): Promise<void>;
};

/** Export/import a save as canonical JSON (bug-report replay, B8). */
export function exportSave(store: GameStore, gameId: string): Promise<string>;
export function importSave(store: GameStore, json: string): Promise<string /* gameId */>;
```

The load path is the existing `recoverSim(store, gameId, setup)` — unchanged, now running in the browser (it imports only core plus the store interface; verified to have no Node imports). *Rejected: a browser-local log format of hotel's own* — invariant 5 violation, and `recoverSim` already does the job.

### C. `packages/bots` addition **[public-contract change: additive]**

```ts
// packages/bots/src/clerk.ts
/** Reads the desk head guest's document/reservation components via IWorld,
 *  evaluates the SAME rule table the sim uses (supplied as `decide` to keep
 *  bots game-agnostic), and emits desk.decision intents with a seeded error
 *  rate. */
export function clerkBot(opts: {
  actor: string; seed: string;
  decide: (world: IWorld) => { type: string; payload: unknown } | undefined; // game-supplied
  errorRatePermille?: number;            // default 0; applied via the bot's own Rng
  everyTicks?: number;                   // decision cadence, default 20
}): BotDriver;
```

The generic `decide` keeps `bots` free of hotel imports, matching `randomWalk`'s payload-factory pattern.

### D. Harness **[public-contract change: `screenClick` un-reserved; new probe]**

- `{ pointer: "screenClick"; atTick: number; u: number; v: number }` is implemented (**tick-gated form only** — the reserved wall-clock form stays exit 2, since deferral rule 6 bans new wall-clock steps): dispatches through a new optional `SyntheticPointer.screenClick(u, v)` slot, which `player-fps` (focused-mode path) forwards to the same `uvToPixel` → command path a real click takes. Missing slot with a step present → `BrowserInfraError`, exit 2, matching the pointer precedent.
- New probe `{ probe: "screen-readability"; appId: string }`: reads `__WORLDFORGE__.screenRect()` (new optional hook slot the hotel app wires: the focused screen quad's projected axis-aligned pixel rect and its texel-per-screen-pixel scale) and analyses the *already captured* screenshot at the probe's declared tick. Reports `{ texelScale, calibContrast, calibPitchErr }`.
- `WorldforgeHook` gains optional `screenRect?()` and `SyntheticPointer` gains optional `screenClick?(u, v)` **[additive]**.

### E. `packages/interiors` **[public-contract change: `GroundFloor` extended, additive; golden re-pinned]**

```ts
export interface GroundFloor {
  // ...existing fields unchanged...
  /** Front desk: the desk prop cells (FURNITURE), the clerk-side terminal
   *  anchor, and an explicit queue slot chain (walkable cells, head slot
   *  adjacent to the desk, snaking into the lobby). */
  desk: {
    xMm: number; zMm: number; yawMdeg: number;      // terminal anchor + facing
    queueCells: { cx: number; cz: number }[];        // slot 0 = head; length >= 8
  };
  /** The street door (a DoorSpec index into `doors`) guests spawn outside of. */
  entranceDoorIndex: number;
  /** Bedrooms: roomId + tier + the interior cell guests walk to. */
  bedrooms: { roomId: number; tier: number; goalCx: number; goalCz: number }[];
}
```

Generator changes: the lobby gains a desk (FURNITURE cells) plus a queue chain; one exterior "street" strip outside the entrance door (room 0 side, walkable spawn cells); the existing 4 rooms are annotated as bedrooms. The golden hash is re-pinned; **the property tests (bijection, traversal, connectivity, 100-seed sweep) must pass with unchanged test logic**, plus two new properties: every `queueCells` entry is WALKABLE and mutually adjacent in chain order, and every `bedrooms.goal` is reachable from the desk head slot via `findRoute`+`findPathCells` with all doors open.

### F. `packages/space` — no changes

The yield rule and jitter live in the hotel's `pathSystem`, not in `space` — they are policy, not geometry. *Rejected: a `space` crowd module* — premature; extract in Phase 3 if a second game needs it.

## The `apps/hotel` additions

File layout (`src/sim` is already a purity root — H0 review item 3):

```
apps/hotel/src/sim/
  game.ts             setup(sim) — registration order below; H0 systems kept
  components.ts       all component interfaces (split out of game.ts)
  rules.ts            the RESERVA rule table + evaluator (pure; also imported by clerkBot's decide and by the RESERVA app)
  reserva-app.ts      ScreenAppDef for RESERVA (pure — surface-ui pure root types only)
  audit-app.ts        ScreenAppDef for AUDIT
  guests.ts           spawn tables, archetype data (names/segments/doc flavour)
  nav.ts              pathSystem helpers: open-cell set, occupancy, jitter, yield
apps/hotel/src/
  main.ts             host wiring (+ save pump, screen surfaces, focus camera)
  render/characters.ts articulated limb rigs + walk pose (host-only)
  render/screens.ts    terminal prop meshes + createScreenSurface wiring
```

**Components (all JSON-plain, all integers/strings/booleans):**

| component | shape (abridged) | on |
|---|---|---|
| `pos`/`prevPos`/`yaw`/`prevYaw`/`collider`/`player`/`door`/`interactable` | as H0; `interactable.kind` widens to `"door" \| "terminal" \| "guest"` | as H0 |
| `guest` | `{ archetypeId, segment, state, roomEntity, stayUntilTick, queueIndex, patienceTicks }` — `state`: `"arriving"\|"queued"\|"presenting"\|"toRoom"\|"inRoom"\|"leaving"` | guest entities |
| `navAgent` | `{ goalCx, goalCz, path, pathIdx, repathAtTick, jitterSeed, stuckTicks }` | moving NPCs |
| `document` | `{ docType: "id"\|"resSlip", fields, ownerEntity, heldBy }` | document entities |
| `reservation` | `{ guestEntity, fields, plantedViolations, decided, accepted?, roomEntity? }` | reservation entities |
| `roomUnit` | `{ roomId, tier, occupantEntity }` | one per bedroom |
| `terminal` | `{ station: "frontdesk", focusedBy }` | desk terminal entity |
| `screenApp` | `{ state: ShellState, paintSeq }` | same terminal entity |
| `hotel` | `{ cash, day, phaseId, phaseStartTick, nextGuestAtTick }` (singleton) | hotel entity |
| `ledgerEntry` | `{ day, debitAccount, creditAccount, amountMinor, memo }` | ledger entities |

**No-closure-state, applied to guest and reservation state explicitly:** everything that changes after tick 1 — guest FSM state, paths, queue membership, document holders, decisions, cash, `paintSeq`, screen state — lives in the components above and nowhere else. Setup closures hold only `floor` (pure from seed) and setup-spawned static ids, exactly as H0. Two sharp edges the implementer must not cut:

1. **The queue is derived, not cached** — `queueIndex` on `guest` is the truth, and the "who is at the head" lookup scans `withComponent("guest")` each tick. No closure array of queue entities.
2. **Guest RNG is `sim.forkRng`** — `setup` registers forks `"guest-spawn"` and `"guest-fraud"` (setup-time only, per core's contract) so `snapshot()`/`restore()` capture their streams. Per-agent jitter does **not** draw from any Rng at query time (see determinism rule 5).

**Commands** (all actor-bound; payloads all-integer/string):

- `face`, `move`, `interact` — as H0. `interact` on a terminal sets `terminal.focusedBy = c.actor` (revalidated: range + arc, same seam); on a guest at the queue head it begins `presenting`; a further `interact` or a `screen.blur` command clears focus.
- `screen.key { code }`, `screen.click { px, py }` — routed to the shell's `reduce` by `screenSystem` **only if** `terminal.focusedBy === c.actor` *and* the actor's entity is still in range of the terminal's `interactable`. Revalidated on every command — the anti-cheat posture applies to screens verbatim: the host's UV mapping proposes, the sim revalidates focus and proximity; out-of-range or unfocused `screen.*` emits `screen.denied { reason }`.
- `desk.decision { reservationEntity, accept, roomEntity? }` — the state-machine trigger. Validated: the submitting actor is at the desk (range check against the terminal anchor), the reservation is undecided, its guest is `presenting`, and on accept the room is vacant. In H1b, RESERVA's `reduce` emits this as an **app effect** and `screenSystem` re-submits it as a same-tick command from the same actor — so the decision always flows through the one validated `desk.decision` path whether it came from H1a's temp keys, `clerkBot`, or the screen.

**Events** (the assertion vocabulary): `guest.arrived|queued|presenting|checkedIn|denied|checkedOut|left`; `desk.fraudCaught { reservationEntity, violations }` / `desk.fraudMissed` / `desk.falseDeny` (emitted at decision time by comparing the decision against `plantedViolations`); `econ.charge|expense|audit { day, revenueMinor, expenseMinor, closingCashMinor }`; `screen.appOpened|actionTaken|denied`; `nav.stuck { entity, cx, cz }` (when `stuckTicks` crosses 40 — the soak tripwire from the roadmap's risk 4).

**System execution order** (registration order in `setup` — extends H0's four; ARCHITECTURE B3's order, pruned to this phase):

1. `snapshotPrevSystem` — now over all `pos`/`yaw` holders, not just the player.
2. `faceSystem` — player, as H0.
3. `guestSpawnSystem` — while `hotel.phaseId` is a check-in phase and `tick >= nextGuestAtTick`: spawn guest + ID + reservation slip + reservation entities from `forkRng("guest-spawn")`; with the scenario's configured probability, plant a violation chosen via `forkRng("guest-fraud")` by mutating one document field per the rule table's own vocabulary; schedule `nextGuestAtTick`.
4. `guestBrainSystem` — the FSM: assign queue slots (lowest free `queueIndex`), advance the chain when the head clears, react to `desk.decision` outcomes (set the `toRoom` goal from `floor.bedrooms`, or the `leaving` goal to the street), check out at `stayUntilTick`.
5. `pathSystem` — repath budget ≤ 10 A* per tick, round-robin by ascending `EntityId` starting after the last-served id (stored in a `navSchedule` singleton component, **not** a closure); computes the per-tick open-cell set and occupancy set once, up front.
6. `moveSystem` — player intent as H0; NPC agents advance one integer step (guest speed 150 mm/tick) along `path` via `moveCircle`, with the **yield rule**: if the next cell is occupied by a lower-id agent, wait (increment `stuckTicks`); if by a higher-id agent, proceed only if the cell frees this tick, else sidestep-repath.
7. `interactSystem` — as H0, widened kinds (terminal focus, guest presenting).
8. `deskSystem` — validates and applies `desk.decision`; emits fraud/econ events; assigns `roomUnit.occupantEntity`; creates paired `ledgerEntry` entities (double-entry: every charge debits `cash`, credits `revenue:rooms`).
9. `screenSystem` — routes validated `screen.*` to the shell's `reduce` with a fresh `ScreenWorldView` (whose `data` carries the queue head's document fields, the reservation fields, the room vacancy list, and today's ledger summary — prepared here, so apps never touch the Sim); on state reference change, bumps `paintSeq`; re-submits app effects as commands.
10. `economySystem` — daily flat expenses at the rollover into audit.
11. `dayPhaseSystem` — advances `phaseId` (morning 0 / day 1 / evening 2 / night 3) on tick thresholds (`DAY_TICKS = 4 * 1500`, i.e. 5 minutes per day at 20 Hz for this phase); at the night rollover emits `econ.audit` and increments `day`.
12. `cleanupSystem` — despawns guests in `leaving` state that reached the street spawn cell (guest, their documents, and the decided reservation) via core's `despawn`.

**Host (`main.ts`) additions:** the save pump wrapping all submits; F5/F9 quick-save/quick-load bindings (load = teardown + `recoverSim` + re-wire — acceptable for H1; async load races the render loop, so load pauses the accumulator first); focus camera ease toward the terminal when `focusedBy === PLAYER_ACTOR` (pointer exits lock but stays captured; the mouse position raycasts against the screen quad each frame → `uvToPixel`, but **`screen.cursor` is not submitted per move** — only clicks and keys become commands, and the hover cursor is purely host-side paint, *not* app state; *rejected: sim-side cursor state* — a 60 Hz mouse would flood the command log for zero sim meaning); the `screenRect()` hook slot; characters synced from `pos`/`prevPos` with a walk-cycle pose driven by displacement (host-side `Math.sin` is fine — presentation).

**Held-item inspect (the tactile layer, H1a-scoped minimally):** when a guest is `presenting`, their two documents get `heldBy = playerEntity` on `interact`; the host renders the held document as a prop raised toward the camera with its fields painted via the same bitmap-font painter onto a small per-document canvas texture (one painter, two uses). A further `interact` returns it. Document *state* (fields, holder) is components; the raised-prop pose is presentation. Full magnifier/rotate inspection is Phase 3.

## Determinism rules specific to this phase

1. **All H0 rules stand** (integer mm/mdeg, LUT trig, yaw-in-sim, raycast-proposes-sim-decides, no closure state, X-then-Z collision).
2. **Screen input is integers end-to-end.** The float UV from the raycast is quantized host-side in `uvToPixel`; `screen.click` carries integer `{px, py}`. The harness `screenClick{u,v}` floats are quantized by the same function — synthetic and real clicks share it.
3. **`reduce`/`layout` are sim code** and live under the `apps/hotel/src/sim` and `packages/surface-ui/src` purity roots — no `Math.` transcendentals, no floats in state, no Date/performance reads. `paintSpec` output never feeds back into sim state (`paintSeq` is a counter, not a content hash — hashing paint output would smuggle presentation into `stateHash`, which is the invariant-2 asset rule applied to pixels).
4. **Fraud planting draws only from registered forks**, so `save-restore` reproduces the exact future guest stream after a mid-day load.
5. **Cell-cost jitter is stateless hashing, not Rng draws:** `jitter(agentSeed, cx, cz) = hash32(agentSeed ^ (cz * grid.width + cx)) & 3`, added to A* g-cost, with `agentSeed` assigned once at spawn from `forkRng("guest-spawn")`. *Rejected: drawing jitter from the sim Rng during pathfinding* — the repath count would perturb the Rng stream, coupling nav timing to every other random system.
6. **The open-cell set** (deferral item 2's fix): `pathSystem` builds, once per tick, a `Set` of open-door cell indices by scanning `withComponent("door")` against seed-pure portal data, plus an occupancy `Map`. Both are **per-tick locals passed down the call stack** — computed and dropped within the tick, never stored across ticks, so they are not closure state.
7. **Scale target and what breaks first:** H1 targets ≤ 16 concurrent guests, ~60 entities. First to break at Phase-3 scale is the per-tick full component scans (open-cell set, occupancy, queue derivation) — all O(entities) per tick per system. Measured now by `checkin-rush`'s verdict `perf.avgTickMs` (budget ≤ 2 ms headless) and the browser `sim-tick-ms` probe (≤ 5 ms), so the Phase-2 `indexSystem` refactor lands against numbers rather than vibes.

## The RESERVA rule table (the forward-compatibility keystone)

```ts
// apps/hotel/src/sim/rules.ts  (pure; imported by deskSystem, reserva-app, clerkBot's decide)

/** One verification rule. Rows are DATA — the evaluator is the only code.
 *  Later tiers add rows (and at most new `check.kind` variants), never
 *  restructure. */
export interface RuleSpec {
  id: string;                       // stable slug, e.g. "name-match"
  minStars: number;                 // escalation gate; H1: all rows minStars 1
  check:
    | { kind: "fieldMatch"; docType: string; docField: string; resField: string }
    | { kind: "docPresent"; docType: string }
    | { kind: "notExpired"; docType: string; dateField: string }     // vs sim day
    | { kind: "listed"; listId: string; docType: string; docField: string; mustBe: "absent" | "present" };
    // Phase 3+ adds variants: crossRef, loyaltyTier, billingCode — additive.
  failFlag: string;                 // violation slug emitted on failure
}

export interface RuleContext {
  day: number;
  /** Named lists (blacklists, loyalty rolls) — H1: empty. MAILBOX delivers
   *  list updates in Phase 3 by writing components this is built from. */
  lists: Record<string, readonly string[]>;
}

export const H1_RULES: readonly RuleSpec[] = [ /* docPresent(id), docPresent(resSlip), fieldMatch name, fieldMatch resCode, notExpired(id) */ ];

/** Pure evaluator: returns the violated failFlags in table order. */
export function evaluateRules(rules, docs, resFields, ctx: RuleContext): string[];

/** The inverse — fraud PLANTING uses the same table: pick a rule via rng,
 *  mutate fields so exactly that rule fails. Guarantees every plantable
 *  fraud is catchable and names its flag. */
export function plantViolation(rules, rng: Rng, docs, resFields): string;
```

The load-bearing properties: rows are pure data gated by `minStars` (DESIGN's escalation ruling becomes "append rows per star tier"); the evaluator is the **single** fraud oracle for `deskSystem` (ground truth via `plantedViolations`), `clerkBot` (decision), and the RESERVA app. What the *player* is shown is the raw fields, never the evaluation — the game is the player running the evaluator in their head; RESERVA displays rule *descriptions* per tier as the diegetic "procedures card", not results. *Rejected: hardcoded fraud branches in `deskSystem`* — explicitly banned by the roadmap. *Rejected: rules as functions in the table* — functions cannot be serialized, diffed, delivered by MAILBOX, or gated by data.

## The screen contract, consolidated

Mechanism per B7, made concrete: each terminal entity owns one `createScreenSurface()` host-side (OffscreenCanvas 640×480 → `CanvasTexture`, nearest, `generateMipmaps: false`); `syncScene` calls `surface.sync(screenApp.paintSeq, shell.paintSpec(state, view))` — repaint only on `paintSeq` change, with `view` rebuilt host-side by the same exported pure view-builder `screenSystem` uses. Focus: `interact` → `terminal.focusedBy` (sim) → the host notices the component, eases the camera, exits pointer lock, maps the mouse to the quad by raycast each frame; click → `uvToPixel` → `screen.click{px,py}`; keydown → `screen.key{code}`; ESC → blur command, camera return, relock.

Headless assertability: **every** gameplay-relevant screen fact is a `screenApp.state` or component assertion (`shellState.openAppId === "reserva"`, `reserva.selectedRoomId === 3`); pixels are touched only by the readability probe. The `layout()` triple duty — hit-test in `reduce`, placement in `paintSpec`, assertable in unit tests — is what keeps clicks and pixels provably aligned without pixel-reading tests.

## Readability as a gate

The shell chrome paints, on every app, a **calibration strip** (`calib` node): a 32×8 px 1-texel checkerboard plus one 8×8 reference glyph row at a fixed surface position. The `screen-readability` probe, at the focused pose:

1. Reads `screenRect()` → the quad's projected rect plus `texelScale` (screen px per surface px, from the projected quad width / 640). **Fail if `texelScale < 1.0`** — B7's "≥ 1 texel per glyph pixel", measured rather than hoped.
2. Locates the calib strip in the screenshot via the rect and known surface coordinates; samples the checkerboard along its row at the expected pitch. Computes `calibContrast` = mean |luma(dark) − luma(light)| over expected alternations, and `calibPitchErr` = fraction of adjacent sample pairs failing to alternate by ≥ 24/255 luma.
3. Pass condition (in `feelTargets`): `texelScale ≥ 1.0`, `calibContrast ≥ 60`, `calibPitchErr ≤ 0.1`.

Why this fails on illegibility rather than only on blankness: a blurred (mip/linear-filtered), affine-warped, mis-scaled, or low-contrast screen collapses the 1-texel alternation (contrast → 0, pitch error → 1) even when the canvas is colourful. A blank canvas also fails (contrast 0). *Rejected: OCR or reference-image diff* — heavyweight and brittle across sub-pixel camera pose differences; the checkerboard is the highest spatial frequency the font uses, so preserving it bounds glyph legibility from below.

## Exit criteria

All headless scenarios: `--verify-replay`, exit 0; exit 3 = replay divergence = P0. All browser scenarios: tick-gated input only, the start barrier, constant command counts across runs per H0 round 3's bar.

**H1a gates:**

1. **`corridor-headon`** — seed `hotel-h1-headon-1`, ticks 300, headless. Setup: hotel `setup` with a scenario-config override (`setupWithConfig(sim, { fixture: "headon" })`) that spawns no scheduled guests and places two `navAgent` guests at opposite ends of the generated corridor with swapped goals; goal cells pinned from the seed's layout, derived and committed as literals with the derivation comment, per the H0 style. Assertions: both agents' final `pos` within their goal cell; both arrived by tick ≤ 200; zero `nav.stuck` events; and a mirrored pair (ids swapped, other axis) in the same run also resolves. Pass: exit 0.
2. **`checkin-rush`** — seed `hotel-h1-rush-1`, ticks 2400, headless. Spawn config: 8 guests over ticks 100–900, fraud rate 0. Bot: `clerkBot` (`errorRatePermille: 0`). Assertions: 8 `guest.checkedIn`; occupancy consistency (count of occupied `roomUnit`s equals guests in `inRoom`); every checked-in guest's final `pos` inside their assigned room via `roomAt`; **ledger balances** (debits equal credits per account pair, and `hotel.cash` equals opening + Σcharges − Σexpenses); zero `nav.stuck`. `perf.avgTickMs ≤ 2` is read from the verdict by the review gate, not asserted (assertions see the Sim, not the verdict). Pass: exit 0 with `--verify-replay`.
3. **`fraud-catch`** — seed `hotel-h1-fraud-1`, ticks 2400, headless. Spawn config: 6 guests, fraud rate 500‰ via `plantViolation` (the scenario comment records the derived planted count for this seed). Run A: `clerkBot` errorRate 0 → `desk.fraudCaught` count equals the planted count, zero `desk.fraudMissed`, zero `desk.falseDeny`, denied guests all reach `guest.left`. Run B: `clerkBot` errorRatePermille 1000 (always accept) → at least one `desk.fraudMissed`, and missed-fraud guests still check in (the failure path is a real path, not a crash). Pass: both exit 0 with `--verify-replay`.

**H1b gates:**

4. **`save-restore`** — seed `hotel-h1-save-1`, browser (Chromium; one Firefox run required in review, not in CI rotation). Tick-gated input: barrier start, walk ticks 1–30, F5 at tick 40 (save), continue 42–80, F9 at tick 90 (load). The hotel records `{ savedTick, savedHash, restoredHash }` into a hook slot; a `save-restore` probe reads it. Pass: `savedHash === restoredHash`, plus a **headless companion test** in `packages/save-web` (under `fake-indexeddb`) proving `webStore` + `createSavePump` + `recoverSim` round-trips a 500-tick hotel run to an equal `stateHash` — the browser gate proves wiring, the unit test proves the store. Exit 0.
5. **`reserva-readability`** — seed `hotel-h1-look-1`, browser, Chromium **and** Firefox. Tick-gated walk to the desk terminal (deltas derived from the seed's layout, committed with derivation comments), click to focus, `screenClick` on RESERVA's taskbar button, screenshot. Assertions (headless, via replay): `terminal.focusedBy === "player"`, `shellState.openAppId === "reserva"`, a `screen.appOpened` event exists. Probes: `screen-readability`, `sim-tick-ms`. Pass on both engines with `--verify-replay`, exit 0 — this is also the phase's screen-input determinism gate.
6. **Standing gates stay green:** build, eslint, `check-purity` (now nine roots, + `surface-ui/src`), `--self-test`, smoke hash `919868270`, and all existing scenarios including `fps-look-interact --browser --verify-replay` on both engines. The generator change re-pins that scenario's committed look deltas — the implementer re-derives them, and the H0 gate must be green **at the H1a review**, not deferred to H1b.

## Implementation order

**H1a** (lanes; → = dependency):

1. `interiors` generator extension + re-pinned golden + new properties. *(no deps)*
2. `rules.ts` + unit tests (evaluate/plant round-trip property: every planted violation is the only flag `evaluateRules` returns). *(no deps)*
3. `components.ts` + `guestSpawnSystem`/`guestBrainSystem`/`deskSystem`/`economySystem`/`dayPhaseSystem`/`cleanupSystem` → depends on 1, 2.
4. `nav.ts` + `pathSystem`/`moveSystem` NPC path → depends on 1; parallel with 3's desk half.
5. `clerkBot` (`bots` additive) → depends on 2, 3.
6. `render/characters.ts` + held-document rendering → depends on 3; parallel with 4, 5.
7. Scenarios `corridor-headon` (after 4), `checkin-rush`/`fraud-catch` (after 3, 4, 5); re-derive `fps-look-interact` literals (after 1). **H1a review gate.**

**H1b:**

8. `surface-ui` pure root (types, app, shell, layout) + purity-root registration + font codegen → *(no deps on H1a)* — **can start in parallel with H1a**; it shares no files.
9. `surface-ui/host` painter + screen-quad → depends on 8.
10. `reserva-app.ts`/`audit-app.ts` + `screenSystem` + `screen.*` commands + focus routing in `main.ts`; remove H1a temp keys → depends on 8 and the H1a merge.
11. `save-web` (`webStore` + pump + fake-indexeddb tests) → *(no deps on 8–10)* — parallel lane.
12. Harness `screenClick` + `screen-readability` probe + hook slots → depends on 9/10's contract.
13. Scenarios `reserva-readability`, `save-restore`; full gate matrix. **H1b review gate.**

## Risks (with early warning signs)

1. **Queue/nav deadlock survives the yield rule in the queue chain itself** (a leaving guest crossing the queue against arrivals). *Early sign:* `nav.stuck` events in `checkin-rush` long before the assertion fails; the generator should route the leave path around the queue cells — check that layout property in the interiors tests.
2. **`ScreenWorldView` becomes a kitchen sink** and apps start needing Sim access. *Early sign:* `data` keys added per widget rather than per app; the reviewer counts keys — RESERVA should need ≤ 5.
3. **The save pump races the render loop** (a tick consumes a command whose durable append has not resolved; the browser kills the tab mid-flush). *Early sign:* the fake-indexeddb round-trip test with an injected slow store shows a replay hash mismatch — the pump must queue the command synchronously (in-memory WAL) and only *ticks past a snapshot* depend on durability; document the crash-loss window (≤ one flush batch) in `save-web`'s README.
4. **The focus camera ease fights pointer-lock state machines across engines** (Firefox unlock timing). *Early sign:* `reserva-readability` Firefox runs show the focus click captured but no subsequent `screen.*` — same class as H0's round-2 lesson; keep focus entry/exit tick-gated and assert `screen.denied` count is 0.
5. **Rule-table scope creep during implementation** (adding a "just one" cross-ref check). *Early sign:* any new `check.kind` beyond the four specified — the reviewer rejects; H1 ships exactly the listed kinds.
6. **`fps-look-interact` literal re-derivation goes stale twice** (H1a changes the layout, H1b "fixes" it again). *Early sign:* the derivation comment's cell coordinates not matching the new golden — re-derive once, in H1a, with the comment updated.

## Open questions (deliberate implementer judgment)

1. Exact `H1_RULES` row set and document field names (the spec fixes the shape and the five-row minimum; flavour is content).
2. `hash32` choice for jitter (any committed integer hash; xorshift-mix suggested) — the contract is determinism plus range 0..3.
3. Whether `screenSystem` delivers a 1 Hz `tickPulse` to the shell (blinking cursor / taskbar clock) or the taskbar clock reads `view.tick` — either; a pulse must not bump `paintSeq` when state is unchanged.
4. Queue chain length and guest patience values (must support 8 concurrent plus the leave-in-disgust path; tuning free).
5. AUDIT app content beyond the `econ.audit` payload table (one screen, no interaction, is acceptable).
6. Whether F9 load rebuilds the Three scene in place or reloads the page (a page reload is acceptable for H1 if the harness step still verifies the hash via the hook after reload — the implementer documents the choice in `main.ts`).
7. Character rig proportions and pose math — host-side, unreviewed for determinism, only for charm.
