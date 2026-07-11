import type { Rng } from "@claude-engine/core";

export interface Note {
  /** Onset, in beats from the start of the score. */
  beat: number;
  durationBeats: number;
  pitchHz: number;
  /** 0..1 */
  velocity: number;
}

export interface Track {
  /** Free-form instrument label (e.g. "lead", "bass"); the /web adapter maps
   *  this to an oscillator/gain configuration. */
  instrument: string;
  notes: Note[];
}

export interface MusicScore {
  bpm: number;
  lengthBeats: number;
  tracks: Track[];
}

export interface ScoreOptions {
  bpm?: number;
  lengthBeats?: number;
  /** Semitone offsets from the root, e.g. a major or minor scale. */
  scale?: readonly number[];
  rootHz?: number;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
const MELODY_DURATIONS = [0.5, 1, 1, 1, 2] as const;

function semitoneToHz(rootHz: number, semitones: number): number {
  return rootHz * Math.pow(2, semitones / 12);
}

/** Small deterministic melody + bass progression, driven entirely by `rng`. */
export function generateScore(rng: Rng, opts: ScoreOptions = {}): MusicScore {
  const lengthBeats = opts.lengthBeats ?? 32;
  const rootHz = opts.rootHz ?? 220;
  const bpm = opts.bpm ?? rng.fork("bpm").int(80, 128);
  const scale = opts.scale ?? (rng.fork("scale-pick").next() < 0.5 ? MAJOR_SCALE : MINOR_SCALE);

  const melodyRng = rng.fork("melody");
  const melodyNotes: Note[] = [];
  let beat = 0;
  while (beat < lengthBeats) {
    const duration = MELODY_DURATIONS[melodyRng.int(0, MELODY_DURATIONS.length - 1)] ?? 1;
    const degree = scale[melodyRng.int(0, scale.length - 1)] ?? 0;
    const octave = melodyRng.int(0, 1);
    const pitchHz = semitoneToHz(rootHz, degree + octave * 12);
    const velocity = 0.5 + melodyRng.next() * 0.4;
    const clampedDuration = Math.min(duration, lengthBeats - beat);
    melodyNotes.push({ beat, durationBeats: clampedDuration, pitchHz, velocity });
    beat += duration;
  }

  const bassRng = rng.fork("bass");
  const bassNotes: Note[] = [];
  for (let b = 0; b < lengthBeats; b += 4) {
    const degree = scale[bassRng.int(0, scale.length - 1)] ?? 0;
    const pitchHz = semitoneToHz(rootHz / 2, degree);
    const velocity = 0.6 + bassRng.next() * 0.3;
    bassNotes.push({ beat: b, durationBeats: Math.min(4, lengthBeats - b), pitchHz, velocity });
  }

  return {
    bpm,
    lengthBeats,
    tracks: [
      { instrument: "lead", notes: melodyNotes },
      { instrument: "bass", notes: bassNotes },
    ],
  };
}
