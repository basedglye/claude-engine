# @claude-engine/save-web

Browser save/load: an IndexedDB implementation of the engine's existing
`GameStore` interface (`@claude-engine/persistence`), plus a host-side save
pump. No changes to `GameStore` — see the ruling in
[docs/PHASE-H1.md](../../docs/PHASE-H1.md), section B.

## Schema (version 1)

- `games` — key `id`
- `commands` — key `[gameId, tick, idx]`. `idx` is a per-`(gameId, tick)`
  counter maintained inside `appendCommands`'s own transaction, mirroring
  `sqliteStore`'s `(game_id, tick, idx)` primary key. `commandsSince` reads
  it back with a bound key-range cursor (`[gameId, afterTick+1]` .. `[gameId,
  Infinity]`), so intra-tick order is structural, not incidental.
- `snapshots` — key `[gameId, tick]`. `latestSnapshot` opens a `"prev"`
  cursor over `[gameId, -Infinity]` .. `[gameId, Infinity]` and takes the
  first hit. Snapshots are stored JSON-stringified, so an exported save file
  (`exportSave`) and the stored bytes share one canonical JSON form.

`appendCommands` is one readwrite transaction per call — that single
transaction is the write-ahead atomicity guarantee.

## The save pump and its crash-loss window

`createSavePump` returns `{ submit, snapshotNow, flush }`. All command
submission is meant to route through `submit(c, passthrough)`.

`submit` pushes the command into an **in-memory write-ahead log
synchronously**, then calls `passthrough(c)` so the sim consumes it
immediately — a tick never waits on IndexedDB durability. Appends are
batched and flushed asynchronously through a serialized promise chain, so
concurrent flushes can never race the per-tick `idx` counter or reorder a
batch.

**`snapshotNow` is the durability boundary.** It `flush()`es the WAL first,
*then* calls `sim.snapshot()` and persists it — so by construction, every
command up to and including the snapshot's tick is durably appended before
the snapshot itself lands. That is what makes `recoverSim`'s
"latest snapshot + `commandsSince(snapshotTick)`" recovery correct: it never
needs a command from *before* a snapshot that isn't already in the store.

**Crash-loss window: at most one flush batch.** If the tab is killed between
two flushes — i.e. after `submit()` has handed commands to the sim but
before the pending WAL batch has been durably appended — those commands are
lost on reload. This is bounded and acceptable: nothing *between* snapshots
needs to be durable for the sim to keep running, only the commands up to a
snapshot's tick need to have landed by the time that snapshot is taken, and
`snapshotNow` guarantees exactly that via its `flush()` call. `flush()` also
runs on `visibilitychange` (tab hidden) and `pagehide`, which shrinks the
window in practice to whatever commands were submitted in the interval since
the last such event.

`snapshotEveryTicks` (default 2000) is accepted by `createSavePump` as a
documented recommended cadence for the host's own tick loop to call
`snapshotNow` at — the pump has no tick loop of its own (it only observes
commands as they're submitted, not every tick), so it cannot enforce a tick
-based cadence internally. Host wiring (`apps/hotel/src/main.ts`) is
responsible for calling `snapshotNow` periodically, plus on the night-audit
event.

## Deferred: `listGames()` / `deleteGame()`

`GameStore` genuinely lacks what a real save-select UI needs —
`listGames()` and `deleteGame(id)` — and this package does not add them.
H1 uses a single fixed game id (`"hotel-sp"`); adding list/delete now would
touch `sqliteStore`/`postgresStore` in a phase that otherwise doesn't. This
is flagged as a **future additive change**, triggered by Phase 2's load
menu (see docs/PHASE-H1.md section B and the non-goals list).

## Load path

Loading a save is the existing `recoverSim(store, gameId, setup)` from
`@claude-engine/persistence` — unchanged, and not re-exported from this
package. It imports only `@claude-engine/core` plus the `GameStore`
interface, has no Node imports, and runs unmodified against a `webStore` in
the browser.
