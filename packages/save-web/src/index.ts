// The load path is the existing recoverSim(store, gameId, setup) from
// @claude-engine/persistence, unchanged — it has no Node imports and runs
// fine against a webStore in the browser (docs/PHASE-H1.md section B).
// Not re-exported here; hosts import it directly from @claude-engine/persistence.
export { webStore, memoryStore, indexedDbAvailable } from "./web-store.js";
export { createSavePump } from "./pump.js";
export { exportSave, importSave } from "./save.js";
