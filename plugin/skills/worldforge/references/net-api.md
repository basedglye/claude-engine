# Multiplayer: `@claude-engine/net`, `server`, `persistence`, `bots`

Phase 3's answer to Claudecraft's critique — authoritative server host,
event-sourced persistence, input validation/rate limiting at the boundary,
bot-driven load testing — as engine packages, not something a game hand-rolls
(CLAUDE.md invariant #5). Games declare `CommandRule`s and handle
`@net/join`/`@net/leave`; they never see a socket, a SQL string, or a token.

## The determinism model

**The authoritative server is the deterministic artifact.** It runs one true
`Sim` at 20Hz; every command is stamped with the tick it executes on by the
*server*, including player joins/leaves, which enter as reserved
`@net/join`/`@net/leave` commands — session lifecycle is part of the
replayable log, never an out-of-band host mutation. Invariant #3 ((seed,
command log) → identical hashes) holds for every server session.

**Client-side prediction is presentation, not simulation.** The net client
never runs a sim — it holds a replicated, interest-filtered copy of
authoritative state and optionally overlays prediction patches for
unacknowledged local input. Predicted views are outside invariants #2/#3
(the same standing Phase 2's `deterministic: false` browser verdicts
established) and are corrected by authority on every state message.

**Live sessions are reproducible headlessly, not re-runnable live.** A
server's authoritative command log (`GameServer.commandLog()`) is exactly
the replay bundle a soak or demo session needs — feed it to `--replay`
(`harness-api.md`) to reproduce the exact final state with no sockets.

## `@claude-engine/net` — wire protocol (pure root)

The protocol is the portability boundary (a future Godot/native host speaks
this JSON vocabulary, not TypeScript). It **wraps** command data: clients
send bare intents; `actor`/`tick` are server-assigned, which is what makes
input validation a boundary rather than a convention.

```ts
const PROTOCOL_VERSION: number;

interface CommandIntent { type: string; payload?: unknown; }

type ClientMessage =
  | { t: "hello"; proto: number; token: string }
  | { t: "input"; seq: number; intents: readonly CommandIntent[] }
  | { t: "ping"; sentAt: number };

type RejectReason = "unknown-type" | "invalid-payload" | "rate-limited";
type CloseCode = "auth-failed" | "protocol-error" | "superseded" | "server-shutdown";

interface ReplicaState {
  tick: number;
  stateHash: number;               // server's full-world stateHash() — the authority anchor
  entities: readonly [EntityId, readonly [string, unknown][]][];
  removed: readonly EntityId[];    // left interest OR destroyed
}

type ServerMessage =
  | { t: "welcome"; proto: number; playerId: string; actor: string; seed: string; tick: number; tickRateHz: number; state: ReplicaState }
  | { t: "state"; state: ReplicaState; ackSeq: number; events: readonly GameEvent[] }
  | { t: "reject"; seq: number; type: string; reason: RejectReason }
  | { t: "pong"; sentAt: number; serverTick: number }
  | { t: "close"; code: CloseCode; message: string };

function encodeMessage(m: ClientMessage | ServerMessage): string;
function decodeClientMessage(raw: string, limits?: ProtocolLimits): ClientMessage;  // throws ProtocolError
function decodeServerMessage(raw: string): ServerMessage;
function isReservedIntentType(type: string): boolean;  // "@"-prefixed — engine-reserved, client-unsendable
class ProtocolError extends Error {}
```

Intent types beginning with `@` (`@net/join`, `@net/leave`) are always
rejected from clients at decode time — before any game or server code sees
them.

## `@claude-engine/net` — client session

Environment-free (an injected `ClientTransport`), so prediction/
reconciliation is unit-testable headlessly with a scripted fake transport.

```ts
interface ClientTransport {
  send(raw: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: (info?: { code?: string; message?: string }) => void): void;
  close(): void;
}

interface PredictView {
  readonly selfActor: string;
  getComponent<T>(entity: EntityId, component: string): T | undefined;
  patch<T>(entity: EntityId, component: string, value: T): void;
}
type PredictFn = (view: PredictView, intents: readonly CommandIntent[]) => void;

interface ClientWorld extends IWorld {
  getPrevComponent<T>(entity: EntityId, component: string): T | undefined;  // interpolation data
}

interface ClientSession {
  readonly world: ClientWorld;
  readonly status: "connecting" | "open" | "closed";
  readonly actor: string;          // server-assigned "player:<id>", empty until welcome
  submitIntent(intent: CommandIntent): void;
  stats(): ClientNetStats;         // rttMs, pendingIntents, replicatedEntities, corrections, rejects
  close(): void;
}

function createClientSession(opts: {
  transport: ClientTransport;
  token: string;
  predict?: PredictFn;
  onEvent?: (event: GameEvent) => void;
  onClose?: (info: { code?: string; message?: string }) => void;
  pingIntervalMs?: number;         // default 2000, 0 disables auto-ping
}): ClientSession;

// @claude-engine/net/web (browser + Node 22+'s global WebSocket):
function webSocketTransport(url: string): ClientTransport;
```

`ClientWorld` implements `IWorld` over the replicated state + prediction
overlay; `stateHash()` returns the server-reported hash from the latest
state message (an interest-filtered replica can't reproduce a full-world
hash locally). Without a `predict` function, the session still works —
local input just waits for the next state message to appear, which is
imperceptible at LAN/localhost latency (this is what `apps/demo`'s net mode
does; see below).

**`corrections`** counts genuine mispredictions, not ordinary round-trip
latency: it's only evaluated once an intent's ack is no longer outstanding,
so authority not yet reflecting a still-pending intent doesn't count against
it.

**Identifying your own entity.** Games commonly store an `owner` component
on player entities set to `Command.actor` server-side (see `apps/demo`'s
`game.ts`); client-side, compare it against `session.actor` to tell your own
entity apart from others'.

## `@claude-engine/server` — the authoritative host

```ts
interface AuthProvider { authenticate(token: string): Promise<{ playerId: string } | null>; }
function ticketAuth(secret: string): AuthProvider;               // HMAC-signed, expiring
function issueTicket(secret: string, playerId: string, opts?: { ttlMs?: number }): string;
function devAuth(): AuthProvider;                                 // "dev:<name>" — never a default

interface CommandRule {
  validate(payload: unknown): boolean;
  maxPerTick?: number;
  maxPerSecond?: number;          // token bucket
}

interface InterestPolicy { entitiesFor(world: IWorld, actor: string): Iterable<EntityId>; }
function allEntities(): InterestPolicy;                          // default
function radiusInterest(opts: { positionComponent: string; ownerComponent: string; radius: number }): InterestPolicy;

interface GameServerOptions {
  seed: string;
  setup: (sim: Sim) => void;      // same game-module contract as harness scenarios
  auth: AuthProvider;
  commands: Record<string, CommandRule>;   // "@"-prefixed keys throw at startup
  interest?: InterestPolicy;                // default allEntities()
  filterEvent?: (event: GameEvent, actor: string, world: IWorld) => boolean;
  port?: number;                             // default 0 = ephemeral
  stateEveryTicks?: number;                  // default 1
  limits?: Partial<ProtocolLimits>;
  store?: GameStore;                         // see persistence below
  gameId?: string;
  snapshotEveryTicks?: number;                // default 600
}

interface GameServer {
  readonly port: number;
  readonly world: IWorld;
  stats(): ServerStats;            // ticks, tickP95Ms/tickMaxMs, commandsAccepted/Rejected,
                                    // rejectionsByReason, bytesOut, entities
  commandLog(): readonly Command[];  // the authoritative log — soak/demo replay bundle
  stop(): Promise<void>;
}
function startGameServer(opts: GameServerOptions): Promise<GameServer>;
```

A CommandRule's `validate`/`maxPerTick`/`maxPerSecond` reject before a
command is ever built — the sim never sees it. A second connection for the
same `playerId` evicts the first (`close("superseded")`), so a player
reconnecting from a fresh tab just works.

**Persistence wiring is write-ahead**: with `store` + `gameId` set, each
tick's accepted commands are appended *before* that tick steps (a crash can
lose an unexecuted tail, never produce state ahead of the log); snapshots
save every `snapshotEveryTicks`. Starting with an existing `gameId` recovers
via `recoverSim` and resumes from where the log left off.

## `@claude-engine/persistence` — event-sourced saves

```ts
interface GameRecord { id: string; name: string; seed: string; protoVersion: number; createdAt: string; }
interface GameStore {
  createGame(opts: { id?: string; name: string; seed: string }): Promise<GameRecord>;
  getGame(id: string): Promise<GameRecord | null>;
  appendCommands(gameId: string, commands: readonly Command[]): Promise<void>;  // atomic per call
  commandsSince(gameId: string, afterTick: number): Promise<readonly Command[]>;
  saveSnapshot(gameId: string, snapshot: SimSnapshot): Promise<void>;
  latestSnapshot(gameId: string): Promise<SimSnapshot | null>;
  close(): Promise<void>;
}
function sqliteStore(path: string): GameStore;    // better-sqlite3 — dev
function postgresStore(url: string): GameStore;   // pg — prod
function recoverSim(store: GameStore, gameId: string, setup: (sim: Sim) => void): Promise<{ sim: Sim; record: GameRecord }>;
```

What's persisted is the command log + snapshots, not emitted `GameEvent`s —
events are derivable outputs; the sim's source of truth (invariant #3) is
(seed, command log). `recoverSim` is snapshot → `Sim.restore()` → replay the
tail since the snapshot (`core-api.md`) — a live sim whose `stateHash()`
matches an uninterrupted run, *up to the last tick a command was actually
logged*: a crash can still lose ticks after that with nothing scheduled on
them (there's nothing to persist for a tick with no commands), which is why
the server also snapshots on graceful shutdown (`stop()`).

## `@claude-engine/bots` — load-test drivers

Pure root: reads `IWorld`, returns intents, never touches a `Sim` — a
`BotDriver` has no `submit()` capability at all.

```ts
interface BotDriver { readonly actor: string; act(world: IWorld, tick: number): readonly CommandIntent[]; }
interface BotContext { rng: Rng; memory: Record<string, unknown>; actor: string; }
type BotBehavior = (world: IWorld, tick: number, ctx: BotContext) => readonly CommandIntent[];

function createBot(opts: { actor: string; seed: string; behavior: BotBehavior }): BotDriver;
function scripted(steps: readonly { atTick: number; intents: readonly CommandIntent[] }[]): BotBehavior;
function randomWalk(opts: { commandType: string; payloadFor: (dx: number, dz: number) => unknown; every?: number }): BotBehavior;
```

Two ways to use bots:

1. **Headless, in the harness**: `Scenario.bots?: readonly BotDriver[]` —
   `runScenario` calls each driver once per tick before stepping, and
   records every submitted command (scripted and bot alike) into
   `verdict.replay.commands`, so `--verify-replay`/`--replay` never need bot
   code. See `scenarios/bots-headless.scenario.mjs`.
2. **Soak, over real sockets**: `SoakSpec.bot: (clientIndex) => BotDriver`
   drives a real `ClientSession` on a wall-clock pump (`harness-api.md`'s
   "Soak mode"). See `scenarios/net-walk.scenario.mjs` and friends.

## Workflow: adding multiplayer to a game

1. Write `setup(sim)` exactly like a single-player game, plus one addition:
   a system reacting to `"@net/join"`/`"@net/leave"` (payload
   `{ playerId: string }`) to spawn/despawn a player entity, keyed by
   `Command.actor` (not the join payload's bare `playerId` — the two are
   different strings; `actor` is server-assigned as `"player:" + playerId`
   and is what `InterestPolicy`/`owner`-component comparisons must match).
   **Derive the actor→entity lookup from a component (e.g. scan
   `withComponent("owner")` for the matching value) — never cache it in a
   setup-closure `Map`.** A closure Map is state `Sim.restore()` cannot
   rebuild: a fresh `setup()` call runs before restore replaces component
   data, so the Map starts empty and any actor who joined before the last
   snapshot silently loses every replayed command (see `core-api.md`'s
   restore section for the full reasoning). Make the join handler idempotent
   per actor too (skip spawning if the lookup already finds an entity for
   that actor) — a superseded connection's leave and its replacement's join
   can arrive close together. `apps/demo/src/game.ts` and
   `scenarios/lib/net-game.mjs` are worked examples — the exact same
   `setup()` backs the offline demo, the headless harness scenarios, and the
   net server.
2. Declare `CommandRule`s for every command type players can send —
   `validate` the payload shape, set `maxPerTick`/`maxPerSecond` for
   anything that shouldn't be spammable.
3. Server entry point: `startGameServer({ seed, setup, auth: devAuth(), commands, port })`
   — `devAuth()` for local dev/demo; swap in `ticketAuth(secret)` (mint
   tickets with `issueTicket`) before exposing a server beyond localhost.
4. Client entry point: `createClientSession({ transport: webSocketTransport(url), token })`,
   render `session.world` the same way a single-player `main.ts` renders a
   `Sim` (both implement `IWorld`) — see `apps/demo/src/main.ts`'s
   `?net=<url>` mode.
5. Verify with the harness before touching a browser: write a
   `Scenario.net`/`Scenario.soak` pair and run `--soak` — real server, real
   WebSocket clients, a `SoakReport` verdict, and a `--replay`-able command
   log, all without opening a tab.

## `apps/demo` net mode

`npm run serve -w @claude-engine/demo` starts a local server
(`devAuth()`, a permissive `move` rule — this app has no production build,
so CLAUDE.md's no-dev-in-prod rule is untriggered). Open
`http://localhost:5173/?net=ws://localhost:8787` (adjust ports to what
`serve`/`dev` print) in two tabs: each renders its own cube (colored
differently via the `owner`-vs-`session.actor` check above) and the other's
movement, replicated through the exact machinery this document describes.
