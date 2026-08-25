/**
 * Guest archetype/spawn DATA for Phase H1a: names, segments, document field
 * flavour. Deliberately NOT behaviour — archetype behaviours are a listed
 * non-goal this phase (docs/PHASE-H1.md non-goals list); guestBrainSystem
 * in game.ts runs the one shared FSM for every guest regardless of
 * archetype. Pure; imported only by game.ts's guestSpawnSystem.
 */
import type { Rng } from "@claude-engine/core";

export interface Archetype {
  id: string;
  segment: string;
  names: readonly string[];
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "business",
    segment: "business",
    names: ["Alex Rivera", "Jordan Blake", "Sam Chen", "Taylor Morgan"],
  },
  {
    id: "leisure",
    segment: "leisure",
    names: ["Casey Nguyen", "Riley Ortiz", "Morgan Diaz", "Jamie Foster"],
  },
  {
    id: "family",
    segment: "family",
    names: ["Pat Whitfield", "Drew Sanchez", "Robin Delacroix", "Quinn Baptiste"],
  },
];

export function pickArchetype(rng: Rng): Archetype {
  return rng.pick(ARCHETYPES);
}

export function pickGuestName(archetype: Archetype, rng: Rng): string {
  return rng.pick(archetype.names);
}

/** Reservation code flavour, e.g. "RC-4821". */
export function makeResCode(rng: Rng): string {
  return `RC-${rng.int(1000, 9999)}`;
}

/** ID document number flavour, e.g. "X482913". */
export function makeDocNumber(rng: Rng): string {
  return `X${rng.int(100000, 999999)}`;
}
