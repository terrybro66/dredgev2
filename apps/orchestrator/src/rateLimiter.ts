import { DomainConfigV2 } from "@dredge/schemas";
import {
  RateLimiterRedis,
  RateLimiterMemory,
  RateLimiterAbstract,
} from "rate-limiter-flexible";
import Redis from "ioredis";
import { getRedisClient } from "./redis";

// ── Redis‑backed rate limiter (shared across instances) ──────────────────────

const adapterLimiters = new Map<string, Limiter>();

function getLimiter(adapter: string, requestsPerMinute: number): Limiter {
  let limiter = adapterLimiters.get(adapter);
  if (!limiter) {
    limiter = createRateLimiter({
      points: requestsPerMinute,
      duration: 60,
      keyPrefix: `rl:${adapter}`,
    });
    adapterLimiters.set(adapter, limiter);
  }
  return limiter;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquire(config: DomainConfigV2): Promise<void> {
  if (!config.rateLimit) return;

  const adapter = config.identity.name;
  const { requestsPerMinute } = config.rateLimit;
  const limiter = getLimiter(adapter, requestsPerMinute);
  const key = adapter; // use adapter as the Redis key suffix

  while (true) {
    try {
      await limiter.consume(key);
      return;
    } catch (e: any) {
      // e is an instance of RateLimiterRes when using rate-limiter-flexible
      const ms = e.msBeforeNext ?? 60000 / requestsPerMinute;
      await sleep(ms);
      // loop will retry after waiting
    }
  }
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
