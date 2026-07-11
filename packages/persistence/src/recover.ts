import { Sim } from "@claude-engine/core";
import type { GameRecord, GameStore } from "./store.js";

/**
 * Snapshot -> restore -> replay tail: the co-designed payoff of Phase 3
 * Scope A's Sim.restore(). Reconstructs a live Sim whose stateHash() equals
 * what an uninterrupted run would show, from whatever a store holds for
 * `gameId` — a fresh Sim replaying the full log if there is no snapshot yet.
 */
export async function recoverSim(
  store: GameStore,
  gameId: string,
  setup: (sim: Sim) => void
): Promise<{ sim: Sim; record: GameRecord }> {
  const record = await store.getGame(gameId);
  if (!record) {
    throw new Error(`recoverSim: no game record for id "${gameId}"`);
  }

  const sim = new Sim(record.seed);
  setup(sim);

  const snapshot = await store.latestSnapshot(gameId);
  let afterTick = 0;
  if (snapshot) {
    sim.restore(snapshot);
    afterTick = snapshot.tick;
  }

  const tail = await store.commandsSince(gameId, afterTick);
  const byTick = new Map<number, typeof tail[number][]>();
  for (const c of tail) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const maxTick = tail.reduce((m, c) => Math.max(m, c.tick), afterTick);
  for (let t = afterTick + 1; t <= maxTick; t++) {
    for (const c of byTick.get(t) ?? []) sim.submit(c);
    sim.step();
  }

  return { sim, record };
}
