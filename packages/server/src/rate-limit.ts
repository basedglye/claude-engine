/** Simple token bucket for CommandRule.maxPerSecond: capacity == refill rate,
 *  so up to maxPerSecond may burst instantly, refilling continuously. */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  tryConsume(nowMs: number = Date.now()): boolean {
    const elapsedSec = Math.max(0, nowMs - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefillMs = nowMs;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
