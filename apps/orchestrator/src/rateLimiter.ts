// rateLimiter.ts

import { DomainConfig } from "@dredge/schemas";

// Internal type for storing bucket state
interface TokenBucket {
  tokens: number;
  lastRefill: number; // timestamp in milliseconds
}

// Map keyed by adapter name storing the token bucket for each adapter
const buckets = new Map<string, TokenBucket>();

/**
 * Sleep helper
 * @param ms milliseconds to wait
 */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire a token for a given domain config
 * Implements a token bucket per adapter
 */
export async function acquire(config: DomainConfig): Promise<void> {
  // No rate limit => return immediately
  if (!config.rateLimit) return;

  const adapter = config.name;
  const { requestsPerMinute } = config.rateLimit;

  // Get or initialize bucket for this adapter
  let bucket = buckets.get(adapter);
  const now = Date.now();
  if (!bucket) {
    bucket = { tokens: requestsPerMinute, lastRefill: now };
    buckets.set(adapter, bucket);
  }

  // Calculate how many tokens should be refilled
  const elapsedMinutes = (now - bucket.lastRefill) / 60000; // convert ms to minutes
  const tokensToAdd = elapsedMinutes * requestsPerMinute;
  bucket.tokens = Math.min(bucket.tokens + tokensToAdd, requestsPerMinute);
  bucket.lastRefill = now;

  // If a token is available, consume it and return immediately
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  // No tokens available, calculate wait time for 1 token
  const msPerToken = 60000 / requestsPerMinute; // ms per token
  await sleep(msPerToken);

  // Update bucket and consume token after wait
  bucket.tokens = Math.min(bucket.tokens + 1, requestsPerMinute) - 1;
  bucket.lastRefill = Date.now();
}
