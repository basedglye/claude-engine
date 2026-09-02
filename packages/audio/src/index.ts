/**
 * @claude-engine/audio — host-side procedural SFX + muzak layer.
 *
 * Extends the proven `assets` oscillator approach (packages/assets/src/
 * music.ts + src/web/audio.ts) with an event-table -> WebAudio scheduler.
 * The sim knows nothing of audio; the host feeds `Sim.eventsSince()` output
 * each frame and this package turns rows of `GameEvent`s into scheduled
 * oscillator/PannerNode graphs. See docs/PHASE-H2.md section 5B for the
 * contract this file implements verbatim, and section 7 rule 2: audio is
 * host-side, full stop — this package is NOT a purity root, is never a
 * `check-purity` root, and must never be imported by sim code (invariant 1/2
 * of CLAUDE.md; a component may never record a sound fact).
 */
import { Rng } from "@claude-engine/core";
import type { GameEvent } from "@claude-engine/core";
import { generateScore } from "@claude-engine/assets";
import { playScore } from "@claude-engine/assets/web";

/** A procedurally synthesized sound: oscillator recipe, not a sample file.
 *  All parameters are plain data so the SFX bank is diffable content. */
export interface SynthSpec {
  wave: OscillatorType; // "square" | "sawtooth" | "sine" | "triangle"
  freqHz: number;
  /** Optional pitch slide target (door creaks, crash whoops). */
  freqEndHz?: number;
  durationMs: number;
  gain: number; // 0..1
  /** Simple noise burst mixed in (crashes, printer chatter). */
  noiseMs?: number;
}

/** One row of the event->sound table. `at: "entity"` sounds are positional
 *  (PannerNode at the entity's world position, camera as listener);
 *  `at: "ui"` sounds are non-positional (screen clicks, audit chime). */
export interface SoundRule {
  eventType: string; // e.g. "guest.checkedIn", "door"
  spec: SynthSpec | readonly SynthSpec[]; // array = deterministic round-robin variants
  at: "entity" | "ui";
  /** Which payload field names the entity to position at (default "guestEntity"). */
  entityField?: string;
  /** Rate limit: at most one instance per this many ms (crowd protection). */
  minIntervalMs?: number;
}

export interface AudioHost {
  /** Feed the sim's new events each frame; the host schedules WebAudio.
   *  Idempotent per event (tracks the last consumed tick internally). */
  onEvents(events: readonly GameEvent[]): void;
  /** Muzak quality tracks star rating (a joke and a progression signal,
   *  B8) — regenerates the ambient score via assets' generateScore with
   *  tier-dependent scale/tempo/voice count. Deterministic per (seed, tier). */
  setMuzakTier(stars: number): void;
  /** AudioContext lifecycle (autoplay policy: call resume() on first user
   *  gesture; the harness never asserts audible output). */
  suspend(): void;
  resume(): void;
  dispose(): void;
}

export interface CreateAudioHostOpts {
  rules: readonly SoundRule[];
  /** Camera pose, polled per frame for the PannerNode listener. */
  listener: () => { xM: number; zM: number; yawRad: number };
  /** Resolve an entity id to a world position (metres), or undefined if
   *  gone — despawned entities simply drop their sound's position to "ui". */
  entityPos: (entity: number) => { xM: number; zM: number } | undefined;
  muzakSeed: string;
  ctx?: AudioContext; // injectable for tests
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
const PENTATONIC_SCALE = [0, 2, 4, 7, 9] as const;

/** Star-tier -> ambient score shape. Coverage-only content per open question
 *  16.4 in PHASE-H2.md — gated by `audio-coverage`, not by taste. Higher
 *  tiers get a fuller (major, faster) score; lower tiers stay sparse/minor,
 *  which reads as "budget muzak" without any judgment call baked into code. */
function scoreOptionsForTier(stars: number): { bpm: number; scale: readonly number[]; voices: 1 | 2 } {
  if (stars >= 2) return { bpm: 116, scale: MAJOR_SCALE, voices: 2 };
  if (stars >= 1) return { bpm: 96, scale: MINOR_SCALE, voices: 2 };
  return { bpm: 72, scale: PENTATONIC_SCALE, voices: 1 };
}

/** Reads an entity id out of an event payload by field name. Payloads are
 *  `unknown` at the type level (core's GameEvent contract) — this narrows
 *  defensively rather than trusting the shape. */
function readEntityField(payload: unknown, field: string): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "number" ? value : undefined;
}

/** Schedules one SynthSpec: oscillator + gain envelope, optional pitch
 *  slide, optional mixed-in noise burst (a buffer source of random samples
 *  — WebAudio has no built-in noise node). Mirrors assets/src/web/audio.ts's
 *  playScore scheduling shape so the two synthesis paths read as one style. */
function scheduleSynthSpec(
  ctx: AudioContext,
  spec: SynthSpec,
  destination: AudioNode
): { disconnect(): void } {
  const startTime = ctx.currentTime;
  const durationS = spec.durationMs / 1000;
  const endTime = startTime + durationS;
  const peak = Math.max(0.0001, Math.min(1, spec.gain));

  const osc = ctx.createOscillator();
  osc.type = spec.wave;
  osc.frequency.setValueAtTime(spec.freqHz, startTime);
  if (spec.freqEndHz !== undefined) {
    osc.frequency.linearRampToValueAtTime(spec.freqEndHz, endTime);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.005);
  gain.gain.linearRampToValueAtTime(0, endTime);

  osc.connect(gain);
  gain.connect(destination);
  osc.start(startTime);
  osc.stop(endTime + 0.02);

  const nodes: { disconnect(): void }[] = [osc, gain];

  if (spec.noiseMs !== undefined && spec.noiseMs > 0) {
    const noiseDurS = spec.noiseMs / 1000;
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * noiseDurS));
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    // Presentation-only synthesis (never sim state, never hashed) — plain
    // Math.random is explicitly legal here per docs/PHASE-H2.md section 5B
    // ("that fact is the package's one-line README headline"). We still use
    // a seeded Rng below for muzak so the (seed,tier) determinism contract
    // holds; noise texture itself has no determinism requirement.
    for (let i = 0; i < frameCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(peak * 0.5, startTime);
    noiseGain.gain.linearRampToValueAtTime(0, startTime + noiseDurS);
    noiseSrc.connect(noiseGain);
    noiseGain.connect(destination);
    noiseSrc.start(startTime);
    noiseSrc.stop(startTime + noiseDurS + 0.02);
    nodes.push(noiseSrc, noiseGain);
  }

  return {
    disconnect(): void {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // already disconnected — ignore
        }
      }
    },
  };
}

export function createAudioHost(opts: CreateAudioHostOpts): AudioHost {
  const ctx = opts.ctx;
  const ruleByType = new Map<string, SoundRule>();
  for (const rule of opts.rules) ruleByType.set(rule.eventType, rule);

  // Idempotence: track the highest tick already consumed AND how many
  // events at that exact tick were consumed, so re-feeding an overlapping
  // window (eventsSince(N) called again with a smaller N, or the exact
  // same window twice) never double-schedules. Tracking (tick, count) —
  // not tick alone — matters because several events can share one tick;
  // "tick alone" would either re-schedule the boundary tick's later events
  // on every re-feed, or silently drop them, depending on which side of
  // the boundary you round to.
  let lastConsumedTick = -1;
  let consumedCountAtLastTick = 0;

  // Deterministic round-robin variant counters, per rule (by eventType).
  // Rejected: Math.random for variant choice — legal per spec, but a
  // counter is simpler AND reproducible in the coverage-gate test, which
  // is worth more here than the (unneeded) unpredictability.
  const variantCounters = new Map<string, number>();

  // Per-rule rate limiting (minIntervalMs), keyed by eventType, tracking the
  // last-scheduled wall time in ctx.currentTime seconds.
  const lastFiredAtS = new Map<string, number>();

  let muzakHandle: { stop(): void } | undefined;
  let disposed = false;

  function pannerFor(pos: { xM: number; zM: number }): PannerNode | undefined {
    if (!ctx) return undefined;
    const panner = ctx.createPanner();
    panner.panningModel = "equalpower";
    panner.positionX.value = pos.xM;
    panner.positionY.value = 0;
    panner.positionZ.value = pos.zM;
    return panner;
  }

  function updateListener(): void {
    if (!ctx || !ctx.listener) return;
    const pose = opts.listener();
    const listener = ctx.listener;
    if (typeof listener.positionX?.setValueAtTime === "function") {
      listener.positionX.setValueAtTime(pose.xM, ctx.currentTime);
      listener.positionZ.setValueAtTime(pose.zM, ctx.currentTime);
    } else if ("setPosition" in listener && typeof listener.setPosition === "function") {
      // Older (deprecated but still-supported) WebAudio API shape.
      listener.setPosition(pose.xM, 0, pose.zM);
    }
  }

  function pickSpec(rule: SoundRule): SynthSpec {
    const specs: readonly SynthSpec[] = Array.isArray(rule.spec) ? rule.spec : [rule.spec as SynthSpec];
    const i = variantCounters.get(rule.eventType) ?? 0;
    variantCounters.set(rule.eventType, (i + 1) % specs.length);
    // specs.length > 0 is a table-authoring invariant, not runtime data.
    return specs[i % specs.length] as SynthSpec;
  }

  function scheduleForRule(rule: SoundRule, event: GameEvent): void {
    if (!ctx) return; // no AudioContext (missing/suspended) — degrade silently
    if (ctx.state === "suspended" || ctx.state === "closed") return;

    if (rule.minIntervalMs !== undefined) {
      const last = lastFiredAtS.get(rule.eventType);
      if (last !== undefined && (ctx.currentTime - last) * 1000 < rule.minIntervalMs) {
        return;
      }
      lastFiredAtS.set(rule.eventType, ctx.currentTime);
    }

    const spec = pickSpec(rule);

    let destination: AudioNode = ctx.destination;
    let panner: PannerNode | undefined;
    if (rule.at === "entity") {
      const entity = readEntityField(event.payload, rule.entityField ?? "guestEntity");
      const pos = entity !== undefined ? opts.entityPos(entity) : undefined;
      if (pos !== undefined) {
        panner = pannerFor(pos);
        if (panner) {
          panner.connect(ctx.destination);
          destination = panner;
        }
      }
      // pos undefined (despawned entity, or missing/misnamed field) ->
      // degrade to non-positional per the contract, rather than throwing.
    }

    scheduleSynthSpec(ctx, spec, destination);
  }

  return {
    onEvents(events: readonly GameEvent[]): void {
      if (disposed) return;
      updateListener();
      // idxInTick = this event's position among same-tick events IN THIS
      // BATCH (0-based). Because eventsSince is append-only and stable-
      // ordered, a re-feed of an overlapping window assigns the exact same
      // idxInTick to the exact same event, which is what makes comparing
      // against (lastConsumedTick, consumedCountAtLastTick) idempotent.
      let curTick = -1;
      let idxInTick = 0;
      for (const event of events) {
        if (event.tick !== curTick) {
          curTick = event.tick;
          idxInTick = 0;
        } else {
          idxInTick++;
        }
        if (curTick < lastConsumedTick) continue;
        if (curTick === lastConsumedTick && idxInTick < consumedCountAtLastTick) continue;

        const rule = ruleByType.get(event.type);
        if (rule) scheduleForRule(rule, event);

        lastConsumedTick = curTick;
        consumedCountAtLastTick = idxInTick + 1;
      }
    },

    setMuzakTier(stars: number): void {
      if (disposed || !ctx) return;
      if (ctx.state === "suspended" || ctx.state === "closed") return;
      muzakHandle?.stop();
      const { bpm, scale, voices } = scoreOptionsForTier(stars);
      // Deterministic per (muzakSeed, tier): forking the seed by tier keeps
      // each tier's score stable across repeated calls with the same tier,
      // while still varying between tiers.
      const rng = new Rng(`${opts.muzakSeed}:tier${stars}`);
      const score = generateScore(rng, { bpm, scale, lengthBeats: 32 });
      const tracks = voices === 1 ? score.tracks.slice(0, 1) : score.tracks;
      muzakHandle = playScore({ ...score, tracks }, ctx);
    },

    suspend(): void {
      if (!ctx) return;
      void ctx.suspend?.();
    },

    resume(): void {
      if (!ctx) return;
      void ctx.resume?.();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      muzakHandle?.stop();
      muzakHandle = undefined;
    },
  };
}

/** The completeness check the unit gate runs: every event type in
 *  `gameplayEventTypes` is either covered by `rules` or listed in
 *  `deliberatelySilent` — no event can be silently forgotten. */
export function auditSoundCoverage(
  rules: readonly SoundRule[],
  gameplayEventTypes: readonly string[],
  deliberatelySilent: readonly string[]
): { uncovered: string[]; unknownRules: string[] } {
  const ruleTypes = new Set(rules.map((r) => r.eventType));
  const silentTypes = new Set(deliberatelySilent);
  const knownTypes = new Set(gameplayEventTypes);

  const uncovered: string[] = [];
  for (const t of gameplayEventTypes) {
    if (!ruleTypes.has(t) && !silentTypes.has(t)) uncovered.push(t);
  }

  const unknownRules: string[] = [];
  for (const t of ruleTypes) {
    if (!knownTypes.has(t)) unknownRules.push(t);
  }

  return { uncovered, unknownRules };
}
