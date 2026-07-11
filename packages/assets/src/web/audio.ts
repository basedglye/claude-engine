import type { MusicScore } from "../music.js";

function waveformFor(instrument: string): OscillatorType {
  switch (instrument) {
    case "bass":
      return "sawtooth";
    case "lead":
      return "triangle";
    default:
      return "sine";
  }
}

/**
 * Schedules every note in `score` as an oscillator + gain envelope on `ctx`,
 * starting at `ctx.currentTime`. Returns a handle that stops/disconnects all
 * scheduled nodes (safe to call more than once).
 */
export function playScore(
  score: MusicScore,
  ctx: AudioContext,
  destination: AudioNode = ctx.destination
): { stop(): void } {
  const startTime = ctx.currentTime;
  const secondsPerBeat = 60 / score.bpm;
  const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];

  for (const track of score.tracks) {
    const waveform = waveformFor(track.instrument);
    for (const note of track.notes) {
      const noteStart = startTime + note.beat * secondsPerBeat;
      const noteEnd = Math.max(
        noteStart + 0.02,
        noteStart + note.durationBeats * secondsPerBeat
      );
      const peak = Math.max(0.0001, Math.min(1, note.velocity)) * 0.2;

      const osc = ctx.createOscillator();
      osc.type = waveform;
      osc.frequency.value = note.pitchHz;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(peak, noteStart + 0.01);
      gain.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(gain);
      gain.connect(destination);
      osc.start(noteStart);
      osc.stop(noteEnd + 0.02);

      nodes.push({ osc, gain });
    }
  }

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const { osc, gain } of nodes) {
        try {
          osc.stop(ctx.currentTime);
        } catch {
          // already stopped/ended — ignore
        }
        osc.disconnect();
        gain.disconnect();
      }
    },
  };
}
