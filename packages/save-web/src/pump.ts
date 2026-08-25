import type { Command, SimSnapshot } from "@claude-engine/core";
import type { GameStore } from "@claude-engine/persistence";

/**
 * Host-side save pump wiring a live sim to a store. Risk 3 (docs/PHASE-H1.md
 * section B): the pump queues every command synchronously into an in-memory
 * write-ahead log *before* handing it to `passthrough`, so the sim never
 * waits on IndexedDB durability to advance a tick — only `snapshotNow`
 * (the night-audit ritual) depends on durability, because it flushes the
 * WAL before persisting the snapshot. See README.md for the crash-loss
 * window this implies.
 */
export function createSavePump(opts: {
  store: GameStore;
  gameId: string;
  /** Recommended snapshot cadence for the host's own tick loop to honour
   *  (e.g. "call snapshotNow every N ticks"). The pump has no tick loop of
   *  its own — it only ever sees commands, not every tick — so it cannot
   *  enforce this cadence itself; it is documented here for host wiring
   *  (main.ts) to read. Default 2000. */
  snapshotEveryTicks?: number;
}): {
  submit(c: Command, passthrough: (c: Command) => void): void;
  snapshotNow(sim: { snapshot(): SimSnapshot }): Promise<void>;
  flush(): Promise<void>;
} {
  const { store, gameId } = opts;
  const snapshotEveryTicks = opts.snapshotEveryTicks ?? 2000;
  void snapshotEveryTicks; // documented cadence only; see comment above

  /** The in-memory write-ahead log: commands queued here are already
   *  "logged" from the sim's point of view even before appendCommands()
   *  resolves. */
  let pending: Command[] = [];

  /** Serializes appendCommands() calls so batches land in submission order
   *  even if a caller fires flush() (or another submit-triggered flush)
   *  while a previous append is still in flight — otherwise two concurrent
   *  appendCommands calls could race on the per-tick idx counter. */
  let flushChain: Promise<void> = Promise.resolve();

  async function doFlush(): Promise<void> {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    await store.appendCommands(gameId, batch);
  }

  function scheduleFlush(): Promise<void> {
    flushChain = flushChain.then(doFlush);
    return flushChain;
  }

  function submit(c: Command, passthrough: (c: Command) => void): void {
    // WAL write happens synchronously, before the command is handed to the
    // sim — order is fixed the instant submit() returns, independent of
    // how slow the underlying store is.
    pending.push(c);
    passthrough(c);
    // Fire-and-forget: the caller does not await durability to keep
    // ticking. Errors surface the next time someone awaits flush()/
    // snapshotNow(), consistent with "only ticks past a snapshot depend on
    // durability."
    void scheduleFlush();
  }

  async function flush(): Promise<void> {
    await scheduleFlush();
  }

  /** Force a snapshot now (the audit ritual). Flushes the WAL first so the
   *  snapshot's tick has every command up to and including it durably
   *  appended — a future recoverSim(store, gameId, ...) starting from this
   *  snapshot never needs a command that isn't in the store. Resolves when
   *  durable. */
  async function snapshotNow(sim: { snapshot(): SimSnapshot }): Promise<void> {
    await flush();
    const snapshot = sim.snapshot();
    await store.saveSnapshot(gameId, snapshot);
  }

  function installLifecycleFlushHooks(): void {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flush();
      });
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("pagehide", () => void flush());
    }
  }
  installLifecycleFlushHooks();

  return { submit, snapshotNow, flush };
}
