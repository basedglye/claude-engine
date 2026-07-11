/**
 * Deterministic, forkable random number generator (sfc32).
 *
 * This is the ONLY sanctioned randomness source for simulation code.
 * `fork(label)` derives an independent stream so that adding draws in one
 * subsystem never perturbs another — the key to keeping replays stable as
 * games grow.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string) {
    const s = typeof seed === "string" ? hashString(seed) : seed >>> 0;
    // Splash the single seed into four state words, then warm up.
    this.a = s ^ 0x9e3779b9;
    this.b = (s << 13) | (s >>> 19);
    this.c = s ^ 0x85ebca6b;
    this.d = (s * 0x27d4eb2f) >>> 0;
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Float in [0, 1). Drop-in replacement for the banned Math.random(). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[this.int(0, items.length - 1)]!;
  }

  /** Derive an independent, reproducible stream for a subsystem. */
  fork(label: string): Rng {
    return new Rng((this.nextUint32() ^ hashString(label)) >>> 0);
  }
}

function hashString(s: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
