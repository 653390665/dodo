/**
 * Simple in-memory token-bucket rate limiter for LLM endpoints.
 * Prevents runaway loops from burning API credits.
 */

const buckets = new Map<string, { tokens: number; lastRefill: number }>();

const RATE_LIMIT = { tokensPerSecond: 0.2, bucketSize: 5 } as const; // 1 token every 5s, max 5

export function rateLimit(endpoint: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(endpoint);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT.bucketSize, lastRefill: now };
    buckets.set(endpoint, bucket);
  }
  // Refill tokens
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(RATE_LIMIT.bucketSize, bucket.tokens + elapsed * RATE_LIMIT.tokensPerSecond);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/** @internal Test-only access for isolating route limiter state. */
export const __rateLimitTestHooks = {
  reset(): void {
    buckets.clear();
  },
};

// Periodic cleanup: remove stale entries to prevent unbounded Map growth
// Runs every 5 minutes to evict buckets where no tokens have been used in >10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [endpoint, bucket] of buckets) {
    if (bucket.lastRefill < cutoff) buckets.delete(endpoint);
  }
}, 5 * 60 * 1000).unref(); // unref prevents the timer from keeping the process alive
