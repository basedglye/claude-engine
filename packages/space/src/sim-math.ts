// Deterministic fixed-point math for sim code. Every function here is
// integer-in/integer-out and computed without any Math.* transcendental —
// Math.sin/cos/atan2/etc. are implementation-defined at boundary values and
// diverge across JS engines, which is exactly the failure this module exists
// to remove (see docs/PHASE-H0.md, Determinism rules #2). Only
// Math.floor/round/abs/min/max/sign/trunc are used below — all exactly
// specified by ECMAScript and therefore safe.
import { SIN_LUT } from "./sin-lut.js";

/** Fixed-point Q16.16 scale: trig results are integers in [-ONE, ONE]. */
export const ONE = 65536;
/** Full circle in millidegrees. All angle args are wrapped mod 360_000. */
export const FULL_TURN_MDEG = 360_000;

// LUT covers 0.0..90.0 degrees in 0.1 degree steps (901 entries, index i ->
// i*0.1 deg). One LUT step in millidegrees:
const LUT_STEP_MDEG = 100; // 0.1 deg
const LUT_LAST_INDEX = SIN_LUT.length - 1; // 900

/** Wrap an arbitrary integer millidegree value into [0, 360_000). */
function wrapMdeg(mdeg: number): number {
  let m = mdeg % FULL_TURN_MDEG;
  if (m < 0) m += FULL_TURN_MDEG;
  return m;
}

/** sin(0..90deg) via linear interpolation over the committed SIN_LUT table.
 *  `quarterMdeg` must already be wrapped into [0, 90_000]. Rounds to the
 *  nearest integer Q16.16 value (documented rounding point). */
function sinLookupFirstQuadrant(quarterMdeg: number): number {
  const posInSteps = quarterMdeg / LUT_STEP_MDEG; // fractional step index
  let idx = Math.floor(posInSteps);
  if (idx >= LUT_LAST_INDEX) return SIN_LUT[LUT_LAST_INDEX]!;
  if (idx < 0) idx = 0;
  const frac = posInSteps - idx; // in [0, 1)
  const lo = SIN_LUT[idx]!;
  const hi = SIN_LUT[idx + 1]!;
  // Integer-rounded linear interpolation.
  return Math.round(lo + (hi - lo) * frac);
}

/** sin of an angle in millidegrees, as Q16.16 integer. Deterministic across
 *  JS engines: computed by integer linear interpolation over the committed
 *  SIN_LUT table (never Math.sin). */
export function sinMdeg(mdeg: number): number {
  const wrapped = wrapMdeg(mdeg);
  if (wrapped <= 90_000) {
    return sinLookupFirstQuadrant(wrapped);
  } else if (wrapped <= 180_000) {
    return sinLookupFirstQuadrant(180_000 - wrapped);
  } else if (wrapped <= 270_000) {
    return -sinLookupFirstQuadrant(wrapped - 180_000);
  } else {
    return -sinLookupFirstQuadrant(360_000 - wrapped);
  }
}

export function cosMdeg(mdeg: number): number {
  return sinMdeg(mdeg + 90_000);
}

/** floor(sqrt(n)) for n >= 0, integer Newton iteration. Throws on n < 0. */
export function isqrt(n: number): number {
  if (n < 0) throw new Error("isqrt: negative input");
  if (n === 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

/** Integer atan2 over integer coordinates (e.g. mm deltas), returning
 *  millidegrees in [0, 360_000). Octant reduction + binary search over
 *  SIN_LUT — no floating transcendentals. Accuracy: within 100 mdeg.
 *  atan2Mdeg(0, 0) is documented to return 0. */
export function atan2Mdeg(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;

  // Reduce to the first octant (0..45deg), tracking the transform to invert.
  const negX = x < 0;
  const negY = y < 0;
  let ax = Math.abs(x);
  let ay = Math.abs(y);
  // swap so ax >= ay >= 0 (first octant: angle in [0,45])
  const swapped = ay > ax;
  if (swapped) {
    const t = ax;
    ax = ay;
    ay = t;
  }

  // angle = atan(ay/ax) in [0, 45000] mdeg. Binary search over SIN_LUT for
  // the angle whose sin/cos ratio best matches ay/ax, i.e. find idx such
  // that SIN_LUT[idx] * ax is closest to SIN_LUT[LUT_LAST_INDEX-idx]*... —
  // simpler: for angle t in [0,45], tan(t) = sin(t)/cos(t) = sin(t)/sin(90-t).
  // Binary search idx in [0, 450] (0..45deg in 0.1deg steps) comparing
  // ay * cos(t) vs ax * sin(t), i.e. ay*SIN_LUT[900-idx] vs ax*SIN_LUT[idx].
  let lo = 0;
  let hi = 450; // 45.0 deg in LUT steps
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1; // bias high to converge on floor
    const sinMid = SIN_LUT[mid]!;
    const cosMid = SIN_LUT[900 - mid]!;
    // tan(mid) = sinMid/cosMid <= ay/ax  <=>  sinMid*ax <= ay*cosMid
    if (sinMid * ax <= ay * cosMid) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  let angleMdeg = lo * LUT_STEP_MDEG; // 0..45000, first octant

  if (swapped) angleMdeg = 90_000 - angleMdeg;

  // angleMdeg now in [0, 90000], the angle for (ax, ay) i.e. quadrant 1
  // magnitudes. Reflect into the actual quadrant.
  let result: number;
  if (!negX && !negY) {
    result = angleMdeg; // quadrant 1: [0,90]
  } else if (negX && !negY) {
    result = 180_000 - angleMdeg; // quadrant 2: [90,180]
  } else if (negX && negY) {
    result = 180_000 + angleMdeg; // quadrant 3: [180,270]
  } else {
    result = 360_000 - angleMdeg; // quadrant 4: [270,360]
  }
  return wrapMdeg(result);
}

/** Smallest signed difference a-b in millidegrees, in (-180_000, 180_000]. */
export function angleDeltaMdeg(a: number, b: number): number {
  let d = wrapMdeg(a) - wrapMdeg(b);
  d = ((d % FULL_TURN_MDEG) + FULL_TURN_MDEG) % FULL_TURN_MDEG; // [0,360000)
  if (d > 180_000) d -= FULL_TURN_MDEG; // (-180000,180000]
  return d;
}
