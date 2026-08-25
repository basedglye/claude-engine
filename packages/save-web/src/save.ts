import type { Command, SimSnapshot } from "@claude-engine/core";
import type { GameStore } from "@claude-engine/persistence";

/** The canonical JSON shape shared by an exported save file and the bytes
 *  webStore actually persists (docs/PHASE-H1.md section B) — a save file
 *  doubles as a bug-report replay. */
interface SaveFile {
  v: 1;
  game: { name: string; seed: string };
  /** All commands from tick 0 onward, in (tick, idx) order — the full
   *  event-sourced log, independent of whatever snapshot exists. */
  commands: Command[];
  snapshot: SimSnapshot | null;
}

/** Export a save as canonical JSON: the game's identity, its full command
 *  log, and its latest snapshot (if any). Re-importable via importSave. */
export async function exportSave(store: GameStore, gameId: string): Promise<string> {
  const record = await store.getGame(gameId);
  if (!record) {
    throw new Error(`exportSave: no game record for id "${gameId}"`);
  }
  const [commands, snapshot] = await Promise.all([
    store.commandsSince(gameId, -1),
    store.latestSnapshot(gameId),
  ]);
  const file: SaveFile = {
    v: 1,
    game: { name: record.name, seed: record.seed },
    commands: [...commands],
    snapshot,
  };
  return JSON.stringify(file);
}

/** Import a save exported by exportSave, as a brand-new game record (never
 *  overwrites an existing id — GameStore.createGame's own id generation
 *  supplies a fresh one). Returns the new gameId. */
export async function importSave(store: GameStore, json: string): Promise<string> {
  const file = JSON.parse(json) as SaveFile;
  if (file.v !== 1) {
    throw new Error(`importSave: unsupported save file version ${(file as { v: unknown }).v}`);
  }
  const record = await store.createGame({ name: file.game.name, seed: file.game.seed });
  if (file.commands.length > 0) {
    await store.appendCommands(record.id, file.commands);
  }
  if (file.snapshot) {
    await store.saveSnapshot(record.id, file.snapshot);
  }
  return record.id;
}
