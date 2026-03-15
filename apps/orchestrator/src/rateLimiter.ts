import { DomainConfig } from "@dredge/schemas";
import {
  RateLimiterRedis,
  RateLimiterMemory,
  RateLimiterAbstract,
} from "rate-limiter-flexible";
import Redis from "ioredis";
import { getRedisClient } from "./redis";

// ── Existing token bucket (unchanged) ────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquire(config: DomainConfig): Promise<void> {
  if (!config.rateLimit) return;

  const adapter = config.name;
  const { requestsPerMinute } = config.rateLimit;

  let bucket = buckets.get(adapter);
  const now = Date.now();
  if (!bucket) {
    bucket = { tokens: requestsPerMinute, lastRefill: now };
    buckets.set(adapter, bucket);
  }

  const elapsedMinutes = (now - bucket.lastRefill) / 60000;
  const tokensToAdd = elapsedMinutes * requestsPerMinute;
  bucket.tokens = Math.min(bucket.tokens + tokensToAdd, requestsPerMinute);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  const msPerToken = 60000 / requestsPerMinute;
  await sleep(msPerToken);

  bucket.tokens = Math.min(bucket.tokens + 1, requestsPerMinute) - 1;
  bucket.lastRefill = Date.now();
}

// ── Redis-backed limiter factory ──────────────────────────────────────────────

interface LimiterOptions {
  points: number;
  duration: number;
  keyPrefix?: string;
}

interface Limiter {
  consume: (key: string) => Promise<void>;
}

export function createRateLimiter(
  opts: LimiterOptions,
  redisClient?: Redis,
): Limiter {
  const client = redisClient ?? getRedisClient();
  let limiter: RateLimiterAbstract;

  if (client.status === "ready" || client.status === "connecting") {
    limiter = new RateLimiterRedis({
      storeClient: client,
      points: opts.points,
      duration: opts.duration,
      keyPrefix: opts.keyPrefix ?? "rl",
    });
  } else {
    limiter = new RateLimiterMemory({
      points: opts.points,
      duration: opts.duration,
      keyPrefix: opts.keyPrefix ?? "rl",
    });
  }

  return {
    consume: async (key: string) => {
      await limiter.consume(key);
    },
  };
}
